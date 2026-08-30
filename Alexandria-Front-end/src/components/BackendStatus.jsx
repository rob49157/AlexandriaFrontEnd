import { useEffect, useState } from 'react'

const API_URL = import.meta.env.VITE_API_URL

// Minimal connectivity check: pings the backend /health endpoint on mount
// and shows whether the frontend can reach the backend gateway.
export default function BackendStatus() {
  const [state, setState] = useState({ status: 'checking', detail: '' })

  useEffect(() => {
    let cancelled = false

    fetch(`${API_URL}/health`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.json()
      })
      .then((data) => {
        if (!cancelled) setState({ status: 'online', detail: data.service || 'connected' })
      })
      .catch((err) => {
        if (!cancelled) setState({ status: 'offline', detail: err.message })
      })

    return () => {
      cancelled = true
    }
  }, [])

  const color =
    state.status === 'online' ? '#22c55e' : state.status === 'offline' ? '#ef4444' : '#eab308'

  return (
    <p style={{ fontSize: '0.8rem', opacity: 0.8, display: 'flex', gap: '0.5rem', alignItems: 'center', justifyContent: 'center' }}>
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, display: 'inline-block' }} />
      Backend: {state.status}
      {state.detail && ` (${state.detail})`}
    </p>
  )
}
