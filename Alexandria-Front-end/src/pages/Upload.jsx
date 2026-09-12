import { useState, useRef } from 'react'
import { Link } from 'react-router-dom'
import { parseUnits } from 'ethers'
import { useWallet } from '../context/WalletContext'
import WalletSelectModal from '../components/WalletSelectModal'
import { useContracts } from '../hooks/useContracts'
import { uploadPdf } from '../services/api'
import { ADDRESSES } from '../config/contracts'
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
  { label: 'Deposit stake on Base Sepolia'        },
]

function formatBytes(bytes) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function Spinner({ small }) {
  return <span className={small ? 'upload__spinner--sm' : 'upload__spinner'} />
}

export default function Upload() {
  const { address, isCorrectNetwork, connecting, error: walletError, switchToBaseSepolia } = useWallet()
  const { tokenContract, stakeContract } = useContracts()
  const fileInputRef = useRef(null)

  const [showWalletSelect, setShowWalletSelect] = useState(false)

  // Form state
  const [file,       setFile]       = useState(null)
  const [form,       setForm]       = useState({ title: '', author: '', category: '', description: '' })
  const [errors,     setErrors]     = useState({})
  const [isDragOver, setIsDragOver] = useState(false)

  // Flow state
  const [step,         setStep]         = useState(1)       // 1 | 2 | 3
  const [arweaveHash,  setArweaveHash]  = useState(null)
  const [registration, setRegistration] = useState(null)
  const [uploadState,  setUploadState]  = useState('idle')  // idle | busy | error
  const [uploadError,  setUploadError]  = useState(null)
  const [stakeStep,    setStakeStep]    = useState(0)       // 0–2 completed
  const [stakeState,   setStakeState]   = useState('idle')  // idle | busy | done | error
  const [stakeError,   setStakeError]   = useState(null)
  const [stakeTxHash,  setStakeTxHash]  = useState(null)

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
    if (!address)          { setShowWalletSelect(true); return }
    if (!isCorrectNetwork) { switchToBaseSepolia();     return }

    setUploadState('busy')
    setUploadError(null)
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('title', form.title.trim())
      fd.append('author', form.author.trim())
      fd.append('category', form.category)
      fd.append('description', form.description.trim())
      fd.append('walletAddress', address)

      const result = await uploadPdf(fd)
      setArweaveHash(result.arweaveHash)
      setRegistration(result.registration)
      setUploadState('idle')
      setStep(2)
    } catch (err) {
      setUploadState('error')
      setUploadError(err.message || 'Upload failed. Please try again.')
    }
  }

  // ── Step 2: Stake on-chain ────────────────────────
  const handleStake = async () => {
    if (!tokenContract || !stakeContract) {
      setStakeError('Contract instances not ready. Please check wallet connection.')
      return
    }
    if (!address) { setShowWalletSelect(true); return }
    if (!isCorrectNetwork) { switchToBaseSepolia(); return }

    setStakeState('busy')
    setStakeError(null)
    try {
      const amountWei = parseUnits(STAKE_AMOUNT.toString(), 18)

      // Step 1: token.approve(stakeContractAddress, amount)
      setStakeStep(1)
      const approveTx = await tokenContract.approve(ADDRESSES.stake, amountWei)
      await approveTx.wait()

      // Step 2: stake.stake(arweaveHash, amount)
      setStakeStep(2)
      const stakeTx = await stakeContract.stake(arweaveHash, amountWei)
      const receipt = await stakeTx.wait()

      setStakeTxHash(receipt?.hash || stakeTx.hash)
      setStakeState('done')
      setStep(3)
    } catch (err) {
      setStakeState('error')
      setStakeError(err.reason || err.message || 'Staking transaction failed.')
    }
  }

  // ── Reset ─────────────────────────────────────────
  const handleReset = () => {
    setFile(null)
    setForm({ title: '', author: '', category: '', description: '' })
    setErrors({})
    setStep(1)
    setArweaveHash(null)
    setRegistration(null)
    setUploadState('idle')
    setUploadError(null)
    setStakeStep(0)
    setStakeState('idle')
    setStakeError(null)
    setStakeTxHash(null)
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
          {['Upload PDF', 'Stake Deposit', 'Complete'].map((label, i) => {
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
                <span>
                  Your wallet address is required to register as archivist.
                  {walletError && <span className="upload__wallet-error">{walletError}</span>}
                </span>
                <button
                  className="upload__wallet-connect"
                  onClick={() => setShowWalletSelect(true)}
                  disabled={connecting}
                >
                  {connecting ? 'Connecting…' : 'Connect Wallet'}
                </button>
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
                Validating · encrypting with AES-256 · sealing with Lit Protocol · storing on Arweave…
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

        {/* ── Step 2: Stake on-chain ── */}
        {step === 2 && (
          <div className="upload__card">
            <div className="upload__result-badge">
              <span className="upload__result-dot" />
              <div>
                <p className="upload__result-label">
                  {registration?.registered ? 'Uploaded to Arweave & Registered On-Chain' : 'Uploaded to Arweave'}
                </p>
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
                Valid uploads have their stake returned and earn a 50 ALEX reward + rental revenue.
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
                Stake {STAKE_AMOUNT} $ALEX →
              </button>
            )}

            {stakeState === 'busy' && (
              <div className="upload__pending">
                <Spinner />
                Waiting for wallet transaction confirmation on Base Sepolia…
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
            <h2 className="upload__done-title">Upload & Staking Complete</h2>
            <p className="upload__done-sub">
              Your book is registered on Base Sepolia and entering the 14-day validation window.
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
              {stakeTxHash && (
                <div className="upload__done-row">
                  <span className="upload__done-key">Stake Tx</span>
                  <a
                    href={`https://sepolia.basescan.org/tx/${stakeTxHash}`}
                    target="_blank"
                    rel="noreferrer"
                    className="upload__done-val upload__done-val--mono"
                    style={{ color: 'var(--accent)', textDecoration: 'underline' }}
                  >
                    {stakeTxHash.slice(0, 10)}…{stakeTxHash.slice(-8)}
                  </a>
                </div>
              )}
              <div className="upload__done-row">
                <span className="upload__done-key">Status</span>
                <span className="upload__done-val upload__done-val--pending">Pending Challenge Window</span>
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

      {showWalletSelect && (
        <WalletSelectModal onClose={() => setShowWalletSelect(false)} />
      )}
    </main>
  )
}
