import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { ethers } from 'ethers'
import { useWallet } from '../context/WalletContext'
import ConnectWalletPrompt from '../components/ConnectWalletPrompt'
import WalletSelectModal from '../components/WalletSelectModal'
import { useContracts } from '../hooks/useContracts'
import { getReviewQueue } from '../services/api'
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

const CLAIMABLE = 18.5

// How often the queue re-fetches itself. A book enters the queue when its
// archivist stakes, which the librarian has no other way to learn about.
const POLL_INTERVAL_MS = 60_000

// challengeUpload writes the reason permanently to contract storage, and a
// resolver has to act on it later. "spam" is not a case.
const MIN_REASON_LENGTH = 10

function timeAgo(isoDate) {
  if (!isoDate) return 'unknown'
  const days = Math.floor((Date.now() - new Date(isoDate).getTime()) / 86_400_000)
  if (days <= 0) return 'today'
  if (days === 1) return '1 day ago'
  return `${days} days ago`
}

/**
 * Time left to act, from the on-chain challenge deadline.
 *
 * This replaces the old `X/100 (AI)` pill, which was invented in the frontend —
 * the backend has no AI score (content analysis is a separate service and is not
 * wired up yet). The deadline is the number that actually governs the librarian:
 * past it, challengeUpload() reverts with "Challenge period expired".
 */
function challengeWindow(endsAt) {
  if (!endsAt) return { text: '—', sub: 'no deadline', color: 'var(--text-muted)' }

  const msLeft = new Date(endsAt).getTime() - Date.now()
  if (msLeft <= 0) return { text: 'closed', sub: 'window expired', color: '#e06060' }

  const hours = Math.floor(msLeft / 3_600_000)
  const days = Math.floor(hours / 24)

  return {
    text: days >= 1 ? `${days}d ${hours % 24}h` : `${hours}h`,
    sub: 'left to challenge',
    // Under a day is the last chance to act on this book, ever.
    color: hours < 24 ? '#eab308' : 'var(--text-secondary)',
  }
}

