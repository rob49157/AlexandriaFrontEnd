import { useState } from 'react'
import { useWallet } from '../context/WalletContext'
import WalletSelectModal from './WalletSelectModal'
import WalletInfoModal from './WalletInfoModal'
import '../styles/WalletButton.css'

function truncate(addr) {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`
}

export default function WalletButton() {
  const { address, isCorrectNetwork, switchToBaseSepolia } = useWallet()
  const [showSelect, setShowSelect] = useState(false)
  const [showInfo,   setShowInfo]   = useState(false)

  if (address && !isCorrectNetwork) {
    return (
      <button className="wallet-btn wallet-btn--wrong-network" onClick={switchToBaseSepolia}>
        Switch to Base Sepolia
      </button>
    )
  }

  if (address) {
    return (
      <>
        <button className="wallet-connected" onClick={() => setShowInfo(true)}>
          <span className="wallet-indicator" />
          <span className="wallet-address">{truncate(address)}</span>
          <span className="wallet-chevron">▾</span>
        </button>

        {showInfo && (
          <WalletInfoModal
            onClose={() => setShowInfo(false)}
            onSwitchWallet={() => setShowSelect(true)}
          />
        )}
      </>
    )
  }

  return (
    <>
      <button className="wallet-btn wallet-btn--connect" onClick={() => setShowSelect(true)}>
        Connect Wallet
      </button>

      {showSelect && (
        <WalletSelectModal onClose={() => setShowSelect(false)} />
      )}
    </>
  )
}
