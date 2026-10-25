// The messages a wallet signs: to unlock one book (a reader), and to upload one
// file (an archivist).
//
// Format: EIP-4361 ("Sign-In with Ethereum"), so wallets show it readably and
// refuse to sign one whose domain does not match the site asking. The upload
// message is checked by the backend only (AlexNode services/uploadAuth.service.js);
// it names the SHA-256 of the exact PDF, so the signature authorizes that file
// and nothing else. The unlock message is parsed, strictly and line by line, in
// three places:
//   1. the decryption Lit Action (litAction.js) — the check that counts
//   2. the backend relay (AlexNode services/unlockAuth.service.js) — so a doomed
//      request never spends a Lit credit
//   3. tests/decryptionAction.test.js — builds every request with this function
// Change the format and all three must change with it, or unlocks fail closed.
//
// What each line binds (KEY-BINDING.md, R2/R3):
//   address          who is asking — recovered from the signature inside the TEE
//   sealed-key hash  which book — a signature for book A cannot open book B
//   session-key hash which browser — the key is released wrapped to that key only,
//                    so a captured signature is worthless to anyone else
//   Issued/Expires   when — the Action refuses windows over 10 minutes

export const UNLOCK_STATEMENT = 'Unlock one Alexandria book for reading.';
export const UPLOAD_STATEMENT = 'Upload one book to Alexandria.';
export const UNLOCK_CHAIN_ID = 84532;
// Must stay under the Action's 600 s cap. Long enough to approve in a wallet.
export const UNLOCK_WINDOW_SECONDS = 300;
// The backend checks an upload's signature when the file has finished arriving,
// so the window covers the transfer too: a large book on a slow uplink. 1800 s
// is the backend's cap for uploads (unlock messages stay at 600 s).
export const UPLOAD_WINDOW_SECONDS = 1800;
export const SEALED_KEY_URN = 'urn:alexandria:sealed-key:sha256:';
export const SESSION_KEY_URN = 'urn:alexandria:session-key:sha256:';
export const PDF_URN = 'urn:alexandria:pdf:sha256:';

/** The shared EIP-4361 shape: fixed lines, fixed order, no optional fields. */
function buildWalletMessage({ domain, uri, address, nonce, issuedAt, expirationTime, statement, resources }) {
  return [
    `${domain} wants you to sign in with your Ethereum account:`,
    address,
    '',
    statement,
    '',
    `URI: ${uri}`,
    'Version: 1',
    `Chain ID: ${UNLOCK_CHAIN_ID}`,
    `Nonce: ${nonce}`,
    `Issued At: ${issuedAt}`,
    `Expiration Time: ${expirationTime}`,
    'Resources:',
    ...resources.map((urn) => `- ${urn}`),
  ].join('\n');
}

/**
 * @param {{
 *   domain: string,          // host[:port] of the page, e.g. "localhost:5173"
 *   uri: string,             // origin of the page, e.g. "http://localhost:5173"
 *   address: string,         // EIP-55 checksummed wallet address
 *   nonce: string,           // 8+ letters/digits
 *   issuedAt: string,        // RFC 3339, UTC ("…Z")
 *   expirationTime: string,  // RFC 3339, UTC
 *   sealedKeyHash: string,   // sha256 hex of the sealed envelope string
 *   sessionKeyHash: string,  // sha256 hex of the session public key (spki)
 * }} fields
 * @returns {string}
 */
export function buildUnlockMessage({ sealedKeyHash, sessionKeyHash, ...fields }) {
  return buildWalletMessage({
    ...fields,
    statement: UNLOCK_STATEMENT,
    resources: [`${SEALED_KEY_URN}${sealedKeyHash}`, `${SESSION_KEY_URN}${sessionKeyHash}`],
  });
}

/**
 * @param {{ domain, uri, address, nonce, issuedAt, expirationTime, pdfHash: string }} fields
 *   pdfHash — sha256 hex of the exact PDF bytes being uploaded
 * @returns {string}
 */
export function buildUploadMessage({ pdfHash, ...fields }) {
  return buildWalletMessage({ ...fields, statement: UPLOAD_STATEMENT, resources: [`${PDF_URN}${pdfHash}`] });
}

/** Unix seconds → RFC 3339 UTC without milliseconds. */
export function toIsoSeconds(unixSeconds) {
  return new Date(unixSeconds * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** 16 random letters/digits. Not checked against a store — expiry is the replay guard. */
export function randomNonce() {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

/** @param {Uint8Array} bytes @returns {Promise<string>} lower-case hex, no 0x */
export async function sha256Hex(bytes) {
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes));
  return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
}
