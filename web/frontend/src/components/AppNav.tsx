import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useEffect, useState, type ReactNode } from 'react'
import { api, clearToken } from '../api'

const TABS = [
  {
    to: '/',
    label: 'Inbox',
    active: 'bg-red-700 text-white',
    idle: 'bg-red-50 text-red-800 hover:bg-red-100',
  },
  {
    to: '/sync',
    label: 'Sync Data',
    active: 'bg-sky-700 text-white',
    idle: 'bg-sky-50 text-sky-800 hover:bg-sky-100',
  },
  {
    to: '/review',
    label: 'Review / AI',
    active: 'bg-amber-600 text-white',
    idle: 'bg-amber-50 text-amber-900 hover:bg-amber-100',
  },
  {
    to: '/settings',
    label: 'Settings',
    active: 'bg-emerald-700 text-white',
    idle: 'bg-emerald-50 text-emerald-800 hover:bg-emerald-100',
  },
] as const

function pageLabel(pathname: string) {
  if (pathname === '/' || pathname.startsWith('/inbox')) return 'Inbox'
  if (pathname.startsWith('/sync')) return 'Sync Data'
  if (pathname.startsWith('/review')) return 'Review / AI'
  if (pathname.startsWith('/settings')) return 'Settings'
  return 'Quotation Reader'
}

type Props = {
  right?: ReactNode
}

export default function AppNav({ right }: Props) {
  const loc = useLocation()
  const navigate = useNavigate()
  const [menuOpen, setMenuOpen] = useState(false)

  useEffect(() => {
    setMenuOpen(false)
  }, [loc.pathname])

  useEffect(() => {
    if (!menuOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [menuOpen])

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
    <>
      <header className="flex items-center gap-2 border-b border-rose-200/70 bg-gradient-to-r from-white via-rose-50/80 to-sky-50/90 px-3 py-2 shadow-sm">
        <button
          type="button"
          onClick={() => setMenuOpen(true)}
          className="cursor-pointer rounded-md bg-slate-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700"
          aria-label="Open menu"
          title="Menu"
        >
          ☰ Menu
        </button>
        <div className="min-w-0 flex-1">
          <div className="truncate text-base font-semibold tracking-tight text-rose-800">
            Quotation Reader
          </div>
          <nav className="mt-0.5 flex items-center gap-1 text-[11px] text-slate-500" aria-label="Breadcrumb">
            <span>Home</span>
            <span className="text-slate-400">/</span>
            <span className="font-semibold text-slate-700">{pageLabel(loc.pathname)}</span>
          </nav>
        </div>
        <div className="hidden items-center gap-3 text-xs text-slate-600 sm:flex">{right}</div>
      </header>

      {menuOpen && (
        <div className="fixed inset-0 z-[60] flex justify-start">
          <button
            type="button"
            className="absolute inset-0 cursor-pointer bg-slate-900/40"
            aria-label="Close menu"
            onClick={() => setMenuOpen(false)}
          />
          <aside className="relative z-10 flex h-full w-[min(100vw,20rem)] flex-col border-r border-slate-200 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <div>
                <div className="text-sm font-semibold text-slate-900">Menu</div>
                <div className="text-[11px] text-slate-500">{pageLabel(loc.pathname)}</div>
              </div>
              <button
                type="button"
                onClick={() => setMenuOpen(false)}
                className="cursor-pointer rounded-md bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-200"
              >
                Close
              </button>
            </div>
            <nav className="flex flex-1 flex-col gap-1.5 p-3">
              {TABS.map((t) => {
                const active =
                  t.to === '/'
                    ? loc.pathname === '/'
                    : loc.pathname === t.to || loc.pathname.startsWith(t.to + '/')
                return (
                  <Link
                    key={t.to}
                    to={t.to}
                    className={`cursor-pointer rounded-lg px-3 py-2.5 text-sm font-semibold transition-colors ${
                      active ? t.active : t.idle
                    }`}
                  >
                    {t.label}
                  </Link>
                )
              })}
            </nav>
            <div className="border-t border-slate-200 p-3 sm:hidden">
              <div className="mb-2 text-xs text-slate-600">{right}</div>
            </div>
            <div className="border-t border-slate-200 p-3">
              <button
                type="button"
                onClick={logout}
                className="w-full cursor-pointer rounded-md bg-slate-800 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-700"
              >
                Log out
              </button>
            </div>
          </aside>
        </div>
      )}
    </>
  )
}
