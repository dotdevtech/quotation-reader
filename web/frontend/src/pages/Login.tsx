import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, setToken } from '../api'

export default function Login() {
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

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
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus
            className="mt-1 w-full cursor-text rounded-lg border border-slate-300 bg-rose-50/40 px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-red-500 focus:ring-2 focus:ring-red-200"
          />
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
          You can change your password anytime in Settings after login.
        </p>
      </form>
    </div>
  )
}
