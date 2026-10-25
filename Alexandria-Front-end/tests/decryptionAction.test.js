// Decryption Lit Action — authorization gate and key-binding invariants.
//
// Run: npm run test:lit-action
//
// This suite EXECUTES the shipped Action source (src/services/litAction.js) inside a
// sandbox with stubbed Lit and ethers and a real WebCrypto. The stubs model what
// the chain returns, never what the Action ought to decide. Signatures are real
// (ethers wallets), session keys are real RSA-OAEP key pairs, and every request is
// built with the same builder the app uses (src/services/unlockMessage.js), so a
// format drift between the two fails here.
//
// Covered:
//   1–14.  Rental, uploader, stranger, key binding (A does not unlock B), fail closed,
//          envelope integrity.
//   15–23. Librarian review access, and every way it must be refused.
//   24–30. Who is asking: identity comes only from the signature; parameters such
//          as userAddress, pkpId and arweaveHash are never read.
//   31–37. What the signature is for: this book, this browser, this site, this chain,
//          and a strict message format.
//   38–45. When: expiry, future-dated, overlong windows, and the chain clock.
//   46–49. Two RPC providers: a fact counts only if both report it.
//   50–52. Invariants over every run: no response ever carries a key in the clear,
//          and a wrapped key opens only with its own session key.

import crypto from 'node:crypto';
import { Wallet, verifyMessage, sha256, toUtf8Bytes, encodeBase64, decodeBase64 } from 'ethers';

import {
  LIT_DECRYPT_ACTION_CODE,
  RENT_CONTRACT_ADDRESS,
  LIBRARY_CONTRACT_ADDRESS,
  STAKE_CONTRACT_ADDRESS,
  BASE_SEPOLIA_RPC_URLS,
  BASE_SEPOLIA_CHAIN_ID,
  LIT_PKP_ID,
  UNLOCK_ALLOWED_DOMAINS,
} from '../src/services/litAction.js';
import { buildUnlockMessage, toIsoSeconds, randomNonce, sha256Hex } from '../src/services/unlockMessage.js';

const { subtle } = crypto.webcrypto;

let passed = 0;
let failed = 0;

function assert(condition, name, detail) {
  if (condition) {
    console.log(`  ✓ ${name}`);
    passed++;
  } else {
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
    failed++;
  }
}

