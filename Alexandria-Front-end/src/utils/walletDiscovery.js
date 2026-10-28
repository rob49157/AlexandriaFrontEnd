import { useSyncExternalStore } from 'react'

// EIP-6963 multi-wallet discovery.
// Each wallet extension announces its own EIP-1193 provider through a window
// event, so wallets no longer fight over window.ethereum (Rabby, for example,
// locks window.ethereum and hides MetaMask from legacy detection).
// https://eips.ethereum.org/EIPS/eip-6963

export const LEGACY_WALLET_ID = 'injected'

let wallets = []            // [{ id, name, icon, provider }], keyed by rdns
const listeners = new Set()

function emit() {
  listeners.forEach(l => l())
}

function onAnnounce(event) {
  const { info, provider } = event.detail ?? {}
  if (!info?.rdns || !provider) return

  const wallet = { id: info.rdns, name: info.name, icon: info.icon, provider }
  const i = wallets.findIndex(w => w.id === wallet.id)
  // Replace rather than mutate so useSyncExternalStore sees a new snapshot
  wallets = i === -1
    ? [...wallets, wallet]
    : wallets.map((w, j) => (j === i ? wallet : w))
  emit()
}

if (typeof window !== 'undefined') {
  window.addEventListener('eip6963:announceProvider', onAnnounce)
  // Ask wallets that loaded before this listener existed to announce again
  window.dispatchEvent(new Event('eip6963:requestProvider'))
}

// Fallback for older wallets that only inject window.ethereum.
// Built once so the snapshot stays referentially stable.
let legacyWallet
function getLegacyWallet() {
  if (legacyWallet === undefined) {
    const eth = typeof window !== 'undefined' ? window.ethereum : null
    legacyWallet = eth
      ? { id: LEGACY_WALLET_ID, name: 'Browser Wallet', icon: null, provider: eth }
      : null
  }
  return legacyWallet
}

let lastWallets
let lastSnapshot = []
function getSnapshot() {
  if (wallets !== lastWallets) {
    lastWallets = wallets
    // Only fall back to window.ethereum when no wallet supports EIP-6963,
    // otherwise it would duplicate whichever wallet owns that global.
    const legacy = getLegacyWallet()
    lastSnapshot = wallets.length > 0 ? wallets : legacy ? [legacy] : []
  }
  return lastSnapshot
}

function subscribe(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getWallets() {
  return getSnapshot()
}

export function getWallet(id) {
  return getSnapshot().find(w => w.id === id) ?? null
}

// Resolves with the wallet once it has announced itself, or null after timeoutMs.
// Wallets and this script load in no fixed order (EIP-6963), so the wallet
// remembered from the last visit may not have announced yet on first render.
export function waitForWallet(id, timeoutMs) {
  const now = getWallet(id)
  if (now) return Promise.resolve(now)
  return new Promise(resolve => {
    const unsubscribe = subscribe(() => {
      const found = getWallet(id)
      if (!found) return
      clearTimeout(timer)
      unsubscribe()
      resolve(found)
    })
    const timer = setTimeout(() => { unsubscribe(); resolve(null) }, timeoutMs)
  })
}

const EMPTY = []

export function useWallets() {
  return useSyncExternalStore(subscribe, getSnapshot, () => EMPTY)
}
