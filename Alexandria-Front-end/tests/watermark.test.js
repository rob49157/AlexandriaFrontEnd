// The footer every page of a book carries (src/utils/watermark.js): who opened
// it, when, and for a rental the transaction that created it. It must stay on
// the page at any page size, since a footer cut off the edge traces nobody.
//
//   npm run test:watermark

import assert from 'node:assert/strict'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { addWatermarks, footerParts, layoutFooter } from '../src/utils/watermark.js'

let passed = 0
async function test(name, fn) {
  await fn()
  passed++
  console.log(`  ok  ${name}`)
}

const WALLET = '0x7d1C4b2E9a0F3c6B8e5D2a1F4c7E0b3A6d9C2e5F' // sample, not a real reader
const TX = '0x' + '9c'.repeat(32)
const rental = { walletAddress: WALLET, rentalDate: '2026-11-22', expiryDate: '2026-11-29', grantedVia: 'rental' }

const PAGES = { letter: 612, a4: 595, trade: 396, massMarket: 306, pocket: 180 }
const font = await (await PDFDocument.create()).embedFont(StandardFonts.Helvetica)

await test('a rental footer names the rental transaction in full', () => {
  const parts = footerParts({ ...rental, transactionHash: TX })
  assert.deepEqual(parts, [
    `Licensed to: ${WALLET}`, 'Rental: 2026-11-22', 'Expires: 2026-11-29', `Rental tx: ${TX}`,
  ])
})

await test('no transaction yet, or a malformed one: the line is left out, never garbled', () => {
  for (const transactionHash of [null, undefined, '', '0x1234', TX + '00', TX.replace('9c', 'zz'), `${TX}\n`, 42]) {
    const parts = footerParts({ ...rental, transactionHash })
    assert.equal(parts.length, 3, `printed ${JSON.stringify(transactionHash)}`)
    assert.ok(!parts.some(p => p.startsWith('Rental tx')))
  }
})

await test('uploader and review copies carry no rental transaction', () => {
  for (const grantedVia of ['uploader', 'librarian_review']) {
    const parts = footerParts({ ...rental, grantedVia, transactionHash: TX })
    assert.ok(!parts.join(' ').includes(TX), grantedVia)
  }
})

await test('on a wide page the footer reads exactly as before, one line joined with " | "', () => {
  const review = footerParts({ ...rental, grantedVia: 'librarian_review' })
  assert.deepEqual(layoutFooter(review, font, PAGES.letter), {
    lines: [`LIBRARIAN REVIEW COPY — not for distribution | Librarian: ${WALLET} | Opened: 2026-11-22`],
    size: 6,
  })
  const withTx = layoutFooter(footerParts({ ...rental, transactionHash: TX }), font, PAGES.letter)
  assert.equal(withTx.lines.length, 1)
})

await test('at every page size, every line fits between the margins and no field is split', () => {
  for (const grantedVia of ['rental', 'uploader', 'librarian_review']) {
    const parts = footerParts({ ...rental, grantedVia, transactionHash: TX })
    for (const [name, width] of Object.entries(PAGES)) {
      const { lines, size } = layoutFooter(parts, font, width)
      for (const line of lines) {
        assert.ok(font.widthOfTextAtSize(line, size) <= width - 20, `${grantedVia} on ${name}: "${line}" overflows`)
      }
      assert.deepEqual(lines.join(' | ').split(' | '), parts, `${grantedVia} on ${name}: a field was split or lost`)
    }
  }
})

await test('a 5.5 in book page wraps the transaction onto its own line at full size', () => {
  const { lines, size } = layoutFooter(footerParts({ ...rental, transactionHash: TX }), font, PAGES.trade)
  assert.equal(size, 6)
  assert.deepEqual(lines, [`Licensed to: ${WALLET} | Rental: 2026-11-22 | Expires: 2026-11-29`, `Rental tx: ${TX}`])
})

await test('only a page too narrow for one field shrinks the text', () => {
  assert.equal(layoutFooter(footerParts({ ...rental, transactionHash: TX }), font, PAGES.massMarket).size, 6)
  const { size } = layoutFooter(footerParts({ ...rental, transactionHash: TX }), font, PAGES.pocket)
  assert.ok(size < 6 && size > 3, `size ${size}`)
})

await test('a real PDF with mixed page sizes is watermarked page by page', async () => {
  const doc = await PDFDocument.create()
  doc.addPage([PAGES.letter, 792])
  doc.addPage([PAGES.trade, 612])
  const marked = await PDFDocument.load(await addWatermarks(await doc.save(), { ...rental, transactionHash: TX }))
  assert.equal(marked.getPageCount(), 2)
})

console.log(`\n${passed} passed`)
