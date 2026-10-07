// Decryption Lit Action for Alexandria — the only copy.
//
// This script runs inside the Lit Protocol TEE (Trusted Execution Environment).
// It unseals the PKP-encrypted envelope, extracts the arweaveHash sealed inside,
// verifies on-chain permissions, and releases ONLY the symmetric AES-256 key if
// authorized.
//
// It lives in the frontend because the frontend is what executes it: the browser
// POSTs this source to Lit, which hashes those exact bytes into an IPFS CID and
// refuses to run a CID the PKP has not permitted. Nothing server-side is in the
// decryption path — the backend never sees a key and never runs this code.
//
// ─── Key Invariants ─────────────────────────────────────────────────────────
// 1. Envelope unsealed FIRST: The Action never trusts a caller-supplied hash.
//    The authorization subject is read directly from the decrypted envelope plaintext.
// 2. Uploader carve-out: Archivists cannot rent their own books (Rent.sol reverts).
//    The Action permits library.getUploader(hash) === userAddress without a rental.
// 3. Fail closed on revert: If Rent.sol reverts (e.g. paused), the check fails closed.
// 4. Librarian review carve-out: A librarian must read a book to judge it, but the
//    book is not rentable during its challenge window (Rent.rentBook requires
//    Approved), so there is no rental to buy even in good faith. The Action permits
//    an ACTIVE librarian to unlock a book that is still challengeable — the same
//    four facts AlexandriaStake.challengeUpload() itself requires. Access ends when
//    the window does, so this grants no standing access to the catalog.
//
// ─── Editing this file ──────────────────────────────────────────────────────
// Any edit changes the IPFS CID, and the old CID is what the PKP permits. So:
//   1. npm run test:lit-action   — the gate is security code; prove it still refuses
//   2. npm run lit:register      — register and permit the new CID
// Ship an edited Action without step 2 and every reader gets "action not permitted".

export const BASE_SEPOLIA_CHAIN_ID = 84532;
export const BASE_SEPOLIA_RPC = 'https://base-sepolia-rpc.publicnode.com';

export const RENT_CONTRACT_ADDRESS = '0xe50AD653Ee690c818900091a4d69F22e484bD2cD';
export const LIBRARY_CONTRACT_ADDRESS = '0x0b26AB8C632586E846DE87D29D665fd727bBe844';
export const STAKE_CONTRACT_ADDRESS = '0xe3027D298450695d9c4eD9A071D34e2921fc567C';

// AlexandriaLibrary.UploadStatus — a book is only reviewable while Pending.
export const UPLOAD_STATUS_PENDING = 0;

export const LIT_DECRYPT_ACTION_CODE = `
async function main({ pkpId, ciphertext, userAddress }) {
  if (!userAddress || typeof userAddress !== 'string') {
    Lit.Actions.setResponse({ response: JSON.stringify({ error: 'missing_user_address' }) });
    return;
  }

  // 1. Unseal the envelope inside the TEE
  let unsealedStr;
  try {
    const res = await Lit.Actions.Decrypt({ pkpId, ciphertext });
    unsealedStr = typeof res === 'string' ? res : (res.decrypted || res.plaintext || JSON.stringify(res));
  } catch (err) {
    Lit.Actions.setResponse({ response: JSON.stringify({ error: 'unseal_failed' }) });
    return;
  }

  // 2. Parse envelope and verify version
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

  // 3. Query on-chain permissions on Base Sepolia
  const provider = new ethers.providers.JsonRpcProvider('${BASE_SEPOLIA_RPC}');
  const rentContract = new ethers.Contract(
    '${RENT_CONTRACT_ADDRESS}',
    ['function isRentalActive(string,address) view returns (bool)'],
    provider
  );
  const libraryContract = new ethers.Contract(
    '${LIBRARY_CONTRACT_ADDRESS}',
    [
      'function getUploader(string) view returns (address)',
      'function getUploadStatus(string) view returns (uint8)'
    ],
    provider
  );
  const stakeContract = new ethers.Contract(
    '${STAKE_CONTRACT_ADDRESS}',
    [
      'function librarians(address) view returns (uint256,uint256,bool)',
      'function stakes(string) view returns (address,uint256,uint256,bool)',
      'function CHALLENGE_PERIOD() view returns (uint256)'
    ],
    provider
  );

  let isRented = false;
  try {
    isRented = await rentContract.isRentalActive(arweaveHash, userAddress);
  } catch (err) {
    // Revert occurs if contract is paused -> fail closed
    isRented = false;
  }

  let isOwner = false;
  try {
    const uploader = await libraryContract.getUploader(arweaveHash);
    isOwner = Boolean(uploader && uploader.toLowerCase() === user);
  } catch (err) {
    isOwner = false;
  }

  // 4. Librarian review carve-out — only consulted when the cheaper checks fail.
  //
  // Mirrors the preconditions of AlexandriaStake.challengeUpload(): an active
  // librarian, an active stake, the book still Pending, and the 14-day window
  // still open. A librarian can therefore unlock exactly the books they can still
  // act on, and nothing else in the catalog.
  //
  // "Now" is the latest block timestamp rather than the enclave clock, so this
  // and the contract agree on when the window shuts.
  let isLibrarianReview = false;
  if (!isRented && !isOwner) {
    try {
      const librarian = await stakeContract.librarians(userAddress);
      // librarians() → (amount, timestamp, active)
      if (librarian[2]) {
        const stakeInfo = await stakeContract.stakes(arweaveHash);
        // stakes() → (staker, amount, timestamp, active)
        const stakeActive = stakeInfo[3];
        const stakedAt = stakeInfo[2];

        const status = await libraryContract.getUploadStatus(arweaveHash);
        const challengePeriod = await stakeContract.CHALLENGE_PERIOD();
        const latestBlock = await provider.getBlock('latest');

        const windowEnds = stakedAt.add(challengePeriod);
        const windowOpen = windowEnds.gt(latestBlock.timestamp);

        isLibrarianReview =
          Boolean(stakeActive) &&
          Number(status) === ${UPLOAD_STATUS_PENDING} &&
          windowOpen;
      }
    } catch (err) {
      // Any unreadable contract state denies review access, exactly as a paused
      // Rent contract denies a rental.
      isLibrarianReview = false;
    }
  }

  // 5. Authorization gate
  if (!isRented && !isOwner && !isLibrarianReview) {
    Lit.Actions.setResponse({ response: JSON.stringify({ error: 'access_denied' }) });
    return;
  }

  // 6. Release ONLY the symmetric key.
  //
  // grantedVia is advisory, for the watermark the frontend stamps on every page:
  // a review copy has to be identifiable as one if it ever leaks. It is not a
  // second authorization — the gate above already decided.
  const grantedVia = isRented ? 'rental' : isOwner ? 'uploader' : 'librarian_review';
  Lit.Actions.setResponse({ response: JSON.stringify({ key: k, grantedVia }) });
}
`.trim();
