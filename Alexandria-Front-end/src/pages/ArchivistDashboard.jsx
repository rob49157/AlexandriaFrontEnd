import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { useWallet } from '../context/WalletContext'
import ConnectWalletPrompt from '../components/ConnectWalletPrompt'
import { useContracts } from '../hooks/useContracts'
import { getArchivistUploads } from '../services/api'
import { categoryStyle, RENTAL_DURATIONS, ARCHIVIST_SHARE_PERCENT } from '../utils/constants'
import { reviewDaysLeft, alexFromWei, parseAlexAmount } from '../utils/formatters'
import { isUserRejection } from '../utils/walletErrors'
import '../styles/Dashboard.css'

const STATUS_CONFIG = {
  // Before pending_stake: the storage worker is confirming the Arweave upload
  // (~25–40 min), or it was never mined and must be uploaded again.
  pending_confirmation: { label: 'Storing on Arweave', color: '#4cb8c4', bg: 'rgba(76, 184, 196, 0.12)' },
  storage_failed:       { label: 'Storage Failed',     color: '#e06060', bg: 'rgba(224, 96, 96, 0.12)'  },
  pending_stake: { label: 'Pending Stake', color: '#eab308', bg: 'rgba(234, 179, 8, 0.12)'   },
  pending:       { label: 'Pending Review',color: '#5b8dee', bg: 'rgba(91, 141, 238, 0.12)'  },
  ready:         { label: 'Ready to Publish', color: '#4caf7a', bg: 'rgba(76, 175, 122, 0.12)' },
  approved:      { label: 'Approved',      color: '#4caf7a', bg: 'rgba(76, 175, 122, 0.12)'  },
  active:        { label: 'Approved',      color: '#4caf7a', bg: 'rgba(76, 175, 122, 0.12)'  },
  challenged:    { label: 'Challenged',    color: '#e06060', bg: 'rgba(224, 96, 96, 0.12)'   },
  rejected:      { label: 'Rejected',      color: '#9090a0', bg: 'rgba(144, 144, 160, 0.12)' },
}

function daysLeft(endsAt) {
  const days = reviewDaysLeft(endsAt)
  return `${days} ${days === 1 ? 'day' : 'days'} left`
}

/**
 * Where a book stands in its lifecycle, from the chain rather than the index:
 * Postgres "pending" covers both a registered book nobody staked yet and a
 * staked one whose 14-day window is running or over.
 *
 *   stake → 14-day challenge window → no challenge: the archivist publishes
 *                                   → challenged: 14 days of librarian review,
 *                                     then the owner resolves it on-chain
 */
function lifecycle(upload) {
  const { stake } = upload
  if (upload.canPublish) {
    return { status: 'ready', note: 'No challenge in 14 days. Publish to approve it for rental and get your stake back.' }
  }
  if (upload.status === 'pending' && stake && !stake.staked) {
    return { status: 'pending_stake', note: 'Registered. Stake 100 $ALEX to start its 14-day challenge window.', stakeLink: true }
  }
  if (upload.status === 'pending_stake') {
    return { status: 'pending_stake', note: 'Stake 100 $ALEX to start its 14-day challenge window.', stakeLink: true }
  }
  if (upload.status === 'pending' && stake?.active && !stake.challenge && !stake.challengePeriodOver) {
    return { status: 'pending', note: `In its challenge window · ${daysLeft(stake.challengePeriodEnds)}` }
  }
  if (upload.status === 'challenged' && stake?.challenge) {
    const { challenge } = stake
    if (challenge.resolved) return { status: 'challenged', note: 'Challenge resolved on-chain; updating…' }
    return {
      status: 'challenged',
      note: challenge.reviewOver
        ? 'Librarian review has ended. Waiting for the owner to resolve it on-chain.'
        : `Librarians are reviewing the challenge · ${daysLeft(challenge.reviewEndsAt)}`,
      reason: challenge.reason,
    }
  }
  if (upload.status === 'pending' && !stake) {
    return { status: 'pending', note: 'Could not read its stake from the chain. Refresh to try again.' }
  }
  return { status: upload.status, note: null }
}

