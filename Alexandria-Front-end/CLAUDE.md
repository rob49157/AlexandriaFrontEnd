# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Context: Alexandria Frontend

This repository contains the **React frontend** for Alexandria, a decentralized, censorship-resistant Web3 library designed to preserve human knowledge permanently on Arweave.

The frontend is the user-facing layer — it handles wallet interactions, communicates with the backend API for uploads/search, and calls smart contracts directly for all on-chain transactions (staking, registration, rentals, payments). It also handles in-browser PDF decryption and display for rented books.

### Alexandria System Architecture (Full Stack)
- **Frontend (THIS REPO):** React + Vite (wallet connection, upload UI, search, rental, in-browser PDF decryption via WebCrypto)
- **Backend Gateway:** Node.js + Express (upload orchestration, validation, encryption, Arweave storage via Irys, PostgreSQL/Prisma indexing) — `AlexNode` repo
- **AI Validation:** Python + FastAPI (OCR/text extraction, content quality analysis, NLP-based checks) — separate service
- **Blockchain:** Base Sepolia (84532) / Solidity (handles $ALEX token, archivist staking, time-bound rental permissions) — `AlexandriaSmartContract` repo
- **Storage:** Arweave via Irys (permanent encrypted file storage) + PostgreSQL on Neon (off-chain search indexing)

### Frontend Responsibilities
This app handles:
- **Wallet Connection:** MetaMask/Rabby integration for signing on-chain transactions on Base Sepolia
- **Upload UI:** PDF file selection + metadata form, sends to backend, then handles on-chain staking
- **Search & Browse:** Query the backend API, display paginated results with category filtering
- **Rental Flow:** Call smart contracts directly to rent books with $ALEX
- **PDF Decryption & Display:** Fetch encrypted PDFs from Arweave/Irys, retrieve symmetric key from Lit Protocol TEE, decrypt in-browser memory via WebCrypto, watermark, and display
- **Archivist Dashboard:** View own uploads, stake status, countdown to release, rental revenue
- **Librarian Dashboard:** Review flagged uploads, challenge suspicious content on-chain, claim rewards

### What the Frontend Does NOT Do
- **Validate PDFs** — backend handles all 5 validation layers
- **Encrypt PDFs** — backend generates symmetric keys and encrypts before Arweave upload
- **Upload to Arweave** — backend uploads encrypted PDFs via Irys
- **Register uploads on-chain** — backend registrar wallet registers uploads to AlexandriaLibrary
- **Store data** — backend manages PostgreSQL, frontend only reads via API
- **Listen to blockchain events** — backend event listener syncs on-chain state to PostgreSQL

## Key Flows

### Upload Flow (Archivist)
```
=== FRONTEND (UI + on-chain transactions) ===
0. Upload page shows the wallet's limits first (GET /api/upload/quota/:address):
   uploads waiting for a stake (max 3, each with "Stake now →"/"View progress →"),
   uploads in the last 24 h (max 10), and the shared daily storage budget. At a
   limit the button is disabled and the reason shown.
1. Archivist selects PDF file and fills in metadata (title, author, category, description)
2. The wallet signs an EIP-4361 message naming the PDF's SHA-256
   (buildUploadMessage in src/services/unlockMessage.js); frontend sends PDF +
   metadata + wallet address + authMessage + authSignature: POST /api/upload
3. Backend checks the signature and limits → validates → encrypts (AES-256) → signs the Arweave L1 tx → seals key envelope in Lit TEE → indexes in Postgres → posts to Arweave (202); a worker stores it and registers it on AlexandriaLibrary
4. Frontend polls GET /api/storage/:arweaveHash until status is "pending"

=== FRONTEND (on-chain, signed by archivist's wallet) ===
5. Frontend calls token.approve(stakeContractAddress, 100 ALEX) — archivist signs
6. Frontend calls stake.stake(arweaveHash, 100 ALEX) — archivist signs
7. Backend event listener picks up on-chain Staked event → updates status
8. Display confirmation with arweaveHash and stake status
```

### Rental Flow (Reader)
```
1. Reader searches for a book → frontend calls GET /api/search → displays results
2. Reader selects a book → frontend calls GET /api/rental/book/:hash → shows details & price
3. Reader selects duration (1, 7, or 30 days) and clicks rent
4. Frontend calls token.approve(rentContractAddress, totalPrice) — reader signs
5. Frontend calls rent.rentBook(arweaveHash, durationSeconds) — reader signs
6. Rent.sol records active rental on-chain
```

