import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useWallet } from '../context/WalletContext'
import '../styles/Dashboard.css'

const CATEGORY_STYLE = {
  science:     { color: '#5b8dee', bg: 'rgba(91, 141, 238, 0.08)'  },
  history:     { color: '#c9894c', bg: 'rgba(201, 137, 76, 0.08)'  },
  philosophy:  { color: '#a97dcf', bg: 'rgba(169, 125, 207, 0.08)' },
  literature:  { color: '#c9a84c', bg: 'rgba(201, 168, 76, 0.08)'  },
  mathematics: { color: '#4caf7a', bg: 'rgba(76, 175, 122, 0.08)'  },
  technology:  { color: '#4cb8c4', bg: 'rgba(76, 184, 196, 0.08)'  },
  medicine:    { color: '#e06060', bg: 'rgba(224, 96, 96, 0.08)'   },
  arts:        { color: '#c94ca8', bg: 'rgba(201, 76, 168, 0.08)'  },
}

const MOCK_QUEUE = [
  {
    arweaveHash: 'ar_sus01',
    title: 'Make $10K Daily With Crypto',
    author: 'Anonymous',
    category: 'technology',
    archivist: '0x9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b',
    uploadedDaysAgo: 0,
    aiScore: 12,
  },
  {
    arweaveHash: 'ar009',
    title: 'Thinking, Fast and Slow',
    author: 'Daniel Kahneman',
    category: 'science',
    archivist: '0x7f8e9d0c1b2a3948576859687970818293a4b5c6',
    uploadedDaysAgo: 1,
    aiScore: 88,
  },
  {
    arweaveHash: 'ar007',
    title: "Gray's Anatomy",
    author: 'Henry Gray',
    category: 'medicine',
    archivist: '0x3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d',
    uploadedDaysAgo: 3,
    aiScore: 91,
  },
  {
    arweaveHash: 'ar004',
    title: 'Ulysses',
    author: 'James Joyce',
    category: 'literature',
    archivist: '0x1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b',
    uploadedDaysAgo: 2,
    aiScore: 94,
  },
]

const CLAIMABLE = 18.5

function scoreColor(score) {
  if (score >= 80) return '#4caf7a'
  if (score >= 60) return 'var(--accent)'
  return '#e06060'
}

function timeAgo(days) {
  if (days === 0) return 'today'
  if (days === 1) return '1 day ago'
  return `${days} days ago`
}

function truncate(addr) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

