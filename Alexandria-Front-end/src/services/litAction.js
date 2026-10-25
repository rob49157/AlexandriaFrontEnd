// Decryption Lit Action for Alexandria — the only copy.
//
// This script runs inside the Lit Protocol TEE (Trusted Execution Environment).
// It proves who is asking, unseals the PKP-encrypted envelope, reads the
// arweaveHash sealed inside it, checks on-chain permission, and releases the
// book's AES key ONLY wrapped to a key held by the reader's browser.
//
// The browser builds the request and the backend relays it to Lit with a key
// that can run nothing but this Action (KEY-BINDING.md R4). Lit hashes this exact
// source into an IPFS CID and refuses any CID its group does not permit. The
// relay only ever sees the wrapped key, which it cannot open.
//
// ─── Key Invariants ─────────────────────────────────────────────────────────
// 1. Envelope unsealed for its hash: the authorization subject is read from the
//    decrypted envelope, never from a parameter (KEY-BINDING.md, "The vulnerability").
// 2. Identity from a signature: the reader's address is recovered from an EIP-4361
//    message they signed, never taken from a parameter. The message binds this
//    book's sealed key, this browser's session key, our domain, our chain, and a
//    window of at most 10 minutes measured on the chain's clock.
// 3. Nothing is unsealed until the caller has proven who they are.
// 4. The PKP is a constant here, so it is part of the reviewed CID.
// 5. Two independent RPC providers: a fact counts only if both report it. One
//    provider lying, or down, cannot unlock a book.
// 6. Fail closed: every unexpected state answers { error } and stops. A contract
//    read that reverts (e.g. Rent paused) counts as "no".
// 7. The key never leaves in the clear: it is RSA-OAEP-encrypted to the session
//    public key named in the signed message.
// 8. Uploader carve-out: archivists cannot rent their own books (Rent.sol reverts),
//    so library.getUploader(hash) === reader is let through without a rental —
//    but only if that reader also staked the book. Registration is automatic, so
//    without the stake anyone could upload a PDF, never stake, and read on
//    Alexandria's credit. stake() records the staker, and the record outlives
//    unstake() and slashing, so an approved book stays readable by its archivist.
// 9. Librarian review carve-out: a book is not rentable during its challenge
//    window, yet a librarian must read it to judge it. An ACTIVE librarian may open
//    a book that is still challengeable — the same facts
//    AlexandriaStake.challengeUpload() requires. Access ends when the window does.
//
// ─── Editing this file ──────────────────────────────────────────────────────
// Any edit changes the IPFS CID, and the old CID is what the PKP permits. So:
//   1. npm run test:lit-action   — the gate is security code; prove it still refuses
//   2. re-pass the checklist in AlexNode/KEY-BINDING.md
//   3. npm run lit:register      — register and permit the new CID
//   4. set LIT_DECRYPT_ACTION_CID in AlexNode/.env, or the relay refuses the new code

export const BASE_SEPOLIA_CHAIN_ID = 84532;
// Both are asked every question. Same pair the backend fails over between.
export const BASE_SEPOLIA_RPC_URLS = ['https://base-sepolia-rpc.publicnode.com', 'https://sepolia.base.org'];

export const RENT_CONTRACT_ADDRESS = '0xe50AD653Ee690c818900091a4d69F22e484bD2cD';
export const LIBRARY_CONTRACT_ADDRESS = '0x0b26AB8C632586E846DE87D29D665fd727bBe844';
export const STAKE_CONTRACT_ADDRESS = '0xe3027D298450695d9c4eD9A071D34e2921fc567C';

// The PKP that seals every envelope. Public; it is a wallet address. Minted on the
// new Lit account (2026-10-24, AlexNode/scripts/lit-new-account.mjs); must equal
// LIT_PKP_ID in AlexNode/.env. Envelopes sealed by the old PKP no longer open.
export const LIT_PKP_ID = '0x371552a274c88976bfb7b13c46f0214b34fb8efe';

// host[:port] of every site allowed to ask for a signature. A new host means a
// new CID. Vite is pinned to 5173 (vite.config.js) so this stays true in dev.
export const UNLOCK_ALLOWED_DOMAINS = ['localhost:5173'];
export const MAX_UNLOCK_WINDOW_SECONDS = 600;
export const MAX_CLOCK_SKEW_SECONDS = 60;

