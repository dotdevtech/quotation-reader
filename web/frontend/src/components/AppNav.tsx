import { Link, useLocation, useNavigate } from 'react-router-dom'
import type { ReactNode } from 'react'
import { api, clearToken } from '../api'

const TABS = [
  { to: '/', label: 'Inbox' },
  { to: '/sync', label: 'Sync Data' },
  { to: '/review', label: 'Review / AI' },
  { to: '/settings', label: 'Settings' },
]

type Props = {
  right?: ReactNode
}

export default function AppNav({ right }: Props) {
  const loc = useLocation()
  const navigate = useNavigate()

  const logout = async () => {
    try {
      await api.logout()
    } catch {
      /* ignore */
    }
    clearToken()
    navigate('/login')
  }

  return (
    <header className="flex flex-wrap items-center gap-3 border-b border-[#333] bg-[#1a1a1a] px-4 py-2.5">
      <div className="text-lg font-semibold tracking-tight text-white">Quotation Reader</div>
      <nav className="flex flex-wrap gap-1 rounded-lg bg-[#111] p-1">
        {TABS.map((t) => {
          const active =
            t.to === '/'
              ? loc.pathname === '/'
              : loc.pathname === t.to || loc.pathname.startsWith(t.to + '/')
          return (
            <Link
              key={t.to}
              to={t.to}
              className={`cursor-pointer rounded-md px-3.5 py-1.5 text-sm font-medium transition-colors ${
                active
                  ? 'bg-red-600 text-white shadow-sm'
                  : 'text-zinc-400 hover:bg-[#2a2a2a] hover:text-white'
              }`}
            >
              {t.label}
            </Link>
          )
        })}
      </nav>
      <div className="ml-auto flex items-center gap-3 text-xs text-zinc-400">
        {right}
        <button
          type="button"
          onClick={logout}
          className="cursor-pointer rounded-md bg-[#333] px-3 py-1.5 text-xs font-medium text-zinc-200 hover:bg-[#444]"
        >
          Log out
        </button>
      </div>
    </header>
  )
}
