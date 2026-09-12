import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react'
import { BrowserProvider, JsonRpcSigner } from 'ethers'

const BASE_SEPOLIA_CHAIN_ID = 84532
const BASE_SEPOLIA_HEX = '0x14a34'

const WalletContext = createContext(null)

// Resolve the injected EIP-1193 provider for a specific wallet.
// Browsers with several wallets installed expose them under window.ethereum.providers.
function resolveProvider(type) {
  const eth = window.ethereum
  if (!eth) return null

  const providers = eth.providers ?? [eth]

  if (type === 'metamask') {
    // Exclude wallets that spoof isMetaMask (Rabby, Brave, etc.)
    return providers.find(p => p.isMetaMask && !p.isRabby && !p.isBraveWallet && !p.isCoinbaseWallet && !p.isFrame) ?? null
  }
  if (type === 'rabby') {
    return providers.find(p => p.isRabby) ?? (eth.isRabby ? eth : null)
  }
  if (type === 'coinbase') {
    return (
      window.coinbaseWalletExtension ??
      providers.find(p => p.isCoinbaseWallet) ??
      null
    )
  }
  // injected — whatever is available
  return eth
}

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
  const [signer,           setSigner]           = useState(null)
  const [chainId,          setChainId]          = useState(null)
  const [walletType,       setWalletType]       = useState(null) // 'metamask' | 'rabby' | 'coinbase' | 'injected' | null
  const [connecting,       setConnecting]       = useState(false)
  const [error,            setError]            = useState(null)
  const [isCorrectNetwork, setIsCorrectNetwork] = useState(false)

  const inFlight = useRef(false) // guards against overlapping connect requests

  // ── Network check ────────────────────────────────────────────────
  const checkNetwork = useCallback((id) => {
    const ok = Number(id) === BASE_SEPOLIA_CHAIN_ID
    setIsCorrectNetwork(ok)
    return ok
  }, [])

  // ── Disconnect ───────────────────────────────────────────────────
  const disconnect = useCallback(() => {
    setAddress(null)
    setProvider(null)
    setRawProvider(null)
    setSigner(null)
    setChainId(null)
    setWalletType(null)
    setIsCorrectNetwork(false)
    setError(null)
  }, [])

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
  const connectWith = useCallback(async (type) => {
    // A second eth_requestAccounts while the first is still open makes the
    // wallet reject with -32002 / "Already processing unlock", so only ever
    // allow one connection attempt in flight.
    if (inFlight.current) {
      setError('A connection request is already open. Check your wallet extension.')
      return false
    }

    const raw = resolveProvider(type)
    if (!raw) {
      setError('Wallet not found. Please install it and try again.')
      return false
    }

    inFlight.current = true
    setConnecting(true)
    setError(null)

    try {
      const p = new BrowserProvider(raw)
      const accounts = await p.send('eth_requestAccounts', [])
      const addr = accounts?.[0]
      if (!addr) throw new Error('No accounts returned. Unlock your wallet and try again.')

      const net = await p.getNetwork()
      // Build the signer from the address we already have. p.getSigner() would
      // re-check eth_accounts and fire a duplicate eth_requestAccounts if the
      // wallet is still finishing its unlock.
      const s = new JsonRpcSigner(p, addr)

      const netId = Number(net.chainId)

      setProvider(p)
      setRawProvider(raw)
      setSigner(s)
      setAddress(addr)
      setChainId(netId)
      setWalletType(type)
      checkNetwork(netId)
      return true
    } catch (err) {
      setError(connectErrorMessage(err))
      return false
    } finally {
      inFlight.current = false
      setConnecting(false)
    }
  }, [checkNetwork])

  const connect = useCallback(() => connectWith('injected'), [connectWith])

  // ── Listen for account & network changes ─────────────────────────
  useEffect(() => {
    const eth = rawProvider ?? window.ethereum
    if (typeof eth?.on !== 'function') return

    const onAccountsChanged = (accounts) => {
      if (!accounts || accounts.length === 0) {
        disconnect()
      } else {
        setAddress(accounts[0])
      }
    }

    const onChainChanged = (newChainId) => {
      const id = parseInt(newChainId, 16)
      setChainId(id)
      checkNetwork(id)
      window.location.reload()
    }

    eth.on('accountsChanged', onAccountsChanged)
    eth.on('chainChanged', onChainChanged)
    return () => {
      eth.removeListener('accountsChanged', onAccountsChanged)
      eth.removeListener('chainChanged', onChainChanged)
    }
  }, [rawProvider, disconnect, checkNetwork])

  return (
    <WalletContext.Provider value={{
      address, provider, signer, chainId, walletType,
      connecting, error, isCorrectNetwork,
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
