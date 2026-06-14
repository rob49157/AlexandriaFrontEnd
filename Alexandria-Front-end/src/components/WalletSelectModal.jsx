import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useWallet } from '../context/WalletContext'
import '../styles/WalletModal.css'


const WALLETS = [
  {
    type: 'metamask',
    label: 'MetaMask',
    description: 'Browser extension wallet',
    installUrl: 'https://metamask.io/download/',
    // Exclude wallets that spoof isMetaMask (Rabby, Brave, etc.)
    detect: () => {
      const providers = window.ethereum?.providers ?? (window.ethereum ? [window.ethereum] : [])
      return providers.some(p => p.isMetaMask && !p.isRabby && !p.isBraveWallet && !p.isCoinbaseWallet)
    },
    icon: (
      <svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" className="wmodal__wallet-icon">
        <rect width="40" height="40" rx="10" fill="#F6851B" fillOpacity="0.12"/>
        <path d="M30 10L22 16.5 23.5 13.5 30 10Z" fill="#E17726" stroke="#E17726" strokeWidth="0.25" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M10 10L17.9 16.6 16.5 13.5 10 10Z" fill="#E27625" stroke="#E27625" strokeWidth="0.25" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M27.2 25L25 28.5 29.5 29.7 30.8 25.1 27.2 25Z" fill="#E27625" stroke="#E27625" strokeWidth="0.25"/>
        <path d="M9.2 25.1L10.5 29.7 15 28.5 12.8 25 9.2 25.1Z" fill="#E27625" stroke="#E27625" strokeWidth="0.25"/>
        <path d="M14.7 19.5L13.5 21.4 18 21.6 17.8 16.8 14.7 19.5Z" fill="#E27625" stroke="#E27625" strokeWidth="0.25"/>
        <path d="M25.3 19.5L22.1 16.7 22 21.6 26.5 21.4 25.3 19.5Z" fill="#E27625" stroke="#E27625" strokeWidth="0.25"/>
        <path d="M15 28.5L17.7 27.2 15.4 25.1 15 28.5Z" fill="#E27625" stroke="#E27625" strokeWidth="0.25"/>
        <path d="M22.3 27.2L25 28.5 24.6 25.1 22.3 27.2Z" fill="#E27625" stroke="#E27625" strokeWidth="0.25"/>
      </svg>
    ),
  },
  {
    type: 'rabby',
    label: 'Rabby',
    description: 'Security-focused browser wallet',
    installUrl: 'https://rabby.io',
    detect: () => {
      const providers = window.ethereum?.providers ?? (window.ethereum ? [window.ethereum] : [])
      return providers.some(p => p.isRabby) || !!window.ethereum?.isRabby
    },
    icon: (
      <svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" className="wmodal__wallet-icon">
        <rect width="40" height="40" rx="10" fill="#8697FF" fillOpacity="0.12"/>
        <ellipse cx="20" cy="21" rx="10" ry="8" fill="#8697FF" fillOpacity="0.9"/>
        <ellipse cx="15" cy="17" rx="3" ry="2.5" fill="#8697FF"/>
        <ellipse cx="25" cy="17" rx="3" ry="2.5" fill="#8697FF"/>
        <circle cx="15" cy="17" r="1.2" fill="white"/>
        <circle cx="25" cy="17" r="1.2" fill="white"/>
        <path d="M14 24 Q20 27 26 24" stroke="white" strokeWidth="1.2" fill="none" strokeLinecap="round"/>
      </svg>
    ),
  },
  {
    type: 'coinbase',
    label: 'Coinbase Wallet',
    description: 'Popular on Base chain',
    installUrl: 'https://www.coinbase.com/wallet/downloads',
    detect: () => !!(window.coinbaseWalletExtension || window.ethereum?.isCoinbaseWallet),
    icon: (
      <svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" className="wmodal__wallet-icon">
        <rect width="40" height="40" rx="10" fill="#1652F0" fillOpacity="0.12"/>
        <circle cx="20" cy="20" r="11" fill="#1652F0"/>
        <rect x="15.5" y="17.5" width="9" height="5" rx="2.5" fill="white"/>
      </svg>
    ),
  },
]

export default function WalletSelectModal({ onClose }) {
  const { connectWith, connecting, error } = useWallet()
  const [activeType, setActiveType] = useState(null)

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const handleSelect = async (type, detected) => {
    if (!detected) return
    setActiveType(type)
    const ok = await connectWith(type)
    setActiveType(null)
    if (ok) onClose()
  }

  return createPortal(
    <div className="wmodal__overlay" onMouseDown={onClose}>
      <div className="wmodal__card" onMouseDown={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Connect wallet">
        <div className="wmodal__header">
          <h2 className="wmodal__title">Connect Wallet</h2>
          <button className="wmodal__close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <p className="wmodal__subtitle">Choose a wallet to connect to Alexandria</p>

        <ul className="wmodal__wallet-list">
          {WALLETS.map(({ type, label, description, installUrl, detect, icon }) => {
            const detected  = detect()
            const isLoading = activeType === type && connecting
            return (
              <li key={type}>
                {detected ? (
                  <button
                    className={`wmodal__wallet-item${isLoading ? ' wmodal__wallet-item--loading' : ''}`}
                    onClick={() => handleSelect(type, detected)}
                    disabled={!!activeType}
                  >
                    {icon}
                    <div className="wmodal__wallet-text">
                      <span className="wmodal__wallet-name">{label}</span>
                      <span className="wmodal__wallet-desc">{description}</span>
                    </div>
                    <span className="wmodal__wallet-right">
                      {isLoading
                        ? <span className="wmodal__spinner" />
                        : <span className="wmodal__detected">Detected</span>}
                    </span>
                  </button>
                ) : (
                  <div className="wmodal__wallet-item wmodal__wallet-item--unavailable">
                    {icon}
                    <div className="wmodal__wallet-text">
                      <span className="wmodal__wallet-name">{label}</span>
                      <span className="wmodal__wallet-desc">{description}</span>
                    </div>
                    <span className="wmodal__wallet-right">
                      {installUrl
                        ? <a className="wmodal__install-link" href={installUrl} target="_blank" rel="noopener noreferrer">Install →</a>
                        : <span className="wmodal__not-detected">Not detected</span>}
                    </span>
                  </div>
                )}
              </li>
            )
          })}
        </ul>

        {error && <p className="wmodal__error">{error}</p>}
      </div>
    </div>,
    document.body
  )
}
