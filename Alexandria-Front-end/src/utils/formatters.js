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
