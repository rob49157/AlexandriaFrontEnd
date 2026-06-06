import { useSearchParams } from 'react-router-dom'
import SearchBar from '../components/SearchBar'
import BookCard from '../components/BookCard'
import { MOCK_BOOKS } from '../data/mockBooks'
import '../styles/Search.css'

const CATEGORIES = [
  { slug: 'science',     label: 'Science',     count: 1284 },
  { slug: 'history',     label: 'History',     count: 892  },
  { slug: 'philosophy',  label: 'Philosophy',  count: 456  },
  { slug: 'literature',  label: 'Literature',  count: 2103 },
  { slug: 'mathematics', label: 'Mathematics', count: 678  },
  { slug: 'technology',  label: 'Technology',  count: 945  },
  { slug: 'medicine',    label: 'Medicine',    count: 731  },
  { slug: 'arts',        label: 'Arts',        count: 312  },
]

const SORT_OPTIONS = [
  { value: 'newest',      label: 'Newest First'      },
  { value: 'most-rented', label: 'Most Rented'       },
  { value: 'az',          label: 'A → Z'             },
  { value: 'price-low',   label: 'Price: Low → High' },
]

function applyFilters(books, { q, category, sort }) {
  let results = books

  if (q) {
    const lower = q.toLowerCase()
    results = results.filter(b =>
      b.title.toLowerCase().includes(lower) ||
      b.author.toLowerCase().includes(lower) ||
      b.description.toLowerCase().includes(lower)
    )
  }

  if (category) {
    results = results.filter(b => b.category === category)
  }

  switch (sort) {
    case 'az':
      results = [...results].sort((a, b) => a.title.localeCompare(b.title))
      break
    case 'price-low':
      results = [...results].sort((a, b) => a.rentalPrice - b.rentalPrice)
      break
    case 'most-rented':
      results = [...results].sort((a, b) => b.rentals - a.rentals)
      break
    case 'newest':
    default:
      results = [...results].sort((a, b) => b.year - a.year)
      break
  }

  return results
}

export default function Search() {
  const [params, setParams] = useSearchParams()
  const q        = params.get('q')        || ''
  const category = params.get('category') || ''
  const sort     = params.get('sort')     || 'newest'

  const setFilter = (key, value) => {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value)
    else next.delete(key)
    setParams(next, { replace: true })
  }

  const clearFilters = () => {
    const next = new URLSearchParams()
    if (q) next.set('q', q)
    setParams(next, { replace: true })
  }

  const books = applyFilters(MOCK_BOOKS, { q, category, sort })
  const activeCategoryLabel = CATEGORIES.find(c => c.slug === category)?.label

  const countLabel = (() => {
    const n = books.length
    const suffix = n !== 1 ? 's' : ''
    const queryPart = q ? ` for "${q}"` : ''
    const catPart = activeCategoryLabel ? ` in ${activeCategoryLabel}` : ''
    return n === 0 ? 'No results found' : `${n} book${suffix}${queryPart}${catPart}`
  })()

  return (
    <main className="search">
      <div className="search__header">
        <div className="search__header-inner">
          <SearchBar initialValue={q} />
        </div>
      </div>

      <div className="search__layout">
        {/* ── Sidebar ── */}
        <aside className="search__sidebar">
          <div className="search__filter-section">
            <h3 className="search__filter-label">Category</h3>
            <ul className="search__filter-list">
              <li>
                <button
                  className={`search__filter-item${!category ? ' search__filter-item--active' : ''}`}
                  onClick={() => setFilter('category', '')}
                >
                  All Categories
                  <span className="search__filter-count">{MOCK_BOOKS.length}</span>
                </button>
              </li>
              {CATEGORIES.map(({ slug, label, count }) => (
                <li key={slug}>
                  <button
                    className={`search__filter-item${category === slug ? ' search__filter-item--active' : ''}`}
                    onClick={() => setFilter('category', slug)}
                  >
                    {label}
                    <span className="search__filter-count">{count.toLocaleString()}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>

          <div className="search__filter-section">
            <h3 className="search__filter-label">Sort by</h3>
            <select
              className="search__sort-select"
              value={sort}
              onChange={e => setFilter('sort', e.target.value)}
            >
              {SORT_OPTIONS.map(({ value, label }) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>

          {category && (
            <button className="search__clear-btn" onClick={clearFilters}>
              Clear filters
            </button>
          )}
        </aside>

        {/* ── Results ── */}
        <section className="search__results">
          <div className="search__results-header">
            <p className="search__count">{countLabel}</p>
          </div>

          {books.length === 0 ? (
            <div className="search__empty">
              <span className="search__empty-icon">📚</span>
              <p className="search__empty-title">No books found</p>
              <p className="search__empty-sub">
                Try a different search term or browse all categories.
              </p>
              <button
                className="search__clear-btn"
                style={{ width: 'auto', padding: '0.45rem 1.25rem' }}
                onClick={() => setParams({})}
              >
                Clear all
              </button>
            </div>
          ) : (
            <div className="search__grid">
              {books.map(book => (
                <BookCard key={book.arweaveHash} book={book} />
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  )
}
