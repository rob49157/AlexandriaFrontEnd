// Lit Protocol Client for Frontend Reader Decryption
//
// Communicates with Lit Protocol Chipotle v3 TEE to unseal the book's symmetric key.
// The TEE executes the immutable Decryption Lit Action, which validates on-chain
// rental permissions on Base Sepolia against the arweaveHash sealed inside the envelope.

import { LIT_DECRYPT_ACTION_CODE } from './litAction';

const LIT_API_URL = import.meta.env.VITE_LIT_API_URL || 'https://api.chipotle.litprotocol.com/core/v1';
const LIT_PKP_ID = import.meta.env.VITE_LIT_PKP_ID || '';
const LIT_API_KEY = import.meta.env.VITE_LIT_API_KEY || '';

/**
 * Request the symmetric AES key from Lit Protocol TEE.
 *
 * @param {string} sealedCiphertext - The litEncryptedKeyId from decrypt-params
 * @param {string} userAddress      - The reader's connected wallet address
 * @returns {Promise<{ key: string, grantedVia: string }>}
 *   key        — 32-byte base64-encoded AES key (k)
 *   grantedVia — 'rental' | 'uploader' | 'librarian_review', which decides the
 *                watermark stamped on every page. A review copy has to be
 *                identifiable as one if it ever leaves the librarian's screen.
 */
export async function unwrapKeyFromLit(sealedCiphertext, userAddress) {
  if (!sealedCiphertext) {
    throw new Error('Missing sealed key ciphertext.');
  }
  if (!userAddress) {
    throw new Error('Wallet address is required for rental access verification.');
  }

  const headers = { 'Content-Type': 'application/json' };
  if (LIT_API_KEY) {
    headers['X-Api-Key'] = LIT_API_KEY;
  }

  const payload = {
    code: LIT_DECRYPT_ACTION_CODE,
    js_params: {
      pkpId: LIT_PKP_ID,
      ciphertext: sealedCiphertext,
      userAddress: userAddress.toLowerCase(),
    },
  };

  const res = await fetch(`${LIT_API_URL}/lit_action`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const errorText = await res.text().catch(() => '');
    throw new Error(`Lit Protocol request failed (${res.status}): ${errorText || 'TEE unreachable'}`);
  }

  const result = await res.json();

  if (result.has_error) {
    throw new Error(`Lit Action execution error: ${result.logs || result.response || 'Unknown error'}`);
  }

  let parsedResponse = result.response;
  if (typeof parsedResponse === 'string') {
    try {
      parsedResponse = JSON.parse(parsedResponse);
    } catch {
      // Keep as string if not JSON
    }
  }

  if (parsedResponse?.error) {
    if (parsedResponse.error === 'access_denied') {
      throw new Error(
        'Access Denied: Base Sepolia shows no active rental, archivist ownership, ' +
          'or open librarian review window for this book.'
      );
    }
    throw new Error(`Lit Action rejected request: ${parsedResponse.error}`);
  }

  const key = parsedResponse?.key || (typeof parsedResponse === 'string' ? parsedResponse : null);

  if (!key) {
    throw new Error('Lit Action returned incomplete response without symmetric key.');
  }

  // Older permitted versions of the Action returned the key alone. Treat a
  // missing grantedVia as a rental rather than guessing something weaker.
  return { key, grantedVia: parsedResponse?.grantedVia || 'rental' };
}
