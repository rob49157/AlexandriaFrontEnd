import { useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import SearchBar from '../components/SearchBar'
import BookCard from '../components/BookCard'
import { searchBooks } from '../services/api'
import { MOCK_BOOKS } from '../data/mockBooks'
import '../styles/Search.css'

const CATEGORIES = [
  { slug: 'science',     label: 'Science'     },
  { slug: 'history',     label: 'History'     },
  { slug: 'philosophy',  label: 'Philosophy'  },
  { slug: 'literature',  label: 'Literature'  },
  { slug: 'mathematics', label: 'Mathematics' },
  { slug: 'technology',  label: 'Technology'  },
  { slug: 'medicine',    label: 'Medicine'    },
  { slug: 'arts',        label: 'Arts'        },
]

const SORT_OPTIONS = [
  { value: 'newest',      label: 'Newest First'      },
  { value: 'az',          label: 'A → Z'             },
]

export default function Search() {
  const [params, setParams] = useSearchParams()
  const q        = params.get('q')        || ''
  const category = params.get('category') || ''
  const sort     = params.get('sort')     || 'newest'

  const [books, setBooks] = useState([])
  const [loading, setLoading] = useState(true)
  const [totalCount, setTotalCount] = useState(0)

  useEffect(() => {
    let cancelled = false
    setLoading(true)

    async function loadResults() {
      try {
        // Query backend search API
        const data = await searchBooks({ q, category, status: '', page: 1, limit: 50 })
        if (cancelled) return

        if (data && Array.isArray(data.results)) {
          let sorted = [...data.results]
          if (sort === 'az') {
            sorted.sort((a, b) => a.title.localeCompare(b.title))
          }
          setBooks(sorted)
          setTotalCount(data.total || sorted.length)
        } else {
          setBooks([])
          setTotalCount(0)
        }
      } catch (err) {
        console.warn('Backend search unreachable, falling back to mock catalog:', err.message)
        if (cancelled) return
        // Fallback filter over mock data for local testing
        let results = MOCK_BOOKS
        if (q) {
          const lower = q.toLowerCase()
          results = results.filter(b =>
            b.title.toLowerCase().includes(lower) ||
            b.author.toLowerCase().includes(lower)
          )
        }
        if (category) {
          results = results.filter(b => b.category === category)
        }
        setBooks(results)
        setTotalCount(results.length)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    loadResults()
    return () => { cancelled = true }
  }, [q, category, sort])

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

  const activeCategoryLabel = CATEGORIES.find(c => c.slug === category)?.label

  const countLabel = (() => {
    if (loading) return 'Searching catalogue…'
    const n = totalCount
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
                </button>
              </li>
              {CATEGORIES.map(({ slug, label }) => (
                <li key={slug}>
                  <button
                    className={`search__filter-item${category === slug ? ' search__filter-item--active' : ''}`}
                    onClick={() => setFilter('category', slug)}
                  >
                    {label}
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

          {loading ? (
            <div style={{ textAlign: 'center', padding: '4rem 0', color: 'var(--text-secondary)' }}>
              Loading catalogue...
            </div>
          ) : books.length === 0 ? (
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