### PDF Decryption & Display Flow (Reader — after rental)
```
1. Frontend downloads the ciphertext through the backend: GET /api/storage/{arweaveHash}/data
   (raw Arweave nodes are plain HTTP; the backend proof-checks every chunk)
2. Frontend requests decryption parameters from backend: GET /api/rental/decrypt-params/{arweaveHash}/{readerAddress}
   → also the free access check: a 403/409 deletes any key this browser kept for the book
3. If this browser kept the key for this wallet and book (src/services/keyStore.js,
   IndexedDB, non-extractable CryptoKey, until the access ends), use it: no
   signature, no Lit call. Otherwise unlock it (src/services/lit.js → unlockBookKey)
   and keep it:
   → creates a non-extractable RSA-OAEP key pair for this read (the "session key")
   → the reader signs an EIP-4361 message (src/services/unlockMessage.js) naming
     their wallet, sha256(sealed key), sha256(session public key), localhost:5173,
     chain 84532, and a 5-minute window
   → POST /api/rental/unlock/{arweaveHash} — the backend checks it and relays it to Lit
   → Decryption Lit Action (src/services/litAction.js) recovers the wallet from the
     signature, unseals the envelope, gates on the sealed arweaveHash (rental /
     uploader who STAKED the book / librarian review, two RPC providers must agree), and returns k
     WRAPPED to the session public key — never in the clear
   → browser unwrapKey()s it straight into a non-extractable AES-GCM CryptoKey
4. Frontend decrypts PDF in browser memory using WebCrypto subtle.decrypt (AES-256-GCM)
5. Frontend watermarks every page (wallet address, rental date, expiry date)
6. Frontend displays watermarked PDF in viewer
7. Frontend clears decrypted content from memory on component unmount, tab close, or rental expiry
   → Decrypted PDF is NEVER saved to localStorage, IndexedDB, or disk
```

### Challenge Flow (Librarian)
```
1. Librarian views pending/flagged uploads on dashboard
2. Librarian reviews content and decides to challenge
3. Frontend calls stake.challengeUpload(arweaveHash, reason) — librarian signs
4. Upload status changes to "challenged" on-chain
5. Admin/DAO resolves challenge → stake released or slashed
6. Librarian claims rewards: stake.claimLibrarianRewards() — librarian signs
```

## Environment & Tooling

- **Runtime:** Node.js v18+ (managed via nvm)
- **Module System:** ES Modules (`"type": "module"` in package.json)
- **Framework:** React 19 + Vite 7
- **Language:** JavaScript (JSX)
- **Linting:** ESLint with React hooks/refresh plugins
- **Global Installs Blocked:** Always use `npx` for CLI tools

### Expected Dependencies
```
# Core (already installed)
react                    — UI framework
react-dom                — React DOM renderer
vite                     — Build tool and dev server

# Routing
react-router-dom         — Client-side routing

# Web3 / Blockchain
ethers                   — Smart contract interaction (read + write, user's wallet signs)
@lit-protocol/lit-node-client  — Lit Protocol SDK for key retrieval
@lit-protocol/constants        — Lit Protocol chain/network constants

# HTTP
axios                    — HTTP client for backend API calls

# PDF
pdfjs-dist               — PDF rendering in browser
pdf-lib                  — PDF manipulation for watermarking

# UI (TBD — pick one)
tailwindcss              — Utility-first CSS (or alternative)

# Dev (already installed)
eslint                   — Linting
@vitejs/plugin-react     — Vite React plugin
```

## Development Commands

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview

