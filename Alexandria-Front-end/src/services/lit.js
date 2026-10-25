// Unlock a book's AES key through the decryption Lit Action.
//
// The reader proves who they are by signing an EIP-4361 message
// (unlockMessage.js); the backend relays the request to Lit (POST
// /api/rental/unlock/:arweaveHash); the Action checks the chain inside the TEE and answers
// with the key wrapped to an RSA key pair this browser created for this read.
//
// The private half of that pair is generated non-extractable, and the key is
// unwrapped straight into a non-extractable AES-GCM CryptoKey. So the book's key
// never exists as readable bytes here, in the network response, at the relay,
// or in Lit's logs — and a captured signature is useless to anyone else, because
// the Action only ever wraps to the session key named inside it.
//
// No Lit credentials live in this bundle: the relay holds the only key that can
// run the Action (KEY-BINDING.md, R4).

import { getAddress } from 'ethers';

import { LIT_DECRYPT_ACTION_CODE } from './litAction';
import { buildUnlockMessage, randomNonce, sha256Hex, toIsoSeconds, UNLOCK_WINDOW_SECONDS } from './unlockMessage';
import { unlockBook } from './api';
import { isUserRejection } from '../utils/walletErrors';

const GRANTS = new Set(['rental', 'uploader', 'librarian_review']);

// The Action's and the relay's error codes, in words a reader can act on.
const ERROR_TEXT = {
  access_denied:
    'Access denied: Base Sepolia shows no active rental, archivist ownership, ' +
    'or open librarian review window for this wallet.',
  no_active_rental: 'No active rental for this wallet. Rent the book first.',
  rent_contract_paused: 'Rentals are paused on-chain right now, so access cannot be checked. Try again later.',
  auth_expired: 'The signature expired before it was checked. Open the book again.',
  auth_not_yet_valid: "Your computer's clock is ahead of the chain. Correct the clock and try again.",
  auth_domain: 'This site is not allowed to unlock books. Open Alexandria from its official address.',
  auth_wallet_mismatch: 'The signature does not match the connected wallet. Reconnect and try again.',
  bad_signature: 'The wallet signature could not be verified. Smart-contract wallets are not supported yet.',
  clock_unavailable: 'The chain could not be reached to check the time. Try again in a minute.',
  rpc_disagree: 'The two Base Sepolia providers gave different answers, so access was refused. Try again shortly.',
  rate_limited: 'Too many unlock attempts. Wait a few minutes and try again.',
  not_registered: 'This book is not registered on-chain yet. It can be opened once storage and registration finish.',
  stake_required: 'Stake this book to open it. Archivists can read their own uploads once they have staked them.',
  unlock_budget_low: 'Book unlocking is paused while the service tops up its credit. Try again later.',
  unlock_not_configured: 'Book unlocking is not set up on this server yet.',
  action_not_permitted: 'This app version is out of date with the server. Reload the page.',
};

function readableError(code, fallback) {
  return ERROR_TEXT[code] || (code ? `Unlock refused: ${code}` : fallback || 'Unlock failed.');
}

function bytesToBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return window.btoa(binary);
}

function base64ToBytes(base64) {
  const binary = window.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Ask the decryption Lit Action for one book's key.
 *
 * @param {object} p
 * @param {string} p.arweaveHash  the book
 * @param {string} p.sealedKey    litEncryptedKeyId from decrypt-params
 * @param {import('ethers').Signer} p.signer   the connected wallet
 * @param {string} p.address      the connected wallet's address
 * @param {(stage: 'signing'|'lit') => void} [p.onStage]  progress for the UI
 * @returns {Promise<{ cryptoKey: CryptoKey, grantedVia: 'rental'|'uploader'|'librarian_review' }>}
 *   cryptoKey  — non-extractable AES-GCM key, usable only to decrypt
 *   grantedVia — decides the watermark stamped on every page. A review copy has
 *                to be identifiable as one if it ever leaves the librarian's screen.
 */
export async function unlockBookKey({ arweaveHash, sealedKey, signer, address, onStage = () => {} }) {
  if (!sealedKey) throw new Error('Missing sealed key.');
  if (!signer || !address) throw new Error('Connect your wallet to open this book.');

  // 1. A key pair for this read only. Its private half can never be exported.
  const session = await window.crypto.subtle.generateKey(
    { name: 'RSA-OAEP', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    false,
    ['wrapKey', 'unwrapKey']
  );
  const spki = new Uint8Array(await window.crypto.subtle.exportKey('spki', session.publicKey));

  // 2. The message: this wallet, this book, this browser, the next few minutes.
  const issued = Math.floor(Date.now() / 1000);
  const authMessage = buildUnlockMessage({
    domain: window.location.host,
    uri: window.location.origin,
    address: getAddress(address),
    nonce: randomNonce(),
    issuedAt: toIsoSeconds(issued),
    expirationTime: toIsoSeconds(issued + UNLOCK_WINDOW_SECONDS),
    sealedKeyHash: await sha256Hex(new TextEncoder().encode(sealedKey)),
    sessionKeyHash: await sha256Hex(spki),
  });

  // 3. The reader signs it.
  onStage('signing');
  let authSignature;
  try {
    authSignature = await signer.signMessage(authMessage);
  } catch (err) {
    if (isUserRejection(err)) throw new Error('You declined the signature, so the book stays locked.');
    throw new Error(`Your wallet could not sign: ${err?.shortMessage || err?.message || 'unknown error'}`);
  }

  // 4. The relay forwards it to the Action.
  onStage('lit');
  let result;
  try {
    result = await unlockBook(arweaveHash, {
      code: LIT_DECRYPT_ACTION_CODE,
      authMessage,
      authSignature,
      sessionPublicKey: bytesToBase64(spki),
    });
  } catch (err) {
    throw new Error(readableError(err?.data?.error, err?.message));
  }

  if (typeof result?.wrappedKey !== 'string' || !GRANTS.has(result.grantedVia)) {
    throw new Error('The unlock service returned an incomplete answer.');
  }

  // 5. Unwrap straight into a key that can decrypt and do nothing else.
  let cryptoKey;
  try {
    cryptoKey = await window.crypto.subtle.unwrapKey(
      'raw',
      base64ToBytes(result.wrappedKey),
      session.privateKey,
      { name: 'RSA-OAEP' },
      { name: 'AES-GCM', length: 256 },
      false,
      ['decrypt']
    );
  } catch {
    throw new Error('The key returned for this book could not be opened by this browser.');
  }

  return { cryptoKey, grantedVia: result.grantedVia };
}