/** The most useful sentence out of a failed transaction (ethers v6 decodes require() strings). */
function txErrorMessage(err) {
  if (isUserRejection(err)) return 'Transaction rejected in your wallet.'
  return err?.reason || err?.shortMessage || err?.message || 'Transaction failed.'
}

/**
 * The daily rental price of an approved book: Rent.setBookPrice(hash, price),
 * signed by the archivist. The contract allows it only for the book's uploader,
 * only once it is Approved, as often as they like. A new price applies to
 * rentals that start after it; rentals already paid for are untouched.
 */
function PriceEditor({ hash, priceWei, delisted, rentContract, isCorrectNetwork, switchToBaseSepolia, onSaved }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [txState, setTxState] = useState('idle') // idle | signing | confirming
  const [error, setError] = useState(null)

  // rentBook() refuses a delisted book, and nothing lists it again.
  if (delisted) {
    return <p className="dash__stage">Delisted by the owner: it can no longer be rented, whatever its price.</p>
  }

  const current = priceWei ? BigInt(priceWei) : 0n
  const hasPrice = current > 0n
  const showForm = editing || !hasPrice
  const busy = txState !== 'idle'
  const parsed = parseAlexAmount(draft)
  const unchanged = parsed !== null && parsed === current

  const save = async (event) => {
    event.preventDefault()
    if (!isCorrectNetwork) {
      switchToBaseSepolia()
      return
    }
    if (!parsed || unchanged || !rentContract) return
    setError(null)
    setTxState('signing')
    try {
      const tx = await rentContract.setBookPrice(hash, parsed)
      setTxState('confirming')
      await tx.wait()
      onSaved(hash, parsed.toString())
      setEditing(false)
      setDraft('')
    } catch (err) {
      console.error('Set price failed', err)
      setError(txErrorMessage(err))
    } finally {
      setTxState('idle')
    }
  }

  const cancel = () => {
    setEditing(false)
    setDraft('')
    setError(null)
  }

  const buttonLabel =
    txState === 'signing' ? 'Confirm in wallet…'
      : txState === 'confirming' ? 'Saving on-chain…'
        : !isCorrectNetwork ? 'Switch to Base Sepolia'
          : hasPrice ? 'Update price' : 'Set price'

  return (
    <div className="dash__price">
      {hasPrice ? (
        <p className="dash__stage">
          Rental price: <strong className="dash__price-current">{alexFromWei(current)} $ALEX / day</strong>
          {!showForm && (
            <button type="button" className="dash__price-change" onClick={() => setEditing(true)}>
              Change
            </button>
          )}
        </p>
      ) : (
        <p className="dash__stage dash__stage--attention">
          No rental price yet. Readers can't rent it until you set one.
        </p>
      )}

      {showForm && (
        <form className="dash__price-form" onSubmit={save}>
          <div className="dash__price-field">
            <input
              className="dash__price-input"
              type="text"
              inputMode="decimal"
              autoComplete="off"
              aria-label="Rental price per day, in $ALEX"
              placeholder={hasPrice ? alexFromWei(current) : 'e.g. 2'}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              disabled={busy}
            />
            <span className="dash__price-unit">$ALEX / day</span>
          </div>
          <button
            type="submit"
            className="dash__price-submit"
            disabled={busy || (isCorrectNetwork && (!parsed || unchanged || !rentContract))}
          >
            {buttonLabel}
          </button>
          {editing && !busy && (
            <button type="button" className="dash__skip-btn" onClick={cancel}>Cancel</button>
          )}
        </form>
      )}

      {showForm && draft.trim() !== '' && (
        parsed === null ? (
          <p className="dash__challenge-error">Enter a number above 0, like 2 or 0.5 (a dot for decimals).</p>
        ) : unchanged ? (
          <p className="dash__price-hint">That is already the price.</p>
        ) : (
          <p className="dash__price-hint">
            Readers pay {RENTAL_DURATIONS.map(d => `${alexFromWei(parsed * BigInt(d.days))} for ${d.label}`).join(' · ')}.
            {' '}You receive {ARCHIVIST_SHARE_PERCENT}% of each rental.
            {hasPrice && ' Rentals already paid for keep their price.'}
          </p>
        )
      )}
      {error && <p className="dash__challenge-error">{error}</p>}
    </div>
  )
}

