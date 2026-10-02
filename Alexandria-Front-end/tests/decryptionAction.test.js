// Decryption Lit Action — authorization gate and key-binding invariants.
//
// Run: npm run test:lit-action
//
// This suite EXECUTES the shipped Action source (src/services/litAction.js) inside a
// sandbox with stubbed Lit and ethers globals. It used to reimplement the
// Action's logic in the test instead, which meant the suite could pass while the
// code actually sent to the TEE was broken — the one thing these tests exist to
// prevent. The stubs below are deliberately dumb: they model what the chain
// returns, never what the Action ought to decide.
//
// Covered:
//   1. Renter with an active rental is granted the key.
//   2. Uploader is granted without a rental (archivists cannot rent their own).
//   3. Stranger is denied.
//   4. ATTACK: renting book A does not unlock book B.
//   5. Paused Rent contract fails closed.
//   6. Tampered envelope (bad version, missing fields) is rejected.
//   7. Librarian reviewing a challengeable book is granted, and marked as review.
//   8. Every way that review grant must NOT be given.

import crypto from 'node:crypto';

import {
  LIT_DECRYPT_ACTION_CODE,
  RENT_CONTRACT_ADDRESS,
  LIBRARY_CONTRACT_ADDRESS,
  STAKE_CONTRACT_ADDRESS,
} from '../src/services/litAction.js';

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

const ALICE_RENTER = '0x1111111111111111111111111111111111111111';
const BOB_ARCHIVIST = '0x2222222222222222222222222222222222222222';
const EVE_ATTACKER = '0x3333333333333333333333333333333333333333';
const STRANGER = '0x4444444444444444444444444444444444444444';
const LIBRARIAN = '0x5555555555555555555555555555555555555555';

const HASH_CHEAP = 'hash_CHEAP_PAMPHLET_0000000000000000000000';
const HASH_RARE = 'hash_RARE_MANUSCRIPT_000000000000000000000';
const HASH_REVIEW = 'hash_UNDER_REVIEW_00000000000000000000000';

const DAY = 86_400;
const CHALLENGE_PERIOD = 14 * DAY;
const NOW = 1_800_000_000;

const STATUS_PENDING = 0;
const STATUS_APPROVED = 2;

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

// ─────────────────────────────────────────────────────────────────────────────
// Sandbox — what the Action sees in place of Lit and ethers
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
  return {
    now: NOW,
    rentPaused: false,
    stakeReverts: false,
    rentals: {
      [HASH_CHEAP]: [ALICE_RENTER.toLowerCase(), EVE_ATTACKER.toLowerCase()],
      [HASH_RARE]: [ALICE_RENTER.toLowerCase()],
    },
    uploaders: {
      [HASH_CHEAP]: BOB_ARCHIVIST.toLowerCase(),
      [HASH_RARE]: BOB_ARCHIVIST.toLowerCase(),
      [HASH_REVIEW]: BOB_ARCHIVIST.toLowerCase(),
    },
    statuses: {
      [HASH_CHEAP]: STATUS_APPROVED,
      [HASH_RARE]: STATUS_APPROVED,
      [HASH_REVIEW]: STATUS_PENDING,
    },
    librarians: {
      [LIBRARIAN.toLowerCase()]: { amount: '50', timestamp: NOW - 30 * DAY, active: true },
    },
    stakes: {
      // Staked two days ago — twelve days of challenge window left.
      [HASH_REVIEW]: { staker: BOB_ARCHIVIST.toLowerCase(), amount: '100', timestamp: NOW - 2 * DAY, active: true },
      [HASH_CHEAP]: { staker: BOB_ARCHIVIST.toLowerCase(), amount: '100', timestamp: NOW - 90 * DAY, active: false },
    },
  };
}

const ZERO_ADDRESS = `0x${'0'.repeat(40)}`;

