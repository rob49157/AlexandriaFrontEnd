import { Link } from 'react-router-dom'

/**
 * What the automated checks found on a queued book — and what they never
 * looked at.
 *
 * This replaces the `X/100 (AI)` pill the review queue used to show. No backend
 * ever produced that number, and no single number could carry this: the checks
 * answer unrelated questions and two of the three possible answers are not
 * "how good is it" at all.
 *
 *   Safety      pass/fail, and already decided — an infected or script-carrying
 *               PDF is rejected at upload and never stored, so every book that
 *               reaches this queue passed. All that is left to report is
 *               whether the virus scanner was running at the time.
 *   Duplicate   a 64-bit fingerprint of the book's text, compared bit by bit
 *               against the index. Flagged at 3 differing bits or fewer.
 *   Text        how much text there was to fingerprint in the first place. A
 *               scan with no OCR has none, so the duplicate check above never
 *               ran — its silence means nothing.
 *
 * The backend decides the flags (one place, under test); the wording lives here.
 */

const UNRECORDED = 'Not recorded'

// Books predating these columns can't be backfilled — the file on Arweave is
// encrypted, so there is nothing to recount. They read as unrecorded, never as
// a clean result.
function safetyChip(security) {
  if (!security || security.clamav === 'unknown') {
    return { tone: 'unknown', label: `Virus scan — ${UNRECORDED.toLowerCase()}` }
  }
  if (security.clamav === 'clean') return { tone: 'ok', label: 'Virus scan clean' }
  return { tone: 'warn', label: 'Virus scan did not run' }
}

function duplicateChip(audit) {
  const { duplicate, flags } = audit
  if (duplicate) {
    const bits = duplicate.hammingDistance
    return {
      tone: 'warn',
      label: bits == null ? 'Near-duplicate' : `Near-duplicate · ${bits}/64 bits differ`,
    }
  }
  // Nothing to compare is not the same answer as nothing found.
  if (flags.includes('NO_TEXT_LAYER')) return { tone: 'warn', label: 'Duplicate check skipped' }
  return { tone: 'ok', label: 'No duplicate found' }
}

function textChip(audit) {
  const { text, flags } = audit
  if (!text) return { tone: 'unknown', label: `Text — ${UNRECORDED.toLowerCase()}` }
  if (flags.includes('NO_TEXT_LAYER')) return { tone: 'warn', label: 'No selectable text' }
  if (flags.includes('MOSTLY_TEXTLESS')) {
    return { tone: 'warn', label: `${text.textlessPages} of ${text.pageCount} pages without text` }
  }
  return { tone: 'ok', label: `~${text.wordsPerPage} words per page` }
}

export function AuditBadges({ audit }) {
  if (!audit) return null

  const chips = [safetyChip(audit.security), duplicateChip(audit), textChip(audit)]

  return (
    <div className="audit__chips">
      {chips.map(({ tone, label }) => (
        <span key={label} className={`audit__chip audit__chip--${tone}`}>
          <span className="audit__dot" aria-hidden="true" />
          {label}
        </span>
      ))}
    </div>
  )
}

/**
 * One sentence per flag, each saying what to actually go and look at.
 *
 * The unflagged case still gets a line. This queue holds every staked book in
 * its challenge window, not only suspicious ones, so silence here would read as
 * approval — and the checks that exist cannot approve anything.
 */
