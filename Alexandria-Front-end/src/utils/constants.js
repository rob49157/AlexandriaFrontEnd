// Book categories. Keep in step with ALLOWED_CATEGORIES in
// AlexNode/services/validation.service.js: the backend rejects an upload with any
// other slug, and answers a search for one with 400.
export const CATEGORIES = [
  { slug: 'science',     label: 'Science',     color: '#5b8dee' },
  { slug: 'history',     label: 'History',     color: '#c9894c' },
  { slug: 'literature',  label: 'Literature',  color: '#c9a84c' },
  { slug: 'philosophy',  label: 'Philosophy',  color: '#a97dcf' },
  { slug: 'technology',  label: 'Technology',  color: '#4cb8c4' },
  { slug: 'art',         label: 'Art',         color: '#c94ca8' },
  { slug: 'mathematics', label: 'Mathematics', color: '#4caf7a' },
  { slug: 'medicine',    label: 'Medicine',    color: '#e06060' },
  { slug: 'law',         label: 'Law',         color: '#8a94a6' },
  { slug: 'religion',    label: 'Religion',    color: '#b0875a' },
  { slug: 'reference',   label: 'Reference',   color: '#7f9c4c' },
  { slug: 'other',       label: 'Other',       color: '#9090a0' },
]

const findCategory = (slug) => CATEGORIES.find(c => c.slug === slug)

function tint(hex, alpha) {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`
}

// { color, bg } for a category's pill and cover
export function categoryStyle(slug) {
  const c = findCategory(slug)
  return c ? { color: c.color, bg: tint(c.color, 0.08) } : { color: 'var(--accent)', bg: 'var(--accent-dim)' }
}

export function categoryLabel(slug) {
  return findCategory(slug)?.label ?? (slug ? slug.charAt(0).toUpperCase() + slug.slice(1) : 'General')
}
