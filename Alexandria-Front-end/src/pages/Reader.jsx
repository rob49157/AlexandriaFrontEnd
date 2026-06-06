import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import * as pdfjsLib from 'pdfjs-dist'
import { PDFDocument, rgb, StandardFonts, degrees } from 'pdf-lib'
import { useWallet } from '../context/WalletContext'
import { MOCK_BOOKS } from '../data/mockBooks'
import '../styles/Reader.css'

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString()

// ── Mock PDF generation ───────────────────────────────────────────
const LOREM =
  'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor ' +
  'incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud ' +
  'exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure ' +
  'dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. ' +
  'Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit ' +
  'anim id est laborum. Sed ut perspiciatis unde omnis iste natus error sit voluptatem ' +
  'accusantium doloremque laudantium totam rem aperiam eaque ipsa quae ab illo inventore.'

async function generateMockPDF(book) {
  const doc       = await PDFDocument.create()
  const titleFont = await doc.embedFont(StandardFonts.TimesRomanBold)
  const bodyFont  = await doc.embedFont(StandardFonts.TimesRoman)
  const PAGE      = [595, 842]

  // Title page
  const tp = doc.addPage(PAGE)
  tp.drawText(book?.title  ?? 'Untitled', { x: 72, y: 680, size: 28, font: titleFont, color: rgb(0.08, 0.08, 0.08), maxWidth: 451, lineHeight: 38 })
  tp.drawText(book?.author ?? 'Unknown Author',  { x: 72, y: 580, size: 16, font: bodyFont,  color: rgb(0.35, 0.35, 0.35) })
  tp.drawText('Preserved on Alexandria · Permanent Arweave Storage', { x: 72, y: 550, size: 10, font: bodyFont, color: rgb(0.6, 0.6, 0.6) })
  if (book?.description) {
    tp.drawText(book.description.slice(0, 300), { x: 72, y: 480, size: 11, font: bodyFont, color: rgb(0.25, 0.25, 0.25), maxWidth: 451, lineHeight: 18 })
  }

  // Content pages
  for (let i = 1; i <= 9; i++) {
    const p = doc.addPage(PAGE)
    p.drawText(`Chapter ${i}`, { x: 72, y: 770, size: 15, font: titleFont, color: rgb(0.12, 0.12, 0.12) })
    let y = 740
    for (let j = 0; j < 5; j++) {
      p.drawText(LOREM, { x: 72, y, size: 11, font: bodyFont, color: rgb(0.15, 0.15, 0.15), maxWidth: 451, lineHeight: 18 })
      y -= 120
    }
    p.drawText(String(i + 1), { x: 291, y: 28, size: 9, font: bodyFont, color: rgb(0.5, 0.5, 0.5) })
  }

  return doc.save()
}

// ── Watermarking ──────────────────────────────────────────────────
async function addWatermarks(pdfBytes, { walletAddress, rentalDate, expiryDate }) {
  const doc      = await PDFDocument.load(pdfBytes)
  const font     = await doc.embedFont(StandardFonts.Helvetica)
  const boldFont = await doc.embedFont(StandardFonts.HelveticaBold)
  const footer   = `Licensed to: ${walletAddress} | Rental: ${rentalDate} | Expires: ${expiryDate}`

  for (const page of doc.getPages()) {
    const { width, height } = page.getSize()
    // Footer strip
    page.drawText(footer, { x: 10, y: 11, size: 6, font, color: rgb(0.45, 0.45, 0.45), opacity: 0.75 })
    // Diagonal ghost watermark
    page.drawText(walletAddress.slice(0, 18) + '…', {
      x: width / 2 - 90, y: height / 2,
      size: 16, font: boldFont,
      color: rgb(0.65, 0.65, 0.65), opacity: 0.06,
      rotate: degrees(40),
    })
  }
  return doc.save()
}

// ── Load steps ────────────────────────────────────────────────────
const STEPS = [
  { key: 'fetching',    label: 'Fetching encrypted PDF from Arweave'        },
  { key: 'lit',         label: 'Requesting decryption key from Lit Protocol' },
  { key: 'decrypting',  label: 'Decrypting PDF in browser memory'            },
  { key: 'watermarking',label: 'Applying watermarks'                         },
]

// ── Countdown ─────────────────────────────────────────────────────
function Countdown({ expiryMs }) {
  const [rem, setRem] = useState(Math.max(0, expiryMs - Date.now()))
  useEffect(() => {
    const id = setInterval(() => setRem(Math.max(0, expiryMs - Date.now())), 1000)
    return () => clearInterval(id)
  }, [expiryMs])
  if (rem === 0) return <span style={{ color: '#e06060' }}>Expired</span>
  const d = Math.floor(rem / 86_400_000)
  const h = Math.floor((rem % 86_400_000) / 3_600_000)
  const m = Math.floor((rem % 3_600_000) / 60_000)
  const s = Math.floor((rem % 60_000) / 1_000)
  return <span>{d}d {String(h).padStart(2,'0')}:{String(m).padStart(2,'0')}:{String(s).padStart(2,'0')}</span>
}

