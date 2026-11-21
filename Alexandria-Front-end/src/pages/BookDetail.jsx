import { useParams, Link, useNavigate } from 'react-router-dom'
import { useState, useEffect } from 'react'
import { useWallet } from '../context/WalletContext'
import WalletSelectModal from '../components/WalletSelectModal'
import { useContracts } from '../hooks/useContracts'
import { getUpload, getRentalStatus, getBookRentalInfo } from '../services/api'
import { ADDRESSES } from '../config/contracts'
import { MOCK_BOOKS } from '../data/mockBooks'
import { categoryLabel, categoryStyle, RENTAL_DURATIONS } from '../utils/constants'
import { reviewLabel, alexFromWei } from '../utils/formatters'
import '../styles/BookDetail.css'

// Why GET /rental/book answered rentable: false. Mirrors the checks in
// Rent.rentBook(): Approved status, a price above 0, and not delisted.
function notRentableReason(book, rentalInfo) {
  if (rentalInfo.delisted) return 'This book was delisted and can no longer be rented.'
  if (rentalInfo.onChainStatus === 'pending') {
    return book.reviewEndsAt
      ? 'It can be rented once its 14-day review is over and the archivist sets a price.'
      : 'Registered, but not staked yet. The 14-day review starts once the archivist stakes it.'
  }
  if (rentalInfo.onChainStatus === 'challenged') return 'A librarian has challenged this book. Rentals wait for the decision.'
  if (rentalInfo.onChainStatus === 'rejected') return 'This book was rejected after a challenge and cannot be rented.'
  if (rentalInfo.onChainStatus === 'approved' && !rentalInfo.priceSet) return "Approved, but the archivist hasn't set a rental price yet."
  return "This book can't be rented right now."
}

// What rentBook() will charge, in atomic $ALEX: the archivist's daily price
// times the days. Exact, because the approval has to cover it to the last wei.
// Null while the chain has not given a price.
function rentalTotalWei(rentalInfo, duration) {
  if (!rentalInfo?.priceSet) return null
  return BigInt(rentalInfo.pricePerDay) * BigInt(duration.days)
}

