import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import * as pdfjsLib from 'pdfjs-dist'
import { PDFDocument, rgb, StandardFonts, degrees } from 'pdf-lib'
import { useWallet } from '../context/WalletContext'
import WalletSelectModal from '../components/WalletSelectModal'
import { getUpload, getDecryptParams, getEncryptedBook } from '../services/api'
import { unlockBookKey } from '../services/lit'
import { decryptPdfInBrowser, zeroMemory } from '../services/decryption'
import { keyExpiry, loadBookKey, saveBookKey, forgetBookKey, forgetExpiredBookKeys } from '../services/keyStore'
import { MOCK_BOOKS } from '../data/mockBooks'
import '../styles/Reader.css'

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString()

// ── Watermarking ──────────────────────────────────────────────────
// One symmetric key protects a book for everyone who ever reads it, so if a
// copy leaks, the only thing that says who leaked it is the page itself. A
// librarian review copy is marked as such: it is a book nobody can rent yet, so
// a leaked one is traceable to the handful of wallets that could open it.
async function addWatermarks(pdfBytes, { walletAddress, rentalDate, expiryDate, grantedVia }) {
  const doc      = await PDFDocument.load(pdfBytes)
  const font     = await doc.embedFont(StandardFonts.Helvetica)
  const boldFont = await doc.embedFont(StandardFonts.HelveticaBold)
  const isReview = grantedVia === 'librarian_review'
  const footer   = isReview
    ? `LIBRARIAN REVIEW COPY — not for distribution | Librarian: ${walletAddress} | Opened: ${rentalDate}`
    : `Licensed to: ${walletAddress} | Rental: ${rentalDate} | Expires: ${expiryDate}`

  for (const page of doc.getPages()) {
    const { width, height } = page.getSize()
    // Footer strip
    page.drawText(footer, { x: 10, y: 11, size: 6, font, color: rgb(0.45, 0.45, 0.45), opacity: 0.75 })
    // Diagonal ghost watermark
    page.drawText(
      isReview ? `REVIEW COPY ${walletAddress.slice(0, 10)}…` : walletAddress.slice(0, 18) + '…',
      {
        x: width / 2 - 90, y: height / 2,
        size: 16, font: boldFont,
        color: rgb(0.65, 0.65, 0.65), opacity: 0.06,
        rotate: degrees(40),
      }
    )
  }
  return doc.save()
}