function section(name) {
  console.log(`\n${name}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

const ALICE_RENTER = Wallet.createRandom();
const BOB_ARCHIVIST = Wallet.createRandom();
const EVE_ATTACKER = Wallet.createRandom();
const STRANGER = Wallet.createRandom();
const LIBRARIAN = Wallet.createRandom();

const HASH_CHEAP = 'hash_CHEAP_PAMPHLET_0000000000000000000000';
const HASH_RARE = 'hash_RARE_MANUSCRIPT_000000000000000000000';
const HASH_REVIEW = 'hash_UNDER_REVIEW_00000000000000000000000';
const HASH_UNSTAKED = 'hash_NEVER_STAKED_00000000000000000000000';

const DAY = 86_400;
const CHALLENGE_PERIOD = 14 * DAY;
const NOW = 1_800_000_000;

const STATUS_PENDING = 0;
const STATUS_APPROVED = 2;

const DOMAIN = UNLOCK_ALLOWED_DOMAINS[0];
const [RPC_A, RPC_B] = BASE_SEPOLIA_RPC_URLS;

// The PKP's sealing key never leaves the TEE. Here it is an ordinary local key,
// so every envelope the Action unseals is one this file actually sealed.
const SIMULATED_PKP_KEY = crypto.randomBytes(32);

function seal(envelopeObj) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', SIMULATED_PKP_KEY, iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(envelopeObj), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64');
}

function unseal(sealedBase64) {
  const raw = Buffer.from(sealedBase64, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', SIMULATED_PKP_KEY, raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
}

const KEY_CHEAP = crypto.randomBytes(32).toString('base64');
const KEY_RARE = crypto.randomBytes(32).toString('base64');
const KEY_REVIEW = crypto.randomBytes(32).toString('base64');

const envelopeCheap = seal({ v: 1, k: KEY_CHEAP, arweaveHash: HASH_CHEAP });
const envelopeRare = seal({ v: 1, k: KEY_RARE, arweaveHash: HASH_RARE });
const envelopeReview = seal({ v: 1, k: KEY_REVIEW, arweaveHash: HASH_REVIEW });
const KEY_UNSTAKED = crypto.randomBytes(32).toString('base64');
const envelopeUnstaked = seal({ v: 1, k: KEY_UNSTAKED, arweaveHash: HASH_UNSTAKED });

// ─────────────────────────────────────────────────────────────────────────────
// Sandbox — what the Action sees in place of Lit, ethers and the chain
// ─────────────────────────────────────────────────────────────────────────────

/** Minimal ethers v5 BigNumber: the Action does stakedAt.add(period).gt(now). */
function bn(value) {
  const v = BigInt(value);
  return {
    _v: v,
    add: (other) => bn(v + BigInt(other && other._v !== undefined ? other._v : other)),
    gt: (other) => v > BigInt(other && other._v !== undefined ? other._v : other),
    toString: () => v.toString(),
  };
}

/** One rented book, one approved book, one staked book still under review. */
function defaultChain() {
  const lower = (w) => w.address.toLowerCase();
  return {
    now: NOW,
    clockFails: false,
    rentPaused: false,
    rentDown: false,
    stakeReverts: false,
    rentals: {
      [HASH_CHEAP]: [lower(ALICE_RENTER), lower(EVE_ATTACKER)],
      [HASH_RARE]: [lower(ALICE_RENTER)],
    },
    uploaders: {
      [HASH_CHEAP]: BOB_ARCHIVIST.address,
      [HASH_RARE]: BOB_ARCHIVIST.address,
      [HASH_REVIEW]: BOB_ARCHIVIST.address,
      [HASH_UNSTAKED]: BOB_ARCHIVIST.address,
    },
    statuses: {
      [HASH_CHEAP]: STATUS_APPROVED,
      [HASH_RARE]: STATUS_APPROVED,
      [HASH_REVIEW]: STATUS_PENDING,
      [HASH_UNSTAKED]: STATUS_PENDING,
    },
    librarians: {
      [lower(LIBRARIAN)]: { amount: '50', timestamp: NOW - 30 * DAY, active: true },
    },
    stakes: {
      // Staked two days ago — twelve days of challenge window left.
      [HASH_REVIEW]: { staker: BOB_ARCHIVIST.address, amount: '100', timestamp: NOW - 2 * DAY, active: true },
      [HASH_CHEAP]: { staker: BOB_ARCHIVIST.address, amount: '100', timestamp: NOW - 90 * DAY, active: false },
      // Approved: staked, window passed, unstaked. unstake() clears only `active`.
      [HASH_RARE]: { staker: BOB_ARCHIVIST.address, amount: '100', timestamp: NOW - 60 * DAY, active: false },
      // HASH_UNSTAKED: registered to Bob, never staked, so no record at all.
    },
  };
}

/** Each provider sees its own copy of the chain, so a test can make them disagree. */
function defaultChains() {
  return { [RPC_A]: defaultChain(), [RPC_B]: defaultChain() };
}

/** Apply the same change to both providers' view. */
function bothChains(mutate) {
  const chains = defaultChains();
  mutate(chains[RPC_A]);
  mutate(chains[RPC_B]);
  return chains;
}

const ZERO_ADDRESS = `0x${'0'.repeat(40)}`;

function contractFor(address, chain) {
  const at = (map, key, fallback) => (Object.prototype.hasOwnProperty.call(map, key) ? map[key] : fallback);

  if (address === RENT_CONTRACT_ADDRESS) {
    return {
      isRentalActive: async (hash, user) => {
        if (chain.rentDown) throw new Error('could not detect network');
        if (chain.rentPaused) throw new Error('Pausable: paused');
        return (chain.rentals[hash] || []).includes(String(user).toLowerCase());
      },
    };
  }

  if (address === LIBRARY_CONTRACT_ADDRESS) {
    return {
      getUploader: async (hash) => at(chain.uploaders, hash, ZERO_ADDRESS),
      getUploadStatus: async (hash) => at(chain.statuses, hash, STATUS_PENDING),
    };
  }

  if (address === STAKE_CONTRACT_ADDRESS) {
    return {
      // Solidity tuples arrive positionally, which is how the Action reads them.
      librarians: async (user) => {
        if (chain.stakeReverts) throw new Error('execution reverted');
        const info = at(chain.librarians, String(user).toLowerCase(), null);
        return info ? [bn(info.amount), bn(info.timestamp), info.active] : [bn(0), bn(0), false];
      },
      stakes: async (hash) => {
        if (chain.stakeReverts) throw new Error('execution reverted');
        const info = at(chain.stakes, hash, null);
        return info
          ? [info.staker, bn(info.amount), bn(info.timestamp), info.active]
          : [ZERO_ADDRESS, bn(0), bn(0), false];
      },
      CHALLENGE_PERIOD: async () => bn(CHALLENGE_PERIOD),
    };
  }

  throw new Error(`Action addressed an unexpected contract: ${address}`);
}

// Everything the Action ever did, across the whole run. Checked at the end.
const audit = { responses: [], decryptPkpIds: [], providers: [] };

/**
 * Run the real Action source against simulated chains.
 * @returns {Promise<{ result: object, decryptCalls: number }>}
 */
async function runAction(params, chains = defaultChains()) {
  const responses = [];
  let decryptCalls = 0;

  const chainFor = (url) => {
    if (!chains[url]) throw new Error(`Action used an unexpected RPC URL: ${url}`);
    return chains[url];
  };

  const Lit = {
    Actions: {
      setResponse: ({ response }) => responses.push(response),
      Decrypt: async ({ pkpId, ciphertext }) => {
        decryptCalls++;
        audit.decryptPkpIds.push(pkpId);
        return unseal(ciphertext);
      },
    },
  };

  // ethers v5 names, as the Lit runtime provides them (ethers/5.7.2, measured
  // live), backed by the real ethers v6 implementations.
  const ethers = {
    utils: {
      verifyMessage: (message, signature) => verifyMessage(message, signature),
      sha256: (bytes) => sha256(bytes),
      toUtf8Bytes: (text) => toUtf8Bytes(text),
      base64: { encode: (bytes) => encodeBase64(bytes), decode: (text) => decodeBase64(text) },
    },
    providers: {
      StaticJsonRpcProvider: function StaticJsonRpcProvider(url, network) {
        audit.providers.push({ url, network });
        return {
          url,
          getBlock: async () => {
            const chain = chainFor(url);
            if (chain.clockFails) throw new Error('timeout');
            return { timestamp: chain.now };
          },
        };
      },
    },
    Contract: function Contract(address, abi, provider) {
      return contractFor(address, chainFor(provider.url));
    },
  };

  const main = new Function('Lit', 'ethers', 'crypto', `${LIT_DECRYPT_ACTION_CODE}\nreturn main;`)(
    Lit,
    ethers,
    crypto.webcrypto
  );

  await main(params);

  audit.responses.push(...responses);

  // Exactly one response, always: two would mean the Action kept running after
  // answering, which for a deny followed by a grant would be a key leak.
  if (responses.length !== 1) return { result: { error: `action_set_${responses.length}_responses` }, decryptCalls };

  try {
    return { result: JSON.parse(responses[0]), decryptCalls };
  } catch {
    return { result: { error: 'unparseable_response' }, decryptCalls };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Requests — built exactly as the browser builds them
// ─────────────────────────────────────────────────────────────────────────────

const newSessionKeyPair = () =>
  subtle.generateKey(
    { name: 'RSA-OAEP', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    false,
    ['encrypt', 'decrypt']
  );

const SESSION = await newSessionKeyPair();
const OTHER_SESSION = await newSessionKeyPair();

const spkiOf = async (pair) => new Uint8Array(await subtle.exportKey('spki', pair.publicKey));

/**
 * A signed unlock request.
 *
 * @param {object} o
 * @param {Wallet} o.wallet         the address the message names
 * @param {string} o.ciphertext     the sealed envelope sent to the Action
 * @param {Wallet} [o.signer]       who actually signs (default: o.wallet)
 * @param {string} [o.signedFor]    the sealed envelope the message names (default: o.ciphertext)
 * @param {object} [o.session]      key pair named in the message
 * @param {object} [o.sentSession]  key pair whose public key is sent (default: o.session)
 * @param {string} [o.domain]
 * @param {number} [o.issuedAt]     unix seconds
 * @param {number} [o.expiresAt]    unix seconds
 * @param {(m: string) => string} [o.edit]  change the message text before signing
 * @param {object} [o.extra]        additional js_params an attacker might add
 */
async function request({
  wallet,
  ciphertext,
  signer = wallet,
  signedFor = ciphertext,
  session = SESSION,
  sentSession = session,
  domain = DOMAIN,
  issuedAt = NOW - 10,
  expiresAt = NOW + 290,
  edit,
  extra = {},
}) {
  let authMessage = buildUnlockMessage({
    domain,
    uri: `http://${domain}`,
    address: wallet.address,
    nonce: randomNonce(),
    issuedAt: toIsoSeconds(issuedAt),
    expirationTime: toIsoSeconds(expiresAt),
    sealedKeyHash: await sha256Hex(new TextEncoder().encode(signedFor)),
    sessionKeyHash: await sha256Hex(await spkiOf(session)),
  });
  if (edit) authMessage = edit(authMessage);

  return {
    ciphertext,
    authMessage,
    authSignature: await signer.signMessage(authMessage),
    sessionPublicKey: encodeBase64(await spkiOf(sentSession)),
    ...extra,
  };
}

