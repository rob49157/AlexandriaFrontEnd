// Alexandria Backend API Service
// Wraps all REST API calls to the Alexandria Node.js Gateway.

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';

/**
 * Helper for JSON fetch requests with standardized error parsing
 */
async function fetchJson(endpoint, options = {}) {
  const url = `${API_URL}${endpoint}`;
  const response = await fetch(url, {
    headers: {
      'Accept': 'application/json',
      ...options.headers,
    },
    ...options,
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    const message = data?.message || data?.error || `Request failed with status ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    error.data = data;
    throw error;
  }

  return data;
}

/**
 * Search the public catalogue. Approved books only, unless `inReview` also asks
 * for staked books still inside their 14-day challenge window (not rentable yet;
 * each carries `reviewEndsAt`). `inReview` and `status` are mutually exclusive.
 * @param {{ q?: string, category?: string, status?: string, inReview?: boolean, page?: number, limit?: number }} params
 */
export async function searchBooks({ q = '', category = '', status = '', inReview = false, page = 1, limit = 20 } = {}) {
  const query = new URLSearchParams();
  if (q) query.set('q', q);
  if (category) query.set('category', category);
  if (status) query.set('status', status);
  if (inReview) query.set('inReview', 'true');
  if (page) query.set('page', String(page));
  if (limit) query.set('limit', String(limit));

  return fetchJson(`/search?${query.toString()}`);
}

/**
 * Fetch public metadata for a single upload
 * @param {string} arweaveHash
 */
export async function getUpload(arweaveHash) {
  return fetchJson(`/upload/${encodeURIComponent(arweaveHash)}`);
}

/**
 * Fetch live rental status for a user wallet on a book
 * @param {string} arweaveHash
 * @param {string} address
 */
export async function getRentalStatus(arweaveHash, address) {
  return fetchJson(`/rental/status/${encodeURIComponent(arweaveHash)}/${encodeURIComponent(address)}`);
}

/**
 * Fetch book pricing, listing status, and registration state
 * @param {string} arweaveHash
 */
export async function getBookRentalInfo(arweaveHash) {
  return fetchJson(`/rental/book/${encodeURIComponent(arweaveHash)}`);
}

/**
 * Fetch decryption payload (sealed envelope, IV, authTag)
 * @param {string} arweaveHash
 * @param {string} address
 */
export async function getDecryptParams(arweaveHash, address) {
  return fetchJson(`/rental/decrypt-params/${encodeURIComponent(arweaveHash)}/${encodeURIComponent(address)}`);
}

/**
 * Relay a signed unlock request to the decryption Lit Action. The backend checks
 * the request, then forwards it to Lit with the only key that can run the
 * Action. The answer is the book's key wrapped to this browser's session key,
 * which the relay cannot open.
 *
 * @param {string} arweaveHash
 * @param {{ code: string, authMessage: string, authSignature: string, sessionPublicKey: string }} body
 * @returns {Promise<{ wrappedKey: string, grantedVia: string }>}
 */
export async function unlockBook(arweaveHash, body) {
  return fetchJson(`/rental/unlock/${encodeURIComponent(arweaveHash)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
}

/**
 * Upload limits for one wallet, and the shared daily storage budget.
 * @param {string} address
 * @returns {Promise<{ canUpload: boolean, reason: string|null, message: string|null,
 *   awaitingStake: { count: number, max: number, books: { arweaveHash: string, title: string, status: string }[] },
 *   last24h: { count: number, max: number },
 *   budget: { usedAr: string, limitAr: string, percentUsed: number, exhausted: boolean } }>}
 */
export async function getUploadQuota(address) {
  return fetchJson(`/upload/quota/${encodeURIComponent(address)}`);
}

/**
 * Upload a PDF file with metadata and wallet address
 * @param {FormData} formData - contains 'file', 'title', 'author', 'category', 'description', 'walletAddress',
 *   and 'authMessage' + 'authSignature': the wallet's signature over the file (buildUploadMessage)
 */
export async function uploadPdf(formData) {
  const url = `${API_URL}/upload`;
  const response = await fetch(url, {
    method: 'POST',
    body: formData,
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    const message = data?.message || data?.reason || `Upload failed with status ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    error.data = data;
    throw error;
  }

  return data;
}

/**
 * Storage progress of one upload. POST /upload answers 202: the book is stored on
 * Arweave by a background worker (mined → 2 verified copies → 16 confirmations,
 * ~25–40 min), then registered on-chain. Poll this until `status` leaves
 * 'pending_confirmation'.
 *
 * @param {string} arweaveHash
 * @returns {Promise<{ status: string, stored: boolean, mined: boolean, confirmations: number|null,
 *   confirmationsRequired: number, copiesComplete: number, copiesRequired: number,
 *   verifiedCopies: number, error: string|null }>}
 */
export async function getStorageProgress(arweaveHash) {
  return fetchJson(`/storage/${encodeURIComponent(arweaveHash)}`);
}

/**
 * Download a book's ciphertext. Served by the backend, which reads it from raw
 * Arweave nodes and proof-checks every chunk: raw nodes are plain HTTP, which this
 * HTTPS app cannot fetch directly, and no third-party gateway is used.
 * The bytes are useless without the key only the Lit Action releases.
 *
 * @param {string} arweaveHash
 * @returns {Promise<ArrayBuffer>}
 */
export async function getEncryptedBook(arweaveHash) {
  const response = await fetch(`${API_URL}/storage/${encodeURIComponent(arweaveHash)}/data`);
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    const error = new Error(data?.message || `Could not download the encrypted book (${response.status})`);
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return response.arrayBuffer();
}

/**
 * Retry on-chain registration for an upload
 * @param {string} arweaveHash
 */
export async function retryRegistration(arweaveHash) {
  return fetchJson(`/upload/${encodeURIComponent(arweaveHash)}/register`, {
    method: 'POST',
  });
}

/**
 * Check backend registrar wallet status and readiness
 */
export async function getRegistrarStatus() {
  return fetchJson('/upload/registrar/status');
}

/**
 * Fetch on-chain stake and challenge status for a book
 * @param {string} arweaveHash
 */
export async function getStakeStatus(arweaveHash) {
  return fetchJson(`/stake/status/${encodeURIComponent(arweaveHash)}`);
}

/**
 * Fetch the librarian review queue — books that are registered, actively staked,
 * unchallenged and still inside the 14-day challenge window.
 *
 * The backend applies the same preconditions AlexandriaStake.challengeUpload()
 * enforces, so every book returned is one the librarian can actually challenge.
 * `librarian` is used only to drop the caller's own uploads.
 *
 * @param {{ librarian?: string, limit?: number }} params
 */
export async function getReviewQueue({ librarian = '', limit = 50 } = {}) {
  const query = new URLSearchParams();
  if (librarian) query.set('librarian', librarian);
  if (limit) query.set('limit', String(limit));

  return fetchJson(`/librarian/review-queue?${query.toString()}`);
}
