import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, setToken } from '../api'

export default function Setup() {
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api.authStatus().then((s) => {
      if (!s.setup_required) navigate('/login', { replace: true })
    })
  }, [navigate])

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (password.length < 4) {
      setError('Password must be at least 4 characters')
      return
    }
    if (password !== confirm) {
      setError('Passwords do not match')
      return
    }
    setBusy(true)
    setError('')
    try {
      const res = await api.setup(password)
      setToken(res.token)
      navigate('/settings', { replace: true })
    } catch (err) {
      setError(String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex h-full items-center justify-center bg-[#121212] px-4">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm rounded-xl border border-[#333] bg-[#1e1e1e] p-8 shadow-xl"
      >
        <h1 className="text-xl font-semibold text-white">Create login password</h1>
        <p className="mt-1 text-sm text-zinc-400">
          This password protects your Quotation Reader panel on this PC.
        </p>

        <label className="mt-6 block text-xs text-zinc-400">
          New password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full rounded border border-[#444] bg-[#111] px-3 py-2.5 text-sm text-white outline-none focus:border-red-500"
          />
        </label>
        <label className="mt-4 block text-xs text-zinc-400">
          Confirm password
          <input
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className="mt-1 w-full rounded border border-[#444] bg-[#111] px-3 py-2.5 text-sm text-white outline-none focus:border-red-500"
          />
        </label>

        {error && <div className="mt-3 text-sm text-red-400">{error}</div>}

        <button
          type="submit"
          disabled={busy}
          className="mt-6 w-full cursor-pointer rounded bg-red-600 py-2.5 text-sm font-medium text-white hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? 'Saving…' : 'Create & continue'}
        </button>
      </form>
    </div>
  )
}
