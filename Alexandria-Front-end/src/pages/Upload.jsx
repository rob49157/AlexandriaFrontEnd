import { useState, useRef } from 'react'
import { Link } from 'react-router-dom'
import { useWallet } from '../context/WalletContext'
import '../styles/Upload.css'

const CATEGORIES = [
  { slug: 'science',     label: 'Science'     },
  { slug: 'history',     label: 'History'     },
  { slug: 'philosophy',  label: 'Philosophy'  },
  { slug: 'literature',  label: 'Literature'  },
  { slug: 'mathematics', label: 'Mathematics' },
  { slug: 'technology',  label: 'Technology'  },
  { slug: 'medicine',    label: 'Medicine'    },
  { slug: 'arts',        label: 'Arts'        },
]

const STAKE_AMOUNT = 100
const STAKE_DAYS   = 14

const STAKE_STEPS = [
  { label: `Approve ${STAKE_AMOUNT} $ALEX spend` },
  { label: 'Stake for upload'                     },
  { label: 'Register on-chain'                    },
]

function formatBytes(bytes) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function Spinner({ small }) {
  return <span className={small ? 'upload__spinner--sm' : 'upload__spinner'} />
}

export default function Upload() {
  const { address, isCorrectNetwork, connect, switchToBaseSepolia } = useWallet()
  const fileInputRef = useRef(null)

  // Form state
  const [file,       setFile]       = useState(null)
  const [form,       setForm]       = useState({ title: '', author: '', category: '', description: '' })
  const [errors,     setErrors]     = useState({})
  const [isDragOver, setIsDragOver] = useState(false)

  // Flow state
  const [step,         setStep]         = useState(1)       // 1 | 2 | 3
  const [arweaveHash,  setArweaveHash]  = useState(null)
  const [uploadState,  setUploadState]  = useState('idle')  // idle | busy | error
  const [uploadError,  setUploadError]  = useState(null)
  const [stakeStep,    setStakeStep]    = useState(0)       // 0–3 completed
  const [stakeState,   setStakeState]   = useState('idle')  // idle | busy | done | error
  const [stakeError,   setStakeError]   = useState(null)

  // ── File handling ─────────────────────────────────
  const handleFile = (f) => {
    if (!f) return
    const next = {}
    if (!f.name.toLowerCase().endsWith('.pdf')) next.file = 'Only PDF files are accepted'
    else if (f.size > 50 * 1024 * 1024)         next.file = 'File must be under 50 MB'
    if (next.file) { setErrors(e => ({ ...e, ...next })); return }
    setFile(f)
    setErrors(e => { const n = { ...e }; delete n.file; return n })
  }

  const handleDragOver  = (e) => { e.preventDefault(); setIsDragOver(true)  }
  const handleDragLeave = (e) => { e.preventDefault(); setIsDragOver(false) }
  const handleDrop      = (e) => {
    e.preventDefault()
    setIsDragOver(false)
    handleFile(e.dataTransfer.files[0])
  }

  // ── Validation ────────────────────────────────────
  const validate = () => {
    const e = {}
    if (!file)                      e.file        = 'Please select a PDF file'
    if (!form.title.trim())         e.title       = 'Title is required'
    if (!form.author.trim())        e.author      = 'Author is required'
    if (!form.category)             e.category    = 'Please select a category'
    if (!form.description.trim())   e.description = 'Description is required'
    return e
  }

  // ── Step 1: Upload to backend ─────────────────────
  const handleUpload = async () => {
    const errs = validate()
    if (Object.keys(errs).length) { setErrors(errs); return }
    if (!address)          { connect();              return }
    if (!isCorrectNetwork) { switchToBaseSepolia();  return }

    setUploadState('busy')
    setUploadError(null)
    try {
      // const fd = new FormData()
      // fd.append('pdf', file)
      // Object.entries(form).forEach(([k, v]) => fd.append(k, v))
      // fd.append('walletAddress', address)
      // const res = await fetch(`${import.meta.env.VITE_API_URL}/upload`, { method: 'POST', body: fd })
      // if (!res.ok) throw new Error(await res.text())
      // const { arweaveHash } = await res.json()
      await new Promise(r => setTimeout(r, 2200))
      const mockHash = `ar${Date.now().toString(36).toUpperCase()}`
      setArweaveHash(mockHash)
      setUploadState('idle')
      setStep(2)
    } catch (err) {
      setUploadState('error')
      setUploadError(err.message || 'Upload failed. Please try again.')
    }
  }

  // ── Step 2: Stake & register on-chain ────────────
  const handleStake = async () => {
    setStakeState('busy')
    setStakeError(null)
    try {
      // Step 1: token.approve(STAKE_CONTRACT_ADDRESS, parseUnits('100', 18))
      setStakeStep(1)
      await new Promise(r => setTimeout(r, 1400))

      // Step 2: stake.stakeForUpload(arweaveHash, parseUnits('100', 18))
      setStakeStep(2)
      await new Promise(r => setTimeout(r, 1400))

      // Step 3: library.registerUpload(arweaveHash, { title, author, category, description })
      setStakeStep(3)
      await new Promise(r => setTimeout(r, 1400))

      setStakeState('done')
      setStep(3)
    } catch (err) {
      setStakeState('error')
      setStakeError(err.message || 'Transaction failed.')
    }
  }

  // ── Reset ─────────────────────────────────────────
  const handleReset = () => {
    setFile(null)
    setForm({ title: '', author: '', category: '', description: '' })
    setErrors({})
    setStep(1)
    setArweaveHash(null)
    setUploadState('idle')
    setUploadError(null)
    setStakeStep(0)
    setStakeState('idle')
    setStakeError(null)
  }

  const field = (key) => ({
    value: form[key],
    onChange: e => setForm(f => ({ ...f, [key]: e.target.value })),
  })

  // ── Render ────────────────────────────────────────
  return (
    <main className="upload">
      <div className="upload__inner">

        {/* Page heading */}
        <div className="upload__header">
          <h1 className="upload__title">Upload a Book</h1>
          <p className="upload__subtitle">
            Preserve knowledge permanently on Arweave. Earn rental revenue. Build the library.
          </p>
        </div>

        {/* Step progress */}
        <div className="upload__stepper">
          {['Upload PDF', 'Stake & Register', 'Complete'].map((label, i) => {
            const n = i + 1
            const isDone   = step > n
            const isActive = step === n
            return (
              <div key={n} className="upload__stepper-item">
                <div className={`upload__stepper-row${i > 0 ? ' upload__stepper-row--after' : ''}`}>
                  {i > 0 && <div className={`upload__stepper-line${step > n ? ' upload__stepper-line--done' : ''}`} />}
                  <div className={`upload__step-circle${isDone ? ' upload__step-circle--done' : isActive ? ' upload__step-circle--active' : ''}`}>
                    {isDone ? '✓' : n}
                  </div>
                </div>
                <span className={`upload__step-label${isDone || isActive ? ' upload__step-label--lit' : ''}`}>
                  {label}
                </span>
              </div>
            )
          })}
        </div>

        {/* ── Step 1: Upload form ── */}
        {step === 1 && (
          <div className="upload__card">
            {!address && (
              <div className="upload__wallet-warning">
                <span>Your wallet address is required to register as archivist.</span>
                <button className="upload__wallet-connect" onClick={connect}>Connect Wallet</button>
              </div>
            )}

            {/* PDF file */}
            <div className="upload__field">
              <label className="upload__label">PDF File <span className="upload__required">*</span></label>
              {file ? (
                <div className="upload__file-selected">
                  <span className="upload__file-icon">📄</span>
                  <div className="upload__file-info">
                    <span className="upload__file-name">{file.name}</span>
                    <span className="upload__file-size">{formatBytes(file.size)}</span>
                  </div>
                  <button
                    className="upload__file-remove"
                    onClick={() => setFile(null)}
                    aria-label="Remove file"
                  >✕</button>
                </div>
              ) : (
                <div
                  className={`upload__dropzone${isDragOver ? ' upload__dropzone--over' : ''}${errors.file ? ' upload__dropzone--error' : ''}`}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                  role="button"
                  tabIndex={0}
                  onKeyDown={e => e.key === 'Enter' && fileInputRef.current?.click()}
                >
                  <svg className="upload__dropzone-icon" viewBox="0 0 40 40" fill="none">
                    <path d="M20 28V12M20 12L14 18M20 12L26 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    <path d="M10 30h20" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                  </svg>
                  <p className="upload__dropzone-text">
                    Drop a PDF here, or <span className="upload__dropzone-link">browse files</span>
                  </p>
                  <p className="upload__dropzone-hint">PDF only · Max 50 MB</p>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".pdf,application/pdf"
                    style={{ display: 'none' }}
                    onChange={e => handleFile(e.target.files[0])}
                  />
                </div>
              )}
              {errors.file && <span className="upload__error">{errors.file}</span>}
            </div>

            {/* Title */}
            <div className="upload__field">
              <label className="upload__label" htmlFor="up-title">
                Title <span className="upload__required">*</span>
              </label>
              <input
                id="up-title"
                className={`upload__input${errors.title ? ' upload__input--error' : ''}`}
                placeholder="e.g. On the Origin of Species"
                {...field('title')}
              />
              {errors.title && <span className="upload__error">{errors.title}</span>}
            </div>

            {/* Author */}
            <div className="upload__field">
              <label className="upload__label" htmlFor="up-author">
                Author <span className="upload__required">*</span>
              </label>
              <input
                id="up-author"
                className={`upload__input${errors.author ? ' upload__input--error' : ''}`}
                placeholder="e.g. Charles Darwin"
                {...field('author')}
              />
              {errors.author && <span className="upload__error">{errors.author}</span>}
            </div>

            {/* Category */}
            <div className="upload__field">
              <label className="upload__label" htmlFor="up-category">
                Category <span className="upload__required">*</span>
              </label>
              <select
                id="up-category"
                className={`upload__select${errors.category ? ' upload__select--error' : ''}`}
                value={form.category}
                onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
              >
                <option value="">Select a category…</option>
                {CATEGORIES.map(({ slug, label }) => (
                  <option key={slug} value={slug}>{label}</option>
                ))}
              </select>
              {errors.category && <span className="upload__error">{errors.category}</span>}
            </div>

            {/* Description */}
            <div className="upload__field">
              <label className="upload__label" htmlFor="up-desc">
                Description <span className="upload__required">*</span>
                <span className="upload__char-count">{form.description.length}/1000</span>
              </label>
              <textarea
                id="up-desc"
                className={`upload__textarea${errors.description ? ' upload__textarea--error' : ''}`}
                placeholder="Describe the book's content, significance, and why it should be preserved on Alexandria…"
                rows={5}
                value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value.slice(0, 1000) }))}
              />
              {errors.description && <span className="upload__error">{errors.description}</span>}
            </div>

            {/* Submit */}
            {uploadState === 'busy' ? (
              <div className="upload__pending">
                <Spinner />
                Uploading · encrypting · storing on Arweave…
              </div>
            ) : (
              <button className="upload__cta" onClick={handleUpload}>
                Upload & Continue →
              </button>
            )}

            {uploadState === 'error' && (
              <div className="upload__err-box">{uploadError}</div>
            )}
          </div>
        )}

        {/* ── Step 2: Stake & Register ── */}
        {step === 2 && (
          <div className="upload__card">
            <div className="upload__result-badge">
              <span className="upload__result-dot" />
              <div>
                <p className="upload__result-label">Uploaded to Arweave</p>
                <code className="upload__result-hash">{arweaveHash}</code>
              </div>
            </div>

            <div className="upload__stake-info">
              <p>
                To complete registration, stake{' '}
                <strong className="upload__stake-amount">{STAKE_AMOUNT} $ALEX</strong>{' '}
                for {STAKE_DAYS} days.
              </p>
              <p>
                Librarians can challenge suspicious uploads during this window.
                Valid uploads have their stake returned and earn a share of rental revenue.
              </p>
            </div>

            <div className="upload__tx-list">
              {STAKE_STEPS.map(({ label }, i) => {
                const n        = i + 1
                const done     = stakeStep >= n
                const active   = stakeStep === n - 1 && stakeState === 'busy'
                return (
                  <div
                    key={n}
                    className={`upload__tx-item${done ? ' upload__tx-item--done' : active ? ' upload__tx-item--active' : ''}`}
                  >
                    <span className="upload__tx-indicator">
                      {done   ? '✓' :
                       active ? <Spinner small /> :
                       n}
                    </span>
                    <span className="upload__tx-label">{label}</span>
                  </div>
                )
              })}
            </div>

            {stakeState === 'idle' && (
              <button className="upload__cta" onClick={handleStake}>
                Begin Staking →
              </button>
            )}

            {stakeState === 'busy' && (
              <div className="upload__pending">
                <Spinner />
                Waiting for wallet confirmation…
              </div>
            )}

            {stakeState === 'error' && (
              <div className="upload__err-box" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>{stakeError}</span>
                <button
                  onClick={() => setStakeState('idle')}
                  style={{ background: 'none', border: '1px solid currentColor', borderRadius: '6px',
                           color: 'inherit', fontSize: '0.8125rem', padding: '0.3rem 0.625rem', cursor: 'pointer' }}
                >
                  Try again
                </button>
              </div>
            )}
          </div>
        )}

        {/* ── Step 3: Complete ── */}
        {step === 3 && (
          <div className="upload__card upload__done">
            <div className="upload__done-check">✓</div>
            <h2 className="upload__done-title">Upload Complete</h2>
            <p className="upload__done-sub">
              Your book is now pending review on Alexandria. You will earn rental revenue once it passes validation.
            </p>

            <div className="upload__done-table">
              <div className="upload__done-row">
                <span className="upload__done-key">Arweave ID</span>
                <code className="upload__done-val upload__done-val--mono">{arweaveHash}</code>
              </div>
              <div className="upload__done-row">
                <span className="upload__done-key">Title</span>
                <span className="upload__done-val">{form.title}</span>
              </div>
              <div className="upload__done-row">
                <span className="upload__done-key">Stake</span>
                <span className="upload__done-val">{STAKE_AMOUNT} $ALEX · {STAKE_DAYS} days</span>
              </div>
              <div className="upload__done-row">
                <span className="upload__done-key">Status</span>
                <span className="upload__done-val upload__done-val--pending">Pending Review</span>
              </div>
            </div>

            <div className="upload__done-actions">
              <Link to={`/book/${arweaveHash}`} className="upload__cta upload__cta--link">
                View Book →
              </Link>
              <button className="upload__secondary-cta" onClick={handleReset}>
                Upload Another
              </button>
            </div>
          </div>
        )}
      </div>
    </main>
  )
}
