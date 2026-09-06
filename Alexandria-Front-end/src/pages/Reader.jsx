import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import * as pdfjsLib from 'pdfjs-dist'
import { PDFDocument, rgb, StandardFonts, degrees } from 'pdf-lib'
import { useWallet } from '../context/WalletContext'
import { getUpload, getDecryptParams } from '../services/api'
import { unwrapKeyFromLit } from '../services/lit'
import { decryptPdfInBrowser, zeroMemory } from '../services/decryption'
import { MOCK_BOOKS } from '../data/mockBooks'
import '../styles/Reader.css'

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString()

const ARWEAVE_GATEWAY = import.meta.env.VITE_ARWEAVE_GATEWAY || 'https://gateway.irys.xyz'

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
  { key: 'fetching',     label: 'Downloading encrypted PDF from Arweave'       },
  { key: 'params',       label: 'Retrieving decryption envelope from backend' },
  { key: 'lit',          label: 'Verifying on-chain rental & unsealing via Lit' },
  { key: 'decrypting',   label: 'Decrypting PDF in browser memory (WebCrypto)' },
  { key: 'watermarking', label: 'Applying reader watermark'                    },
]

// ── Countdown ─────────────────────────────────────────────────────
function Countdown({ expiryMs }) {
  const [rem, setRem] = useState(() => Math.max(0, expiryMs - Date.now()))
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

  const [bookTitle,    setBookTitle]    = useState('')
  const storedExpiry = sessionStorage.getItem(`rental_expiry_${arweaveHash}`)
  const rentalExpiry = storedExpiry ? parseInt(storedExpiry, 10) : Date.now() + 7 * 86_400_000

  // Flow state
  const [loadPhase,    setLoadPhase]    = useState('idle')  // idle|fetching|params|lit|decrypting|watermarking|ready|error
  const [doneSteps,    setDoneSteps]    = useState([])
  const [loadError,    setLoadError]    = useState(null)

  // PDF state
  const [pdfDoc,       setPdfDoc]       = useState(null)
  const [totalPages,   setTotalPages]   = useState(0)
  const [currentPage,  setCurrentPage]  = useState(1)
  const [scale,        setScale]        = useState(1.25)
  const [rendering,    setRendering]    = useState(false)

  // Refs — in-memory only, wiped on unmount
  const canvasRef      = useRef(null)
  const containerRef   = useRef(null)
  const renderTaskRef  = useRef(null)
  const pdfBytesRef    = useRef(null)

  // ── Loading pipeline ──
  useEffect(() => {
    let cancelled = false

    const run = async () => {
      const walletAddr = address ?? '0x0000000000000000000000000000000000000000'
      const today      = new Date().toISOString().slice(0, 10)
      const expDate    = new Date(rentalExpiry).toISOString().slice(0, 10)

      // Fetch book title for UI
      getUpload(arweaveHash)
        .then(data => { if (!cancelled && data?.title) setBookTitle(data.title) })
        .catch(() => {
          const mock = MOCK_BOOKS.find(b => b.arweaveHash === arweaveHash)
          if (!cancelled && mock) setBookTitle(mock.title)
        })

      // Step 1: Download encrypted PDF from Arweave / Irys
      setLoadPhase('fetching')
      const gatewayRes = await fetch(`${ARWEAVE_GATEWAY}/${arweaveHash}`)
      if (!gatewayRes.ok) {
        throw new Error(`Failed to download encrypted PDF from Arweave gateway (${gatewayRes.status})`)
      }
      const encryptedBuffer = await gatewayRes.arrayBuffer()
      if (cancelled) return
      setDoneSteps(s => [...s, 'fetching'])

      // Step 2: Fetch decryption parameters from backend
      setLoadPhase('params')
      const decryptParams = await getDecryptParams(arweaveHash, walletAddr)
      if (cancelled) return
      setDoneSteps(s => [...s, 'params'])

      // Step 3: Unwrap symmetric key via Lit Protocol TEE
      setLoadPhase('lit')
      const symmetricKeyBase64 = await unwrapKeyFromLit(decryptParams.litEncryptedKeyId, walletAddr)
      if (cancelled) return
      setDoneSteps(s => [...s, 'lit'])

      // Step 4: WebCrypto AES-256-GCM decryption in browser RAM
      setLoadPhase('decrypting')
      const decryptedPdfBytes = await decryptPdfInBrowser(
        encryptedBuffer,
        symmetricKeyBase64,
        decryptParams.encryptionIv,
        decryptParams.encryptionAuthTag
      )
      if (cancelled) return
      setDoneSteps(s => [...s, 'decrypting'])

      // Step 5: Apply dynamic watermarks
      setLoadPhase('watermarking')
      const watermarked = await addWatermarks(decryptedPdfBytes, {
        walletAddress: walletAddr,
        rentalDate: today,
        expiryDate: expDate,
      })
      if (cancelled) return
      zeroMemory(decryptedPdfBytes) // zero unwatermarked buffer
      pdfBytesRef.current = watermarked
      setDoneSteps(s => [...s, 'watermarking'])

      // Step 6: Render in PDF.js
      const task = pdfjsLib.getDocument({ data: watermarked })
      const doc  = await task.promise
      if (cancelled) return

      setPdfDoc(doc)
      setTotalPages(doc.numPages)
      setLoadPhase('ready')
    }

    run().catch(err => {
      if (!cancelled) {
        setLoadPhase('error')
        setLoadError(err.message || 'Failed to decrypt and load PDF.')
      }
    })

    return () => {
      cancelled = true
      if (pdfBytesRef.current) {
        zeroMemory(pdfBytesRef.current)
        pdfBytesRef.current = null
      }
    }
  }, [arweaveHash, address, rentalExpiry])

  // ── Render page on canvas ──
  useEffect(() => {
    if (!pdfDoc || loadPhase !== 'ready' || !canvasRef.current) return
    let cancelled = false

    const render = async () => {
      setRendering(true)
      if (renderTaskRef.current) {
        try { renderTaskRef.current.cancel() }
        // eslint-disable-next-line no-empty
        catch {}
      }
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
    const onHide = () => {
      if (document.hidden && pdfBytesRef.current) {
        zeroMemory(pdfBytesRef.current)
        pdfBytesRef.current = null
      }
    }
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
            {bookTitle ? `Opening: ${bookTitle}` : 'Opening book…'}
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
          <p style={{ color: '#e06060', marginBottom: '1rem', fontWeight: 600 }}>Failed to unlock book</p>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginBottom: '1.5rem', lineHeight: 1.5 }}>
            {loadError}
          </p>
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
        <span className="reader__book-title">{bookTitle || arweaveHash}</span>
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