// AlexandriaLibrary.UploadStatus — a book is only reviewable while Pending.
export const UPLOAD_STATUS_PENDING = 0;

// String.raw keeps the regex backslashes intact in the shipped source.
export const LIT_DECRYPT_ACTION_CODE = String.raw`
const PKP_ID = '${LIT_PKP_ID}';
const CHAIN_ID = ${BASE_SEPOLIA_CHAIN_ID};
const RPC_URLS = ${JSON.stringify(BASE_SEPOLIA_RPC_URLS)};
const ALLOWED_DOMAINS = ${JSON.stringify(UNLOCK_ALLOWED_DOMAINS)};
const MAX_WINDOW = ${MAX_UNLOCK_WINDOW_SECONDS};
const MAX_SKEW = ${MAX_CLOCK_SKEW_SECONDS};
const STATEMENT = 'Unlock one Alexandria book for reading.';
const TIME = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,3})?Z$/;

// EIP-4361, exactly the shape src/services/unlockMessage.js builds. Anything
// else, including extra optional fields, is refused rather than interpreted.
function parseUnlockMessage(text) {
  if (text.indexOf('\r') !== -1) return null;
  const lines = text.split('\n');
  if (lines.length !== 14) return null;

  const header = /^([A-Za-z0-9.-]+(?::[0-9]{1,5})?) wants you to sign in with your Ethereum account:$/.exec(lines[0]);
  if (!header) return null;
  if (!/^0x[0-9a-fA-F]{40}$/.test(lines[1])) return null;
  if (lines[2] !== '' || lines[3] !== STATEMENT || lines[4] !== '') return null;

  const field = (line, name, pattern) => {
    const prefix = name + ': ';
    if (line.indexOf(prefix) !== 0) return null;
    const value = line.slice(prefix.length);
    return pattern.test(value) ? value : null;
  };
  const uri = field(lines[5], 'URI', /^https?:\/\/\S+$/);
  const version = field(lines[6], 'Version', /^1$/);
  const chainId = field(lines[7], 'Chain ID', /^[0-9]{1,12}$/);
  const nonce = field(lines[8], 'Nonce', /^[A-Za-z0-9]{8,64}$/);
  const issuedAt = field(lines[9], 'Issued At', TIME);
  const expirationTime = field(lines[10], 'Expiration Time', TIME);
  const sealed = /^- urn:alexandria:sealed-key:sha256:([0-9a-f]{64})$/.exec(lines[12]);
  const session = /^- urn:alexandria:session-key:sha256:([0-9a-f]{64})$/.exec(lines[13]);
  if (!uri || !version || !chainId || !nonce || !issuedAt || !expirationTime) return null;
  if (lines[11] !== 'Resources:' || !sealed || !session) return null;

  const domain = header[1];
  if (uri !== 'http://' + domain && uri !== 'https://' + domain) return null;

  const issued = Date.parse(issuedAt) / 1000;
  const expires = Date.parse(expirationTime) / 1000;
  if (!Number.isFinite(issued) || !Number.isFinite(expires) || expires <= issued) return null;

  return {
    domain,
    address: lines[1],
    chainId: Number(chainId),
    issuedAt: Math.floor(issued),
    expirationTime: Math.floor(expires),
    sealedKeyHash: sealed[1],
    sessionKeyHash: session[1],
  };
}

function sha256Hex(bytes) {
  return ethers.utils.sha256(bytes).slice(2).toLowerCase();
}

// What one provider says this reader may do. Each read fails closed on its own:
// a revert (Rent paused, unknown book) or an outage is a "no", never an error
// that skips the remaining checks.
async function readAccess(provider, arweaveHash, user, now) {
  const rent = new ethers.Contract(
    '${RENT_CONTRACT_ADDRESS}',
    ['function isRentalActive(string,address) view returns (bool)'],
    provider
  );
  const library = new ethers.Contract(
    '${LIBRARY_CONTRACT_ADDRESS}',
    [
      'function getUploader(string) view returns (address)',
      'function getUploadStatus(string) view returns (uint8)'
    ],
    provider
  );
  const stake = new ethers.Contract(
    '${STAKE_CONTRACT_ADDRESS}',
    [
      'function librarians(address) view returns (uint256,uint256,bool)',
      'function stakes(string) view returns (address,uint256,uint256,bool)',
      'function CHALLENGE_PERIOD() view returns (uint256)'
    ],
    provider
  );

  const view = { rented: false, owner: false, review: false };

  try {
    view.rented = (await rent.isRentalActive(arweaveHash, user)) === true;
  } catch (err) {
    view.rented = false;
  }

  try {
    const uploader = await library.getUploader(arweaveHash);
    if (typeof uploader === 'string' && uploader.toLowerCase() === user.toLowerCase()) {
      // stakes() → (staker, amount, timestamp, active). An unstaked book's staker
      // is the zero address, which no signature recovers to.
      const stakeInfo = await stake.stakes(arweaveHash);
      view.owner = typeof stakeInfo[0] === 'string' && stakeInfo[0].toLowerCase() === user.toLowerCase();
    }
  } catch (err) {
    view.owner = false;
  }

  // Librarian review — only consulted when the cheaper checks fail. Mirrors
  // AlexandriaStake.challengeUpload(): an active librarian, an active stake, the
  // book still Pending, and the 14-day window still open on the chain's clock.
  if (!view.rented && !view.owner) {
    try {
      const librarian = await stake.librarians(user);
      // librarians() → (amount, timestamp, active)
      if (librarian[2] === true) {
        const stakeInfo = await stake.stakes(arweaveHash);
        // stakes() → (staker, amount, timestamp, active)
        const status = await library.getUploadStatus(arweaveHash);
        const challengePeriod = await stake.CHALLENGE_PERIOD();
        const windowEnds = stakeInfo[2].add(challengePeriod);
        view.review =
          stakeInfo[3] === true &&
          Number(status) === ${UPLOAD_STATUS_PENDING} &&
          windowEnds.gt(now);
      }
    } catch (err) {
      view.review = false;
    }
  }

  return view;
}

// Only ciphertext, authMessage, authSignature and sessionPublicKey are read.
// userAddress, pkpId, arweaveHash or anything else in js_params is ignored.
async function main({ ciphertext, authMessage, authSignature, sessionPublicKey }) {
  const respond = (body) => Lit.Actions.setResponse({ response: JSON.stringify(body) });

  // 1. Shape
  if (
    typeof ciphertext !== 'string' || !ciphertext || ciphertext.length > 20000 ||
    typeof authMessage !== 'string' || !authMessage || authMessage.length > 2000 ||
    typeof authSignature !== 'string' ||
    typeof sessionPublicKey !== 'string' || !sessionPublicKey || sessionPublicKey.length > 2000
  ) {
    respond({ error: 'missing_params' });
    return;
  }

  // 2. The signed message: format, site, chain
  const msg = parseUnlockMessage(authMessage);
  if (!msg) {
    respond({ error: 'auth_message_invalid' });
    return;
  }
  if (ALLOWED_DOMAINS.indexOf(msg.domain) === -1) {
    respond({ error: 'auth_domain' });
    return;
  }
  if (msg.chainId !== CHAIN_ID) {
    respond({ error: 'auth_chain' });
    return;
  }
  if (msg.expirationTime - msg.issuedAt > MAX_WINDOW) {
    respond({ error: 'auth_window_too_long' });
    return;
  }

  // 3. What the signature is for: this sealed key, this session key
  if (msg.sealedKeyHash !== sha256Hex(ethers.utils.toUtf8Bytes(ciphertext))) {
    respond({ error: 'auth_wrong_key' });
    return;
  }
  let sessionKeyBytes;
  try {
    sessionKeyBytes = ethers.utils.base64.decode(sessionPublicKey);
  } catch (err) {
    respond({ error: 'session_key_invalid' });
    return;
  }
  if (msg.sessionKeyHash !== sha256Hex(sessionKeyBytes)) {
    respond({ error: 'auth_session_key' });
    return;
  }

  // 4. Who is asking — the only identity this Action knows
  if (!/^0x[0-9a-fA-F]{130}$/.test(authSignature)) {
    respond({ error: 'bad_signature' });
    return;
  }
  let user;
  try {
    user = ethers.utils.verifyMessage(authMessage, authSignature);
  } catch (err) {
    respond({ error: 'bad_signature' });
    return;
  }
  if (typeof user !== 'string' || user.toLowerCase() !== msg.address.toLowerCase()) {
    respond({ error: 'auth_wallet_mismatch' });
    return;
  }

  let sessionKey;
  try {
    sessionKey = await crypto.subtle.importKey(
      'spki',
      sessionKeyBytes,
      { name: 'RSA-OAEP', hash: 'SHA-256' },
      false,
      ['encrypt']
    );
  } catch (err) {
    respond({ error: 'session_key_invalid' });
    return;
  }

  // 5. When — on the chain's clock. The two providers must agree to within
  //    MAX_SKEW, and "now" is the NEWER of the two: a provider that lags, or lies
  //    backwards, cannot revive an expired signature or reopen a review window.
  const providers = RPC_URLS.map(
    (url) => new ethers.providers.StaticJsonRpcProvider(url, { chainId: CHAIN_ID, name: 'base-sepolia' })
  );
  let times;
  try {
    const blocks = await Promise.all(providers.map((provider) => provider.getBlock('latest')));
    times = blocks.map((block) => Number(block.timestamp));
    if (times.some((t) => !Number.isFinite(t) || t <= 0)) throw new Error('no clock');
  } catch (err) {
    respond({ error: 'clock_unavailable' });
    return;
  }
  if (Math.max.apply(null, times) - Math.min.apply(null, times) > MAX_SKEW) {
    respond({ error: 'rpc_disagree' });
    return;
  }
  const now = Math.max.apply(null, times);
  if (msg.issuedAt > now + MAX_SKEW) {
    respond({ error: 'auth_not_yet_valid' });
    return;
  }
  if (now >= msg.expirationTime) {
    respond({ error: 'auth_expired' });
    return;
  }

  // 6. Unseal — only now, after the caller has proven who they are
  let envelope;
  try {
    const unsealed = await Lit.Actions.Decrypt({ pkpId: PKP_ID, ciphertext });
    if (typeof unsealed !== 'string') throw new Error('unexpected Decrypt result');
    envelope = unsealed;
  } catch (err) {
    respond({ error: 'unseal_failed' });
    return;
  }
  try {
    envelope = JSON.parse(envelope);
  } catch (err) {
    respond({ error: 'invalid_envelope_json' });
    return;
  }

  let keyBytes = null;
  if (
    envelope && envelope.v === 1 &&
    typeof envelope.k === 'string' && envelope.k &&
    typeof envelope.arweaveHash === 'string' && envelope.arweaveHash
  ) {
    try {
      keyBytes = ethers.utils.base64.decode(envelope.k);
    } catch (err) {
      keyBytes = null;
    }
  }
  if (!keyBytes || keyBytes.length !== 32) {
    respond({ error: 'invalid_envelope_format' });
    return;
  }

  // 7. The gate, for the hash sealed in the envelope and the recovered reader.
  //    A fact counts only if both providers report it.
  const views = await Promise.all(
    providers.map((provider) => readAccess(provider, envelope.arweaveHash, user, now))
  );
  const rented = views.every((v) => v.rented);
  const isOwner = views.every((v) => v.owner);
  const isLibrarianReview = views.every((v) => v.review);

  if (!rented && !isOwner && !isLibrarianReview) {
    const someProviderWouldGrant = views.some((v) => v.rented || v.owner || v.review);
    respond({ error: someProviderWouldGrant ? 'rpc_disagree' : 'access_denied' });
    return;
  }

  // 8. Release the key wrapped to the reader's session key — never in the clear.
  //
  // grantedVia is advisory, for the watermark the frontend stamps on every page:
  // a review copy has to be identifiable as one if it ever leaks. It is not a
  // second authorization — the gate above already decided.
  let wrapped;
  try {
    wrapped = await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, sessionKey, keyBytes);
  } catch (err) {
    respond({ error: 'wrap_failed' });
    return;
  }
  const grantedVia = rented ? 'rental' : isOwner ? 'uploader' : 'librarian_review';
  respond({ wrappedKey: ethers.utils.base64.encode(new Uint8Array(wrapped)), grantedVia });
}
`.trim();
