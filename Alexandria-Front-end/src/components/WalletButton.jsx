import { useWallet } from '../context/WalletContext'
import '../styles/WalletButton.css'

function truncate(addr) {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`
}

export default function WalletButton() {
  const { address, connecting, isCorrectNetwork, connect, disconnect, switchToBaseSepolia } = useWallet()

  if (address && !isCorrectNetwork) {
    return (
      <button className="wallet-btn wallet-btn--wrong-network" onClick={switchToBaseSepolia}>
        Switch to Base Sepolia
      </button>
    )
  }

  if (address) {
    return (
      <div className="wallet-connected">
        <span className="wallet-indicator" />
        <span className="wallet-address">{truncate(address)}</span>
        <button className="wallet-disconnect" onClick={disconnect} aria-label="Disconnect wallet">✕</button>
      </div>
    )
  }

  return (
    <button className="wallet-btn wallet-btn--connect" onClick={connect} disabled={connecting}>
      {connecting ? 'Connecting…' : 'Connect Wallet'}
    </button>
  )
}