// ── Load steps ────────────────────────────────────────────────────
const STEPS = [
  { key: 'fetching',     label: 'Downloading encrypted PDF from Arweave nodes' },
  { key: 'params',       label: 'Retrieving decryption envelope from backend' },
  { key: 'signing',      label: "Sign in your wallet to prove it's yours"      },
  { key: 'lit',          label: 'Verifying on-chain access & unsealing via Lit' },
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
  const { address, signer, restoring } = useWallet()
  const [showWalletSelect, setShowWalletSelect] = useState(false)

  const [bookTitle,    setBookTitle]    = useState('')
  // Read once. Recomputing Date.now() on every render made this a new value each
  // time, which re-ran the whole unlock pipeline (and its signature prompt) on
  // every state change.
  const [rentalExpiry] = useState(() => {
    const storedExpiry = sessionStorage.getItem(`rental_expiry_${arweaveHash}`)
    return storedExpiry ? parseInt(storedExpiry, 10) : Date.now() + 7 * 86_400_000
  })

  // Flow state
  const [loadPhase,    setLoadPhase]    = useState('idle')  // idle|fetching|params|signing|lit|decrypting|watermarking|ready|error
  const [doneSteps,    setDoneSteps]    = useState([])
  const [loadError,    setLoadError]    = useState(null)
  // Which door the Lit Action let this reader through: rental | uploader |
  // librarian_review. Set from the Action's own verdict once the key arrives.
  const [accessMode,   setAccessMode]   = useState('rental')

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
    // After a reload the wallet reconnects a moment after first render. Wait for
    // it instead of failing with "connect your wallet".
    if (restoring) return undefined
    let cancelled = false

    const run = async () => {
      // The Lit Action only knows a reader by their signature, so there is no
      // reading without a connected wallet that can sign.
      if (!address || !signer) {
        throw new Error('Connect your wallet to open this book.')
      }
      const walletAddr = address
      const today      = new Date().toISOString().slice(0, 10)
      const expDate    = new Date(rentalExpiry).toISOString().slice(0, 10)

      // Fetch book title for UI
      getUpload(arweaveHash)
        .then(data => { if (!cancelled && data?.title) setBookTitle(data.title) })
        .catch(() => {
          const mock = MOCK_BOOKS.find(b => b.arweaveHash === arweaveHash)
          if (!cancelled && mock) setBookTitle(mock.title)
        })

      // Step 1: Download the encrypted PDF. The backend reads it from raw Arweave
      // nodes and proof-checks every chunk; no third-party gateway is involved.
      setLoadPhase('fetching')
      const encryptedBuffer = await getEncryptedBook(arweaveHash)
      if (cancelled) return
      setDoneSteps(s => [...s, 'fetching'])

      // Keys for access that has since ended, on books not opened again.
      forgetExpiredBookKeys()

      // Step 2: Fetch decryption parameters from backend. Also the free access
      // check that every re-open with a saved key relies on.
      setLoadPhase('params')
      let decryptParams
      try {
        decryptParams = await getDecryptParams(arweaveHash, walletAddr)
      } catch (err) {
        // No access any more (rental over, review window closed, …): a key this
        // browser kept must not outlive it.
        if (err?.status === 403 || err?.status === 409) await forgetBookKey(walletAddr, arweaveHash)
        throw err
      }
      if (cancelled) return
      setDoneSteps(s => [...s, 'params'])

      // Step 3: the book key. Sign, then the Lit Action checks the chain and
      // releases the key wrapped to a key pair this browser made for this read.
      // The key is then kept, non-extractable, until the access ends, so opening
      // the book again needs no signature and no Lit call (KEY-BINDING.md R3).
      const unlockFresh = async () => {
        const fresh = await unlockBookKey({
          arweaveHash,
          sealedKey: decryptParams.litEncryptedKeyId,
          signer,
          address: walletAddr,
          onStage: (stage) => {
            if (cancelled) return
            if (stage === 'lit') setDoneSteps(s => [...s, 'signing'])
            setLoadPhase(stage)
          },
        })
        await saveBookKey(walletAddr, arweaveHash, {
          ...fresh,
          expiresAt: keyExpiry(fresh.grantedVia, decryptParams),
        })
        return fresh
      }

      const saved = await loadBookKey(walletAddr, arweaveHash)
      if (cancelled) return
      // Fresh: the TEE decided which door this reader came through, and its
      // verdict is what gets stamped. Saved: the access check in step 2 just
      // passed, so its answer is the current one.
      let { cryptoKey, grantedVia } = saved
        ? { cryptoKey: saved.cryptoKey, grantedVia: decryptParams.grantedVia }
        : await unlockFresh()
      if (cancelled) return
      setAccessMode(grantedVia)
      setDoneSteps(s => (saved ? [...s, 'signing', 'lit'] : [...s, 'lit']))

      // Step 4: WebCrypto AES-256-GCM decryption in browser RAM
      setLoadPhase('decrypting')
      const decrypt = (key) => decryptPdfInBrowser(
        encryptedBuffer,
        key,
        decryptParams.encryptionIv,
        decryptParams.encryptionAuthTag
      )
      let decryptedPdfBytes
      try {
        decryptedPdfBytes = await decrypt(cryptoKey)
      } catch (err) {
        // A saved key that does not open the book is dropped and the book is
        // unlocked afresh. A fresh key that fails is a real error.
        if (!saved) throw err
        await forgetBookKey(walletAddr, arweaveHash)
        ;({ cryptoKey, grantedVia } = await unlockFresh())
        if (cancelled) return
        setAccessMode(grantedVia)
        setLoadPhase('decrypting')
        decryptedPdfBytes = await decrypt(cryptoKey)
      }
      if (cancelled) return
      setDoneSteps(s => [...s, 'decrypting'])

      // Step 5: Apply dynamic watermarks
      setLoadPhase('watermarking')
      const watermarked = await addWatermarks(decryptedPdfBytes, {
        walletAddress: walletAddr,
        rentalDate: today,
        expiryDate: expDate,
        grantedVia,
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
  }, [arweaveHash, address, signer, rentalExpiry, restoring])

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
  // A review copy has no rental to expire. Its limit is the challenge window,
  // which the Lit Action enforces on the next unlock — kicking the librarian out
  // on a rental clock they never started would just be wrong.
  useEffect(() => {
    if (accessMode === 'librarian_review') return undefined
    const id = setInterval(() => {
      if (Date.now() > rentalExpiry) navigate(`/book/${arweaveHash}`)
    }, 15_000)
    return () => clearInterval(id)
  }, [accessMode, rentalExpiry, arweaveHash, navigate])

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
    const btnStyle = { background: 'var(--accent)', border: 'none', borderRadius: '8px', color: '#0a0a12', fontWeight: 700, padding: '0.625rem 1.5rem', cursor: 'pointer' }
    return (
      <div className="reader-load">
        <div className="reader-load__card">
          <p style={{ color: '#e06060', marginBottom: '1rem', fontWeight: 600 }}>Failed to unlock book</p>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginBottom: '1.5rem', lineHeight: 1.5 }}>
            {loadError}
          </p>
          {/* This page has no navbar, so a wallet that didn't reconnect (e.g. locked) connects here */}
          {!address && (
            <button onClick={() => setShowWalletSelect(true)} style={{ ...btnStyle, marginRight: '0.75rem' }}>
              Connect Wallet
            </button>
          )}
          <button onClick={goBack} style={btnStyle}>
            ← Back to Book
          </button>
          {showWalletSelect && <WalletSelectModal onClose={() => setShowWalletSelect(false)} />}
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
          {accessMode === 'librarian_review' ? (
            <>
              <span className="reader__expiry-label">Librarian review copy</span>
              <span className="reader__expiry-timer">every page is watermarked</span>
            </>
          ) : (
            <>
              <span className="reader__expiry-label">Expires in</span>
              <span className="reader__expiry-timer"><Countdown expiryMs={rentalExpiry} /></span>
            </>
          )}
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
