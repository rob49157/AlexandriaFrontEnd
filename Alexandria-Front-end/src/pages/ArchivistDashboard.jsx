import { useState, useEffect } from 'react'
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

const STATUS_CONFIG = {
  pending:    { label: 'Pending Review', color: '#5b8dee', bg: 'rgba(91, 141, 238, 0.12)'  },
  active:     { label: 'Active',         color: '#4caf7a', bg: 'rgba(76, 175, 122, 0.12)'  },
  challenged: { label: 'Challenged',     color: '#e06060', bg: 'rgba(224, 96, 96, 0.12)'   },
  released:   { label: 'Released',       color: '#9090a0', bg: 'rgba(144, 144, 160, 0.12)' },
}

const MOCK_UPLOADS = [
  {
    arweaveHash: 'ar001',
    title: 'On the Origin of Species',
    author: 'Charles Darwin',
    category: 'science',
    status: 'active',
    stakedAt: Date.now() - 5 * 86_400_000,
    stakeDays: 14,
    stakeAmount: 100,
    revenue: 24.5,
  },
  {
    arweaveHash: 'ar012',
    title: 'A Brief History of Time',
    author: 'Stephen Hawking',
    category: 'science',
    status: 'pending',
    stakedAt: Date.now() - 1 * 86_400_000,
    stakeDays: 14,
    stakeAmount: 100,
    revenue: 0,
  },
  {
    arweaveHash: 'ar010',
    title: 'Crime and Punishment',
    author: 'Fyodor Dostoevsky',
    category: 'literature',
    status: 'challenged',
    stakedAt: Date.now() - 8 * 86_400_000,
    stakeDays: 14,
    stakeAmount: 100,
    revenue: 0,
  },
  {
    arweaveHash: 'ar003',
    title: 'The Republic',
    author: 'Plato',
    category: 'philosophy',
    status: 'released',
    stakedAt: Date.now() - 30 * 86_400_000,
    stakeDays: 14,
    stakeAmount: 100,
    revenue: 87.0,
  },
]

function StakeTimer({ stakedAt, stakeDays }) {
  const expiry = stakedAt + stakeDays * 86_400_000
  const [rem, setRem] = useState(Math.max(0, expiry - Date.now()))

  useEffect(() => {
    if (rem === 0) return
    const id = setInterval(() => setRem(Math.max(0, expiry - Date.now())), 1000)
    return () => clearInterval(id)
  }, [expiry])

  if (rem === 0) return <span className="dash__timer--expired">Stake period ended</span>
  const d = Math.floor(rem / 86_400_000)
  const h = Math.floor((rem % 86_400_000) / 3_600_000)
  const m = Math.floor((rem % 3_600_000) / 60_000)
  const s = Math.floor((rem % 60_000) / 1_000)
  return (
    <span className="dash__timer">
      {d}d {String(h).padStart(2, '0')}:{String(m).padStart(2, '0')}:{String(s).padStart(2, '0')} left
    </span>
  )
}

export default function ArchivistDashboard() {
  const { address, connect } = useWallet()

  const totalRevenue = MOCK_UPLOADS.reduce((sum, u) => sum + u.revenue, 0)
  const activeStakes = MOCK_UPLOADS.filter(u => u.status !== 'released').length

  return (
    <main className="dash">
      <div className="dash__inner">
        <div className="dash__tabs">
          <Link to="/dashboard/archivist" className="dash__tab dash__tab--active">Archivist</Link>
          <Link to="/dashboard/librarian" className="dash__tab">Librarian</Link>
        </div>

        {!address ? (
          <div className="dash__connect">
            <p>Connect your wallet to view your archivist dashboard.</p>
            <button className="dash__connect-btn" onClick={connect}>Connect Wallet</button>
          </div>
        ) : (
          <>
            <div className="dash__stats">
              {[
                { label: 'Books Uploaded', value: MOCK_UPLOADS.length },
                { label: 'Active Stakes',  value: activeStakes        },
                { label: 'Revenue Earned', value: `${totalRevenue.toFixed(1)} $ALEX` },
              ].map(({ label, value }) => (
                <div key={label} className="dash__stat">
                  <span className="dash__stat-value">{value}</span>
                  <span className="dash__stat-label">{label}</span>
                </div>
              ))}
            </div>

            <div>
              <h2 className="dash__section-title">My Uploads</h2>
              <div className="dash__list">
                {MOCK_UPLOADS.map(upload => {
                  const cs = CATEGORY_STYLE[upload.category] || { color: 'var(--accent)', bg: 'var(--accent-dim)' }
                  const ss = STATUS_CONFIG[upload.status]
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
                            {upload.category.charAt(0).toUpperCase() + upload.category.slice(1)}
                          </span>
                        </p>
                      </div>

                      <div className="dash__upload-right">
                        <span className="dash__status" style={{ color: ss.color, background: ss.bg }}>
                          {ss.label}
                        </span>

                        {(upload.status === 'active' || upload.status === 'pending') && (
                          <StakeTimer stakedAt={upload.stakedAt} stakeDays={upload.stakeDays} />
                        )}
                        {upload.status === 'challenged' && (
                          <span className="dash__stake-locked">Stake locked pending review</span>
                        )}
                        {upload.status === 'released' && (
                          <span className="dash__stake-done">Stake returned</span>
                        )}

                        <span className="dash__revenue">
                          {upload.revenue > 0 ? (
                            <><span className="dash__revenue-value">{upload.revenue}</span> $ALEX earned</>
                          ) : (
                            <span className="dash__revenue-zero">0 $ALEX earned</span>
                          )}
                        </span>

                        <Link to={`/book/${upload.arweaveHash}`} className="dash__view-link">
                          View Book →
                        </Link>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </>
        )}
      </div>
    </main>
  )
}
