import { useParams, Link, useNavigate } from 'react-router-dom'
import { useState, useEffect } from 'react'
import { useWallet } from '../context/WalletContext'
import { MOCK_BOOKS } from '../data/mockBooks'
import '../styles/BookDetail.css'

const CATEGORY_STYLE = {
  science:     { color: '#5b8dee', bg: 'rgba(91, 141, 238, 0.08)' },
  history:     { color: '#c9894c', bg: 'rgba(201, 137, 76, 0.08)' },
  philosophy:  { color: '#a97dcf', bg: 'rgba(169, 125, 207, 0.08)' },
  literature:  { color: '#c9a84c', bg: 'rgba(201, 168, 76, 0.08)' },
  mathematics: { color: '#4caf7a', bg: 'rgba(76, 175, 122, 0.08)' },
  technology:  { color: '#4cb8c4', bg: 'rgba(76, 184, 196, 0.08)' },
  medicine:    { color: '#e06060', bg: 'rgba(224, 96, 96, 0.08)' },
  arts:        { color: '#c94ca8', bg: 'rgba(201, 76, 168, 0.08)' },
}

const DURATIONS = [
  { days: 7,  label: '7 days'  },
  { days: 14, label: '14 days' },
  { days: 30, label: '30 days' },
]

function calcPrice(baseWeekly, days) {
  if (days === 7)  return baseWeekly
  if (days === 14) return Math.ceil(baseWeekly * 1.75)
  return Math.ceil(baseWeekly * 3.5)
}

function Countdown({ expiryMs }) {
  const [rem, setRem] = useState(expiryMs - Date.now())
  useEffect(() => {
    const id = setInterval(() => setRem(expiryMs - Date.now()), 1000)
    return () => clearInterval(id)
  }, [expiryMs])
  if (rem <= 0) return <span>Expired</span>
  const d = Math.floor(rem / 86_400_000)
  const h = Math.floor((rem % 86_400_000) / 3_600_000)
  const m = Math.floor((rem % 3_600_000) / 60_000)
  const s = Math.floor((rem % 60_000) / 1_000)
  return (
    <span className="book-detail__countdown">
      {d > 0 ? `${d}d ` : ''}
      {String(h).padStart(2, '0')}:{String(m).padStart(2, '0')}:{String(s).padStart(2, '0')}
    </span>
  )
}

