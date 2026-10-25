// Book keys this browser has already unlocked, kept until the reader's access
// ends, so re-opening a book costs no Lit call (~1 cent each; KEY-BINDING.md R3).
//
// What is stored is the CryptoKey object itself, created non-extractable by
// unlockBookKey(): this page can decrypt with it, but no script can read its
// bytes (exportKey is refused), and other sites cannot see it. localStorage could
// not do this: it holds text only, so the key would have to be exported first.
//
// Non-extractable is a promise of the JavaScript API, not of the disk: the
// browser writes the key's bytes into its profile folder. Someone with file
// access to that profile and the right tools could recover them. That is no
// easier than dumping the decrypted PDF from memory, which any renter can do
// while reading, so it changes nothing about what a determined reader can keep.
//
// One key per book, shared by every reader of that book, so a key must never
// exist as copyable bytes: leaked, it would open the book for anyone, forever.
//
// Keeping it until the access ends is the app's rule, not cryptography. The
// Reader checks access (free, through decrypt-params) before using a stored key,
// and deletes the key as soon as access is gone or it expires. A modified app
// could skip that, but it could also simply save the decrypted PDF, which is why
// R3 promises time-bound access through the app, not time-bound possession.
//
// Every function here swallows storage errors (private windows, full disks,
// blocked IndexedDB): without storage the Reader just unlocks through Lit again.

const DB_NAME = 'alexandria-keys'
const STORE = 'bookKeys'
const VERSION = 1
const DAY_MS = 24 * 60 * 60 * 1000

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

/** Run one request in a transaction and resolve with its result once committed. */
async function inStore(mode, makeRequest) {
  const db = await openDb()
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode)
      const request = makeRequest(tx.objectStore(STORE))
      tx.oncomplete = () => resolve(request.result)
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error)
    })
  } finally {
    db.close()
  }
}

// Per wallet and book: two wallets in one browser never share a key entry.
const idFor = (wallet, arweaveHash) => `${wallet.toLowerCase()}:${arweaveHash}`

/**
 * How long a key may be kept, by how it was granted.
 *   rental            until the rental's on-chain expiry
 *   uploader          no expiry: the archivist's access does not end
 *   librarian_review  one day at most; the review window's end is not known here
 * The Reader re-checks access before every use regardless.
 *
 * @param {'rental'|'uploader'|'librarian_review'} grantedVia
 * @param {{ expiry?: string|null }} decryptParams  from GET /rental/decrypt-params
 * @returns {number|null} ms since epoch, or null for no expiry
 */
export function keyExpiry(grantedVia, decryptParams, now = Date.now()) {
  if (grantedVia === 'uploader') return null
  if (grantedVia === 'rental') {
    const rentalEnds = Date.parse(decryptParams?.expiry ?? '')
    if (Number.isFinite(rentalEnds)) return rentalEnds
  }
  return now + DAY_MS
}

/** @returns {Promise<{ cryptoKey: CryptoKey, grantedVia: string, expiresAt: number|null } | null>} */
export async function loadBookKey(wallet, arweaveHash, now = Date.now()) {
  try {
    const entry = await inStore('readonly', (store) => store.get(idFor(wallet, arweaveHash)))
    if (!entry || !(entry.cryptoKey instanceof CryptoKey)) return null
    if (entry.expiresAt !== null && entry.expiresAt <= now) {
      await forgetBookKey(wallet, arweaveHash)
      return null
    }
    return entry
  } catch {
    return null
  }
}

export async function saveBookKey(wallet, arweaveHash, { cryptoKey, grantedVia, expiresAt }) {
  // Never keep a key whose bytes could be read back out.
  if (!(cryptoKey instanceof CryptoKey) || cryptoKey.extractable) return
  try {
    await inStore('readwrite', (store) =>
      store.put({ cryptoKey, grantedVia, expiresAt, savedAt: Date.now() }, idFor(wallet, arweaveHash))
    )
  } catch {
    // Private window or storage refused: the next open unlocks through Lit again.
  }
}

export async function forgetBookKey(wallet, arweaveHash) {
  try {
    await inStore('readwrite', (store) => store.delete(idFor(wallet, arweaveHash)))
  } catch {
    // Nothing stored, or storage unavailable.
  }
}

/** Delete every expired key, for books this browser will not open again. */
export async function forgetExpiredBookKeys(now = Date.now()) {
  try {
    const db = await openDb()
    try {
      await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite')
        const cursorRequest = tx.objectStore(STORE).openCursor()
        cursorRequest.onsuccess = () => {
          const cursor = cursorRequest.result
          if (!cursor) return
          const { expiresAt } = cursor.value || {}
          if (expiresAt !== null && expiresAt <= now) cursor.delete()
          cursor.continue()
        }
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
      })
    } finally {
      db.close()
    }
  } catch {
    // Storage unavailable: nothing was kept, so nothing has expired.
  }
}