// ── Component ─────────────────────────────────────────────────────
export default function Reader() {
  const { arweaveHash } = useParams()
  const navigate        = useNavigate()
  const { address }     = useWallet()

  const book         = MOCK_BOOKS.find(b => b.arweaveHash === arweaveHash)
  const storedExpiry = sessionStorage.getItem(`rental_expiry_${arweaveHash}`)
  const rentalExpiry = storedExpiry ? parseInt(storedExpiry, 10) : Date.now() + 7 * 86_400_000

  // Flow state
  const [loadPhase,    setLoadPhase]    = useState('idle')  // idle|fetching|lit|decrypting|watermarking|ready|error
  const [doneSteps,    setDoneSteps]    = useState([])
  const [loadError,    setLoadError]    = useState(null)

  // PDF state
  const [pdfDoc,       setPdfDoc]       = useState(null)
  const [totalPages,   setTotalPages]   = useState(0)
  const [currentPage,  setCurrentPage]  = useState(1)
  const [scale,        setScale]        = useState(1.25)
  const [rendering,    setRendering]    = useState(false)

  // Refs — never persisted to storage
  const canvasRef      = useRef(null)
  const containerRef   = useRef(null)
  const renderTaskRef  = useRef(null)
  const pdfBytesRef    = useRef(null) // in-memory only, wiped on unmount

  // ── Loading pipeline ──
  useEffect(() => {
    let cancelled = false

    const run = async () => {
      const walletAddr = address ?? '0x0000000000000000000000000000000000000000'
      const today      = new Date().toISOString().slice(0, 10)
      const expDate    = new Date(rentalExpiry).toISOString().slice(0, 10)

      setLoadPhase('fetching')
      // fetch(`https://arweave.net/${arweaveHash}`) then .arrayBuffer() → encryptedBytes
      await new Promise(r => setTimeout(r, 1600))
      if (cancelled) return
      const rawBytes = await generateMockPDF(book) // replace with real Arweave fetch
      if (cancelled) return
      setDoneSteps(s => [...s, 'fetching'])

      setLoadPhase('lit')
      // const { decryptionKey } = await litClient.executeJs({ ... accessControlConditions, ... })
      await new Promise(r => setTimeout(r, 1000))
      if (cancelled) return
      setDoneSteps(s => [...s, 'lit'])

      setLoadPhase('decrypting')
      // const decryptedBytes = await decryptAES256GCM(encryptedBytes, decryptionKey)
      await new Promise(r => setTimeout(r, 700))
      if (cancelled) return
      setDoneSteps(s => [...s, 'decrypting'])

      setLoadPhase('watermarking')
      const watermarked = await addWatermarks(rawBytes, {
        walletAddress: walletAddr,
        rentalDate: today,
        expiryDate: expDate,
      })
      if (cancelled) return
      pdfBytesRef.current = watermarked
      setDoneSteps(s => [...s, 'watermarking'])

      const task = pdfjsLib.getDocument({ data: watermarked })
      const doc  = await task.promise
      if (cancelled) return

      setPdfDoc(doc)
      setTotalPages(doc.numPages)
      setLoadPhase('ready')
    }

    run().catch(err => {
      if (!cancelled) { setLoadPhase('error'); setLoadError(err.message) }
    })

    return () => {
      cancelled = true
      pdfBytesRef.current = null
    }
  }, [])

  // ── Render page on canvas ──
  useEffect(() => {
    if (!pdfDoc || loadPhase !== 'ready' || !canvasRef.current) return
    let cancelled = false

    const render = async () => {
      setRendering(true)
      if (renderTaskRef.current) { try { renderTaskRef.current.cancel() } catch {} }
      try {
        const page     = await pdfDoc.getPage(currentPage)
        const viewport = page.getViewport({ scale })
        const canvas   = canvasRef.current
        if (!canvas || cancelled) return
        canvas.width  = viewport.width
        canvas.height = viewport.height
        const task = page.render({ canvasContext: canvas.getContext('2d'), viewport })
        renderTaskRef.current = task
        await task.promise
      } catch (e) {
        if (e?.name !== 'RenderingCancelledException') console.error(e)
      } finally {
        if (!cancelled) setRendering(false)
      }
    }

    render()
    return () => { cancelled = true }
  }, [pdfDoc, currentPage, scale, loadPhase])

  // ── Keyboard navigation ──
  useEffect(() => {
    const handle = (e) => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown')  setCurrentPage(p => Math.min(p + 1, totalPages))
      if (e.key === 'ArrowLeft'  || e.key === 'ArrowUp')    setCurrentPage(p => Math.max(p - 1, 1))
    }
    window.addEventListener('keydown', handle)
    return () => window.removeEventListener('keydown', handle)
  }, [totalPages])

  // ── Clear on tab hide (security) ──
  useEffect(() => {
    const onHide = () => { if (document.hidden) pdfBytesRef.current = null }
    document.addEventListener('visibilitychange', onHide)
    return () => document.removeEventListener('visibilitychange', onHide)
  }, [])

  // ── Rental expiry redirect ──
  useEffect(() => {
    const id = setInterval(() => {
      if (Date.now() > rentalExpiry) navigate(`/book/${arweaveHash}`)
    }, 15_000)
    return () => clearInterval(id)
  }, [rentalExpiry, arweaveHash, navigate])

  const zoomIn  = useCallback(() => setScale(s => Math.min(+(s + 0.25).toFixed(2), 2.5)), [])
  const zoomOut = useCallback(() => setScale(s => Math.max(+(s - 0.25).toFixed(2), 0.5)), [])
  const goBack  = useCallback(() => navigate(`/book/${arweaveHash}`), [arweaveHash, navigate])

  // ── Render ──
  if (loadPhase !== 'ready' && loadPhase !== 'error') {
    return (
      <div className="reader-load">
        <div className="reader-load__card">
          <div className="reader-load__spinner" />
          <p className="reader-load__title">
            {book ? `Opening: ${book.title}` : 'Opening book…'}
          </p>
          <div className="reader-load__steps">
            {STEPS.map(({ key, label }) => {
              const done   = doneSteps.includes(key)
              const active = loadPhase === key
              return (
                <div key={key} className={`reader-load__step${done ? ' reader-load__step--done' : active ? ' reader-load__step--active' : ''}`}>
                  <span className="reader-load__step-icon">
                    {done ? '✓' : active ? <span className="reader-load__spin" /> : '○'}
                  </span>
                  <span className="reader-load__step-label">{label}</span>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    )
  }

  if (loadPhase === 'error') {
    return (
      <div className="reader-load">
        <div className="reader-load__card">
          <p style={{ color: '#e06060', marginBottom: '1rem' }}>Failed to load book</p>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginBottom: '1.5rem' }}>{loadError}</p>
          <button onClick={goBack} style={{ background: 'var(--accent)', border: 'none', borderRadius: '8px', color: '#0a0a12', fontWeight: 700, padding: '0.625rem 1.5rem', cursor: 'pointer' }}>
            ← Back to Book
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="reader">
      {/* ── Top bar ── */}
      <header className="reader__topbar">
        <button className="reader__back" onClick={goBack}>← Back</button>
        <span className="reader__book-title">{book?.title ?? arweaveHash}</span>
        <div className="reader__expiry">
          <span className="reader__expiry-label">Expires in</span>
          <span className="reader__expiry-timer"><Countdown expiryMs={rentalExpiry} /></span>
        </div>
      </header>

      {/* ── Canvas area ── */}
      <div className="reader__canvas-area" ref={containerRef}>
        {rendering && <div className="reader__page-spinner"><span className="reader-load__spin" /></div>}
        <canvas ref={canvasRef} className="reader__canvas" />
      </div>

      {/* ── Control bar ── */}
      <footer className="reader__controlbar">
        <button
          className="reader__ctrl-btn"
          onClick={() => setCurrentPage(p => Math.max(p - 1, 1))}
          disabled={currentPage <= 1}
          aria-label="Previous page"
        >‹</button>

        <span className="reader__page-info">
          Page <strong>{currentPage}</strong> of {totalPages}
        </span>

        <button
          className="reader__ctrl-btn"
          onClick={() => setCurrentPage(p => Math.min(p + 1, totalPages))}
          disabled={currentPage >= totalPages}
          aria-label="Next page"
        >›</button>

        <div className="reader__divider" />

        <button className="reader__ctrl-btn reader__ctrl-btn--zoom" onClick={zoomOut} disabled={scale <= 0.5} aria-label="Zoom out">−</button>
        <span className="reader__zoom-label">{Math.round(scale * 100)}%</span>
        <button className="reader__ctrl-btn reader__ctrl-btn--zoom" onClick={zoomIn}  disabled={scale >= 2.5} aria-label="Zoom in">+</button>
      </footer>
    </div>
  )
}
