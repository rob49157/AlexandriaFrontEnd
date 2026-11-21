import { formatUnits, parseUnits } from 'ethers'

const DAY_MS = 86_400_000

// Whole days until a review ends, rounded up: 13 days 2 hours reads "14 days
// left", so the count only reaches 0 once the window has really closed.
export function reviewDaysLeft(reviewEndsAt, now = Date.now()) {
  return Math.max(0, Math.ceil((Date.parse(reviewEndsAt) - now) / DAY_MS))
}

// A staked book stays "pending" after its window closes, until the archivist
// unstakes, which is what approves it (AlexandriaStake.unstake).
export function reviewLabel(reviewEndsAt, now) {
  const days = reviewDaysLeft(reviewEndsAt, now)
  if (days === 0) return 'Review over · approval pending'
  return `In review · ${days} ${days === 1 ? 'day' : 'days'} left`
}

// Whole-ALEX amount as the backend sends it (ethers formatUnits: "5.0", "2.5")
export function formatAlex(amount) {
  return amount.endsWith('.0') ? amount.slice(0, -2) : amount
}

// Atomic $ALEX (18 decimals, bigint or decimal string) as the reader sees it: "5", "2.5"
export function alexFromWei(wei) {
  return formatAlex(formatUnits(BigInt(wei), 18))
}

/**
 * A typed $ALEX amount in atomic units, or null if it is not a number above 0
 * with at most 18 decimals (the token's). "2", "0.5", ".5" and "5." are fine;
 * "1,5", "-1", "1e3" and "" are not. Exact: no floating point on the way.
 */
export function parseAlexAmount(text) {
  const match = /^(\d*)(?:\.(\d*))?$/.exec(String(text ?? '').trim())
  if (!match) return null
  const [, whole = '', fraction = ''] = match
  if (!whole && !fraction) return null
  if (fraction.length > 18) return null
  const wei = parseUnits(`${whole || '0'}.${fraction || '0'}`, 18)
  return wei > 0n ? wei : null
}
