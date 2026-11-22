// ── Watermarking ──────────────────────────────────────────────────
// One symmetric key protects a book for everyone who ever reads it, so if a
// copy leaks, the only thing that says who leaked it is the page itself. A
// librarian review copy is marked as such: it is a book nobody can rent yet, so
// a leaked one is traceable to the handful of wallets that could open it.
//
// A rental's footer also names the transaction that created the rental
// (decrypt-params `rentalTxHash`, from the BookRented event the backend indexes),
// so anyone holding a leaked page can look the rental up on Basescan. It is left
// out while the backend has not indexed the rental yet.
//
// The marks are text added to the page in the browser: a copy can be stripped
// of them, and the browser holds the clean PDF before they are added. Burning
// them into page images in a TEE is PAGE-RENDERING-PLAN.md §7.

import { PDFDocument, rgb, StandardFonts, degrees } from 'pdf-lib'

const FOOTER_SIZE = 6     // pt
const FOOTER_MARGIN = 10  // pt from the left and right edges
const FOOTER_BOTTOM = 11  // pt, baseline of the last line
const FOOTER_LEADING = 1.4

const TX_HASH = /^0x[0-9a-fA-F]{64}$/

/**
 * The footer's fields, in order. Joined with " | " on one line when the page is
 * wide enough, as they always were.
 */
export function footerParts({ walletAddress, rentalDate, expiryDate, grantedVia, transactionHash }) {
  if (grantedVia === 'librarian_review') {
    return ['LIBRARIAN REVIEW COPY — not for distribution', `Librarian: ${walletAddress}`, `Opened: ${rentalDate}`]
  }
  if (grantedVia === 'uploader') {
    // The archivist's own book: access that never expires, so no expiry to print.
    return ['ARCHIVIST COPY', `Uploader: ${walletAddress}`, `Opened: ${rentalDate}`]
  }
  const parts = [`Licensed to: ${walletAddress}`, `Rental: ${rentalDate}`, `Expires: ${expiryDate || 'unknown'}`]
  // Only a well-formed hash is printed: it comes from the backend, and the
  // standard font cannot encode just any character.
  if (typeof transactionHash === 'string' && TX_HASH.test(transactionHash)) {
    parts.push(`Rental tx: ${transactionHash}`)
  }
  return parts
}

/**
 * Pack the fields into as few lines as fit the page, never splitting a field.
 * On a page too narrow for the widest field, the text shrinks until it fits.
 * A rental footer with its transaction is about 560 pt wide at 6 pt, so it is
 * one line on Letter or A4 and two on a 5.5 in (396 pt) book page.
 *
 * @returns {{ lines: string[], size: number }}
 */
export function layoutFooter(parts, font, pageWidth) {
  const maxWidth = pageWidth - 2 * FOOTER_MARGIN
  const widest = Math.max(...parts.map(p => font.widthOfTextAtSize(p, FOOTER_SIZE)))
  const size = widest > maxWidth ? FOOTER_SIZE * (maxWidth / widest) : FOOTER_SIZE
  const lines = []
  for (const part of parts) {
    const joined = lines.length ? `${lines[lines.length - 1]} | ${part}` : null
    if (joined && font.widthOfTextAtSize(joined, size) <= maxWidth) lines[lines.length - 1] = joined
    else lines.push(part)
  }
  return { lines, size }
}

export async function addWatermarks(pdfBytes, { walletAddress, rentalDate, expiryDate, grantedVia, transactionHash }) {
  const doc      = await PDFDocument.load(pdfBytes)
  const font     = await doc.embedFont(StandardFonts.Helvetica)
  const boldFont = await doc.embedFont(StandardFonts.HelveticaBold)
  const isReview = grantedVia === 'librarian_review'
  const parts    = footerParts({ walletAddress, rentalDate, expiryDate, grantedVia, transactionHash })

  for (const page of doc.getPages()) {
    const { width, height } = page.getSize()
    // Footer strip, laid out per page: one PDF can mix page sizes.
    const { lines, size } = layoutFooter(parts, font, width)
    lines.forEach((line, i) => {
      const y = FOOTER_BOTTOM + (lines.length - 1 - i) * size * FOOTER_LEADING
      page.drawText(line, { x: FOOTER_MARGIN, y, size, font, color: rgb(0.45, 0.45, 0.45), opacity: 0.75 })
    })
    // Diagonal ghost watermark
    page.drawText(
      isReview ? `REVIEW COPY ${walletAddress.slice(0, 10)}…` : walletAddress.slice(0, 18) + '…',
      {
        x: width / 2 - 90, y: height / 2,
        size: 16, font: boldFont,
        color: rgb(0.65, 0.65, 0.65), opacity: 0.06,
        rotate: degrees(40),
      }
    )
  }
  return doc.save()
}
