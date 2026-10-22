import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, clearToken, getToken, setToken } from '../api'

export default function Login() {
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const status = await api.authStatus()
        if (cancelled) return
        if (status.setup_required) {
          navigate('/setup', { replace: true })
          return
        }
        if (getToken() && status.logged_in) {
          navigate('/', { replace: true })
          return
        }
        if (getToken() && !status.logged_in) {
          clearToken()
        }
      } catch {
        /* show login form */
      } finally {
        if (!cancelled) setChecking(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [navigate])

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const res = await api.login(password)
      setToken(res.token)
      navigate('/', { replace: true })
    } catch (err) {
      setError(String(err))
    } finally {
      setBusy(false)
    }
  }

  if (checking) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-slate-500">
        Checking session…
      </div>
    )
  }

  return (
    <div className="flex h-full items-center justify-center px-4">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm rounded-2xl border border-rose-200/80 bg-white/95 p-8 shadow-xl shadow-rose-100/60 ring-1 ring-sky-100"
      >
        <div className="mb-1 inline-block rounded-md bg-red-700 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">
          Secure
        </div>
        <h1 className="text-xl font-semibold text-rose-900">Quotation Reader</h1>
        <p className="mt-1 text-sm text-slate-500">Sign in to continue</p>

        <label className="mt-6 block text-xs font-medium text-slate-600">
          Password
          <div className="relative mt-1">
            <input
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus
              className="w-full cursor-text rounded-lg border border-slate-300 bg-rose-50/40 py-2.5 pl-3 pr-11 text-sm text-slate-900 outline-none focus:border-red-500 focus:ring-2 focus:ring-red-200"
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              className="absolute inset-y-0 right-0 flex cursor-pointer items-center px-3 text-slate-500 hover:text-slate-800"
              title={showPassword ? 'Hide password' : 'Show password'}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
            >
              {showPassword ? (
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-5 w-5"
                  aria-hidden
                >
                  <path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
                  <path d="M9.9 4.24A10.94 10.94 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                  <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
                  <line x1="1" y1="1" x2="23" y2="23" />
                </svg>
              ) : (
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-5 w-5"
                  aria-hidden
                >
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              )}
            </button>
          </div>
        </label>

        {error && <div className="mt-3 text-sm text-red-600">{error}</div>}

        <button
          type="submit"
          disabled={busy || !password}
          className="mt-6 w-full cursor-pointer rounded-lg bg-red-700 py-2.5 text-sm font-semibold text-white hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? 'Signing in…' : 'Sign in'}
        </button>

        <p className="mt-4 text-center text-xs text-slate-500">
          Your session stays signed in for about 24 hours. You can change your password anytime in
          Settings after login.
        </p>
      </form>
    </div>
  )
}
