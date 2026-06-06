import { createContext, useContext, useState, useCallback, useEffect } from 'react'

const WalletContext = createContext(null)

const BASE_SEPOLIA_CHAIN_ID = 84532

export function WalletProvider({ children }) {
  const [address, setAddress] = useState(null)
  const [provider, setProvider] = useState(null)
  const [signer, setSigner] = useState(null)
  const [chainId, setChainId] = useState(null)
  const [connecting, setConnecting] = useState(false)
  const [error, setError] = useState(null)

  const isCorrectNetwork = chainId === BASE_SEPOLIA_CHAIN_ID

  const connect = useCallback(async () => {
    if (!window.ethereum) {
      setError('Please install MetaMask to use Alexandria')
      return
    }
    setConnecting(true)
    setError(null)
    try {
      const { BrowserProvider } = await import('ethers')
      const prov = new BrowserProvider(window.ethereum)
      const accounts = await prov.send('eth_requestAccounts', [])
      const sign = await prov.getSigner()
      const network = await prov.getNetwork()
      setProvider(prov)
      setSigner(sign)
      setAddress(accounts[0])
      setChainId(Number(network.chainId))
    } catch (err) {
      setError(err.message)
    } finally {
      setConnecting(false)
    }
  }, [])

  const disconnect = useCallback(() => {
    setAddress(null)
    setProvider(null)
    setSigner(null)
    setChainId(null)
    setError(null)
  }, [])

  const switchToBaseSepolia = useCallback(async () => {
    if (!window.ethereum) return
    try {
      await window.ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: `0x${BASE_SEPOLIA_CHAIN_ID.toString(16)}` }],
      })
    } catch (err) {
      if (err.code === 4902) {
        await window.ethereum.request({
          method: 'wallet_addEthereumChain',
          params: [{
            chainId: `0x${BASE_SEPOLIA_CHAIN_ID.toString(16)}`,
            chainName: 'Base Sepolia',
            nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
            rpcUrls: ['https://sepolia.base.org'],
            blockExplorerUrls: ['https://sepolia.basescan.org'],
          }],
        })
      }
    }
  }, [])

  useEffect(() => {
    if (!window.ethereum) return
    const onAccountsChanged = (accounts) => {
      if (accounts.length === 0) disconnect()
      else setAddress(accounts[0])
    }
    const onChainChanged = (chainIdHex) => {
      setChainId(parseInt(chainIdHex, 16))
    }
    window.ethereum.on('accountsChanged', onAccountsChanged)
    window.ethereum.on('chainChanged', onChainChanged)
    return () => {
      window.ethereum.removeListener('accountsChanged', onAccountsChanged)
      window.ethereum.removeListener('chainChanged', onChainChanged)
    }
  }, [disconnect])

  return (
    <WalletContext.Provider value={{
      address, provider, signer, chainId,
      connecting, error, isCorrectNetwork,
      connect, disconnect, switchToBaseSepolia,
    }}>
      {children}
    </WalletContext.Provider>
  )
}

export function useWallet() {
  const ctx = useContext(WalletContext)
  if (!ctx) throw new Error('useWallet must be used within WalletProvider')
  return ctx
}
