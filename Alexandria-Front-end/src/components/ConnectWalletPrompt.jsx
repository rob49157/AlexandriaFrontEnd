import { useState } from 'react'
import { useWallet } from '../context/WalletContext'
import WalletSelectModal from './WalletSelectModal'

// Centred "connect your wallet" panel shared by the dashboards.
// It owns the wallet picker so a failed connect shows an error instead of
// looking like a dead button.
export default function ConnectWalletPrompt({ message }) {
  const { connecting, error } = useWallet()
  const [showSelect, setShowSelect] = useState(false)

  return (
    <div className="dash__connect">
      <p>{message}</p>
      {error && <p className="dash__connect-error">{error}</p>}
      <button
        className="dash__connect-btn"
        onClick={() => setShowSelect(true)}
        disabled={connecting}
      >
        {connecting ? 'Connecting…' : 'Connect Wallet'}
      </button>

      {showSelect && <WalletSelectModal onClose={() => setShowSelect(false)} />}
    </div>
  )
}
