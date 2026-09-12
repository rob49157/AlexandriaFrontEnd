import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useWallet } from '../context/WalletContext'
import ConnectWalletPrompt from '../components/ConnectWalletPrompt'
import { searchBooks } from '../services/api'
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
  pending_stake: { label: 'Pending Stake', color: '#eab308', bg: 'rgba(234, 179, 8, 0.12)'   },
  pending:       { label: 'Pending Review',color: '#5b8dee', bg: 'rgba(91, 141, 238, 0.12)'  },
  approved:      { label: 'Approved',      color: '#4caf7a', bg: 'rgba(76, 175, 122, 0.12)'  },
  active:        { label: 'Approved',      color: '#4caf7a', bg: 'rgba(76, 175, 122, 0.12)'  },
  challenged:    { label: 'Challenged',    color: '#e06060', bg: 'rgba(224, 96, 96, 0.12)'   },
  rejected:      { label: 'Rejected',      color: '#9090a0', bg: 'rgba(144, 144, 160, 0.12)' },
}

const DEFAULT_UPLOADS = [
  {
    arweaveHash: 'FQ4e7Gt6AB4fSj65bxiyNqrn3Yn2T4nn3dJKKD7ZCx0',
    title: 'On the Origin of Species',
    author: 'Charles Darwin',
    category: 'science',
    status: 'pending',
  },
]

export default function ArchivistDashboard() {
  const { address } = useWallet()
  const [uploads, setUploads] = useState([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let cancelled = false
    if (!address) {
      return
    }

    searchBooks({ status: '', limit: 100 })
      .then(data => {
        if (cancelled) return
        if (data && Array.isArray(data.results)) {
          const userAddr = address.toLowerCase()
          const myUploads = data.results.filter(b => b.uploader && b.uploader.toLowerCase() === userAddr)
          if (myUploads.length > 0) {
            setUploads(myUploads)
            setLoading(false)
            return
          }
        }
        setUploads(DEFAULT_UPLOADS)
      })
      .catch(err => {
        console.warn('Could not fetch archivist uploads from backend:', err)
        if (!cancelled) setUploads(DEFAULT_UPLOADS)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => { cancelled = true }
  }, [address])

  const displayedUploads = address ? uploads : []
  const activeStakes = displayedUploads.filter(u => u.status === 'pending' || u.status === 'approved').length

  return (
    <main className="dash">
      <div className="dash__inner">
        <div className="dash__tabs">
          <Link to="/dashboard/archivist" className="dash__tab dash__tab--active">Archivist</Link>
          <Link to="/dashboard/librarian" className="dash__tab">Librarian</Link>
        </div>

        {!address ? (
          <ConnectWalletPrompt message="Connect your wallet to view your archivist dashboard." />
        ) : (
          <>
            <div className="dash__stats">
              {[
                { label: 'Books Uploaded', value: displayedUploads.length },
                { label: 'Active Uploads', value: activeStakes   },
                { label: 'Network Stake',  value: '100 $ALEX / book' },
              ].map(({ label, value }) => (
                <div key={label} className="dash__stat">
                  <span className="dash__stat-value">{value}</span>
                  <span className="dash__stat-label">{label}</span>
                </div>
              ))}
            </div>

            <div>
              <h2 className="dash__section-title">My Uploads</h2>
              {loading ? (
                <p style={{ color: 'var(--text-secondary)' }}>Loading your uploads…</p>
              ) : displayedUploads.length === 0 ? (
                <p style={{ color: 'var(--text-secondary)' }}>No uploads found. Upload a book to preserve it on Alexandria!</p>
              ) : (
                <div className="dash__list">
                  {displayedUploads.map(upload => {
                    const cs = CATEGORY_STYLE[upload.category?.toLowerCase()] || { color: 'var(--accent)', bg: 'var(--accent-dim)' }
                    const ss = STATUS_CONFIG[upload.status] || { label: upload.status || 'Pending', color: '#5b8dee', bg: 'rgba(91,141,238,0.12)' }
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
                        </div>

                        <div className="dash__upload-right">
                          <span className="dash__status" style={{ color: ss.color, background: ss.bg }}>
                            {ss.label}
                          </span>

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
            </div>
          </>
        )}
      </div>
    </main>
  )
}
