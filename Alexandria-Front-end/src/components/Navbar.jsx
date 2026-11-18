import { Link, useLocation } from 'react-router-dom'
import WalletButton from './WalletButton'
import '../styles/Navbar.css'

const NAV_LINKS = [
  { to: '/search', label: 'Browse' },
  { to: '/upload', label: 'Upload' },
  // Every user is a reader, so the dashboard opens on the Reader tab. `match`
  // keeps the link lit on any tab, not just the one it opens.
  { to: '/dashboard/reader', label: 'Dashboard', match: '/dashboard' },
]

export default function Navbar() {
  const { pathname } = useLocation()

  return (
    <header className="navbar">
      <div className="navbar__inner">
        <Link to="/" className="navbar__brand">
          <svg className="navbar__logo" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="16" cy="16" r="13.5" stroke="currentColor" strokeWidth="1.5" />
            <path d="M16 7L23 23H9L16 7Z" fill="currentColor" fillOpacity="0.9" />
            <line x1="10.5" y1="19" x2="21.5" y2="19" stroke="var(--bg-primary)" strokeWidth="1.75" />
          </svg>
          <span className="navbar__name">Alexandria</span>
        </Link>

        <nav className="navbar__links">
          {NAV_LINKS.map(({ to, label, match }) => (
            <Link
              key={to}
              to={to}
              className={`navbar__link${pathname.startsWith(match || to) ? ' navbar__link--active' : ''}`}
            >
              {label}
            </Link>
          ))}
        </nav>

        <WalletButton />
      </div>
    </header>
  )
}
