// What the Archivist dashboard sends to Rent.setBookPrice(), and what the book
// page asks a reader to approve. Both must be exact to the wei: a price parsed
// through floating point can approve less than rentBook() then charges.
//
//   npm run test:price

import assert from 'node:assert/strict'
import { parseUnits } from 'ethers'
import { parseAlexAmount, alexFromWei } from '../src/utils/formatters.js'
import { RENTAL_DURATIONS } from '../src/utils/constants.js'

let passed = 0
function test(name, fn) {
  fn()
  passed++
  console.log(`  ok  ${name}`)
}

const ALEX = 10n ** 18n

test('whole and decimal prices parse to atomic units', () => {
  assert.equal(parseAlexAmount('2'), 2n * ALEX)
  assert.equal(parseAlexAmount('0.5'), ALEX / 2n)
  assert.equal(parseAlexAmount('.5'), ALEX / 2n)
  assert.equal(parseAlexAmount('5.'), 5n * ALEX)
  assert.equal(parseAlexAmount('  3.25 '), parseUnits('3.25', 18))
})

test('the smallest unit and 18 decimals are accepted', () => {
  assert.equal(parseAlexAmount('0.000000000000000001'), 1n)
  assert.equal(parseAlexAmount('1.123456789012345678'), 1123456789012345678n)
})

test('setBookPrice() would refuse it, so the form does too', () => {
  for (const bad of ['', ' ', '.', '0', '0.0', '-1', '1,5', '1e3', 'abc', '1.2.3', '0x10', '1.0000000000000000001', null, undefined]) {
    assert.equal(parseAlexAmount(bad), null, `accepted ${JSON.stringify(bad)}`)
  }
})

test('display drops a trailing .0 and keeps real decimals', () => {
  assert.equal(alexFromWei(5n * ALEX), '5')
  assert.equal(alexFromWei((5n * ALEX).toString()), '5')
  assert.equal(alexFromWei(ALEX / 10n), '0.1')
  assert.equal(alexFromWei(1n), '0.000000000000000001')
})

test('totals are exact where floating point is not', () => {
  // 0.1 * 3 in floating point is 0.30000000000000004
  const price = parseAlexAmount('0.1')
  assert.equal(alexFromWei(price * 3n), '0.3')
  const totals = RENTAL_DURATIONS.map(d => alexFromWei(price * BigInt(d.days)))
  assert.deepEqual(totals, ['0.1', '0.7', '3'])
})

test('durations match Rent.sol (1, 7, 30 days, charged per day)', () => {
  assert.deepEqual(RENTAL_DURATIONS.map(d => d.seconds), [86400, 604800, 2592000])
  for (const d of RENTAL_DURATIONS) assert.equal(d.seconds / 86400, d.days)
})

console.log(`\n${passed} passed`)
