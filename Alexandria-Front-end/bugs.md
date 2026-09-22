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
* **Corrections to the analysis above (found while implementing):**
  * **No backend ever produced a score.** `aiScore` was a literal in the frontend's `MOCK_QUEUE`. There was nothing to refactor on the backend — the numbers were invented in the browser.
  * **A malware badge can never fire.** Layer 2 rejects infected or script-carrying PDFs during upload, before encryption and Arweave storage, so a flagged file is never stored and never reaches the queue. Every book here passed. The only fact left worth reporting is whether ClamAV was actually running — it is skipped when the daemon is offline, which is the normal case in dev.
  * **There is no OCR anywhere in the stack.** `ocrQuality` had no source: OCR and content-quality analysis belong to Tier 2 of the AI validator, which is still notes only (`Alex-AI-Validator/AI_VALIDATOR_NOTES.md`). What does exist is the text pdf-parse extracts at Layer 1, which was used for the fingerprint and then discarded.
  * **`similarityPct` recreates the original problem.** It is `(64 − distance) / 64`, so two unrelated books score ~50% and everything flagged lands between 95.3% and 100%. The UI reports bits instead.
* **Bug found and fixed along the way (`pageJoiner`):** pdf-parse appends `-- 3 of 212 --` after every page by default, and Layer 1 counted those markers as extracted text. Consequences: a scan with no OCR got a non-empty fingerprint, so the "no text, skip dedup" branch in `dedup.service.js` never ran; and any two scans with the same page count fingerprinted **identically**, flagging the second as a near-duplicate of the first. Fixed by extracting with `pageJoiner: ''`. Near-duplicate matches were also unsorted, so the stored `nearDuplicateOf` was not necessarily the closest match.
* **Implemented — Backend (`AlexNode`):**
  * New columns on `Upload` (all nullable; migration `20260922120000_add_upload_audit_fields`): `nearDuplicateDistance`, `clamavStatus`, `textWordCount`, `textlessPageCount`. The distance is backfilled from the stored fingerprints; the text counts cannot be backfilled, because the file on Arweave is encrypted.
  * Word counts are measured with SimHash's own `tokenize()`, so the number shown is exactly what the fingerprint was built from.
  * `GET /api/librarian/review-queue` returns an `audit` object per book. Matched books are named via one extra query for the whole page, and the fingerprint itself is never selected or sent.
    ```json
    "audit": {
      "flags": ["NEAR_DUPLICATE", "NO_TEXT_LAYER", "MOSTLY_TEXTLESS"],
      "security":  { "structuralScan": "passed", "clamav": "clean | not_run | unknown" },
      "duplicate": { "arweaveHash": "…", "title": "Gray's Anatomy", "status": "approved",
                     "sameUploader": false, "hammingDistance": 2, "threshold": 3 },
      "text": { "wordCount": 62000, "wordsPerPage": 310, "textlessPages": 0, "pageCount": 200 }
    }
    ```
* **Implemented — Frontend:** `src/components/AuditBadges.jsx` renders three chips (Safety, Duplicate, Text) plus a callout naming what to go and look at, with a "What was actually checked?" disclosure (a disclosure, not a hover tooltip, so it works on touch and by keyboard) and a "Use as challenge reason" button that seeds the on-chain reason with the evidence.
* **Deliberate wording choices:**
  * A book with no text layer shows **"Duplicate check skipped"**, never "No duplicate found" — the silence of a check that never ran is not a result.
  * Rows predating the new columns read **"not recorded"**, never "clean".
  * Unflagged books still get a line, because this queue holds *every* staked book in its window, not only suspicious ones: *"No automated flags. These checks cover file safety and duplicate text only…"*
* **Still open:** content quality, metadata accuracy, language and category verification remain unchecked — Tier 2 of the AI validator. The `flags` array takes new values without a shape change.

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