export default function ArchivistDashboard() {
  const { address, isCorrectNetwork, switchToBaseSepolia } = useWallet()
  const { stakeContract, rentContract } = useContracts()

  const [uploads, setUploads] = useState([])
  const [unavailable, setUnavailable] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  // { [arweaveHash]: 'pending' | 'done' | <error message> }
  const [publishState, setPublishState] = useState({})
  // { [arweaveHash]: atomic price } set from this page. The list reads prices
  // from the index, which learns of BookPriceSet only once the listener catches up.
  const [savedPrices, setSavedPrices] = useState({})

  const load = useCallback(async ({ silent = false } = {}) => {
    if (!address) return
    if (!silent) setLoading(true)
    try {
      const data = await getArchivistUploads(address)
      const list = Array.isArray(data.uploads) ? data.uploads : []
      setUploads(list)
      // Once the index shows a price set here, it is the source again.
      setSavedPrices(saved => {
        const next = { ...saved }
        for (const u of list) if (next[u.arweaveHash] === u.pricePerDay) delete next[u.arweaveHash]
        return next
      })
      setUnavailable(data.unavailable ?? 0)
      setError(null)
    } catch (err) {
      // No mock fallback: a made-up book here would look like the archivist's own.
      setError(err.message || 'Could not reach the backend.')
    } finally {
      setLoading(false)
    }
  }, [address])

  useEffect(() => {
    setUploads([])
    setPublishState({})
    setSavedPrices({})
    load()
  }, [load])

  const handlePriceSaved = (hash, priceWei) => {
    setSavedPrices(s => ({ ...s, [hash]: priceWei }))
    load({ silent: true })
  }

  // stake.unstake(): the contract re-checks everything — the archivist's own
  // active stake, the 14-day window over, no challenge — then marks the book
  // Approved, returns the stake and pays the upload reward.
  const handlePublish = async (hash) => {
    if (!stakeContract) return
    setPublishState(s => ({ ...s, [hash]: 'pending' }))
    try {
      const tx = await stakeContract.unstake(hash)
      await tx.wait()
      setPublishState(s => ({ ...s, [hash]: 'done' }))
      load({ silent: true })
    } catch (err) {
      console.error('Publish failed', err)
      setPublishState(s => ({ ...s, [hash]: txErrorMessage(err) }))
    }
  }

  const displayedUploads = address ? uploads : []
  const readyCount = displayedUploads.filter(u => u.canPublish && publishState[u.arweaveHash] !== 'done').length
  const isApproved = (u) => u.status === 'approved' || publishState[u.arweaveHash] === 'done'
  const approvedCount = displayedUploads.filter(isApproved).length
  const unpricedCount = displayedUploads.filter(
    u => isApproved(u) && !u.delisted && !savedPrices[u.arweaveHash] && !u.pricePerDay
  ).length

  return (
    <main className="dash">
      <div className="dash__inner">
        <div className="dash__tabs">
          <Link to="/dashboard/reader" className="dash__tab">Reader</Link>
          <Link to="/dashboard/archivist" className="dash__tab dash__tab--active">Archivist</Link>
          <Link to="/dashboard/librarian" className="dash__tab">Librarian</Link>
        </div>

        {!address ? (
          <ConnectWalletPrompt message="Connect your wallet to view your archivist dashboard." />
        ) : (
          <>
            <div className="dash__stats dash__stats--four">
              {[
                { label: 'Books Uploaded',   value: displayedUploads.length },
                { label: 'Ready to Publish', value: readyCount },
                { label: 'Approved',         value: approvedCount },
                { label: 'Need a Price',     value: unpricedCount },
              ].map(({ label, value }) => (
                <div key={label} className="dash__stat">
                  <span className="dash__stat-value">{value}</span>
                  <span className="dash__stat-label">{label}</span>
                </div>
              ))}
            </div>

            <div>
              <h2 className="dash__section-title">
                My Uploads
                <button className="dash__refresh-btn" onClick={() => load()} disabled={loading}>
                  {loading ? 'Refreshing…' : '↻ Refresh'}
                </button>
              </h2>
              <p className="dash__challenge-reviews-intro">
                Staking starts a 14-day window in which librarians may challenge the book. If nobody does, publish it here: it is approved for rental and your stake comes back. A challenged book gets 14 more days of librarian review, then the owner resolves it. Once a book is approved, set its daily rental price here; readers can rent it as soon as it has one, and you can change it at any time.
              </p>
              {error ? (
                <div className="dash__queue-error">
                  <span>Could not load your uploads — {error}</span>
                  <button className="dash__skip-btn" onClick={() => load()}>Retry</button>
                </div>
              ) : loading && displayedUploads.length === 0 ? (
                <div className="dash__empty"><span className="dash__spinner" /> Loading your uploads…</div>
              ) : displayedUploads.length === 0 ? (
                <div className="dash__empty">No uploads yet. <Link to="/upload">Upload a book</Link> to preserve it on Alexandria.</div>
              ) : (
                <div className="dash__list">
                  {displayedUploads.map(upload => {
                    const cs = categoryStyle(upload.category?.toLowerCase())
                    const stage = lifecycle(upload)
                    const published = publishState[upload.arweaveHash] === 'done'
                    const publishing = publishState[upload.arweaveHash] === 'pending'
                    const publishError = !published && !publishing ? publishState[upload.arweaveHash] : null
                    const shownStatus = published ? 'approved' : stage.status
                    const ss = STATUS_CONFIG[shownStatus] || { label: shownStatus || 'Pending', color: '#5b8dee', bg: 'rgba(91,141,238,0.12)' }
                    const initials = upload.title.split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase()

                    return (
                      <div key={upload.arweaveHash} className="dash__upload-item">
                        <div
                          className="dash__cover"
                          style={{ background: cs.bg, borderLeft: `3px solid ${cs.color}` }}
                        >
                          <span className="dash__cover-initials" style={{ color: cs.color }}>
                            {initials}
                          </span>
                        </div>

                        <div className="dash__upload-info">
                          <h3 className="dash__upload-title">{upload.title}</h3>
                          <p className="dash__upload-author">
                            {upload.author}
                            <span className="dash__upload-cat" style={{ color: cs.color, background: cs.bg }}>
                              {upload.category?.charAt(0).toUpperCase() + upload.category?.slice(1)}
                            </span>
                          </p>
                          {published ? (
                            <p className="dash__stage">Published: approved for rental, and your stake is on its way back.</p>
                          ) : stage.note && (
                            <p className="dash__stage">{stage.note}</p>
                          )}
                          {stage.reason && !published && (
                            <p className="dash__stage">Challenge reason: “{stage.reason}”</p>
                          )}
                          {publishError && <p className="dash__challenge-error">{publishError}</p>}
                          {isApproved(upload) && (
                            <PriceEditor
                              hash={upload.arweaveHash}
                              priceWei={savedPrices[upload.arweaveHash] ?? upload.pricePerDay}
                              delisted={upload.delisted}
                              rentContract={rentContract}
                              isCorrectNetwork={isCorrectNetwork}
                              switchToBaseSepolia={switchToBaseSepolia}
                              onSaved={handlePriceSaved}
                            />
                          )}
                        </div>

                        <div className="dash__upload-right">
                          <span className="dash__status" style={{ color: ss.color, background: ss.bg }}>
                            {ss.label}
                          </span>

                          {upload.canPublish && !published && (
                            <button
                              className="dash__challenge-submit"
                              onClick={() => handlePublish(upload.arweaveHash)}
                              disabled={publishing || !stakeContract}
                            >
                              {publishing ? 'Confirm in wallet…' : 'Publish & reclaim stake'}
                            </button>
                          )}
                          {stage.stakeLink && (
                            <Link to="/upload" className="dash__view-link">Stake now →</Link>
                          )}

                          <code className="upload__result-hash" style={{ fontSize: '0.75rem' }}>
                            {upload.arweaveHash?.slice(0, 8)}…{upload.arweaveHash?.slice(-6)}
                          </code>

                          <Link to={`/book/${upload.arweaveHash}`} className="dash__view-link">
                            View Book →
                          </Link>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}

              {unavailable > 0 && !error && (
                <p className="dash__queue-note">
                  {unavailable} upload{unavailable === 1 ? '' : 's'} could not be checked against the chain. Refresh to try again.
                </p>
              )}
            </div>
          </>
        )}
      </div>
    </main>
  )
}