# Lint
npm run lint
```

## Project Structure (Planned)

```
Alexandria-Front-end/
├── index.html                      # HTML entry point
├── package.json
├── vite.config.js
├── .env.example                    # Template for required environment variables
│
├── public/
│   └── assets/                     # Static assets (logos, icons)
│
├── src/
│   ├── main.jsx                    # React DOM entry point
│   ├── App.jsx                     # Root component, routing setup
│   │
│   ├── config/
│   │   ├── contracts.js            # Contract addresses + ABIs
│   │   └── lit.js                  # Lit Protocol configuration
│   │
│   ├── context/
│   │   └── WalletContext.jsx       # Wallet connection state (provider, signer, address)
│   │
│   ├── hooks/
│   │   ├── useWallet.js            # Wallet connection/disconnection
│   │   ├── useContracts.js         # Smart contract instances (token, stake, library, rent, payment)
│   │   ├── useUpload.js            # Upload flow (backend API + on-chain calls)
│   │   ├── useSearch.js            # Search API calls
│   │   ├── useRental.js            # Rental flow (smart contract + Lit + decryption)
│   │   └── useLitProtocol.js       # Lit Protocol key retrieval
│   │
│   ├── pages/
│   │   ├── Home.jsx                # Landing page, search bar
│   │   ├── Search.jsx              # Search results, category filters, pagination
│   │   ├── BookDetail.jsx          # Single book view, rent button
│   │   ├── Upload.jsx              # Archivist upload form
│   │   ├── Reader.jsx              # PDF viewer (decryption + watermark + display)
│   │   ├── ArchivistDashboard.jsx  # Archivist's uploads, stakes, revenue
│   │   └── LibrarianDashboard.jsx  # Flagged uploads, challenge UI, rewards
│   │
│   ├── components/
│   │   ├── WalletButton.jsx        # Connect/disconnect wallet
│   │   ├── SearchBar.jsx           # Search input
│   │   ├── BookCard.jsx            # Book preview card in search results
│   │   ├── UploadForm.jsx          # PDF file input + metadata fields
│   │   ├── PDFViewer.jsx           # Watermarked PDF display
│   │   ├── RentalTimer.jsx         # Rental expiry countdown
│   │   ├── StakeStatus.jsx         # Stake status display with countdown
│   │   └── TransactionStatus.jsx   # Pending/confirmed transaction feedback
│   │
│   ├── services/
│   │   ├── api.js                  # Backend API calls (upload, quota, search, storage, decrypt-params, unlock)
│   │   ├── lit.js                  # unlockBookKey: session key, signed unlock, relay, unwrap
│   │   ├── litAction.js            # The decryption Lit Action (security code; its CID is what Lit permits)
│   │   ├── unlockMessage.js        # EIP-4361 messages the wallet signs: unlock and upload
│   │   ├── keyStore.js             # Book keys kept in IndexedDB (non-extractable) until access ends
│   │   └── decryption.js           # AES-256-GCM decryption in browser
│   │
│   ├── utils/
│   │   ├── watermark.js            # PDF watermarking (wallet address, dates, tx hash)
│   │   ├── formatters.js           # Address truncation, date formatting, token amounts
│   │   └── constants.js            # Allowed categories, rental durations, etc.
│   │
│   └── styles/
│       ├── index.css               # Global styles
│       └── ...                     # Component/page styles
```

## Environment Variables

```bash
# Backend API
VITE_API_URL=http://localhost:3001/api

# Blockchain (Base Testnet / Sepolia)
VITE_CHAIN_ID=84532
VITE_RPC_URL=https://sepolia.base.org
VITE_TOKEN_CONTRACT_ADDRESS=
VITE_LIBRARY_CONTRACT_ADDRESS=
VITE_STAKE_CONTRACT_ADDRESS=
VITE_RENT_CONTRACT_ADDRESS=
VITE_PAYMENT_CONTRACT_ADDRESS=

# Lit Protocol — nothing in the bundle. Unlocks go through the backend relay,
# and the PKP id is a constant in src/services/litAction.js. LIT_GROUP_ID is for
# `npm run lit:register` only; that script asks for its Lit key at a hidden prompt
# and refuses to run if LIT_API_KEY is set, so the key never lands in .env.
# .env is gitignored and untracked (KEY-BINDING.md F7): copy .env.example.

# Arweave
VITE_ARWEAVE_GATEWAY=https://arweave.net
```

Note: Vite requires the `VITE_` prefix for environment variables to be exposed to the client.

## Smart Contract Integration

The frontend calls smart contracts directly using ethers.js with the user's wallet (MetaMask) as the signer. The backend never writes to the blockchain.

### Contracts the Frontend Interacts With
```javascript
// token.sol — $ALEX ERC20
token.approve(stakeContractAddress, amount)     // Before staking
token.balanceOf(userAddress)                    // Display balance