function Countdown({ expiryMs }) {
  const [rem, setRem] = useState(() => expiryMs - Date.now())
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
  const { address, isCorrectNetwork, switchToBaseSepolia } = useWallet()
  const { tokenContract, rentContract } = useContracts()

  const [showWalletSelect, setShowWalletSelect] = useState(false)
  const [book, setBook] = useState(null)
  const [loading, setLoading] = useState(true)
  const [rentalInfo, setRentalInfo] = useState(null)
  const [selectedDuration, setSelectedDuration] = useState(RENTAL_DURATIONS[1]) // 7 days default
  const [txState, setTxState] = useState('idle') // idle | approving | renting | error
  const [txError, setTxError] = useState(null)
  const [rentalExpiry, setRentalExpiry] = useState(null)
  const [isUploader, setIsUploader] = useState(false)

  // ── Load Book & Rental Info ───────────────────────────
  useEffect(() => {
    let cancelled = false
    setLoading(true)

    async function load() {
      try {
        // Fetch metadata from backend
        const data = await getUpload(arweaveHash).catch(() => null)
        if (cancelled) return

        if (data) {
          setBook(data)
          if (address && data.uploader && data.uploader.toLowerCase() === address.toLowerCase()) {
            setIsUploader(true)
          }
        } else {
          // Fallback to mock data if not in backend database
          const mock = MOCK_BOOKS.find(b => b.arweaveHash === arweaveHash)
          if (mock) setBook(mock)
        }

        // Fetch on-chain rental price & status
        const priceData = await getBookRentalInfo(arweaveHash).catch(() => null)
        if (!cancelled && priceData) {
          setRentalInfo(priceData)
        }

        // Check if current user has active rental
        if (address) {
          const status = await getRentalStatus(arweaveHash, address).catch(() => null)
          if (!cancelled && status && status.active && status.expiry) {
            setRentalExpiry(new Date(status.expiry).getTime())
          }
        }
      } catch (err) {
        console.warn('Error loading book details:', err)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => { cancelled = true }
  }, [arweaveHash, address])

  // ── Rent Book Transaction ─────────────────────────────
  const handleRent = async () => {
    if (!address) { setShowWalletSelect(true); return }
    if (!isCorrectNetwork) { switchToBaseSepolia(); return }
    if (!tokenContract || !rentContract) {
      setTxError('Smart contracts not initialized.')
      return
    }

    const totalPriceWei = rentalTotalWei(rentalInfo, selectedDuration)
    if (totalPriceWei === null) {
      setTxState('error')
      setTxError("This book's price could not be read from the chain. Refresh and try again.")
      return
    }

    setTxState('approving')
    setTxError(null)

    try {
      // Step 1: token.approve(RENT_ADDRESS, totalPriceWei)
      const approveTx = await tokenContract.approve(ADDRESSES.rent, totalPriceWei)
      await approveTx.wait()

      // Step 2: rent.rentBook(arweaveHash, durationSeconds)
      setTxState('renting')
      const rentTx = await rentContract.rentBook(arweaveHash, selectedDuration.seconds)
      await rentTx.wait()

      const expiry = Date.now() + selectedDuration.seconds * 1000
      setRentalExpiry(expiry)
      setTxState('idle')
    } catch (err) {
      // The archivist can change the price at any time, and rentBook() charges
      // the price when it runs: a raise after this page loaded leaves the
      // approval short, and transferFrom reverts. Nothing is taken then.
      const fresh = await getBookRentalInfo(arweaveHash).catch(() => null)
      if (fresh) setRentalInfo(fresh)
      setTxState('error')
      if (fresh?.priceSet && fresh.pricePerDay !== rentalInfo.pricePerDay) {
        setTxError(
          `The archivist changed the price to ${alexFromWei(fresh.pricePerDay)} $ALEX/day while you were renting. ` +
          'No $ALEX was taken. Check the new total and try again.'
        )
      } else {
        setTxError(err.reason || err.message || 'Rental transaction failed.')
      }
    }
  }

  if (loading) {
    return (
      <main className="book-detail">
        <div className="book-detail__inner" style={{ textAlign: 'center', padding: '4rem 0' }}>
          <p style={{ color: 'var(--text-secondary)' }}>Loading book metadata…</p>
        </div>
      </main>
    )
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

  const style         = categoryStyle(book.category?.toLowerCase())
  const initials      = book.title.split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase()
  const totalWei      = rentalTotalWei(rentalInfo, selectedDuration)
  const totalPrice    = totalWei === null ? null : alexFromWei(totalWei)
  const pricePerDay   = rentalInfo?.priceSet ? alexFromWei(rentalInfo.pricePerDay) : null
  const isRented      = isUploader || Boolean(rentalExpiry && rentalExpiry > Date.now())
  const isPending     = txState === 'approving' || txState === 'renting'
  const notRentable   = Boolean(rentalInfo && !rentalInfo.rentable)
  // The backend could not read the chain: no price to show, so no rent button
  const priceUnknown  = !rentalInfo || totalWei === null
  const inReview      = book.status === 'pending' && Boolean(book.reviewEndsAt)

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
                <span className="book-detail__meta-label">Pages</span>
                <span className="book-detail__meta-value">{book.pageCount ?? book.pages ?? '—'}</span>
              </div>
              <div className="book-detail__meta-row">
                <span className="book-detail__meta-label">Status</span>
                <span className="book-detail__meta-value" style={{ textTransform: 'capitalize' }}>
                  {book.status?.replace('_', ' ') || 'Preserved'}
                </span>
              </div>
              <div className="book-detail__meta-row">
                <span className="book-detail__meta-label">Uploader</span>
                <span className="book-detail__meta-value" title={book.uploader}>
                  {book.uploader ? `${book.uploader.slice(0, 6)}…${book.uploader.slice(-4)}` : 'Archivist'}
                </span>
              </div>
            </div>

            <div className="book-detail__arweave">
              <span className="book-detail__arweave-label">Arweave ID</span>
              <code className="book-detail__arweave-hash">{arweaveHash}</code>
              <span className="book-detail__arweave-status">● Encrypted & Stored</span>
            </div>
          </aside>

          {/* ── Content column ── */}
          <div className="book-detail__content">
            <span
              className="book-detail__category"
              style={{ color: style.color, background: style.bg }}
            >
              {categoryLabel(book.category?.toLowerCase())}
            </span>

            <h1 className="book-detail__title">{book.title}</h1>
            <p className="book-detail__author">{book.author}</p>
            <p className="book-detail__desc">{book.description}</p>

            {/* ── Rental panel ── */}
            <div className="book-detail__rental">
              <h2 className="book-detail__rental-heading">
                {isUploader ? 'Archivist Access' : isRented ? 'Active Rental' : 'Rent Access'}
              </h2>

              {isUploader ? (
                <>
                  <div className="book-detail__rented-status">
                    <span className="book-detail__rented-dot" />
                    <span>You uploaded this book. You have permanent reader access.</span>
                  </div>
                  <Link to={`/read/${arweaveHash}`} className="book-detail__read-btn">
                    Read Book →
                  </Link>
                  {rentalInfo?.onChainStatus === 'approved' && !rentalInfo.delisted && (
                    <p className="book-detail__wallet-note">
                      {rentalInfo.priceSet
                        ? `Readers pay ${pricePerDay} $ALEX per day. `
                        : "Readers can't rent it until you set a daily price. "}
                      <Link to="/dashboard/archivist">
                        {rentalInfo.priceSet ? 'Change it on your dashboard →' : 'Set it on your dashboard →'}
                      </Link>
                    </p>
                  )}
                </>
              ) : isRented ? (
                <>
                  <div className="book-detail__rented-status">
                    <span className="book-detail__rented-dot" />
                    <span>Expires in <Countdown expiryMs={rentalExpiry} /></span>
                  </div>
                  <Link to={`/read/${arweaveHash}`} className="book-detail__read-btn">
                    Read Book →
                  </Link>
                </>
              ) : notRentable ? (
                // Renting would revert on-chain, after the reader has already approved $ALEX
                <div className="book-detail__unavailable">
                  {inReview && <span className="book-detail__unavailable-title">{reviewLabel(book.reviewEndsAt)}</span>}
                  <span>{notRentableReason(book, rentalInfo)}</span>
                </div>
              ) : priceUnknown ? (
                <div className="book-detail__unavailable">
                  <span>This book's rental price could not be read from the chain. Refresh the page to try again.</span>
                </div>
              ) : (
                <>
                  <div className="book-detail__durations">
                    {RENTAL_DURATIONS.map((dur) => (
                      <button
                        key={dur.days}
                        className={`book-detail__dur${selectedDuration.days === dur.days ? ' book-detail__dur--active' : ''}`}
                        onClick={() => !isPending && setSelectedDuration(dur)}
                        disabled={isPending}
                      >
                        {dur.label}
                      </button>
                    ))}
                  </div>

                  <div className="book-detail__price-row">
                    <span className="book-detail__price-value">{totalPrice}</span>
                    <span className="book-detail__price-unit"> $ALEX</span>
                    <span className="book-detail__price-note">
                      ({pricePerDay} ALEX/day for {selectedDuration.label})
                    </span>
                  </div>

                  {isPending ? (
                    <div className="book-detail__pending">
                      <span className="book-detail__spinner" />
                      {txState === 'approving'
                        ? 'Approving $ALEX token spend…'
                        : 'Confirming rental transaction on Base Sepolia…'}
                    </div>
                  ) : (
                    <button className="book-detail__rent-btn" onClick={handleRent}>
                      {!address
                        ? 'Connect Wallet to Rent'
                        : !isCorrectNetwork
                          ? 'Switch to Base Sepolia'
                          : `Rent for ${totalPrice} $ALEX`}
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
                      MetaMask / Rabby on Base Sepolia required to rent books.
                    </p>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {showWalletSelect && (
        <WalletSelectModal onClose={() => setShowWalletSelect(false)} />
      )}
    </main>
  )
}
