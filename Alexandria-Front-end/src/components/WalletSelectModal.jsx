import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useWallet } from '../context/WalletContext'
import { useWallets } from '../utils/walletDiscovery'
import '../styles/WalletModal.css'


// Suggested when no wallet extension is detected at all
const SUGGESTED_WALLETS = [
  { name: 'MetaMask', installUrl: 'https://metamask.io/download/' },
  { name: 'Rabby',    installUrl: 'https://rabby.io' },
]

function WalletIcon({ icon, name }) {
  if (icon) return <img src={icon} alt="" className="wmodal__wallet-icon" />
  return (
    <span className="wmodal__wallet-icon wmodal__wallet-icon--fallback" aria-hidden="true">
      {name.charAt(0)}
    </span>
  )
}

export default function WalletSelectModal({ onClose }) {
  const { connectWith, connecting, error } = useWallet()
  const wallets = useWallets()
  const [activeId, setActiveId] = useState(null)

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const handleSelect = async (id) => {
    setActiveId(id)
    const ok = await connectWith(id)
    setActiveId(null)
    if (ok) onClose()
  }

  return createPortal(
    <div className="wmodal__overlay" onMouseDown={onClose}>
      <div className="wmodal__card" onMouseDown={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Connect wallet">
        <div className="wmodal__header">
          <h2 className="wmodal__title">Connect Wallet</h2>
          <button className="wmodal__close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <p className="wmodal__subtitle">
          {wallets.length > 0
            ? 'Choose a wallet to connect to Alexandria'
            : 'No wallet extension detected. Install one to continue.'}
        </p>

        <ul className="wmodal__wallet-list">
          {wallets.length > 0
            ? wallets.map(({ id, name, icon }) => {
                const isLoading = activeId === id && connecting
                return (
                  <li key={id}>
                    <button
                      className={`wmodal__wallet-item${isLoading ? ' wmodal__wallet-item--loading' : ''}`}
                      onClick={() => handleSelect(id)}
                      disabled={!!activeId}
                    >
                      <WalletIcon icon={icon} name={name} />
                      <div className="wmodal__wallet-text">
                        <span className="wmodal__wallet-name">{name}</span>
                      </div>
                      <span className="wmodal__wallet-right">
                        {isLoading
                          ? <span className="wmodal__spinner" />
                          : <span className="wmodal__detected">Detected</span>}
                      </span>
                    </button>
                  </li>
                )
              })
            : SUGGESTED_WALLETS.map(({ name, installUrl }) => (
                <li key={name}>
                  <div className="wmodal__wallet-item wmodal__wallet-item--unavailable">
                    <WalletIcon name={name} />
                    <div className="wmodal__wallet-text">
                      <span className="wmodal__wallet-name">{name}</span>
                      <span className="wmodal__wallet-desc">Not detected</span>
                    </div>
                    <span className="wmodal__wallet-right">
                      <a className="wmodal__install-link" href={installUrl} target="_blank" rel="noopener noreferrer">Install →</a>
                    </span>
                  </div>
                </li>
              ))}
        </ul>

        {error && <p className="wmodal__error">{error}</p>}
      </div>
    </div>,
    document.body
  )
}
