import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useWallet } from '../context/WalletContext'
import '../styles/WalletModal.css'

export default function WalletInfoModal({ onClose, onSwitchWallet }) {
  const { address, chainId, isCorrectNetwork, wallet, disconnect, switchToBaseSepolia } = useWallet()
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const handleCopy = async () => {
    await navigator.clipboard.writeText(address)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleDisconnect = () => {
    disconnect()
    onClose()
  }

  const handleSwitchWallet = () => {
    onClose()
    onSwitchWallet()
  }

  const networkLabel = isCorrectNetwork ? 'Base Sepolia' : `Unknown network (${chainId})`

  return createPortal(
    <div className="wmodal__overlay" onMouseDown={onClose}>
      <div className="wmodal__card wmodal__card--info" onMouseDown={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Wallet details">
        <div className="wmodal__header">
          <h2 className="wmodal__title">Connected Wallet</h2>
          <button className="wmodal__close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        {wallet && (
          <p className="wmodal__wallet-type-label">{wallet.name}</p>
        )}

        <div className="wmodal__address-row">
          <code className="wmodal__full-address">{address}</code>
          <button className="wmodal__copy-btn" onClick={handleCopy} aria-label="Copy address">
            {copied ? '✓ Copied' : 'Copy'}
          </button>
        </div>

        <div className="wmodal__network-row">
          <span className={`wmodal__network-dot${isCorrectNetwork ? '' : ' wmodal__network-dot--wrong'}`} />
          <span className={`wmodal__network-label${isCorrectNetwork ? '' : ' wmodal__network-label--wrong'}`}>
            {networkLabel}
          </span>
          {!isCorrectNetwork && (
            <button className="wmodal__switch-network-btn" onClick={switchToBaseSepolia}>
              Switch network
            </button>
          )}
        </div>

        <a
          className="wmodal__basescan-link"
          href={`https://sepolia.basescan.org/address/${address}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          View on Basescan ↗
        </a>

        <div className="wmodal__info-actions">
          <button className="wmodal__switch-wallet-btn" onClick={handleSwitchWallet}>
            Switch Wallet
          </button>
          <button className="wmodal__disconnect-btn" onClick={handleDisconnect}>
            Disconnect
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
