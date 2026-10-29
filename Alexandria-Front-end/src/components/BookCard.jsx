import { Link } from 'react-router-dom'
import { categoryLabel, categoryStyle } from '../utils/constants'
import { formatAlex, reviewLabel } from '../utils/formatters'
import '../styles/BookCard.css'

export default function BookCard({ book }) {
  const { arweaveHash, title, author, category, description, status, reviewEndsAt, pricePerDayAlex } = book
  const style = categoryStyle(category)
  const initials = title.split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase()
  // Staked and inside its challenge window: listed, but Rent.rentBook() needs Approved
  const inReview = status === 'pending' && Boolean(reviewEndsAt)

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
        <div className="book-card__tags">
          <span
            className="book-card__category"
            style={{ color: style.color, background: style.bg }}
          >
            {categoryLabel(category)}
          </span>
          {inReview && <span className="book-card__review">{reviewLabel(reviewEndsAt)}</span>}
        </div>
        <h3 className="book-card__title">{title}</h3>
        <p className="book-card__author">{author}</p>
        <p className="book-card__desc">{description}</p>
        <div className="book-card__footer">
          {inReview ? (
            <span className="book-card__note">Rentable after review</span>
          ) : pricePerDayAlex ? (
            <span className="book-card__price">
              <span className="book-card__price-value">{formatAlex(pricePerDayAlex)}</span>
              <span className="book-card__price-unit"> $ALEX / day</span>
            </span>
          ) : (
            <span className="book-card__note">Price not set yet</span>
          )}
          <span className="book-card__cta">View →</span>
        </div>
      </div>
    </Link>
  )
}