// library.sol — Upload registry
library.registerUpload(arweaveHash, metadata)   // After backend returns arweaveHash
library.getUpload(arweaveHash)                  // View upload details

// stake.sol — Staking & validation
stake.stakeForUpload(arweaveHash, amount)       // Lock tokens for 14-day validation
stake.getStakeStatus(arweaveHash)               // View stake state
stake.challengeUpload(arweaveHash, reason)      // Librarian challenges
stake.claimLibrarianRewards()                   // Librarian withdraws rewards

// Rent.sol — Rental permissions
rent.rentBook(arweaveHash, duration)            // Reader rents (pays $ALEX)
rent.isRentalActive(arweaveHash, userAddress)   // Check active rental

// payment.sol — Revenue (called indirectly via rentBook)
// Splits happen automatically on-chain
```

### Contract ABIs
ABIs are generated by `npx hardhat compile` in the `AlexandriaSmartContract` repo. Copy the relevant JSON ABI files into `src/config/contracts.js` after each contract deployment.

## PDF Decryption & Security

### In-Browser Decryption Rules
- Decrypted PDF exists **only in browser memory** (ArrayBuffer/Blob)
- NEVER write the decrypted PDF to localStorage, sessionStorage, IndexedDB, or disk
- The book's AES key may be kept in IndexedDB ONLY as a non-extractable CryptoKey,
  per wallet + book, until the access ends (src/services/keyStore.js) — never as
  bytes, never in localStorage. Non-extractable binds scripts, not the disk: the
  browser writes the bytes into its profile (see AlexNode/KEY-BINDING.md, R3)
- Clear decrypted content from memory on page close, tab switch, or rental expiry
- Use `URL.revokeObjectURL()` to clean up blob URLs after display

### Watermarking (Every Page)
```javascript
// Before displaying the decrypted PDF, inject watermark on every page:
{
  walletAddress: "0x1234...5678",       // Renter's wallet (traceable)
  rentalDate: "2026-02-24",            // When rental started
  expiryDate: "2026-03-03",            // When rental expires
  transactionHash: "0xabcd..."         // On-chain rental tx (proof)
}
// Format: "Licensed to: 0x1234...5678 | Rental: 2026-02-24 | Expires: 2026-03-03"
```

### Why Watermarking Matters
- One symmetric key per book — if the key leaks, watermarking traces the leak to a specific wallet
- Social/legal consequences for leakers
- Economic disincentive (lose stake, get blacklisted)

## Wallet Integration

### MetaMask Connection
- Detect if MetaMask is installed (`window.ethereum`)
- Request account access (`eth_requestAccounts`)
- Get signer for transaction signing
- Listen for account/chain changes
- Verify user is on Base Sepolia (chain ID 84532), prompt to switch if not

### Wallet Address in Upload Requests
The frontend includes the connected wallet address in upload requests so the backend can associate the upload with the archivist in MongoDB. This is not cryptographic auth — the real proof of ownership happens on-chain when the archivist stakes with their wallet.
```javascript
// Include wallet address in the upload form data
formData.append('walletAddress', address);
```

## Relationship to Other Repos

- **AlexNode (Backend):** Frontend calls the backend REST API for uploads (`POST /api/upload`) and search (`GET /api/search`). Backend returns `{ arweaveHash, litEncryptedKeyId }` after processing uploads. Frontend does NOT call the backend for rentals or payments.
- **AlexandriaSmartContract:** Frontend needs contract ABIs and deployed addresses. ABIs come from `npx hardhat compile` in that repo. Frontend calls contracts directly with the user's wallet for all on-chain transactions.
- **Arweave:** Frontend fetches encrypted PDFs directly from `https://arweave.net/{arweaveHash}`. No backend involvement.
- **Lit Protocol:** The decryption Lit Action lives here (`src/services/litAction.js`), but requests reach Lit through the backend relay (`POST /api/rental/unlock/:arweaveHash`), which holds the only key that can run it and rate-limits it. The Action checks the chain itself and answers with the key wrapped to the reader's session key, so the relay never sees a usable key. Every edit to the Action changes its CID: run `npm run test:lit-action`, re-pass the checklist in `AlexNode/KEY-BINDING.md`, `npm run lit:register`, then set `LIT_DECRYPT_ACTION_CID` in the backend.