export default function LibrarianDashboard() {
  const { address, connect } = useWallet()

  const [hidden,          setHidden]          = useState(new Set())
  const [challengeOpen,   setChallengeOpen]   = useState(null)
  const [reason,          setReason]          = useState('')
  const [challengeStates, setChallengeStates] = useState({}) // { hash: 'pending' | 'done' }
  const [claimState,      setClaimState]      = useState('idle') // idle | pending | done

  const queue = MOCK_QUEUE
    .filter(b => !hidden.has(b.arweaveHash) && challengeStates[b.arweaveHash] !== 'done')
    .sort((a, b) => a.aiScore - b.aiScore) // most suspicious first

  const handleSkip = (hash) => setHidden(s => new Set([...s, hash]))

  const openChallenge = (hash) => {
    setChallengeOpen(hash)
    setReason('')
  }

  const handleChallengeSubmit = async (hash) => {
    if (!reason.trim()) return
    setChallengeStates(s => ({ ...s, [hash]: 'pending' }))
    try {
      // await stake.challengeUpload(hash, reason)
      await new Promise(r => setTimeout(r, 1400))
      setChallengeStates(s => ({ ...s, [hash]: 'done' }))
      setChallengeOpen(null)
      setReason('')
    } catch {
      setChallengeStates(s => { const n = { ...s }; delete n[hash]; return n })
    }
  }

  const handleClaim = async () => {
    if (!address) { connect(); return }
    setClaimState('pending')
    // await stake.claimLibrarianRewards()
    await new Promise(r => setTimeout(r, 1400))
    setClaimState('done')
  }

  return (
    <main className="dash">
      <div className="dash__inner">
        <div className="dash__tabs">
          <Link to="/dashboard/archivist" className="dash__tab">Archivist</Link>
          <Link to="/dashboard/librarian" className="dash__tab dash__tab--active">Librarian</Link>
        </div>

        {!address ? (
          <div className="dash__connect">
            <p>Connect your wallet to view your librarian dashboard.</p>
            <button className="dash__connect-btn" onClick={connect}>Connect Wallet</button>
          </div>
        ) : (
          <>
            <div className="dash__stats">
              {[
                { label: 'Books Reviewed',  value: 12        },
                { label: 'Challenges Won',  value: 2         },
                { label: 'Rewards Earned',  value: `${CLAIMABLE} $ALEX` },
              ].map(({ label, value }) => (
                <div key={label} className="dash__stat">
                  <span className="dash__stat-value">{value}</span>
                  <span className="dash__stat-label">{label}</span>
                </div>
              ))}
            </div>

            {/* Claim rewards */}
            {claimState === 'done' ? (
              <div className="dash__claim-done">
                ✓ {CLAIMABLE} $ALEX claimed successfully
              </div>
            ) : (
              <div className="dash__claim-card">
                <div className="dash__claim-info">
                  <span className="dash__claim-label">Claimable Rewards</span>
                  <span className="dash__claim-amount">{CLAIMABLE} $ALEX</span>
                </div>
                {claimState === 'pending' ? (
                  <div className="dash__claim-pending">
                    <span className="dash__spinner" />
                    Claiming…
                  </div>
                ) : (
                  <button className="dash__claim-btn" onClick={handleClaim}>
                    Claim Rewards →
                  </button>
                )}
              </div>
            )}

            {/* Review queue */}
            <div>
              <h2 className="dash__section-title">
                Review Queue
                {queue.length > 0 && (
                  <span className="dash__queue-badge">{queue.length}</span>
                )}
              </h2>

              {queue.length === 0 ? (
                <div className="dash__empty">
                  All caught up — no uploads pending review.
                </div>
              ) : (
                <div className="dash__list">
                  {queue.map(book => {
                    const cs = CATEGORY_STYLE[book.category] || { color: 'var(--accent)', bg: 'var(--accent-dim)' }
                    const initials = book.title.split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase()
                    const isOpen   = challengeOpen === book.arweaveHash
                    const isPending = challengeStates[book.arweaveHash] === 'pending'

                    return (
                      <div key={book.arweaveHash} className="dash__queue-item">
                        <div className="dash__queue-main">
                          <div
                            className="dash__cover"
                            style={{ background: cs.bg, borderLeft: `3px solid ${cs.color}` }}
                          >
                            <span className="dash__cover-initials" style={{ color: cs.color }}>
                              {initials}
                            </span>
                          </div>

                          <div className="dash__upload-info">
                            <h3 className="dash__upload-title">{book.title}</h3>
                            <p className="dash__upload-author">
                              {book.author}
                              <span className="dash__upload-cat" style={{ color: cs.color, background: cs.bg }}>
                                {book.category.charAt(0).toUpperCase() + book.category.slice(1)}
                              </span>
                            </p>
                            <p className="dash__archivist">
                              {truncate(book.archivist)} · {timeAgo(book.uploadedDaysAgo)}
                            </p>
                          </div>

                          <div className="dash__upload-right">
                            <div className="dash__ai-score" style={{ color: scoreColor(book.aiScore) }}>
                              <span className="dash__ai-value">{book.aiScore}</span>
                              <span className="dash__ai-label">/100 AI</span>
                            </div>
                            <div className="dash__queue-actions">
                              <button
                                className="dash__challenge-btn"
                                onClick={() => isOpen ? setChallengeOpen(null) : openChallenge(book.arweaveHash)}
                                disabled={isPending}
                              >
                                {isOpen ? 'Cancel' : '⚡ Challenge'}
                              </button>
                              <button
                                className="dash__skip-btn"
                                onClick={() => handleSkip(book.arweaveHash)}
                                disabled={isPending}
                              >
                                Skip
                              </button>
                            </div>
                          </div>
                        </div>

                        {/* Inline challenge form */}
                        {isOpen && (
                          <div className="dash__challenge-form">
                            <label className="dash__challenge-label">
                              Reason for challenge
                            </label>
                            <textarea
                              className="dash__challenge-textarea"
                              placeholder="Describe why this upload should be challenged — plagiarism, low quality, copyright violation, spam…"
                              value={reason}
                              onChange={e => setReason(e.target.value)}
                              rows={3}
                              autoFocus
                            />
                            <div className="dash__challenge-footer">
                              {isPending ? (
                                <div className="dash__claim-pending">
                                  <span className="dash__spinner" />
                                  Submitting challenge on-chain…
                                </div>
                              ) : (
                                <>
                                  <button
                                    className="dash__challenge-submit"
                                    onClick={() => handleChallengeSubmit(book.arweaveHash)}
                                    disabled={!reason.trim()}
                                  >
                                    Submit Challenge →
                                  </button>
                                  <button
                                    className="dash__skip-btn"
                                    onClick={() => setChallengeOpen(null)}
                                  >
                                    Cancel
                                  </button>
                                </>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </main>
  )
}
