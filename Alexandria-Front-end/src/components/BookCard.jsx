import { Link } from 'react-router-dom'
import '../styles/BookCard.css'

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

export default function BookCard({ book }) {
  const { arweaveHash, title, author, category, description, rentalPrice } = book
  const style = CATEGORY_STYLE[category] || { color: 'var(--accent)', bg: 'var(--accent-dim)' }
  const initials = title.split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase()
  const categoryLabel = category.charAt(0).toUpperCase() + category.slice(1)

  return (
    <Link to={`/book/${arweaveHash}`} className="book-card">
      <div
        className="book-card__cover"
        style={{ background: style.bg, borderLeft: `3px solid ${style.color}` }}
      >
        <span className="book-card__initials" style={{ color: style.color }}>
          {initials}
        </span>
      </div>

      <div className="book-card__body">
        <span
          className="book-card__category"
          style={{ color: style.color, background: style.bg }}
        >
          {categoryLabel}
        </span>
        <h3 className="book-card__title">{title}</h3>
        <p className="book-card__author">{author}</p>
        <p className="book-card__desc">{description}</p>
        <div className="book-card__footer">
          <span className="book-card__price">
            <span className="book-card__price-value">{rentalPrice}</span>
            <span className="book-card__price-unit"> $ALEX / week</span>
          </span>
          <span className="book-card__cta">View →</span>
        </div>
      </div>
    </Link>
  )
}
