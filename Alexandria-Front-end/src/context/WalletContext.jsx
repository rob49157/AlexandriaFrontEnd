import { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { BrowserProvider, JsonRpcSigner } from 'ethers'
import { getWallet, getWallets, waitForWallet } from '../utils/walletDiscovery'

const BASE_SEPOLIA_CHAIN_ID = 84532
const BASE_SEPOLIA_HEX = '0x14a34'

// The wallet (EIP-6963 rdns) to reconnect to after a reload. Only the wallet,
// never the address: the wallet says which account is current. Per browser, best effort.
const WALLET_KEY = 'alexandria:wallet'
const rememberWallet = (id) => { try { localStorage.setItem(WALLET_KEY, id) } catch { /* private mode */ } }
const forgetWallet   = ()   => { try { localStorage.removeItem(WALLET_KEY) } catch { /* private mode */ } }
const recallWallet   = ()   => { try { return localStorage.getItem(WALLET_KEY) } catch { return null } }

// How long a reload waits for the remembered wallet before showing Connect
const RESTORE_TIMEOUT_MS = 2000

const WalletContext = createContext(null)

// Wallet errors arrive wrapped by ethers, so the provider's own code sits on
// err.error / err.info.error rather than err.code.
function connectErrorMessage(err) {
  const inner = err?.info?.error ?? err?.error ?? err
  const code = inner?.code ?? err?.code

  if (code === 4001) return 'Connection rejected.'
  if (code === -32002 || code === -32001) {
    return 'Your wallet is already asking you to unlock or connect. Open the extension, finish that prompt, then try again.'
  }
  return inner?.message || err?.message || 'Failed to connect wallet.'
}

export function WalletProvider({ children }) {
  const [address,          setAddress]          = useState(null)
  const [provider,         setProvider]         = useState(null)
  const [rawProvider,      setRawProvider]      = useState(null) // injected EIP-1193 provider we connected through
  const [chainId,          setChainId]          = useState(null)
  const [wallet,           setWallet]           = useState(null) // { id, name, icon } of the connected wallet
  const [connecting,       setConnecting]       = useState(false)
  const [error,            setError]            = useState(null)
  const [isCorrectNetwork, setIsCorrectNetwork] = useState(false)
  const [restoring,        setRestoring]        = useState(() => recallWallet() !== null) // reconnecting after a reload

  const inFlight  = useRef(false) // guards against overlapping connect requests
  const userActed = useRef(false) // the user connected or disconnected; a slow reconnect must not undo it

  // Derived so it always matches the current account and network.
  // Built from the address directly: p.getSigner() would re-check eth_accounts
  // and fire a duplicate eth_requestAccounts if the wallet is still unlocking.
  const signer = useMemo(
    () => (provider && address ? new JsonRpcSigner(provider, address) : null),
    [provider, address],
  )

  // ── Network check ────────────────────────────────────────────────
  const checkNetwork = useCallback((id) => {
    const ok = Number(id) === BASE_SEPOLIA_CHAIN_ID
    setIsCorrectNetwork(ok)
    return ok
  }, [])

  // ── Adopt an account the wallet has handed over ──────────────────
  const adopt = useCallback(async (found, p, addr) => {
    const net = await p.getNetwork()
    const netId = Number(net.chainId)

    setProvider(p)
    setRawProvider(found.provider)
    setAddress(addr)
    setChainId(netId)
    setWallet({ id: found.id, name: found.name, icon: found.icon })
    checkNetwork(netId)
  }, [checkNetwork])

  // ── Disconnect ───────────────────────────────────────────────────
  // The app's side only. Also what happens when the wallet drops the account
  // itself (locked, or this site removed in the wallet): the wallet stays
  // remembered, so the next reload reconnects once it is unlocked.
  const clearConnection = useCallback(() => {
    setAddress(null)
    setProvider(null)
    setRawProvider(null)
    setChainId(null)
    setWallet(null)
    setIsCorrectNetwork(false)
    setError(null)
  }, [])

  // The Disconnect button: forget the wallet so a reload doesn't reconnect, and
  // ask the wallet to drop this site too. MetaMask's extension supports
  // wallet_revokePermissions; a wallet that doesn't is still disconnected here.
  const disconnect = useCallback(() => {
    userActed.current = true
    forgetWallet()
    if (rawProvider) {
      rawProvider.request({ method: 'wallet_revokePermissions', params: [{ eth_accounts: {} }] }).catch(() => {})
    }
    clearConnection()
  }, [rawProvider, clearConnection])

  // ── Switch / Add Base Sepolia ────────────────────────────────────
  const switchToBaseSepolia = useCallback(async () => {
    const eth = rawProvider ?? window.ethereum
    if (!eth) return
    try {
      await eth.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: BASE_SEPOLIA_HEX }],
      })
    } catch (switchErr) {
      if (switchErr.code === 4902) {
        try {
          await eth.request({
            method: 'wallet_addEthereumChain',
            params: [{
              chainId: BASE_SEPOLIA_HEX,
              chainName: 'Base Sepolia',
              nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
              rpcUrls: ['https://sepolia.base.org'],
              blockExplorerUrls: ['https://sepolia.basescan.org'],
            }],
          })
        } catch (addErr) {
          setError(`Failed to add Base Sepolia: ${addErr.message}`)
        }
      } else {
        setError(`Failed to switch network: ${switchErr.message}`)
      }
    }
  }, [rawProvider])

  // ── Connect ──────────────────────────────────────────────────────
  // walletId is the EIP-6963 rdns (e.g. 'io.metamask'), or LEGACY_WALLET_ID
  const connectWith = useCallback(async (walletId) => {
    // A second eth_requestAccounts while the first is still open makes the
    // wallet reject with -32002 / "Already processing unlock", so only ever
    // allow one connection attempt in flight.
    if (inFlight.current) {
      setError('A connection request is already open. Check your wallet extension.')
      return false
    }

    const found = getWallet(walletId)
    const raw = found?.provider
    if (!raw) {
      setError('Wallet not found. Please install it and try again.')
      return false
    }

    userActed.current = true
    inFlight.current = true
    setConnecting(true)
    setError(null)

    try {
      const p = new BrowserProvider(raw)
      const accounts = await p.send('eth_requestAccounts', [])
      const addr = accounts?.[0]
      if (!addr) throw new Error('No accounts returned. Unlock your wallet and try again.')

      await adopt(found, p, addr)
      rememberWallet(found.id)
      return true
    } catch (err) {
      setError(connectErrorMessage(err))
      return false
    } finally {
      inFlight.current = false
      setConnecting(false)
    }
  }, [adopt])

  // Connect to the first discovered wallet
  const connect = useCallback(() => connectWith(getWallets()[0]?.id), [connectWith])

  // ── Reconnect after a reload ─────────────────────────────────────
  // eth_accounts answers without a prompt: the account if this site is still
  // approved and the wallet unlocked, [] otherwise. Only eth_requestAccounts,
  // from a click on Connect, may open the wallet.
  useEffect(() => {
    const id = recallWallet()
    if (!id) return undefined
    let cancelled = false
    // A wallet that never answers must not leave Connect hidden behind "Reconnecting…"
    const giveUp = setTimeout(() => setRestoring(false), RESTORE_TIMEOUT_MS)

    const restore = async () => {
      const found = await waitForWallet(id, RESTORE_TIMEOUT_MS)
      if (cancelled || !found) return
      const p = new BrowserProvider(found.provider)
      const accounts = await p.send('eth_accounts', [])
      if (cancelled || userActed.current || !accounts?.[0]) return
      await adopt(found, p, accounts[0])
    }

    restore()
      .catch(() => { /* stay disconnected; Connect still works */ })
      .finally(() => {
        clearTimeout(giveUp)
        if (!cancelled) setRestoring(false)
      })

    return () => { cancelled = true; clearTimeout(giveUp) }
  }, [adopt])

  // ── Listen for account & network changes ─────────────────────────
  useEffect(() => {
    // Only listen to the wallet we connected through. Falling back to
    // window.ethereum would pick up events from whichever wallet owns that
    // global (e.g. Rabby) even while disconnected or connected to MetaMask.
    if (typeof rawProvider?.on !== 'function') return

    // The derived signer follows the new address automatically
    const onAccountsChanged = (accounts) => {
      if (!accounts || accounts.length === 0) {
        clearConnection()
      } else {
        setAddress(accounts[0])
      }
    }

    // ethers' BrowserProvider is bound to the network it detected and throws
    // "network changed" afterwards, so swap in a fresh one instead of
    // reloading the page (which dropped the connection).
    const onChainChanged = (newChainId) => {
      const id = Number(newChainId)
      setProvider(new BrowserProvider(rawProvider))
      setChainId(id)
      checkNetwork(id)
    }

    rawProvider.on('accountsChanged', onAccountsChanged)
    rawProvider.on('chainChanged', onChainChanged)
    return () => {
      rawProvider.removeListener('accountsChanged', onAccountsChanged)
      rawProvider.removeListener('chainChanged', onChainChanged)
    }
  }, [rawProvider, clearConnection, checkNetwork])

  return (
    <WalletContext.Provider value={{
      address, provider, signer, chainId, wallet,
      connecting, restoring, error, isCorrectNetwork,
      connect, connectWith, disconnect, switchToBaseSepolia,
    }}>
      {children}
    </WalletContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useWallet() {
  const ctx = useContext(WalletContext)
  if (!ctx) throw new Error('useWallet must be used within WalletProvider')
  return ctx
}
