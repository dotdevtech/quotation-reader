import { useEffect, useState, type ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { api, clearToken, getToken } from '../api'

export default function RequireAuth({ children }: { children: ReactNode }) {
  const location = useLocation()
  const [state, setState] = useState<'loading' | 'setup' | 'login' | 'ok'>('loading')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const status = await api.authStatus()
        if (cancelled) return
        if (status.setup_required) {
          setState('setup')
          return
        }
        if (!getToken()) {
          setState('login')
          return
        }
        // Validate token with a protected call
        try {
          await api.health()
          if (!cancelled) setState('ok')
        } catch {
          clearToken()
          if (!cancelled) setState('login')
        }
      } catch (e) {
        if (!cancelled) setState('login')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [location.pathname])

  if (state === 'loading') {
    return (
      <div className="flex h-full items-center justify-center text-sm text-slate-500">Loading…</div>
    )
  }
  if (state === 'setup') return <Navigate to="/setup" replace />
  if (state === 'login') return <Navigate to="/login" replace state={{ from: location }} />
  return <>{children}</>
}
