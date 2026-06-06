import { Link } from 'react-router-dom'
import SearchBar from '../components/SearchBar'
import '../styles/Home.css'

const CATEGORIES = [
  { slug: 'science',      label: 'Science',      icon: '⚗️',  count: 1284 },
  { slug: 'history',      label: 'History',      icon: '📜',  count: 892  },
  { slug: 'philosophy',   label: 'Philosophy',   icon: '🏛️',  count: 456  },
  { slug: 'literature',   label: 'Literature',   icon: '📖',  count: 2103 },
  { slug: 'mathematics',  label: 'Mathematics',  icon: '∑',   count: 678  },
  { slug: 'technology',   label: 'Technology',   icon: '⚙️',  count: 945  },
  { slug: 'medicine',     label: 'Medicine',     icon: '⚕',   count: 731  },
  { slug: 'arts',         label: 'Arts',         icon: '🎨',  count: 312  },
]

const STEPS = [
  {
    num: '01',
    title: 'Upload & Preserve',
    desc: 'Archivists upload PDFs. Files are encrypted and stored permanently on Arweave. Content is validated by our AI layer.',
  },
  {
    num: '02',
    title: 'Stake & Verify',
    desc: 'Archivists stake $ALEX tokens for 14 days. Librarians can challenge suspicious uploads. Valid uploads release stakes and earn revenue.',
  },
  {
    num: '03',
    title: 'Rent & Read',
    desc: 'Readers rent time-bound access to books. PDFs are decrypted in your browser using Lit Protocol — never stored on our servers.',
  },
]

export default function Home() {
  return (
    <main className="home">
      <section className="home__hero">
        <div className="home__hero-inner">
          <p className="home__eyebrow">Decentralized · Permanent · Censorship-resistant</p>
          <h1 className="home__headline">
            The Library of<br />
            <span className="home__headline-accent">Human Knowledge</span>
          </h1>
          <p className="home__subline">
            Millions of books preserved forever on Arweave.<br />
            Rented with $ALEX. Read in your browser.
          </p>
          <div className="home__search">
            <SearchBar size="large" placeholder="Search books, authors, or topics…" />
          </div>
        </div>
        <div className="home__hero-glow" aria-hidden="true" />
      </section>

      <section className="home__stats" aria-label="Platform statistics">
        <div className="home__stats-inner">
          {[
            { value: '50,412', label: 'Books Preserved' },
            { value: '3,891',  label: 'Archivists'      },
            { value: '128,034',label: 'Readers'          },
          ].map(({ value, label }) => (
            <div key={label} className="home__stat">
              <span className="home__stat-value">{value}</span>
              <span className="home__stat-label">{label}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="home__section">
        <div className="home__section-inner">
          <h2 className="home__section-title">Browse by Category</h2>
          <div className="home__categories">
            {CATEGORIES.map(({ slug, label, icon, count }) => (
              <Link key={slug} to={`/search?category=${slug}`} className="home__category">
                <span className="home__category-icon" aria-hidden="true">{icon}</span>
                <span className="home__category-label">{label}</span>
                <span className="home__category-count">{count.toLocaleString()} books</span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="home__section home__section--alt">
        <div className="home__section-inner">
          <h2 className="home__section-title">How Alexandria Works</h2>
          <div className="home__steps">
            {STEPS.map(({ num, title, desc }) => (
              <div key={num} className="home__step">
                <span className="home__step-num" aria-hidden="true">{num}</span>
                <h3 className="home__step-title">{title}</h3>
                <p className="home__step-desc">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </main>
  )
}