/** Recover k from a grant, as the browser's unwrapKey would. null if absent or unopenable. */
async function unwrap(result, session = SESSION) {
  if (!result || typeof result.wrappedKey !== 'string') return null;
  try {
    const raw = await subtle.decrypt({ name: 'RSA-OAEP' }, session.privateKey, decodeBase64(result.wrappedKey));
    return Buffer.from(raw).toString('base64');
  } catch {
    return null;
  }
}

async function call(options, chains) {
  return runAction(await request(options), chains);
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

async function run() {
  section('Rental and uploader access');
  {
    const alice = (await call({ wallet: ALICE_RENTER, ciphertext: envelopeRare })).result;
    assert((await unwrap(alice)) === KEY_RARE, '1. an active renter receives the key, wrapped to their session key');
    assert(alice.grantedVia === 'rental', '2. and the grant is marked as a rental');

    const bob = (await call({ wallet: BOB_ARCHIVIST, ciphertext: envelopeRare })).result;
    assert((await unwrap(bob)) === KEY_RARE, '3. the uploader receives the key without renting');
    assert(bob.grantedVia === 'uploader', '4. and the grant is marked as ownership');

    const stranger = (await call({ wallet: STRANGER, ciphertext: envelopeRare })).result;
    assert(stranger.error === 'access_denied', '5. a stranger is denied');
    assert(
      stranger.wrappedKey === undefined && stranger.key === undefined,
      '6. and no key travels alongside the error'
    );
  }

  section('Key binding — the attack this envelope format exists to stop');
  {
    // Eve rented the cheap pamphlet, then submits the rare manuscript's
    // ciphertext. The hash is sealed inside it, so her rental cannot vouch for it.
    const eve = (await call({ wallet: EVE_ATTACKER, ciphertext: envelopeRare })).result;
    assert(eve.error === 'access_denied', '7. renting book A does not unlock book B');

    const eveOwn = (await call({ wallet: EVE_ATTACKER, ciphertext: envelopeCheap })).result;
    assert((await unwrap(eveOwn)) === KEY_CHEAP, '8. her own rental still works');
  }

  section('Fail closed');
  {
    const paused = bothChains((c) => (c.rentPaused = true));

    const alice = (await call({ wallet: ALICE_RENTER, ciphertext: envelopeRare }, paused)).result;
    assert(alice.error === 'access_denied', '9. a paused Rent contract denies rather than grants');

    const bob = (await call({ wallet: BOB_ARCHIVIST, ciphertext: envelopeRare }, paused)).result;
    assert((await unwrap(bob)) === KEY_RARE, '10. but the uploader is unaffected by Rent being paused');
  }

  section('Envelope integrity');
  {
    const v2 = seal({ v: 2, k: KEY_RARE, arweaveHash: HASH_RARE });
    assert(
      (await call({ wallet: ALICE_RENTER, ciphertext: v2 })).result.error === 'invalid_envelope_format',
      '11. an unknown envelope version is rejected'
    );

    const noHash = seal({ v: 1, k: KEY_RARE });
    assert(
      (await call({ wallet: ALICE_RENTER, ciphertext: noHash })).result.error === 'invalid_envelope_format',
      '12. an envelope without its bound hash is rejected'
    );

    const noKey = seal({ v: 1, arweaveHash: HASH_RARE });
    assert(
      (await call({ wallet: ALICE_RENTER, ciphertext: noKey })).result.error === 'invalid_envelope_format',
      '13. an envelope without a key is rejected'
    );

    const shortKey = seal({ v: 1, k: crypto.randomBytes(16).toString('base64'), arweaveHash: HASH_RARE });
    assert(
      (await call({ wallet: ALICE_RENTER, ciphertext: shortKey })).result.error === 'invalid_envelope_format',
      '14. an envelope whose key is not 32 bytes is rejected'
    );
  }

  // The carve-out that makes review possible at all. A book inside its challenge
  // window is not rentable (Rent.rentBook requires Approved), so without this a
  // librarian is asked to judge a book they have no way to open.
  section('Librarian review access');
  {
    const granted = (await call({ wallet: LIBRARIAN, ciphertext: envelopeReview })).result;
    assert((await unwrap(granted)) === KEY_REVIEW, '15. an active librarian can open a challengeable book');
    assert(
      granted.grantedVia === 'librarian_review',
      '16. and the grant says so, which is what watermarks the pages'
    );
  }

  section('Librarian review — every way it must be refused');
  {
    const reviewAs = async (chains, wallet = LIBRARIAN, ciphertext = envelopeReview) =>
      (await call({ wallet, ciphertext }, chains)).result.error;

    const expired = bothChains((c) => (c.stakes[HASH_REVIEW].timestamp = NOW - 15 * DAY)); // window shut yesterday
    assert((await reviewAs(expired)) === 'access_denied', '17. when the challenge window closes, so does access');

    const unstaked = bothChains((c) => (c.librarians[LIBRARIAN.address.toLowerCase()].active = false));
    assert((await reviewAs(unstaked)) === 'access_denied', '18. a librarian who unstaked is denied');

    assert(
      (await reviewAs(defaultChains(), STRANGER)) === 'access_denied',
      '19. a wallet that was never a librarian is denied'
    );

    const approved = bothChains((c) => (c.statuses[HASH_REVIEW] = STATUS_APPROVED));
    assert(
      (await reviewAs(approved)) === 'access_denied',
      '20. an approved book is catalogue, not review material — rent it like anyone else'
    );

    const stakeInactive = bothChains((c) => (c.stakes[HASH_REVIEW].active = false));
    assert(
      (await reviewAs(stakeInactive)) === 'access_denied',
      '21. no active stake means nothing to challenge, so nothing to review'
    );

    const reverting = bothChains((c) => (c.stakeReverts = true));
    assert(
      (await reviewAs(reverting)) === 'access_denied',
      '22. an unreadable stake contract denies review, it does not assume it'
    );

    // The carve-out must not become a skeleton key for the rest of the library.
    assert(
      (await reviewAs(defaultChains(), LIBRARIAN, envelopeRare)) === 'access_denied',
      '23. a librarian cannot open an approved book they hold no rental for'
    );
  }

  // F4 in KEY-BINDING.md: who rented what is public, so any identity the caller
  // can simply state is an identity anyone can borrow.
  section('Who is asking — identity comes only from the signature');
  {
    const borrowed = await call({ wallet: ALICE_RENTER, signer: EVE_ATTACKER, ciphertext: envelopeRare });
    assert(borrowed.result.error === 'auth_wallet_mismatch', '24. a message naming Alice but signed by Eve is refused');
    assert(borrowed.decryptCalls === 0, '25. and nothing is unsealed for it');

    const garbage = await request({ wallet: ALICE_RENTER, ciphertext: envelopeRare });
    garbage.authSignature = `0x${'11'.repeat(65)}`;
    assert(
      (await runAction(garbage)).result.error === 'bad_signature',
      '26. a signature that recovers nothing is refused'
    );

    // Eve signs honestly as herself, then adds parameters naming Alice. The old
    // Action read userAddress; this one must not read any of these.
    const claims = await call({
      wallet: EVE_ATTACKER,
      ciphertext: envelopeRare,
      extra: { userAddress: ALICE_RENTER.address, arweaveHash: HASH_CHEAP, pkpId: 'attacker-chosen-pkp' },
    });
    assert(claims.result.error === 'access_denied', '27. userAddress / arweaveHash parameters change nothing');
    assert(
      audit.decryptPkpIds.length > 0 && audit.decryptPkpIds.every((pkp) => pkp === LIT_PKP_ID),
      '28. Decrypt is only ever called with the constant PKP, never a caller-chosen one'
    );

    // A relay (or anyone in the middle) swaps in its own session key so the key
    // would be wrapped to something it can open.
    const swapped = await call({ wallet: ALICE_RENTER, ciphertext: envelopeRare, sentSession: OTHER_SESSION });
    assert(swapped.result.error === 'auth_session_key', '29. a session key other than the signed one is refused');
    assert(swapped.decryptCalls === 0, '30. and nothing is unsealed for it');
  }

  section('What the signature is for');
  {
    // Alice really did sign — for the cheap book. The signature is replayed with
    // the rare book's envelope.
    const replayed = await call({ wallet: ALICE_RENTER, ciphertext: envelopeRare, signedFor: envelopeCheap });
    assert(replayed.result.error === 'auth_wrong_key', '31. a signature for book A cannot open book B');

    const phishing = await call({
      wallet: ALICE_RENTER,
      ciphertext: envelopeRare,
      domain: 'alexandria-library.example',
    });
    assert(phishing.result.error === 'auth_domain', '32. a message signed on another site is refused');

    const otherChain = await call({
      wallet: ALICE_RENTER,
      ciphertext: envelopeRare,
      edit: (m) => m.replace(`Chain ID: ${BASE_SEPOLIA_CHAIN_ID}`, 'Chain ID: 1'),
    });
    assert(otherChain.result.error === 'auth_chain', '33. a message for another chain is refused');

    const extraLine = await call({
      wallet: ALICE_RENTER,
      ciphertext: envelopeRare,
      edit: (m) => `${m}\n- urn:alexandria:sealed-key:sha256:${'0'.repeat(64)}`,
    });
    assert(extraLine.result.error === 'auth_message_invalid', '34. an extra line is refused, not ignored');

    const crlf = await call({
      wallet: ALICE_RENTER,
      ciphertext: envelopeRare,
      edit: (m) => m.replace(/\n/g, '\r\n'),
    });
    assert(crlf.result.error === 'auth_message_invalid', '35. CRLF line endings are refused');

    const wrongUri = await call({
      wallet: ALICE_RENTER,
      ciphertext: envelopeRare,
      edit: (m) => m.replace(`URI: http://${DOMAIN}`, 'URI: https://evil.example'),
    });
    assert(wrongUri.result.error === 'auth_message_invalid', "36. a URI that is not the domain's own is refused");

    const missing = await runAction({ ciphertext: envelopeRare, authMessage: 'hi', authSignature: '0x' });
    assert(missing.result.error === 'missing_params', '37. a request without a session key is refused');
  }

  section('When — expiry on the chain clock');
  {
    const expired = await call({
      wallet: ALICE_RENTER,
      ciphertext: envelopeRare,
      issuedAt: NOW - 400,
      expiresAt: NOW - 100,
    });
    assert(expired.result.error === 'auth_expired', '38. an expired message is refused');
    assert(expired.decryptCalls === 0, '39. and nothing is unsealed for it');

    const future = await call({
      wallet: ALICE_RENTER,
      ciphertext: envelopeRare,
      issuedAt: NOW + 120,
      expiresAt: NOW + 400,
    });
    assert(future.result.error === 'auth_not_yet_valid', '40. a message issued in the future is refused');

    const long = await call({
      wallet: ALICE_RENTER,
      ciphertext: envelopeRare,
      issuedAt: NOW - 10,
      expiresAt: NOW + 3600,
    });
    assert(long.result.error === 'auth_window_too_long', '41. a window longer than 10 minutes is refused');

    const noClock = defaultChains();
    noClock[RPC_B].clockFails = true;
    const blind = await call({ wallet: ALICE_RENTER, ciphertext: envelopeRare }, noClock);
    assert(blind.result.error === 'clock_unavailable', '42. an unreadable clock denies');

    // Provider B lags (or lies backwards) by 40 s — inside tolerance. The message
    // expired 20 s ago by A's clock. Using B's older clock would revive it.
    const lagging = defaultChains();
    lagging[RPC_A].now = NOW + 30;
    lagging[RPC_B].now = NOW - 10;
    const revived = await call(
      { wallet: ALICE_RENTER, ciphertext: envelopeRare, issuedAt: NOW - 100, expiresAt: NOW + 10 },
      lagging
    );
    assert(
      revived.result.error === 'auth_expired',
      '43. "now" is the newer clock, so a lagging provider cannot revive an expired signature'
    );

    const apart = defaultChains();
    apart[RPC_B].now = NOW - 120;
    const split = await call({ wallet: ALICE_RENTER, ciphertext: envelopeRare }, apart);
    assert(split.result.error === 'rpc_disagree', '44. clocks more than 60 s apart deny');

    // The review window closes on the newer clock too.
    const reviewLag = defaultChains();
    const closesAt = reviewLag[RPC_A].stakes[HASH_REVIEW].timestamp + CHALLENGE_PERIOD;
    reviewLag[RPC_A].now = closesAt + 5;
    reviewLag[RPC_B].now = closesAt - 20;
    const lateReview = await call(
      { wallet: LIBRARIAN, ciphertext: envelopeReview, issuedAt: closesAt - 60, expiresAt: closesAt + 200 },
      reviewLag
    );
    assert(
      lateReview.result.error === 'access_denied',
      '45. a lagging provider cannot reopen a closed review window'
    );
  }

  // R5: one RPC endpoint is a trust anchor. Two must agree.
  section('Two RPC providers — a fact counts only if both report it');
  {
    const lying = defaultChains();
    lying[RPC_A].rentals[HASH_RARE].push(EVE_ATTACKER.address.toLowerCase()); // A claims Eve rented it
    const eve = (await call({ wallet: EVE_ATTACKER, ciphertext: envelopeRare }, lying)).result;
    assert(eve.error === 'rpc_disagree', '46. one provider reporting a rental the other does not is refused');
    assert(eve.wrappedKey === undefined, '47. and no key is released');

    const down = defaultChains();
    down[RPC_B].rentDown = true;
    const alice = (await call({ wallet: ALICE_RENTER, ciphertext: envelopeRare }, down)).result;
    assert(alice.wrappedKey === undefined && alice.error === 'rpc_disagree', '48. one provider down denies a renter');

    assert(
      audit.providers.length > 0 &&
        audit.providers.every((p) => p.network && p.network.chainId === BASE_SEPOLIA_CHAIN_ID) &&
        new Set(audit.providers.map((p) => p.url)).size === 2,
      '49. both providers are pinned to Base Sepolia'
    );
  }

  section("The uploader door needs the uploader's own stake");
  {
    // Registration is automatic, so without this anyone could upload a PDF,
    // never stake, and read "their" book on Alexandria's Lit credit.
    const never = (await call({ wallet: BOB_ARCHIVIST, ciphertext: envelopeUnstaked })).result;
    assert(
      never.error === 'access_denied' && never.wrappedKey === undefined,
      '53. an uploader who never staked the book is denied'
    );

    const underReview = (await call({ wallet: BOB_ARCHIVIST, ciphertext: envelopeReview })).result;
    assert(
      (await unwrap(underReview)) === KEY_REVIEW && underReview.grantedVia === 'uploader',
      '54. an uploader whose stake is active is let in as the uploader'
    );

    // stake() only ever records the uploader, but the Action must not assume it:
    // a stake record naming someone else does not open the uploader's door.
    const othersStake = bothChains((c) => {
      c.stakes[HASH_UNSTAKED] = { staker: STRANGER.address, amount: '100', timestamp: NOW - 2 * DAY, active: true };
    });
    const bobAgain = (await call({ wallet: BOB_ARCHIVIST, ciphertext: envelopeUnstaked }, othersStake)).result;
    assert(bobAgain.error === 'access_denied', "55. someone else's stake does not open the uploader's door");
  }

  section('Invariants over every run above');
  {
    const bodies = audit.responses.map((r) => JSON.parse(r));
    const leaked = bodies.filter(
      (b) => Object.prototype.hasOwnProperty.call(b, 'key') || Object.prototype.hasOwnProperty.call(b, 'k')
    );
    assert(leaked.length === 0, '50. no response ever carried the key in the clear');

    const grants = bodies.filter((b) => b.wrappedKey);
    assert(
      grants.length > 0 && grants.every((b) => ['rental', 'uploader', 'librarian_review'].includes(b.grantedVia)),
      '51. every grant names how it was granted'
    );

    assert((await unwrap(grants[0], OTHER_SESSION)) === null, '52. a wrapped key cannot be opened with another session key');
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

run().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
