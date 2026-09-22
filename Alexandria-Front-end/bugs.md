# Alexandria Frontend & Backend Bug Tracker & Technical Roadmap

This document outlines reported issues, architectural root causes, and action items for the Alexandria Web3 Library platform. Issues are organized by functional domain.

---

## 1. Librarian Dashboard Issues & Enhancements

The Librarian Dashboard is responsible for content curation, upload reviews, quality audit inspection, and challenge submissions.

### 1.1 Review Queue Sync (Newly Uploaded Books Missing)
* **Problem Description:** When an archivist uploads a book for testing, it does not appear in the Librarian review queue on the dashboard (`/dashboard/librarian`).
* **Root Cause Analysis:**
  * **Frontend:** [LibrarianDashboard.jsx](file:///c:/Users/rober/OneDrive/Documents/GitHub/AlexandriaFrontEnd/Alexandria-Front-end/src/pages/LibrarianDashboard.jsx) uses a static in-memory array (`MOCK_QUEUE`) containing 4 mock books (`ar_sus01`, `ar009`, `ar007`, `ar004`). It does not initiate any API call to fetch actual pending uploads.
  * **Backend / API:** The search endpoint (`GET /api/search`) returns public catalog items, but there is no dedicated API route for fetching unapproved or flagged uploads requiring librarian intervention.
* **Action Items:**
  * **[Backend]** Implement `GET /api/librarian/review-queue` in `AlexNode` to query PostgreSQL/MongoDB for uploads with status `pending_review` or `flagged`.
  * **[Frontend]** Replace `MOCK_QUEUE` in `LibrarianDashboard.jsx` with an API call to `GET /api/librarian/review-queue`.
  * **[Frontend]** Add polling or real-time event updates so newly submitted uploads appear immediately on the queue.

---

### 1.2 AI Verification & Metric Scoring Ambiguity (`12/100 (AI)`)
* **Problem Description:** The dashboard displays single composite scores like `12/100 (AI)` or `50/100`, but these numbers are opaque and confusing. Librarians cannot tell what a score means (e.g., does 50/100 indicate a virus/malware threat, a near-duplicate of an existing book via SimHash, or bad OCR text quality?).
* **Technical Reality vs UI Representation:**
  * **SimHash Is Not a 0–100 Score:** In the backend (`AlexNode`), near-duplicate detection uses a 64-bit SimHash fingerprint. Similarity is measured by **Hamming distance** (bit difference ≤ 3 out of 64 bits = near-duplicate), NOT a percentage or score out of 100.
  * **ClamAV Security Scan Is Binary:** Virus scanning returns a pass/fail status (clean vs infected), which cannot be mapped to a linear score out of 100 without losing critical safety information.
  * **OCR / NLP Content Quality:** OCR text density and gibberish detection measure text readability and formatting.
  * **The Problem with 0–100 UI Scores:** Merging security scans, SimHash Hamming distance, and OCR quality into a single arbitrary `50/100` score masks the actual reason an upload was flagged and provides zero guidance on what the librarian should actually look for.
* **Action Items & UX Improvement:**
  * **[Backend]** Refactor review queue API payload to return categorized audit flags instead of a generic number:
    ```json
    {
      "securityStatus": "CLEAN", // CLEAN | MALWARE_DETECTED
      "simHashMatch": {
        "isDuplicate": true,
        "matchedBookTitle": "Gray's Anatomy (1918 ed.)",
        "hammingDistance": 2, // 2 bits difference out of 64
        "similarityPct": 96.8
      },
      "ocrQuality": 42, // Extracted text readability percentage
      "flags": ["NEAR_DUPLICATE", "LOW_OCR_QUALITY"]
    }
    ```
  * **[Frontend]** Replace static `X/100` score pills with **Categorized Audit Badges & Risk Breakdown Cards**:
    * **Malware Badge:** `[🛡️ Clean]` or `[🚨 Virus Flagged]`
    * **SimHash Duplicate Badge:** `[📄 96.8% Duplicate match with "Book Title"]`
    * **OCR Quality Badge:** `[🔍 Low Text Quality (42%)]`
  * **[Frontend Guidance]** Add hover tooltips and an explicit **Audit Summary Callout** telling the librarian *exactly* why the book was queued (e.g., *"Flagged: High similarity to existing catalog item #ar009. Check for duplicate re-upload before approving."*).

---

### 1.3 Book Inspection & Content Preview Before Challenging
* **Problem Description:** Librarians cannot inspect or read the content of uploaded books prior to challenging them, making it impossible to evaluate legitimate flag reasons.
* **Root Cause Analysis:**
  * **Frontend:** `LibrarianDashboard.jsx` only shows metadata (Title, Author, Category, Uploader Address, AI Score). There is no "View Book" or "Inspect Content" button.
  * **Encryption Constraints:** Uploaded PDFs are AES-256 encrypted on Arweave. Key access via Lit Protocol currently requires an active on-chain rental (`Rent.sol.isRentalActive()`), which librarians do not possess for unreleased/pending books.
* **Action Items:**
  * **[Backend / Lit Protocol]** Configure a **Librarian Access Provision** in Lit Protocol TEE or backend preview service allowing wallets with active librarian stakes (`stakeContract.librarians(address).active == true`) to decrypt a watermarked preview/excerpt.
  * **[Frontend]** Add an **"Inspect Book" / "Preview Document"** modal to `LibrarianDashboard.jsx` utilizing `PDFViewer.jsx` with librarian-specific watermarking (*"Librarian Review Copy — Wallet 0x..."*).

---

### 1.4 Challenge Governance & Resolution Workflow
* **Problem Description:** Who reviews challenges submitted by librarians, and where are dispute resolutions processed?
* **Root Cause Analysis:**
  * **Frontend:** When a librarian challenges an upload (`stake.challengeUpload(arweaveHash, reason)`), `LibrarianDashboard.jsx` executes a placeholder timeout and updates local state.
  * **Governance Gap:** On-chain (`AlexandriaStake.sol`), challenging sets the upload status to `challenged`. However, there is no UI or dashboard for DAO members/Admins to review evidence and vote to slash stakes or dismiss challenges.
* **Action Items:**
  * **[Frontend & Backend]** Build a dedicated **Dispute Resolution / Governance Panel** (`/dashboard/disputes` or `/dashboard/admin`).
  * **Workflow:**
    1. **Submission:** Librarian challenges upload on-chain with evidence reason.
    2. **Review:** Challenged item appears in the Dispute Resolution Panel.
    3. **Resolution:** Authorized DAO/Admin/Arbitrator wallets vote to **Confirm Challenge** (slashing archivist stake, rewarding librarian) or **Dismiss Challenge** (releasing archivist stake to public library).

---

## 2. Archivist Dashboard Issues

### 2.1 My Uploads Not Visible for Connected Wallet
* **Problem Description:** On the Archivist Dashboard (`/dashboard/archivist`), archivists cannot see books they uploaded with their connected wallet.
* **Root Cause Analysis:**
  * **Frontend Query Mismatch:** [ArchivistDashboard.jsx](file:///c:/Users/rober/OneDrive/Documents/GitHub/AlexandriaFrontEnd/Alexandria-Front-end/src/pages/ArchivistDashboard.jsx) queries `searchBooks({ status: '', limit: 100 })` and filters client-side by `b.uploader.toLowerCase() === userAddr`.
  * **Limitations of Current Approach:**
    * `/api/search` only returns active/approved catalog items, excluding uploads in `pending_stake` or `pending_review` states.
    * If total catalog items exceed 100, an archivist's uploads may be paginated out.
  * **Fallback Behavior:** When `myUploads` returns empty, `ArchivistDashboard.jsx` falls back to displaying hardcoded mock data (`On the Origin of Species`), creating confusion.
* **Action Items:**
  * **[Backend]** Create a dedicated API route `GET /api/upload/user/:walletAddress` in `AlexNode` that fetches all uploads for a specific address across all statuses (`pending_stake`, `pending_review`, `approved`, `challenged`, `rejected`).
  * **[Frontend]** Update `ArchivistDashboard.jsx` to fetch directly from `GET /api/upload/user/${address}`.
  * **[Frontend]** Remove the mock data fallback (`DEFAULT_UPLOADS`). Display a proper empty state (*"No uploads found for this wallet. Upload a book to get started!"*) when no uploads exist.

---