function flagNotes(audit) {
  const notes = []
  const { duplicate, text, flags } = audit

  if (duplicate) {
    const named = duplicate.title ? `“${duplicate.title}”` : `upload ${duplicate.arweaveHash.slice(0, 10)}…`
    const sameness = duplicate.hammingDistance === 0 ? 'identical to' : 'nearly identical to'
    const whose = duplicate.sameUploader
      ? ' The same archivist uploaded both, so this may be a re-upload.'
      : ' A different archivist uploaded that one.'

    notes.push({
      key: 'NEAR_DUPLICATE',
      body: (
        <>
          This book’s text is {sameness}{' '}
          {duplicate.status ? (
            <Link to={`/book/${duplicate.arweaveHash}`} className="audit__link">
              {named}
            </Link>
          ) : (
            named
          )}
          {duplicate.status ? ` (${duplicate.status})` : ''}.{whose} Compare the two before the window closes.
        </>
      ),
    })
  }

  if (flags.includes('NO_TEXT_LAYER')) {
    notes.push({
      key: 'NO_TEXT_LAYER',
      body: (
        <>
          The file has no selectable text — almost certainly page images from a scan that was never put
          through OCR. Nothing here has been compared against the index, whatever the duplicate badge says.
          Read a few pages yourself before deciding.
        </>
      ),
    })
  }

  if (flags.includes('MOSTLY_TEXTLESS') && text) {
    notes.push({
      key: 'MOSTLY_TEXTLESS',
      body: (
        <>
          {text.textlessPages} of {text.pageCount} pages carry no selectable text, so only the remaining{' '}
          {text.pageCount - text.textlessPages} were fingerprinted. Normal for an atlas or an art book;
          worth a look on anything else.
        </>
      ),
    })
  }

  return notes
}

/**
 * Evidence for the on-chain reason field, which is permanent and public.
 *
 * Kept local to this file: exporting a non-component alongside components
 * breaks fast refresh, and nothing outside needs it.
 */
function challengeReasonFor(audit) {
  if (!audit) return ''
  const parts = []
  const { duplicate, text, flags } = audit

  if (duplicate) {
    const bits = duplicate.hammingDistance == null ? 'within threshold' : `${duplicate.hammingDistance} of 64 bits differ`
    parts.push(
      `Near-duplicate of ${duplicate.arweaveHash}${duplicate.title ? ` ("${duplicate.title}")` : ''}: ${bits}.`
    )
  }
  if (flags.includes('NO_TEXT_LAYER')) {
    parts.push('The PDF has no selectable text, so duplicate detection could not run on it.')
  } else if (flags.includes('MOSTLY_TEXTLESS') && text) {
    parts.push(`${text.textlessPages} of ${text.pageCount} pages have no selectable text.`)
  }

  return parts.join(' ')
}

export function AuditSummary({ audit, onUseReason }) {
  if (!audit) return null

  const notes = flagNotes(audit)

  return (
    <div className={`audit__summary${notes.length ? ' audit__summary--flagged' : ''}`}>
      {notes.length > 0 ? (
        <>
          <ul className="audit__notes">
            {notes.map(({ key, body }) => (
              <li key={key}>{body}</li>
            ))}
          </ul>
          {onUseReason && (
            <button
              type="button"
              className="audit__reason-btn"
              onClick={() => onUseReason(challengeReasonFor(audit))}
            >
              Use as challenge reason →
            </button>
          )}
        </>
      ) : (
        <p className="audit__clear">
          No automated flags. These checks cover file safety and duplicate text only — whether the book is
          what it claims to be, whether it is legible, and who holds the rights are all yours to judge.
        </p>
      )}

      {/* A disclosure rather than a hover tooltip: this has to work on a phone
          and for anyone driving the page from the keyboard. */}
      <details className="audit__why">
        <summary>What was actually checked?</summary>
        <dl>
          <dt>Safety</dt>
          <dd>
            PDFs carrying scripts, auto-actions or embedded files are rejected during upload and never
            stored, so every book in this queue passed that scan. The badge reports the separate virus
            scan, which is skipped when the scanner is offline.
          </dd>

          <dt>Duplicate</dt>
          <dd>
            The book’s text is reduced to a 64-bit fingerprint and compared with every book in the index.
            Three or fewer differing bits counts as a near-duplicate. It compares wording, not meaning: a
            different edition, translation or retyping of the same work will not be caught.
          </dd>

          <dt>Text</dt>
          <dd>
            Counted from the same words the fingerprint is built from. Picture books, atlases, comics and
            sheet music legitimately have very few. No check here reads the images.
          </dd>
        </dl>
      </details>
    </div>
  )
}
