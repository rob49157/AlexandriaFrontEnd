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
 * Search the public catalogue
 * @param {{ q?: string, category?: string, status?: string, page?: number, limit?: number }} params
 */
export async function searchBooks({ q = '', category = '', status = '', page = 1, limit = 20 } = {}) {
  const query = new URLSearchParams();
  if (q) query.set('q', q);
  if (category) query.set('category', category);
  if (status) query.set('status', status);
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
 * Upload a PDF file with metadata and wallet address
 * @param {FormData} formData - contains 'file', 'title', 'author', 'category', 'description', 'walletAddress'
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