function truncate(addr) {
  if (!addr) return 'unknown'
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

/**
 * The most useful sentence we can get out of a failed transaction.
 *
 * ethers v6 decodes the contract's own require() strings, so "Already
 * challenged" and "Challenge period expired" arrive verbatim and are worth far
 * more to the librarian than a generic failure.
 */
function txErrorMessage(err) {
  if (err?.code === 'ACTION_REJECTED') return 'Transaction rejected in your wallet.'
  return err?.reason || err?.shortMessage || err?.message || 'Transaction failed.'
}

export default function LibrarianDashboard() {
  const { address } = useWallet()
  const { tokenContract, stakeContract } = useContracts()

  const [showWalletSelect, setShowWalletSelect] = useState(false)
  const [hidden,          setHidden]          = useState(new Set())
  const [challengeOpen,   setChallengeOpen]   = useState(null)
  const [reason,          setReason]          = useState('')
  const [challengeStates, setChallengeStates] = useState({}) // { hash: 'pending' | 'done' }
  const [challengeError,  setChallengeError]  = useState(null)
  const [claimState,      setClaimState]      = useState('idle') // idle | pending | done

  // Review queue, from GET /api/librarian/review-queue
  const [queue,        setQueue]        = useState([])
  // Every status=pending book the backend considered, before the on-chain
  // filter. candidates > 0 with an empty queue is "nothing challengeable right
  // now" — a different thing to say than "nothing pending at all".
  const [candidates,   setCandidates]   = useState(0)
  const [unavailable,  setUnavailable]  = useState(0)
  const [queueLoading, setQueueLoading] = useState(false)
  const [queueError,   setQueueError]   = useState(null)

  // Staking state
  const [isLibrarian, setIsLibrarian] = useState(false)
  const [stakedAmount, setStakedAmount] = useState('0')
  const [stakeInput, setStakeInput] = useState('50') // Min 50 ALEX
  const [stakeLoading, setStakeLoading] = useState(false)

  useEffect(() => {
    async function checkLibrarianStatus() {
      if (!address || !stakeContract) return
      try {
        const info = await stakeContract.librarians(address)
        setIsLibrarian(info.active)
        if (info.active) {
          setStakedAmount(ethers.formatUnits(info.amount, 18))
        }
      } catch (err) {
        console.error("Error fetching librarian status", err)
      }
    }
    checkLibrarianStatus()
  }, [address, stakeContract])

  // ── Review queue ────────────────────────────────────────────────────────
  // The backend does the challengeability filtering (Postgres for metadata,
  // live stake reads for whether challengeUpload would actually succeed), so
  // everything returned here is safe to put a Challenge button on.
  const loadQueue = useCallback(async ({ silent = false } = {}) => {
    if (!address) return
    if (!silent) setQueueLoading(true)
    try {
      const data = await getReviewQueue({ librarian: address })
      setQueue(Array.isArray(data.queue) ? data.queue : [])
      setCandidates(data.candidates ?? 0)
      setUnavailable(data.unavailable ?? 0)
      setQueueError(null)
    } catch (err) {
      console.error('Could not load the review queue', err)
      // No mock fallback. Fabricating a queue here is the bug this replaced.
      setQueueError(err.message || 'Could not reach the backend.')
    } finally {
      setQueueLoading(false)
    }
  }, [address])

  useEffect(() => {
    if (!address || !isLibrarian) return

    loadQueue()

    // A book joins the queue when its archivist stakes — an event this page has
    // no other way to hear about. Silent refresh so the list does not flash a
    // spinner every minute; skipped while the tab is hidden.
    const id = setInterval(() => {
      if (!document.hidden) loadQueue({ silent: true })
    }, POLL_INTERVAL_MS)

    return () => clearInterval(id)
  }, [address, isLibrarian, loadQueue])

  const handleStake = async () => {
    if (!stakeInput || isNaN(stakeInput)) return
    setStakeLoading(true)
    try {
      const amount = ethers.parseUnits(stakeInput, 18)
      
      // 1. Approve
      const approveTx = await tokenContract.approve(stakeContract.target, amount)
      await approveTx.wait()
      
      // 2. Stake
      const stakeTx = await stakeContract.stakeAsLibrarian(amount)
      await stakeTx.wait()
      
      setIsLibrarian(true)
      setStakedAmount(stakeInput)
    } catch (err) {
      console.error("Staking failed", err)
      alert("Staking failed. See console.")
    } finally {
      setStakeLoading(false)
    }
  }

  const handleUnstake = async () => {
    setStakeLoading(true)
    try {
      const tx = await stakeContract.unstakeAsLibrarian()
      await tx.wait()
      setIsLibrarian(false)
      setStakedAmount('0')
    } catch (err) {
      console.error("Unstaking failed", err)
      alert("Unstaking failed. Note there is a 30-day cooldown.")
    } finally {
      setStakeLoading(false)
    }
  }

  // Backend already ordered by closing window and excluded anything the
  // contract would reject; all that is left is this session's own dismissals.
  const visibleQueue = queue.filter(
    b => !hidden.has(b.arweaveHash) && challengeStates[b.arweaveHash] !== 'done'
  )

  const handleSkip = (hash) => setHidden(s => new Set([...s, hash]))

  const openChallenge = (hash) => {
    setChallengeOpen(hash)
    setReason('')
    setChallengeError(null)
  }

  const handleChallengeSubmit = async (hash) => {
    const trimmed = reason.trim()
    if (trimmed.length < MIN_REASON_LENGTH) return
    if (!stakeContract) {
      setChallengeError('Wallet not connected.')
      return
    }

    setChallengeError(null)
    setChallengeStates(s => ({ ...s, [hash]: 'pending' }))

    try {
      const tx = await stakeContract.challengeUpload(hash, trimmed)
      await tx.wait()

      setChallengeStates(s => ({ ...s, [hash]: 'done' }))
      setChallengeOpen(null)
      setReason('')
      // The book is now Challenged on-chain, so the backend will stop returning
      // it. Re-fetch rather than trusting local state to stay in step.
      loadQueue({ silent: true })
    } catch (err) {
      console.error('Challenge failed', err)
      // Surfaced inline, not in an alert: the contract's revert reason tells the
      // librarian exactly which precondition failed.
      setChallengeError(txErrorMessage(err))
      setChallengeStates(s => { const n = { ...s }; delete n[hash]; return n })
    }
  }

  const handleClaim = async () => {
    if (!address) { setShowWalletSelect(true); return }
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
          <ConnectWalletPrompt message="Connect your wallet to view your librarian dashboard." />
        ) : !isLibrarian ? (
          <div className="dash__connect">
            <h2>Become a Librarian</h2>
            <p>Stake a minimum of 50 $ALEX to join the librarian network. You will be responsible for reviewing uploads and resolving challenges.</p>
            <div style={{ marginTop: '20px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px' }}>
              <input 
                type="number" 
                value={stakeInput} 
                onChange={e => setStakeInput(e.target.value)} 
                min="50"
                style={{ padding: '10px', width: '200px', borderRadius: '8px', border: '1px solid var(--border)' }}
              />
              <button 
                className="dash__connect-btn" 
                onClick={handleStake}
                disabled={stakeLoading}
              >
                {stakeLoading ? 'Staking...' : 'Approve & Stake'}
              </button>
            </div>
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
              <div className="dash__stat">
                <span className="dash__stat-value">{stakedAmount} $ALEX</span>
                <span className="dash__stat-label">Active Stake</span>
                <button 
                  onClick={handleUnstake} 
                  disabled={stakeLoading}
                  style={{ marginTop: '10px', background: 'transparent', color: 'var(--accent)', border: '1px solid var(--accent)', padding: '4px 8px', borderRadius: '4px', cursor: 'pointer' }}
                >
                  {stakeLoading ? 'Unstaking...' : 'Unstake'}
                </button>
              </div>
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
                {visibleQueue.length > 0 && (
                  <span className="dash__queue-badge">{visibleQueue.length}</span>
                )}
                <button
                  className="dash__refresh-btn"
                  onClick={() => loadQueue()}
                  disabled={queueLoading}
                >
                  {queueLoading ? 'Refreshing…' : '↻ Refresh'}
                </button>
              </h2>

              {queueError ? (
                <div className="dash__queue-error">
                  <span>Could not load the review queue — {queueError}</span>
                  <button className="dash__skip-btn" onClick={() => loadQueue()}>
                    Retry
                  </button>
                </div>
              ) : queueLoading && queue.length === 0 ? (
                <div className="dash__empty">
                  <span className="dash__spinner" /> Loading review queue…
                </div>
              ) : visibleQueue.length === 0 ? (
                <div className="dash__empty">
                  {candidates > 0
                    ? `${candidates} upload${candidates === 1 ? '' : 's'} pending, but none are open to challenge right now — ` +
                      'each is either unstaked, past its 14-day window, already challenged, or your own.'
                    : 'All caught up — no uploads pending review.'}
                </div>
              ) : (
                <div className="dash__list">
                  {visibleQueue.map(book => {
                    const cs = CATEGORY_STYLE[book.category] || { color: 'var(--accent)', bg: 'var(--accent-dim)' }
                    const initials = book.title.split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase()
                    const isOpen   = challengeOpen === book.arweaveHash
                    const isPending = challengeStates[book.arweaveHash] === 'pending'
                    const win      = challengeWindow(book.challengePeriodEnds)

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
                              {truncate(book.uploader)} · {timeAgo(book.uploadTimestamp)}
                              {book.stakeAmountAlex && ` · ${book.stakeAmountAlex} $ALEX staked`}
                            </p>
                          </div>

                          <div className="dash__upload-right">
                            <div className="dash__window" style={{ color: win.color }}>
                              <span className="dash__window-value">{win.text}</span>
                              <span className="dash__window-label">{win.sub}</span>
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
                              <span className="dash__window-label">
                                {' '}— stored permanently on-chain, min {MIN_REASON_LENGTH} characters
                              </span>
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
                                  Confirm in your wallet, then waiting for the transaction…
                                </div>
                              ) : (
                                <>
                                  {challengeError && (
                                    <span className="dash__challenge-error">{challengeError}</span>
                                  )}
                                  <button
                                    className="dash__challenge-submit"
                                    onClick={() => handleChallengeSubmit(book.arweaveHash)}
                                    disabled={reason.trim().length < MIN_REASON_LENGTH}
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

              {unavailable > 0 && !queueError && (
                <p className="dash__queue-note">
                  {unavailable} upload{unavailable === 1 ? '' : 's'} could not be checked against the
                  chain and {unavailable === 1 ? 'is' : 'are'} hidden until the next refresh.
                </p>
              )}
            </div>
          </>
        )}
      </div>

      {showWalletSelect && (
        <WalletSelectModal onClose={() => setShowWalletSelect(false)} />
      )}
    </main>
  )
}