export default function BookDetail() {
  const { arweaveHash } = useParams()
  const navigate = useNavigate()
  const { address, isCorrectNetwork, connect, switchToBaseSepolia } = useWallet()

  const [selectedDays, setSelectedDays] = useState(7)
  const [txState, setTxState] = useState('idle') // idle | approving | renting | error
  const [txError, setTxError] = useState(null)
  const [rentalExpiry, setRentalExpiry] = useState(null)

  const book = MOCK_BOOKS.find(b => b.arweaveHash === arweaveHash)

  const isPending = txState === 'approving' || txState === 'renting'
  const isRented  = !!(rentalExpiry && rentalExpiry > Date.now())

  const handleRent = async () => {
    if (!address) { connect(); return }
    if (!isCorrectNetwork) { switchToBaseSepolia(); return }
    setTxState('approving')
    setTxError(null)
    try {
      // Step 1: token.approve(RENT_CONTRACT_ADDRESS, parseUnits(price.toString(), 18))
      await new Promise(r => setTimeout(r, 1400))
      setTxState('renting')
      // Step 2: rent.rentBook(arweaveHash, BigInt(selectedDays * 86400))
      await new Promise(r => setTimeout(r, 1400))
      const expiry = Date.now() + selectedDays * 86_400_000
      setRentalExpiry(expiry)
      sessionStorage.setItem(`rental_expiry_${arweaveHash}`, String(expiry))
      setTxState('idle')
    } catch (err) {
      setTxState('error')
      setTxError(err.message)
    }
  }

  if (!book) {
    return (
      <main className="book-detail">
        <div className="book-detail__inner">
          <button className="book-detail__back" onClick={() => navigate(-1)}>← Browse</button>
          <p style={{ color: 'var(--text-secondary)', marginTop: '3rem', textAlign: 'center' }}>
            Book not found.
          </p>
        </div>
      </main>
    )
  }

  const style        = CATEGORY_STYLE[book.category] || { color: 'var(--accent)', bg: 'var(--accent-dim)' }
  const initials     = book.title.split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase()
  const price        = calcPrice(book.rentalPrice, selectedDays)
  const categoryLabel = book.category.charAt(0).toUpperCase() + book.category.slice(1)
  const yearDisplay  = book.year < 0 ? `${Math.abs(book.year)} BC` : String(book.year)

  return (
    <main className="book-detail">
      <div className="book-detail__inner">
        <button className="book-detail__back" onClick={() => navigate(-1)}>← Browse</button>

        <div className="book-detail__layout">

          {/* ── Cover column ── */}
          <aside className="book-detail__cover-col">
            <div
              className="book-detail__cover"
              style={{ background: style.bg, borderLeft: `4px solid ${style.color}` }}
            >
              <span className="book-detail__initials" style={{ color: style.color }}>
                {initials}
              </span>
            </div>

            <div className="book-detail__meta-card">
              <div className="book-detail__meta-row">
                <span className="book-detail__meta-label">Year</span>
                <span className="book-detail__meta-value">{yearDisplay}</span>
              </div>
              <div className="book-detail__meta-row">
                <span className="book-detail__meta-label">Pages</span>
                <span className="book-detail__meta-value">{book.pages?.toLocaleString() ?? '—'}</span>
              </div>
              <div className="book-detail__meta-row">
                <span className="book-detail__meta-label">Language</span>
                <span className="book-detail__meta-value">{book.language ?? '—'}</span>
              </div>
              <div className="book-detail__meta-row">
                <span className="book-detail__meta-label">Rentals</span>
                <span className="book-detail__meta-value">{book.rentals?.toLocaleString() ?? '0'}</span>
              </div>
            </div>

            <div className="book-detail__arweave">
              <span className="book-detail__arweave-label">Arweave ID</span>
              <code className="book-detail__arweave-hash">{arweaveHash}</code>
              <span className="book-detail__arweave-status">● Permanently stored</span>
            </div>
          </aside>

          {/* ── Content column ── */}
          <div className="book-detail__content">
            <span
              className="book-detail__category"
              style={{ color: style.color, background: style.bg }}
            >
              {categoryLabel}
            </span>

            <h1 className="book-detail__title">{book.title}</h1>
            <p className="book-detail__author">{book.author}</p>
            <p className="book-detail__desc">{book.description}</p>

            {/* ── Rental panel ── */}
            <div className="book-detail__rental">
              <h2 className="book-detail__rental-heading">
                {isRented ? 'Active Rental' : 'Rent Access'}
              </h2>

              {isRented ? (
                <>
                  <div className="book-detail__rented-status">
                    <span className="book-detail__rented-dot" />
                    <span>Expires in <Countdown expiryMs={rentalExpiry} /></span>
                  </div>
                  <Link to={`/read/${arweaveHash}`} className="book-detail__read-btn">
                    Read Book →
                  </Link>
                </>
              ) : (
                <>
                  <div className="book-detail__durations">
                    {DURATIONS.map(({ days, label }) => (
                      <button
                        key={days}
                        className={`book-detail__dur${selectedDays === days ? ' book-detail__dur--active' : ''}`}
                        onClick={() => !isPending && setSelectedDays(days)}
                        disabled={isPending}
                      >
                        {label}
                      </button>
                    ))}
                  </div>

                  <div className="book-detail__price-row">
                    <span className="book-detail__price-value">{price}</span>
                    <span className="book-detail__price-unit"> $ALEX</span>
                    <span className="book-detail__price-note">for {selectedDays} days of access</span>
                  </div>

                  {isPending ? (
                    <div className="book-detail__pending">
                      <span className="book-detail__spinner" />
                      {txState === 'approving' ? 'Approving $ALEX spend…' : 'Confirming rental…'}
                    </div>
                  ) : (
                    <button className="book-detail__rent-btn" onClick={handleRent}>
                      {!address
                        ? 'Connect Wallet to Rent'
                        : !isCorrectNetwork
                          ? 'Switch to Base Sepolia'
                          : 'Rent Now'}
                    </button>
                  )}

                  {txState === 'error' && (
                    <div className="book-detail__error">
                      <span>{txError || 'Transaction failed.'}</span>
                      <button onClick={() => setTxState('idle')}>Try again</button>
                    </div>
                  )}

                  {!address && (
                    <p className="book-detail__wallet-note">
                      MetaMask on Base Sepolia required to rent books.
                    </p>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </main>
  )
}
