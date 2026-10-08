import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, type Health, type SyncStatus } from '../api'
import AppNav from '../components/AppNav'

function todayISO() {
  return new Date().toISOString().slice(0, 10)
}

function daysAgoISO(days: number) {
  const d = new Date()
  d.setDate(d.getDate() - days)
  return d.toISOString().slice(0, 10)
}

const MIN_AUTO_MINUTES = 10

export default function Sync() {
  const [health, setHealth] = useState<Health | null>(null)
  const [sync, setSync] = useState<SyncStatus | null>(null)
  const [dateFrom, setDateFrom] = useState(daysAgoISO(90))
  const [dateTo, setDateTo] = useState(todayISO())
  const [autoEnabled, setAutoEnabled] = useState(false)
  const [autoMinutes, setAutoMinutes] = useState(MIN_AUTO_MINUTES)
  const [nextRunAt, setNextRunAt] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')
  const [savingAuto, setSavingAuto] = useState(false)

  const refreshSync = useCallback(async () => {
    try {
      setSync(await api.syncStatus())
    } catch {
      /* ignore */
    }
  }, [])

  const loadAuto = useCallback(async () => {
    try {
      const s = await api.getAutoSync()
      setAutoEnabled(!!s.enabled)
      setAutoMinutes(Math.max(MIN_AUTO_MINUTES, s.interval_minutes || MIN_AUTO_MINUTES))
      setNextRunAt(s.next_run_at || null)
    } catch (e) {
      setError(String(e))
    }
  }, [])

  useEffect(() => {
    api.health().then(setHealth).catch((e) => setError(String(e)))
    refreshSync()
    loadAuto()
  }, [refreshSync, loadAuto])

  useEffect(() => {
    if (!sync?.running) return
    const t = setInterval(async () => {
      const s = await api.syncStatus()
      setSync(s)
      if (!s.running) {
        if (s.error || s.phase === 'error') {
          setError(s.error || s.message || 'Sync failed')
        } else {
          setMsg(s.message || 'Sync finished')
          setError('')
        }
        loadAuto()
      }
    }, 2500)
    return () => clearInterval(t)
  }, [sync?.running, loadAuto])

  // Light idle poll only when auto-sync is on (not every few seconds forever)
  useEffect(() => {
    if (sync?.running || !autoEnabled) return
    const t = setInterval(() => {
      refreshSync()
      loadAuto()
    }, 60_000)
    return () => clearInterval(t)
  }, [sync?.running, autoEnabled, refreshSync, loadAuto])

  const runSync = async (mode: 'all' | 'range' | 'new') => {
    setError('')
    setMsg('')
    try {
      const res =
        mode === 'range'
          ? await api.sync({ mode: 'range', date_from: dateFrom, date_to: dateTo })
          : await api.sync({ mode })
      if (!res.ok) {
        setError(res.error || 'Could not start sync')
        return
      }
      setMsg(
        mode === 'all'
          ? 'Full mailbox sync started…'
          : mode === 'new'
            ? 'Syncing new emails…'
            : `Syncing ${dateFrom} → ${dateTo}…`,
      )
      const s = await api.syncStatus()
      setSync(s)
    } catch (e) {
      setError(String(e))
    }
  }

  const saveAuto = async (enabled = autoEnabled, minutes = autoMinutes) => {
    setSavingAuto(true)
    setError('')
    try {
      const mins = Math.max(MIN_AUTO_MINUTES, Number(minutes) || MIN_AUTO_MINUTES)
      const s = await api.setAutoSync({ enabled, interval_minutes: mins })
      setAutoEnabled(!!s.enabled)
      setAutoMinutes(Math.max(MIN_AUTO_MINUTES, s.interval_minutes))
      setNextRunAt(s.next_run_at || null)
      setMsg(
        s.enabled
          ? `Auto-sync on — every ${s.interval_minutes} min (new emails only)`
          : 'Auto-sync turned off',
      )
    } catch (e) {
      setError(String(e))
    } finally {
      setSavingAuto(false)
    }
  }

  const running = !!sync?.running

  return (
    <div className="flex h-full flex-col">
      <AppNav
        right={
          <span>
            IMAP {health?.imap_configured ? '✓' : '✗'} · Cached {sync?.cached_total ?? '—'}
          </span>
        }
      />

      <div className="min-h-0 flex-1 overflow-y-auto bg-[#141414] px-4 py-6">
        <div className="mx-auto max-w-3xl space-y-6">
          <div>
            <h1 className="text-xl font-semibold text-white">Sync Data</h1>
            <p className="mt-1 text-sm text-zinc-400">
              Pull emails from IMAP into the local cache. One Sync click = one job. Long date ranges
              are searched month-by-month inside that job (normal for Bluehost). Do not open emails
              until sync finishes.
            </p>
          </div>

          {(error || msg) && (
            <div className="rounded-lg border border-[#333] bg-[#1a1a1a] px-4 py-3 text-sm">
              {error && <div className="text-red-400">{error}</div>}
              {msg && <div className="text-emerald-400">{msg}</div>}
            </div>
          )}

          {sync && (
            <div className="rounded-lg border border-[#333] bg-[#1a1a1a] px-4 py-3 text-sm text-zinc-300">
              {running ? (
                <div>
                  <span className="font-medium text-amber-300">Syncing…</span> {sync.message}{' '}
                  ({sync.done}/{sync.total})
                </div>
              ) : sync.phase === 'error' ? (
                <div className="text-red-400">
                  Last sync error: {sync.error || sync.message}
                </div>
              ) : sync.last_sync_at ? (
                <div>
                  Last sync <span className="text-white">{sync.last_sync_at}</span> ·{' '}
                  {sync.last_sync_count || 0} messages
                </div>
              ) : (
                <div className="text-zinc-500">Not synced yet</div>
              )}
            </div>
          )}

          {!health?.imap_configured && (
            <div className="rounded-lg border border-amber-800/50 bg-amber-950/30 px-4 py-3 text-sm text-amber-300">
              IMAP is not configured.{' '}
              <Link to="/settings" className="cursor-pointer underline hover:text-amber-200">
                Open Settings
              </Link>
            </div>
          )}

          {/* Full sync */}
          <section className="rounded-xl border border-[#333] bg-[#1a1a1a] p-5">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-400">
              1 · Whole mailbox
            </h2>
            <p className="mt-2 text-sm text-zinc-400">
              Download headers for the full mailbox history (long range — may take several minutes).
            </p>
            <button
              type="button"
              disabled={running || !health?.imap_configured}
              onClick={() => runSync('all')}
              className="mt-4 cursor-pointer rounded-md bg-red-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {running ? 'Syncing…' : 'Sync whole mailbox'}
            </button>
          </section>

          {/* Date range */}
          <section className="rounded-xl border border-[#333] bg-[#1a1a1a] p-5">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-400">
              2 · Date range
            </h2>
            <p className="mt-2 text-sm text-zinc-400">
              Sync only emails between the dates you choose.
            </p>
            <div className="mt-4 flex flex-wrap items-end gap-3">
              <label className="text-xs text-zinc-400">
                From
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  className="mt-1 block cursor-pointer rounded-md border border-[#444] bg-[#111] px-2 py-1.5 text-sm text-white"
                />
              </label>
              <label className="text-xs text-zinc-400">
                To
                <input
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  className="mt-1 block cursor-pointer rounded-md border border-[#444] bg-[#111] px-2 py-1.5 text-sm text-white"
                />
              </label>
              <div className="flex flex-wrap gap-1 rounded-lg bg-[#111] p-1">
                {[
                  ['30d', 30],
                  ['3mo', 90],
                  ['9mo', 270],
                ].map(([label, days]) => (
                  <button
                    key={String(label)}
                    type="button"
                    onClick={() => {
                      setDateFrom(daysAgoISO(Number(days)))
                      setDateTo(todayISO())
                    }}
                    className="cursor-pointer rounded-md px-3 py-1.5 text-xs font-medium text-zinc-300 hover:bg-[#2a2a2a] hover:text-white"
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <button
              type="button"
              disabled={running || !health?.imap_configured}
              onClick={() => runSync('range')}
              className="mt-4 cursor-pointer rounded-md bg-zinc-100 px-4 py-2.5 text-sm font-medium text-zinc-900 hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              {running ? 'Syncing…' : 'Sync date range'}
            </button>
          </section>

          {/* New + auto timer */}
          <section className="rounded-xl border border-[#333] bg-[#1a1a1a] p-5">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-400">
              3 · New emails &amp; auto-sync timer
            </h2>
            <p className="mt-2 text-sm text-zinc-400">
              Pull only newer mail (since last sync). Turn on the timer to repeat automatically —
              minimum interval is {MIN_AUTO_MINUTES} minutes.
            </p>

            <button
              type="button"
              disabled={running || !health?.imap_configured}
              onClick={() => runSync('new')}
              className="mt-4 cursor-pointer rounded-md bg-[#333] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#444] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {running ? 'Syncing…' : 'Sync new emails now'}
            </button>

            <div className="mt-6 border-t border-[#2a2a2a] pt-5">
              <label className="flex cursor-pointer items-center gap-3">
                <input
                  type="checkbox"
                  className="h-4 w-4 cursor-pointer accent-red-600"
                  checked={autoEnabled}
                  disabled={savingAuto || !health?.imap_configured}
                  onChange={(e) => {
                    const on = e.target.checked
                    setAutoEnabled(on)
                    saveAuto(on, autoMinutes)
                  }}
                />
                <span className="text-sm font-medium text-white">Enable auto-sync timer</span>
              </label>

              <div className="mt-4 flex flex-wrap items-end gap-3">
                <label className="text-xs text-zinc-400">
                  Interval (minutes)
                  <input
                    type="number"
                    min={MIN_AUTO_MINUTES}
                    step={5}
                    value={autoMinutes}
                    disabled={!autoEnabled || savingAuto}
                    onChange={(e) =>
                      setAutoMinutes(
                        Math.max(MIN_AUTO_MINUTES, Number(e.target.value) || MIN_AUTO_MINUTES),
                      )
                    }
                    className="mt-1 block w-28 cursor-pointer rounded-md border border-[#444] bg-[#111] px-2 py-1.5 text-sm text-white disabled:opacity-40"
                  />
                </label>
                <button
                  type="button"
                  disabled={!autoEnabled || savingAuto || !health?.imap_configured}
                  onClick={() => saveAuto(true, autoMinutes)}
                  className="cursor-pointer rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {savingAuto ? 'Saving…' : 'Save interval'}
                </button>
              </div>

              {autoEnabled && (
                <p className="mt-3 text-xs text-zinc-500">
                  Auto-sync runs in the background even if this tab is closed.
                  {nextRunAt ? (
                    <>
                      {' '}
                      Next run around <span className="text-zinc-300">{nextRunAt}</span>.
                    </>
                  ) : null}
                </p>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
