import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { useWallet } from '../context/WalletContext'
import ConnectWalletPrompt from '../components/ConnectWalletPrompt'
import { getRenterRentals } from '../services/api'
import { categoryStyle } from '../utils/constants'
import '../styles/Dashboard.css'

const RENTED = { label: 'Rented',  color: '#4caf7a', bg: 'rgba(76, 175, 122, 0.12)'  }
const ENDED  = { label: 'Expired', color: '#9090a0', bg: 'rgba(144, 144, 160, 0.12)' }

function formatDate(iso) {
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

function timeLeft(expiryMs, now) {
  const ms = Math.max(0, expiryMs - now)
  const d = Math.floor(ms / 86_400_000)
  const h = Math.floor((ms % 86_400_000) / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  return d > 0 ? `${d}d ${h}h left` : `${h}h ${m}m left`
}

function RentalItem({ rental, active, now }) {
  const { book, arweaveHash } = rental
  const title = book?.title || `${arweaveHash.slice(0, 8)}…${arweaveHash.slice(-6)}`
  const cs = categoryStyle(book?.category?.toLowerCase())
  const initials = title.split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase()
  const pill = active ? RENTED : ENDED
  const days = rental.durationDays

  return (
    <div className="dash__upload-item">
      <div className="dash__cover" style={{ background: cs.bg, borderLeft: `3px solid ${cs.color}` }}>
        <span className="dash__cover-initials" style={{ color: cs.color }}>{initials}</span>
      </div>

      <div className="dash__upload-info">
        <h3 className="dash__upload-title">{title}</h3>
        {book?.author && <p className="dash__upload-author">{book.author}</p>}
        <p className="dash__stage">
          Rented {formatDate(rental.rentedAt)} for {days} {days === 1 ? 'day' : 'days'} ·{' '}
          {active ? `expires ${formatDate(rental.expiry)}` : `expired ${formatDate(rental.expiry)}`}
        </p>
      </div>

      <div className="dash__upload-right">
        <span className="dash__status" style={{ color: pill.color, background: pill.bg }}>{pill.label}</span>
        {active ? (
          <>
            <span className="dash__stage">{timeLeft(Date.parse(rental.expiry), now)}</span>
            <Link to={`/read/${arweaveHash}`} className="dash__view-link">Read →</Link>
          </>
        ) : null}
        <Link to={`/book/${arweaveHash}`} className="dash__view-link">
          {active ? 'View Book →' : 'View or rent again →'}
        </Link>
      </div>
    </div>
  )
}

export default function ReaderDashboard() {
  const { address } = useWallet()

  const [rentals, setRentals] = useState([])
  const [unresolved, setUnresolved] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  // Re-split active and expired once a minute, so a rental that runs out while
  // the page is open moves to the history without a refresh.
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(id)
  }, [])

  const load = useCallback(async () => {
    if (!address) return
    setLoading(true)
    try {
      const data = await getRenterRentals(address)
      setRentals(Array.isArray(data.rentals) ? data.rentals : [])
      setUnresolved(data.unresolved ?? 0)
      setError(null)
      setNow(Date.now())
    } catch (err) {
      // No mock fallback: a made-up rental here would look like the reader's own.
      setError(err.message || 'Could not reach the backend.')
    } finally {
      setLoading(false)
    }
  }, [address])

  useEffect(() => {
    setRentals([])
    load()
  }, [load])

  const shown = address ? rentals : []
  const isActive = (r) => Date.parse(r.expiry) > now
  const current = shown.filter(isActive)
  const history = shown.filter(r => !isActive(r))
  const distinctBooks = new Set(shown.map(r => r.arweaveHash)).size

  return (
    <main className="dash">
      <div className="dash__inner">
        <div className="dash__tabs">
          <Link to="/dashboard/reader" className="dash__tab dash__tab--active">Reader</Link>
          <Link to="/dashboard/archivist" className="dash__tab">Archivist</Link>
          <Link to="/dashboard/librarian" className="dash__tab">Librarian</Link>
        </div>

        {!address ? (
          <ConnectWalletPrompt message="Connect your wallet to see the books you have rented." />
        ) : (
          <>
            <div className="dash__stats">
              {[
                { label: 'Currently Rented', value: current.length },
                { label: 'Books Rented',     value: distinctBooks },
                { label: 'Total Rentals',    value: shown.length },
              ].map(({ label, value }) => (
                <div key={label} className="dash__stat">
                  <span className="dash__stat-value">{value}</span>
                  <span className="dash__stat-label">{label}</span>
                </div>
              ))}
            </div>

            <div>
              <h2 className="dash__section-title">
                Currently Rented
                <button className="dash__refresh-btn" onClick={() => load()} disabled={loading}>
                  {loading ? 'Refreshing…' : '↻ Refresh'}
                </button>
              </h2>
              {error ? (
                <div className="dash__queue-error">
                  <span>Could not load your rentals — {error}</span>
                  <button className="dash__skip-btn" onClick={() => load()}>Retry</button>
                </div>
              ) : loading && shown.length === 0 ? (
                <div className="dash__empty"><span className="dash__spinner" /> Loading your rentals…</div>
              ) : current.length === 0 ? (
                <div className="dash__empty">
                  Nothing rented right now. <Link to="/search">Browse the library</Link> to find a book.
                </div>
              ) : (
                <div className="dash__list">
                  {current.map(r => <RentalItem key={r.transactionHash} rental={r} active now={now} />)}
                </div>
              )}
              <p className="dash__queue-note">
                Just rented a book? It can take a minute to show up here.
              </p>
            </div>

            {!error && history.length > 0 && (
              <div style={{ marginTop: '2rem' }}>
                <h2 className="dash__section-title">Rental History</h2>
                <div className="dash__list">
                  {history.map(r => <RentalItem key={r.transactionHash} rental={r} active={false} now={now} />)}
                </div>
              </div>
            )}

            {unresolved > 0 && !error && (
              <p className="dash__queue-note">
                {unresolved} rental{unresolved === 1 ? ' is' : 's are'} on-chain for a book this library has not indexed, so {unresolved === 1 ? 'it is' : 'they are'} not listed.
              </p>
            )}
          </>
        )}
      </div>
    </main>
  )
}
