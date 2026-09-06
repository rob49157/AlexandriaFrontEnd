import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { BrowserProvider } from 'ethers'

const BASE_SEPOLIA_CHAIN_ID = 84532
const BASE_SEPOLIA_HEX = '0x14a34'

const WalletContext = createContext(null)

export function WalletProvider({ children }) {
  const [address,          setAddress]          = useState(null)
  const [provider,         setProvider]         = useState(null)
  const [signer,           setSigner]           = useState(null)
  const [chainId,          setChainId]          = useState(null)
  const [walletType,       setWalletType]       = useState(null) // 'metamask' | 'coinbase' | null
  const [connecting,       setConnecting]       = useState(false)
  const [error,            setError]            = useState(null)
  const [isCorrectNetwork, setIsCorrectNetwork] = useState(false)

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
    setSigner(null)
    setChainId(null)
    setWalletType(null)
    setIsCorrectNetwork(false)
    setError(null)
  }, [])

  // ── Switch / Add Base Sepolia ────────────────────────────────────
  const switchToBaseSepolia = useCallback(async () => {
    if (!window.ethereum) return
    try {
      await window.ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: BASE_SEPOLIA_HEX }],
      })
    } catch (switchErr) {
      if (switchErr.code === 4902) {
        try {
          await window.ethereum.request({
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
  }, [])

  // ── Connect ──────────────────────────────────────────────────────
  const connectWith = useCallback(async (type) => {
    if (!window.ethereum) {
      setError('No Ethereum wallet detected. Please install MetaMask.')
      return
    }

    setConnecting(true)
    setError(null)

    try {
      const p = new BrowserProvider(window.ethereum)
      const accounts = await p.send('eth_requestAccounts', [])
      const net = await p.getNetwork()
      const s = await p.getSigner()

      const addr = accounts[0]
      const netId = Number(net.chainId)

      setProvider(p)
      setSigner(s)
      setAddress(addr)
      setChainId(netId)
      setWalletType(type)
      checkNetwork(netId)
    } catch (err) {
      if (err.code === 4001) {
        setError('Connection rejected.')
      } else {
        setError(err.message || 'Failed to connect wallet.')
      }
    } finally {
      setConnecting(false)
    }
  }, [checkNetwork])

  const connect = useCallback(() => connectWith('metamask'), [connectWith])

  // ── Listen for account & network changes ─────────────────────────
  useEffect(() => {
    if (!window.ethereum) return

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

    window.ethereum.on('accountsChanged', onAccountsChanged)
    window.ethereum.on('chainChanged', onChainChanged)
    return () => {
      window.ethereum.removeListener('accountsChanged', onAccountsChanged)
      window.ethereum.removeListener('chainChanged', onChainChanged)
    }
  }, [disconnect, checkNetwork])

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