function contractFor(address, chain) {
  const at = (map, key, fallback) => (Object.prototype.hasOwnProperty.call(map, key) ? map[key] : fallback);

  if (address === RENT_CONTRACT_ADDRESS) {
    return {
      isRentalActive: async (hash, user) => {
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

/**
 * Run the real Action source against a simulated chain.
 * @returns whatever the Action handed to Lit.Actions.setResponse, parsed.
 */
async function runAction({ ciphertext, userAddress }, chain = defaultChain()) {
  const responses = [];

  const Lit = {
    Actions: {
      setResponse: ({ response }) => responses.push(response),
      Decrypt: async ({ ciphertext: ct }) => unseal(ct),
    },
  };

  const ethers = {
    providers: {
      JsonRpcProvider: function JsonRpcProvider() {
        return { getBlock: async () => ({ timestamp: chain.now }) };
      },
    },
    Contract: function Contract(address) {
      return contractFor(address, chain);
    },
  };

  const main = new Function('Lit', 'ethers', `${LIT_DECRYPT_ACTION_CODE}\nreturn main;`)(Lit, ethers);

  await main({ pkpId: 'pkp-test', ciphertext, userAddress });

  // Exactly one response, always: two would mean the Action kept running after
  // answering, which for a deny followed by a grant would be a key leak.
  if (responses.length !== 1) return { error: `action_set_${responses.length}_responses` };

  try {
    return JSON.parse(responses[0]);
  } catch {
    return { error: 'unparseable_response' };
  }
}

const envelopeCheap = seal({ v: 1, k: KEY_CHEAP, arweaveHash: HASH_CHEAP });
const envelopeRare = seal({ v: 1, k: KEY_RARE, arweaveHash: HASH_RARE });
const envelopeReview = seal({ v: 1, k: KEY_REVIEW, arweaveHash: HASH_REVIEW });

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

async function run() {
  section('Rental and uploader access');
  {
    const alice = await runAction({ ciphertext: envelopeRare, userAddress: ALICE_RENTER });
    assert(alice.key === KEY_RARE, '1. an active renter receives the key');
    assert(alice.grantedVia === 'rental', '2. and the grant is marked as a rental');

    const bob = await runAction({ ciphertext: envelopeRare, userAddress: BOB_ARCHIVIST });
    assert(bob.key === KEY_RARE, '3. the uploader receives the key without renting');
    assert(bob.grantedVia === 'uploader', '4. and the grant is marked as ownership');

    const stranger = await runAction({ ciphertext: envelopeRare, userAddress: STRANGER });
    assert(stranger.error === 'access_denied', '5. a stranger is denied');
    assert(stranger.key === undefined, '6. and no key travels alongside the error');
  }

  section('Key binding — the attack this envelope format exists to stop');
  {
    // Eve rented the cheap pamphlet, then submits the rare manuscript's
    // ciphertext. The hash is sealed inside it, so her rental cannot vouch for it.
    const eve = await runAction({ ciphertext: envelopeRare, userAddress: EVE_ATTACKER });
    assert(eve.error === 'access_denied', '7. renting book A does not unlock book B');

    const eveOwn = await runAction({ ciphertext: envelopeCheap, userAddress: EVE_ATTACKER });
    assert(eveOwn.key === KEY_CHEAP, '8. her own rental still works');
  }

  section('Fail closed');
  {
    const chain = defaultChain();
    chain.rentPaused = true;

    const alice = await runAction({ ciphertext: envelopeRare, userAddress: ALICE_RENTER }, chain);
    assert(alice.error === 'access_denied', '9. a paused Rent contract denies rather than grants');

    const bob = await runAction({ ciphertext: envelopeRare, userAddress: BOB_ARCHIVIST }, chain);
    assert(bob.key === KEY_RARE, '10. but the uploader is unaffected by Rent being paused');
  }

  section('Envelope integrity');
  {
    const v2 = seal({ v: 2, k: KEY_RARE, arweaveHash: HASH_RARE });
    assert(
      (await runAction({ ciphertext: v2, userAddress: ALICE_RENTER })).error === 'invalid_envelope_format',
      '11. an unknown envelope version is rejected'
    );

    const noHash = seal({ v: 1, k: KEY_RARE });
    assert(
      (await runAction({ ciphertext: noHash, userAddress: ALICE_RENTER })).error === 'invalid_envelope_format',
      '12. an envelope without its bound hash is rejected'
    );

    const noKey = seal({ v: 1, arweaveHash: HASH_RARE });
    assert(
      (await runAction({ ciphertext: noKey, userAddress: ALICE_RENTER })).error === 'invalid_envelope_format',
      '13. an envelope without a key is rejected'
    );

    assert(
      (await runAction({ ciphertext: envelopeRare, userAddress: '' })).error === 'missing_user_address',
      '14. a missing caller address is rejected before anything is unsealed'
    );
  }

  // The carve-out that makes review possible at all. A book inside its challenge
  // window is not rentable (Rent.rentBook requires Approved), so without this a
  // librarian is asked to judge a book they have no way to open.
  section('Librarian review access');
  {
    const granted = await runAction({ ciphertext: envelopeReview, userAddress: LIBRARIAN });
    assert(granted.key === KEY_REVIEW, '15. an active librarian can open a challengeable book');
    assert(
      granted.grantedVia === 'librarian_review',
      '16. and the grant says so, which is what watermarks the pages'
    );
  }

  section('Librarian review — every way it must be refused');
  {
    const expired = defaultChain();
    expired.stakes[HASH_REVIEW].timestamp = NOW - 15 * DAY; // window shut yesterday
    assert(
      (await runAction({ ciphertext: envelopeReview, userAddress: LIBRARIAN }, expired)).error === 'access_denied',
      '17. when the challenge window closes, so does access'
    );

    const unstaked = defaultChain();
    unstaked.librarians[LIBRARIAN.toLowerCase()].active = false;
    assert(
      (await runAction({ ciphertext: envelopeReview, userAddress: LIBRARIAN }, unstaked)).error === 'access_denied',
      '18. a librarian who unstaked is denied'
    );

    assert(
      (await runAction({ ciphertext: envelopeReview, userAddress: STRANGER })).error === 'access_denied',
      '19. a wallet that was never a librarian is denied'
    );

    const approved = defaultChain();
    approved.statuses[HASH_REVIEW] = STATUS_APPROVED;
    assert(
      (await runAction({ ciphertext: envelopeReview, userAddress: LIBRARIAN }, approved)).error === 'access_denied',
      '20. an approved book is catalogue, not review material — rent it like anyone else'
    );

    const stakeInactive = defaultChain();
    stakeInactive.stakes[HASH_REVIEW].active = false;
    assert(
      (await runAction({ ciphertext: envelopeReview, userAddress: LIBRARIAN }, stakeInactive)).error ===
        'access_denied',
      '21. no active stake means nothing to challenge, so nothing to review'
    );

    const reverting = defaultChain();
    reverting.stakeReverts = true;
    assert(
      (await runAction({ ciphertext: envelopeReview, userAddress: LIBRARIAN }, reverting)).error === 'access_denied',
      '22. an unreadable stake contract denies review, it does not assume it'
    );

    // The carve-out must not become a skeleton key for the rest of the library.
    assert(
      (await runAction({ ciphertext: envelopeRare, userAddress: LIBRARIAN })).error === 'access_denied',
      '23. a librarian cannot open an approved book they hold no rental for'
    );
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

run().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
