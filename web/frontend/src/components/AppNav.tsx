import { Link, useLocation, useNavigate } from 'react-router-dom'
import type { ReactNode } from 'react'
import { api, clearToken } from '../api'

const TABS = [
  {
    to: '/',
    label: 'Inbox',
    active: 'bg-red-700 text-white shadow-sm ring-1 ring-red-800',
    idle: 'bg-red-100 text-red-800 hover:bg-red-200',
  },
  {
    to: '/sync',
    label: 'Sync Data',
    active: 'bg-sky-700 text-white shadow-sm ring-1 ring-sky-800',
    idle: 'bg-sky-100 text-sky-800 hover:bg-sky-200',
  },
  {
    to: '/review',
    label: 'Review / AI',
    active: 'bg-amber-600 text-white shadow-sm ring-1 ring-amber-700',
    idle: 'bg-amber-100 text-amber-900 hover:bg-amber-200',
  },
  {
    to: '/settings',
    label: 'Settings',
    active: 'bg-emerald-700 text-white shadow-sm ring-1 ring-emerald-800',
    idle: 'bg-emerald-100 text-emerald-800 hover:bg-emerald-200',
  },
] as const

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
    <header className="flex flex-wrap items-center gap-3 border-b border-rose-200/70 bg-gradient-to-r from-white via-rose-50/80 to-sky-50/90 px-4 py-2.5 shadow-sm">
      <div className="text-lg font-semibold tracking-tight text-rose-800">Quotation Reader</div>
      <nav className="flex flex-wrap gap-1.5 rounded-xl bg-white/80 p-1.5 shadow-inner ring-1 ring-slate-200/80">
        {TABS.map((t) => {
          const active =
            t.to === '/'
              ? loc.pathname === '/'
              : loc.pathname === t.to || loc.pathname.startsWith(t.to + '/')
          return (
            <Link
              key={t.to}
              to={t.to}
              className={`cursor-pointer rounded-lg px-3.5 py-1.5 text-sm font-semibold transition-colors ${
                active ? t.active : t.idle
              }`}
            >
              {t.label}
            </Link>
          )
        })}
      </nav>
      <div className="ml-auto flex items-center gap-3 text-xs text-slate-600">
        {right}
        <button
          type="button"
          onClick={logout}
          className="cursor-pointer rounded-md bg-slate-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700"
        >
          Log out
        </button>
      </div>
    </header>
  )
}
