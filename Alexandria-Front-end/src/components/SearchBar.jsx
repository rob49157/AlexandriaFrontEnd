import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import '../styles/SearchBar.css'

export default function SearchBar({
  placeholder = 'Search books, authors, topics…',
  size = 'default',
  initialValue = '',
}) {
  const [query, setQuery] = useState(initialValue)
  const navigate = useNavigate()

  const handleSubmit = (e) => {
    e.preventDefault()
    if (query.trim()) {
      navigate(`/search?q=${encodeURIComponent(query.trim())}`)
    }
  }

  return (
    <form className={`search-bar search-bar--${size}`} onSubmit={handleSubmit} role="search">
      <input
        className="search-bar__input"
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck="false"
      />
      <button className="search-bar__btn" type="submit" aria-label="Search">
        <svg viewBox="0 0 20 20" fill="none" className="search-bar__icon">
          <circle cx="9" cy="9" r="5.5" stroke="currentColor" strokeWidth="1.75" />
          <path d="M13.5 13.5L17 17" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
        </svg>
      </button>
    </form>
  )
}
