# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Context: Alexandria Frontend

This repository contains the **React frontend** for Alexandria, a decentralized, censorship-resistant Web3 library designed to preserve human knowledge permanently on Arweave.

The frontend is the user-facing layer — it handles wallet interactions, communicates with the backend API for uploads/search, and calls smart contracts directly for all on-chain transactions (staking, registration, rentals, payments). It also handles in-browser PDF decryption and display for rented books.

### Alexandria System Architecture (Full Stack)
- **Frontend (THIS REPO):** React + Vite (wallet connection, upload UI, search, rental, in-browser PDF decryption)
- **Backend Gateway:** Node.js + Express (upload orchestration, validation, encryption, Arweave storage, MongoDB indexing) — `AlexNode` repo
- **AI Validation:** Python + FastAPI (OCR/text extraction, content quality analysis, NLP-based checks) — separate service
- **Blockchain:** Base Testnet / Solidity (handles $ALEX token, archivist staking, time-bound rental permissions) — `AlexandriaSmartContract` repo
- **Storage:** Arweave via Irys (permanent encrypted file storage) + MongoDB (off-chain search indexing)

### Frontend Responsibilities
This app handles:
- **Wallet Connection:** MetaMask integration for signing on-chain transactions
- **Upload UI:** PDF file selection + metadata form, sends to backend, then handles on-chain staking and registration
- **Search & Browse:** Query the backend API, display paginated results with category filtering
- **Rental Flow:** Call smart contracts directly to rent books and process payments
- **PDF Decryption & Display:** Fetch encrypted PDFs from Arweave, retrieve decryption keys from Lit Protocol, decrypt in-browser, watermark, and display
- **Archivist Dashboard:** View own uploads, stake status, countdown to release, rental revenue
- **Librarian Dashboard:** Review flagged uploads, challenge suspicious content on-chain, claim rewards

### What the Frontend Does NOT Do
- **Validate PDFs** — backend handles all 5 validation layers
- **Encrypt PDFs** — backend generates symmetric keys and encrypts before Arweave upload
- **Upload to Arweave** — backend uploads encrypted PDFs via Irys
- **Store data** — backend manages MongoDB, frontend only reads via API
- **Listen to blockchain events** — backend event listener syncs on-chain state to MongoDB

## Key Flows

### Upload Flow (Archivist)
```
=== FRONTEND (UI + on-chain transactions) ===
1. Archivist selects PDF file and fills in metadata (title, author, category, description)
2. Frontend sends PDF + metadata + wallet address to backend: POST /api/upload
3. Backend validates → encrypts → uploads to Arweave → encrypts key with Lit Protocol
4. Backend saves to MongoDB with uploader wallet address and status "pending_stake"
5. Backend returns { arweaveHash, litEncryptedKeyId } to frontend

=== FRONTEND (on-chain, signed by archivist's wallet) ===
6. Frontend calls token.approve(stakeContractAddress, stakeAmount) — archivist signs
7. Frontend calls stake.stakeForUpload(arweaveHash, stakeAmount) — archivist signs
8. Frontend calls library.registerUpload(arweaveHash, metadata) — archivist signs
9. Backend event listener picks up on-chain events → updates MongoDB status to "pending"
10. Display confirmation with arweaveHash and stake status
```

### Rental Flow (Reader)
```
1. Reader searches for a book → frontend calls GET /api/search → displays results
2. Reader selects a book → frontend shows details (title, author, category, description)
3. Reader clicks rent → frontend calls rent.rentBook(arweaveHash, duration) — reader signs + pays $ALEX
4. payment.sol automatically splits the fees (archivist / protocol / librarian pool)
5. Rent.sol records: rentals[arweaveHash][readerAddress] = expiryTimestamp
```

### PDF Decryption & Display Flow (Reader — after rental)
```
1. Frontend downloads encrypted PDF directly from Arweave: fetch(https://arweave.net/{arweaveHash})
2. Frontend requests decryption key from Lit Protocol using litEncryptedKeyId
   → Lit checks on-chain: Rent.sol.isRentalActive(arweaveHash, readerAddress)
   → Rental is active → Lit releases the original symmetric key
3. Frontend decrypts PDF in browser memory using AES-256-GCM
4. Frontend watermarks every page (wallet address, rental date, expiry date, tx hash)
5. Frontend displays watermarked PDF in viewer
6. Frontend clears decrypted content from memory on page close or rental expiry
   → Decrypted PDF is NEVER saved to localStorage or disk
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
│   │   ├── api.js                  # Axios instance, backend API calls (upload, search, status)
│   │   ├── arweave.js              # Fetch encrypted PDFs from arweave.net/{hash}
│   │   ├── lit.js                  # Lit Protocol key retrieval with access conditions
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

# Lit Protocol
VITE_LIT_NETWORK=cayenne

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
- NEVER write to localStorage, sessionStorage, IndexedDB, or disk
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
- **Lit Protocol:** Frontend requests decryption keys directly from Lit. Lit checks `Rent.sol.isRentalActive()` on-chain before releasing keys. No backend involvement.
