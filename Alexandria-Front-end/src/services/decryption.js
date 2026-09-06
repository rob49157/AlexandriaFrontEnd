// In-Browser WebCrypto AES-256-GCM Decryption Service
//
// Decrypts PDF ciphertexts in browser memory using WebCrypto subtle.decrypt().
// Plaintext data exists ONLY in RAM (ArrayBuffer/Uint8Array) and is never
// persisted to disk, localStorage, or IndexedDB.

/**
 * Decode a base64 string to a Uint8Array
 * @param {string} base64
 * @returns {Uint8Array}
 */
export function base64ToUint8Array(base64) {
  // Support both standard base64 and base64url
  const standardBase64 = base64.replace(/-/g, '+').replace(/_/g, '/');
  const binaryString = window.atob(standardBase64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

/**
 * Decrypt an AES-256-GCM encrypted PDF buffer in-memory using WebCrypto.
 *
 * @param {ArrayBuffer|Uint8Array} encryptedBytes - Ciphertext downloaded from Arweave/Irys
 * @param {string} base64Key                     - 32-byte symmetric key from Lit Action
 * @param {string} base64Iv                      - 12-byte IV from decrypt-params
 * @param {string} base64AuthTag                 - 16-byte Auth Tag from decrypt-params
 * @returns {Promise<Uint8Array>}                - Decrypted PDF bytes in RAM
 */
export async function decryptPdfInBrowser(encryptedBytes, base64Key, base64Iv, base64AuthTag) {
  if (!encryptedBytes || encryptedBytes.byteLength === 0) {
    throw new Error('Missing or empty encrypted PDF buffer.');
  }
  if (!base64Key || !base64Iv || !base64AuthTag) {
    throw new Error('Missing decryption parameters (key, IV, or Auth Tag).');
  }

  const rawKey = base64ToUint8Array(base64Key);
  const ivBytes = base64ToUint8Array(base64Iv);
  const authTagBytes = base64ToUint8Array(base64AuthTag);

  if (rawKey.length !== 32) {
    throw new Error(`Invalid key length: expected 32 bytes, got ${rawKey.length}`);
  }
  if (ivBytes.length !== 12) {
    throw new Error(`Invalid IV length: expected 12 bytes, got ${ivBytes.length}`);
  }
  if (authTagBytes.length !== 16) {
    throw new Error(`Invalid Auth Tag length: expected 16 bytes, got ${authTagBytes.length}`);
  }

  // 1. WebCrypto expects the 16-byte auth tag appended to the ciphertext buffer
  const ciphertext = new Uint8Array(encryptedBytes);
  const combinedBuffer = new Uint8Array(ciphertext.length + authTagBytes.length);
  combinedBuffer.set(ciphertext, 0);
  combinedBuffer.set(authTagBytes, ciphertext.length);

  // 2. Import symmetric AES-GCM key
  const cryptoKey = await window.crypto.subtle.importKey(
    'raw',
    rawKey,
    { name: 'AES-GCM' },
    false,
    ['decrypt']
  );

  // 3. Decrypt in-memory
  let decryptedArrayBuffer;
  try {
    decryptedArrayBuffer = await window.crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: ivBytes,
        tagLength: 128, // 16 bytes = 128-bit authentication tag
      },
      cryptoKey,
      combinedBuffer
    );
  } catch (err) {
    throw new Error(`PDF decryption failed: Authentication tag or key mismatch (${err.message})`);
  } finally {
    // Zero out raw key buffer in RAM
    rawKey.fill(0);
  }

  return new Uint8Array(decryptedArrayBuffer);
}

/**
 * Safely zero out sensitive byte buffers in memory
 * @param {Uint8Array} uint8Array
 */
export function zeroMemory(uint8Array) {
  if (uint8Array && typeof uint8Array.fill === 'function') {
    uint8Array.fill(0);
  }
}
