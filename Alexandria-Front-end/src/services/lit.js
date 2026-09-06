// Lit Protocol Client for Frontend Reader Decryption
//
// Communicates with Lit Protocol Chipotle v3 TEE to unseal the book's symmetric key.
// The TEE executes the immutable Decryption Lit Action, which validates on-chain
// rental permissions on Base Sepolia against the arweaveHash sealed inside the envelope.

const LIT_API_URL = import.meta.env.VITE_LIT_API_URL || 'https://api.chipotle.litprotocol.com/core/v1';
const LIT_PKP_ID = import.meta.env.VITE_LIT_PKP_ID || '';
const LIT_API_KEY = import.meta.env.VITE_LIT_API_KEY || '';

// The exact Decryption Lit Action executed in the TEE
const LIT_DECRYPT_ACTION_CODE = `
async function main({ pkpId, ciphertext, userAddress }) {
  if (!userAddress || typeof userAddress !== 'string') {
    Lit.Actions.setResponse({ response: JSON.stringify({ error: 'missing_user_address' }) });
    return;
  }

  let unsealedStr;
  try {
    const res = await Lit.Actions.Decrypt({ pkpId, ciphertext });
    unsealedStr = typeof res === 'string' ? res : (res.decrypted || res.plaintext || JSON.stringify(res));
  } catch (err) {
    Lit.Actions.setResponse({ response: JSON.stringify({ error: 'unseal_failed' }) });
    return;
  }

  let envelope;
  try {
    envelope = typeof unsealedStr === 'object' && unsealedStr !== null ? unsealedStr : JSON.parse(unsealedStr);
  } catch (err) {
    Lit.Actions.setResponse({ response: JSON.stringify({ error: 'invalid_envelope_json' }) });
    return;
  }

  if (!envelope || envelope.v !== 1 || !envelope.k || !envelope.arweaveHash) {
    Lit.Actions.setResponse({ response: JSON.stringify({ error: 'invalid_envelope_format' }) });
    return;
  }

  const { k, arweaveHash } = envelope;
  const user = userAddress.toLowerCase();

  const provider = new ethers.providers.JsonRpcProvider('https://base-sepolia-rpc.publicnode.com');
  const rentContract = new ethers.Contract(
    '0xe50AD653Ee690c818900091a4d69F22e484bD2cD',
    ['function isRentalActive(string,address) view returns (bool)'],
    provider
  );
  const libraryContract = new ethers.Contract(
    '0x0b26AB8C632586E846DE87D29D665fd727bBe844',
    ['function getUploader(string) view returns (address)'],
    provider
  );

  let isRented = false;
  try {
    isRented = await rentContract.isRentalActive(arweaveHash, userAddress);
  } catch (err) {
    isRented = false;
  }

  let isOwner = false;
  try {
    const uploader = await libraryContract.getUploader(arweaveHash);
    isOwner = Boolean(uploader && uploader.toLowerCase() === user);
  } catch (err) {
    isOwner = false;
  }

  if (!isRented && !isOwner) {
    Lit.Actions.setResponse({ response: JSON.stringify({ error: 'access_denied' }) });
    return;
  }

  Lit.Actions.setResponse({ response: JSON.stringify({ key: k }) });
}
`.trim();

/**
 * Request the symmetric AES key from Lit Protocol TEE.
 *
 * @param {string} sealedCiphertext - The litEncryptedKeyId from decrypt-params
 * @param {string} userAddress      - The reader's connected wallet address
 * @returns {Promise<string>}       - The 32-byte base64-encoded AES key (k)
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
      throw new Error('Access Denied: No active rental or archivist ownership found on Base Sepolia.');
    }
    throw new Error(`Lit Action rejected request: ${parsedResponse.error}`);
  }

  const key = parsedResponse?.key || (typeof parsedResponse === 'string' ? parsedResponse : null);

  if (!key) {
    throw new Error('Lit Action returned incomplete response without symmetric key.');
  }

  return key;
}
