import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  PAGE_SIZE,
  api,
  type EmailDetail,
  type EmailSummary,
  type Health,
  type Offer,
  type SyncStatus,
} from '../api'

const PAGE_SIZE_OPTIONS = [50, 100, 150, 200] as const
import OffersEditor from '../components/OffersEditor'
import AttachmentPreviewPanel from '../components/AttachmentPreviewPanel'
import AppNav from '../components/AppNav'
import { downloadAttachmentFile } from '../openAttachment'

function todayISO() {
  return new Date().toISOString().slice(0, 10)
}

function daysAgoISO(days: number) {
  const d = new Date()
  d.setDate(d.getDate() - days)
  return d.toISOString().slice(0, 10)
}

function shortFrom(from: string) {
  const m = from.match(/^"?([^"<]+)"?\s*</)
  if (m?.[1]?.trim()) return m[1].trim()
  return from.length > 42 ? from.slice(0, 42) + '…' : from
}

const STATUS_TABS: { value: string; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'none', label: 'Not started' },
  { value: 'pending', label: 'Queued' },
  { value: 'running', label: 'Processing' },
  { value: 'completed', label: 'Complete' },
  { value: 'error', label: 'Error' },
]

const FORWARD_TABS: { value: string; label: string }[] = [
  { value: 'all', label: 'Any send' },
  { value: 'none', label: 'Not sent' },
  { value: 'sent', label: 'Sent' },
  { value: 'error', label: 'Send failed' },
]

function StatusTag({
  status,
  error,
  forwardStatus,
}: {
  status?: string
  error?: string | null
  forwardStatus?: string
}) {
  const s = status || 'none'
  const f = forwardStatus || 'none'
  return (
    <div className="flex shrink-0 flex-col items-end gap-1">
      {s === 'completed' && (
        <span
          className="rounded bg-emerald-900/90 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-300"
          title="OpenAI extraction complete — data saved"
        >
          Complete
        </span>
      )}
      {s === 'pending' && (
        <span
          className="rounded bg-sky-900/90 px-1.5 py-0.5 text-[10px] font-semibold text-sky-300"
          title="Queued for OpenAI"
        >
          Queued
        </span>
      )}
      {s === 'running' && (
        <span
          className="rounded bg-amber-900/90 px-1.5 py-0.5 text-[10px] font-semibold text-amber-300"
          title="OpenAI is processing this email"
        >
          Processing
        </span>
      )}
      {s === 'error' && (
        <span
          className="rounded bg-red-900/90 px-1.5 py-0.5 text-[10px] font-semibold text-red-300"
          title={error || 'OpenAI extraction failed — open email for details'}
        >
          Error
        </span>
      )}
      {f === 'sent' && (
        <span
          className="rounded bg-violet-900/90 px-1.5 py-0.5 text-[10px] font-semibold text-violet-300"
          title="Sent to Google Sheet webhook"
        >
          Sent
        </span>
      )}
      {f === 'error' && (
        <span
          className="rounded bg-orange-900/90 px-1.5 py-0.5 text-[10px] font-semibold text-orange-300"
          title="Sheet webhook send failed"
        >
          Send failed
        </span>
      )}
    </div>
  )
}

export default function Inbox() {
  const [health, setHealth] = useState<Health | null>(null)
  const [emails, setEmails] = useState<EmailSummary[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(PAGE_SIZE)
  const [q, setQ] = useState('')
  const [qDebounced, setQDebounced] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [forwardFilter, setForwardFilter] = useState('all')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [activeUid, setActiveUid] = useState<string | null>(null)
  const [detail, setDetail] = useState<EmailDetail | null>(null)
  const [sync, setSync] = useState<SyncStatus | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [sendingSheet, setSendingSheet] = useState(false)
  const [jobMsg, setJobMsg] = useState('')
  const [offers, setOffers] = useState<Offer[]>([])
  const [extractionId, setExtractionId] = useState<number | null>(null)
  const [extractionStatus, setExtractionStatus] = useState('none')
  const [extractionError, setExtractionError] = useState<string | null>(null)
  const [compareOpen, setCompareOpen] = useState(false)
  const [previewTabKey, setPreviewTabKey] = useState<string>('email')

  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const rangeStart = total === 0 ? 0 : (page - 1) * pageSize + 1
  const rangeEnd = Math.min(page * pageSize, total)

  const filtersActive = !!(
    qDebounced ||
    dateFrom ||
    dateTo ||
    statusFilter !== 'all' ||
    forwardFilter !== 'all'
  )

  const clearFilters = () => {
    setQ('')
    setQDebounced('')
    setDateFrom('')
    setDateTo('')
    setStatusFilter('all')
    setForwardFilter('all')
    setPage(1)
  }

  useEffect(() => {
    const t = setTimeout(() => setQDebounced(q), 350)
    return () => clearTimeout(t)
  }, [q])

  const loadEmails = useCallback(async () => {
    try {
      const data = await api.emails({
        q: qDebounced,
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
        extraction_status: statusFilter,
        forward_status: forwardFilter,
        limit: pageSize,
        offset: (page - 1) * pageSize,
      })
      setEmails(data.items)
      setTotal(data.total)
      const maxPage = Math.max(1, Math.ceil(data.total / pageSize))
      if (page > maxPage) setPage(maxPage)
    } catch (e) {
      setError(String(e))
    }
  }, [qDebounced, dateFrom, dateTo, statusFilter, forwardFilter, page, pageSize])

  const refreshSync = useCallback(async () => {
    try {
      setSync(await api.syncStatus())
    } catch {
      /* ignore */
    }
  }, [])

  useEffect(() => {
    api.health().then(setHealth).catch((e) => setError(String(e)))
    refreshSync()
  }, [refreshSync])

  useEffect(() => {
    loadEmails()
  }, [loadEmails])

  useEffect(() => {
    setPage(1)
  }, [qDebounced, dateFrom, dateTo, statusFilter, forwardFilter, pageSize])

  useEffect(() => {
    if (!sync?.running) return
    const t = setInterval(async () => {
      const s = await api.syncStatus()
      setSync(s)
      if (!s.running) {
        setPage(1)
        await loadEmails()
        api.health().then(setHealth).catch(() => undefined)
      }
    }, 2500)
    return () => clearInterval(t)
  }, [sync?.running, loadEmails])

  useEffect(() => {
    const busyAi = emails.some(
      (e) => e.extraction_status === 'pending' || e.extraction_status === 'running',
    )
    if (!busyAi) return
    const t = setInterval(() => {
      loadEmails()
      if (activeUid) {
        api
          .emailExtraction(activeUid)
          .then((ext) => {
            setExtractionId(ext.id ?? null)
            setExtractionStatus(ext.status || 'none')
            setExtractionError(ext.error || null)
            setOffers(ext.offers || [])
          })
          .catch(() => undefined)
      }
    }, 2500)
    return () => clearInterval(t)
  }, [emails, activeUid, loadEmails])

  const openEmail = async (uid: string, opts?: { keepCompare?: boolean }) => {
    const keepCompare = Boolean(opts?.keepCompare)
    setActiveUid(uid)
    // Keep previous Comparison content visible while loading (avoids flicker)
    if (!keepCompare) {
      setDetail(null)
      setOffers([])
      setExtractionId(null)
      setExtractionStatus('none')
      setExtractionError(null)
      setCompareOpen(false)
    }
    setPreviewTabKey('email')
    setBusy(true)
    setError('')
    try {
      // Extraction is local/fast — load it first so the UI isn't empty while IMAP runs
      const ext = await api.emailExtraction(uid)
      setExtractionId(ext.id ?? null)
      setExtractionStatus(ext.status || 'none')
      setExtractionError(ext.error || null)
      setOffers(ext.offers || [])
      const msg = await api.email(uid)
      setDetail(msg)
    } catch (e) {
      const text = String(e)
      if (text.toLowerCase().includes('sync') || text.toLowerCase().includes('busy')) {
        setError(text)
      } else {
        setError(
          `Could not load email body from the mail server. ${text} ` +
            (sync?.running
              ? 'Sync is still running — wait for it to finish, then open again.'
              : 'Try again in a moment.'),
        )
      }
    } finally {
      setBusy(false)
    }
  }

  const activeEmailIndex = useMemo(
    () => (activeUid ? emails.findIndex((e) => e.uid === activeUid) : -1),
    [emails, activeUid],
  )
  const globalEmailIndex =
    activeEmailIndex >= 0 ? (page - 1) * pageSize + activeEmailIndex : -1
  const canComparePrev = globalEmailIndex > 0
  const canCompareNext = globalEmailIndex >= 0 && globalEmailIndex < total - 1

  const goCompareEmail = (uid: string | null | undefined) => {
    if (!uid || busy) return
    void openEmail(uid, { keepCompare: true })
  }

  /** Navigate Comparison across the full filtered list (not only this page). */
  const goCompareByGlobalOffset = async (offset: number) => {
    if (offset < 0 || offset >= total || busy) return
    const localIdx = offset - (page - 1) * pageSize
    if (localIdx >= 0 && localIdx < emails.length) {
      goCompareEmail(emails[localIdx]?.uid)
      return
    }
    setBusy(true)
    try {
      const data = await api.emails({
        q: qDebounced,
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
        extraction_status: statusFilter,
        forward_status: forwardFilter,
        limit: 1,
        offset,
      })
      const uid = data.items[0]?.uid
      if (!uid) {
        setBusy(false)
        return
      }
      const targetPage = Math.floor(offset / pageSize) + 1
      if (targetPage !== page) setPage(targetPage)
      await openEmail(uid, { keepCompare: true })
    } catch (e) {
      setBusy(false)
      setError(String(e))
    }
  }

  const goComparePrev = () => {
    if (!canComparePrev || busy) return
    void goCompareByGlobalOffset(globalEmailIndex - 1)
  }

  const goCompareNext = () => {
    if (!canCompareNext || busy) return
    void goCompareByGlobalOffset(globalEmailIndex + 1)
  }

  const toggle = (uid: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(uid)) next.delete(uid)
      else next.add(uid)
      return next
    })
  }

  const pageUids = useMemo(() => emails.map((e) => e.uid), [emails])
  const allPageSelected =
    pageUids.length > 0 && pageUids.every((uid) => selected.has(uid))

  /** Add/remove only this page’s emails — keep selections from other pages. */
  const toggleAll = () => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (allPageSelected) {
        for (const uid of pageUids) next.delete(uid)
      } else {
        for (const uid of pageUids) next.add(uid)
      }
      return next
    })
  }

  const sendToAi = async (force = false) => {
    if (selected.size === 0) return
    const uids = [...selected]
    setJobMsg('')
    setError('')
    try {
      const { job_id } = await api.extract(uids, force)
      setSelected(new Set())
      setEmails((prev) =>
        prev.map((e) =>
          uids.includes(e.uid)
            ? { ...e, extraction_status: 'pending', extraction_error: null }
            : e,
        ),
      )
      setJobMsg(
        `Queued ${uids.length} email(s) as job #${job_id}. Status tags will update as OpenAI finishes.`,
      )
    } catch (e) {
      setError(String(e))
    }
  }

  const sendToSheet = async (uidsOverride?: string[]) => {
    const uids = uidsOverride?.length ? uidsOverride : [...selected]
    if (uids.length === 0 || sendingSheet) return
    const readyUids = uids.filter((uid) => {
      if (uid === activeUid && extractionStatus === 'completed') return true
      return emails.some((e) => e.uid === uid && e.extraction_status === 'completed')
    })
    if (readyUids.length === 0) {
      setError('This email must be Complete (extracted) before sending to the sheet.')
      return
    }
    const alreadySent = readyUids.filter((uid) => {
      const fromList = emails.find((e) => e.uid === uid)?.forward_status
      const fromDetail =
        detail?.uid === uid ? detail.forward_status : undefined
      return (fromList || fromDetail) === 'sent'
    })
    if (alreadySent.length > 0) {
      const ok = window.confirm(
        alreadySent.length === 1 && readyUids.length === 1
          ? 'This quotation was already sent to Google Sheet.\n\nDo you want to send it again?'
          : `${alreadySent.length} of ${readyUids.length} selected quotation(s) were already sent to Google Sheet.\n\nDo you want to send them again?`,
      )
      if (!ok) return
    }
    setJobMsg(`Sending ${readyUids.length} quotation(s) to Google Sheet…`)
    setError('')
    setSendingSheet(true)
    try {
      const res = await api.forwardSelected(readyUids)
      setEmails((prev) =>
        prev.map((e) => {
          if (!readyUids.includes(e.uid)) return e
          const failed = res.errors?.some((x) => x.email_uid === e.uid)
          return { ...e, forward_status: failed ? 'error' : 'sent' }
        }),
      )
      if (!uidsOverride) setSelected(new Set())
      if (res.sent > 0 && res.failed === 0) {
        setJobMsg(`Sent ${res.sent} quotation(s) to Google Sheet.`)
        setError('')
      } else if (res.sent > 0) {
        setJobMsg(`Sent ${res.sent} quotation(s). ${res.failed} failed.`)
        setError(res.errors.map((x) => x.error).join('; '))
      } else {
        setJobMsg('')
        setError(
          res.errors?.map((x) => x.error).join('; ') ||
            'Send failed — check webhook URL/token in Settings and your internet connection.',
        )
      }
      await loadEmails()
    } catch (e) {
      setJobMsg('')
      setError(String(e))
    } finally {
      setSendingSheet(false)
    }
  }

  const bodyHtml = useMemo(() => {
    if (!detail) return ''
    if (detail.body_html) return detail.body_html
    const plain = (detail.body_text || '(empty body)').replace(/</g, '&lt;')
    return `<pre style="white-space:pre-wrap;font-family:Segoe UI,sans-serif">${plain}</pre>`
  }, [detail])

  return (
    <div className="flex h-full flex-col">
      <AppNav
        right={
          <>
            <span>
              IMAP {health?.imap_configured ? '✓' : '✗'} · OpenAI{' '}
              {health?.openai_configured ? '✓' : '✗'}
            </span>
            <span>{total} shown</span>
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-2 border-b border-[#333] bg-[#222] px-3 py-2">
        <input
          type="date"
          value={dateFrom}
          onChange={(e) => setDateFrom(e.target.value)}
          title="From date"
          className="cursor-pointer rounded border border-[#444] bg-[#111] px-1.5 py-1 text-xs text-white"
        />
        <span className="text-[10px] text-zinc-500">→</span>
        <input
          type="date"
          value={dateTo}
          onChange={(e) => setDateTo(e.target.value)}
          title="To date"
          className="cursor-pointer rounded border border-[#444] bg-[#111] px-1.5 py-1 text-xs text-white"
        />
        <div className="flex gap-0.5">
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
              className="cursor-pointer rounded px-1.5 py-1 text-[11px] text-zinc-400 hover:bg-[#2a2a2a] hover:text-white"
            >
              {label}
            </button>
          ))}
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          title="Extraction status"
          className="cursor-pointer rounded border border-[#444] bg-[#111] px-1.5 py-1 text-xs text-white"
        >
          {STATUS_TABS.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
        <select
          value={forwardFilter}
          onChange={(e) => setForwardFilter(e.target.value)}
          title="Sheet send status"
          className="cursor-pointer rounded border border-[#444] bg-[#111] px-1.5 py-1 text-xs text-white"
        >
          {FORWARD_TABS.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={clearFilters}
          disabled={!filtersActive}
          className="cursor-pointer rounded border border-[#444] px-2 py-1 text-[11px] text-zinc-400 hover:bg-[#333] disabled:opacity-40"
        >
          Clear
        </button>
        <button
          type="button"
          onClick={loadEmails}
          className="cursor-pointer rounded bg-[#333] px-2 py-1 text-[11px] hover:bg-[#444]"
        >
          Refresh
        </button>
        <Link
          to="/sync"
          className="cursor-pointer rounded bg-red-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-red-500"
        >
          Sync
        </Link>
        {sync?.running && (
          <span className="text-[11px] text-amber-300">
            Syncing… {sync.done}/{sync.total}
          </span>
        )}
        {!health?.imap_configured && (
          <Link to="/settings" className="cursor-pointer text-[11px] text-amber-400 hover:underline">
            Configure IMAP →
          </Link>
        )}
      </div>

      {(error || jobMsg || sendingSheet) && (
        <div className="border-b border-[#333] px-4 py-2 text-sm">
          {sendingSheet && (
            <div className="mb-1 flex items-center gap-2 text-amber-300">
              <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-amber-300 border-t-transparent" />
              Sending to Google Sheet — please wait…
            </div>
          )}
          {error && <div className="text-red-400">{error}</div>}
          {jobMsg && !sendingSheet && <div className="text-emerald-400">{jobMsg}</div>}
          {jobMsg && sendingSheet && <div className="text-amber-200/90">{jobMsg}</div>}
        </div>
      )}

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-2">
        <section className="flex min-h-0 flex-col border-r border-[#333] bg-[#1e1e1e]">
          <div className="border-b border-[#333] p-3">
            <div className="flex items-center gap-2 rounded border border-[#444] bg-[#2d2d30] px-3">
              <span className="text-zinc-500">⌕</span>
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search sender, subject, address…"
                className="w-full cursor-text bg-transparent py-2.5 text-sm outline-none placeholder:text-zinc-500"
              />
            </div>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-500">
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  className="cursor-pointer"
                  checked={allPageSelected}
                  onChange={toggleAll}
                />
                Select all on this page
              </label>
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-1.5 text-zinc-400">
                  Per page
                  <select
                    value={pageSize}
                    onChange={(e) => setPageSize(Number(e.target.value))}
                    className="cursor-pointer rounded border border-[#444] bg-[#111] px-1.5 py-1 text-xs text-white"
                    title="How many emails to show on each page"
                  >
                    {PAGE_SIZE_OPTIONS.map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </label>
                <span>
                  {selected.size} selected · {rangeStart}–{rangeEnd} of {total}
                </span>
              </div>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {emails.length === 0 && (
              <div className="p-8 text-center text-sm text-zinc-500">
                No emails match these filters.{' '}
                <Link to="/sync" className="cursor-pointer text-red-400 hover:underline">
                  Sync Data
                </Link>{' '}
                to pull mail, or clear filters.
              </div>
            )}
            {emails.map((e, i) => {
              const active = e.uid === activeUid
              const checked = selected.has(e.uid)
              return (
                <div
                  key={e.uid}
                  className={`flex cursor-pointer gap-2 border-b border-[#2a2a2a] px-3 py-3 ${
                    active ? 'bg-[#3a3a3d]' : i % 2 ? 'bg-[#252526]' : 'bg-[#1e1e1e]'
                  } hover:bg-[#333337]`}
                  onClick={() => openEmail(e.uid)}
                >
                  <input
                    type="checkbox"
                    className="mt-1 cursor-pointer"
                    checked={checked}
                    onChange={() => toggle(e.uid)}
                    onClick={(ev) => ev.stopPropagation()}
                  />
                  <div className="min-w-0 flex-1 text-left">
                    <div className="flex items-start justify-between gap-2">
                      <span
                        className={`truncate text-sm font-semibold ${active ? 'text-red-400' : 'text-zinc-100'}`}
                      >
                        {shortFrom(e.from_addr)}
                      </span>
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        <span className="text-xs text-zinc-500">{e.date_str}</span>
                        <StatusTag
                          status={e.extraction_status}
                          error={e.extraction_error}
                          forwardStatus={e.forward_status}
                        />
                      </div>
                    </div>
                    <div className="mt-0.5 flex items-center gap-2">
                      <span className="truncate text-sm text-zinc-300">
                        {e.subject || '(no subject)'}
                      </span>
                      {!!e.has_attachments && <span className="shrink-0 text-red-400">📎</span>}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          <div className="flex items-center justify-between gap-2 border-t border-[#333] bg-[#181818] px-3 py-2">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="cursor-pointer rounded bg-[#333] px-3 py-1.5 text-xs hover:bg-[#444] disabled:cursor-not-allowed disabled:opacity-40"
            >
              ← Newer
            </button>
            <span className="text-xs text-zinc-400">
              Page {page} of {totalPages}
            </span>
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              className="cursor-pointer rounded bg-[#333] px-3 py-1.5 text-xs hover:bg-[#444] disabled:cursor-not-allowed disabled:opacity-40"
            >
              Older →
            </button>
          </div>

          <div className="grid grid-cols-3 gap-1.5 border-t border-[#333] bg-[#181818] px-2 py-2">
            <button
              type="button"
              disabled={selected.size === 0}
              onClick={() => sendToAi(false)}
              title="Send selected to OpenAI"
              className="cursor-pointer rounded bg-red-600 px-1 py-1.5 text-[11px] font-medium text-white hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-40"
            >
              OpenAI{selected.size ? ` (${selected.size})` : ''}
            </button>
            <button
              type="button"
              disabled={selected.size === 0}
              onClick={() => sendToAi(true)}
              title="Re-extract selected (force, uses API again)"
              className="cursor-pointer rounded border border-[#444] px-1 py-1.5 text-[11px] text-zinc-300 hover:bg-[#2a2a2a] disabled:opacity-40"
            >
              Re-extract
            </button>
            <button
              type="button"
              disabled={
                sendingSheet ||
                selected.size === 0 ||
                ![...selected].some((uid) =>
                  emails.some((e) => e.uid === uid && e.extraction_status === 'completed'),
                )
              }
              onClick={() => sendToSheet()}
              className="cursor-pointer rounded bg-violet-700 px-1 py-1.5 text-[11px] font-medium text-white hover:bg-violet-600 disabled:cursor-not-allowed disabled:opacity-40"
              title="Send selected to Google Sheet"
            >
              {sendingSheet ? 'Sending…' : 'Sheet'}
            </button>
          </div>
        </section>

        <section className="flex min-h-0 flex-col bg-[#f4f4f4] text-zinc-900">
          {!detail && (
            <div className="flex flex-1 items-center justify-center text-sm text-zinc-500">
              {busy ? 'Loading message…' : 'Select an email to preview'}
            </div>
          )}
          {detail && (
            <div className="min-h-0 flex-1 overflow-y-auto">
              <div className="border-b border-zinc-200 bg-white px-3 py-2">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <h2 className="truncate text-sm font-semibold leading-snug">{detail.subject}</h2>
                    <p className="mt-0.5 truncate text-[11px] text-zinc-500">
                      {detail.from_addr}
                      <span className="mx-1 text-zinc-300">·</span>
                      {detail.date_str}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-1.5">
                    <button
                      type="button"
                      onClick={() => setCompareOpen(true)}
                      className="cursor-pointer rounded bg-red-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-red-500"
                    >
                      Compare
                    </button>
                    <button
                      type="button"
                      disabled={extractionStatus !== 'completed' || !activeUid || sendingSheet}
                      onClick={() => activeUid && sendToSheet([activeUid])}
                      className="cursor-pointer rounded bg-violet-700 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-violet-600 disabled:cursor-not-allowed disabled:opacity-40"
                      title={
                        extractionStatus === 'completed'
                          ? 'Send this email’s extracted offers to Google Sheet'
                          : 'Extract with OpenAI first (must be Complete)'
                      }
                    >
                      {sendingSheet
                        ? '…'
                        : detail.forward_status === 'sent' ||
                            emails.find((e) => e.uid === detail.uid)?.forward_status === 'sent'
                          ? 'Resend sheet'
                          : 'Send sheet'}
                    </button>
                  </div>
                </div>
                {(extractionStatus === 'pending' || extractionStatus === 'running') && (
                  <div className="mt-1.5 text-[11px] text-amber-700">
                    {extractionStatus === 'pending' ? 'Queued' : 'Processing'} — waiting for OpenAI…
                  </div>
                )}
                {extractionStatus === 'error' && (
                  <div className="mt-1.5 rounded border border-red-200 bg-red-50 px-2 py-1.5 text-[11px] text-red-800">
                    <div className="font-semibold">OpenAI error</div>
                    <div className="mt-0.5 line-clamp-3 whitespace-pre-wrap break-words">
                      {extractionError || 'Unknown error while extracting this email.'}
                    </div>
                    <button
                      type="button"
                      className="mt-1 cursor-pointer rounded bg-red-700 px-2 py-0.5 text-[10px] text-white hover:bg-red-600"
                      onClick={() => {
                        if (activeUid) {
                          setSelected(new Set([activeUid]))
                          sendToAi(true)
                        }
                      }}
                    >
                      Retry
                    </button>
                  </div>
                )}
              </div>
              {detail.attachments?.length > 0 && (
                <div className="border-b border-zinc-200 bg-zinc-50 px-5 py-2.5">
                  <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
                    Attachments ({detail.attachments.length})
                  </div>
                  <ul className="space-y-1.5">
                    {detail.attachments.map((a, i) => {
                      const idx = typeof a.index === 'number' ? a.index : i
                      const sizeKb =
                        a.size >= 1024
                          ? `${Math.max(1, Math.round(a.size / 1024))} KB`
                          : `${a.size} B`
                      const downloadUrl = api.attachmentUrl(detail.uid, idx, false)
                      const tabKey = `att-${idx}`
                      const isOpen = previewTabKey === tabKey
                      return (
                        <li
                          key={`${a.filename}-${idx}`}
                          className={`flex flex-wrap items-center gap-2 rounded border px-2.5 py-1.5 text-sm ${
                            isOpen
                              ? 'border-zinc-800 bg-zinc-100'
                              : 'border-zinc-200 bg-white'
                          }`}
                        >
                          <span
                            className="mr-auto truncate font-medium text-zinc-800"
                            title={a.filename}
                          >
                            📎 {a.filename}
                            <span className="ml-2 text-xs font-normal text-zinc-400">{sizeKb}</span>
                          </span>
                          <button
                            type="button"
                            className={`cursor-pointer rounded px-3 py-1 text-xs text-white ${
                              isOpen ? 'bg-red-600 hover:bg-red-500' : 'bg-zinc-800 hover:bg-zinc-700'
                            }`}
                            onClick={() => {
                              setPreviewTabKey(tabKey)
                              requestAnimationFrame(() => {
                                document
                                  .getElementById('inbox-preview-body')
                                  ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                              })
                            }}
                          >
                            {isOpen ? 'Viewing' : 'Open'}
                          </button>
                          <button
                            type="button"
                            className="cursor-pointer rounded border border-zinc-300 px-3 py-1 text-xs text-zinc-700 hover:bg-zinc-100"
                            onClick={() =>
                              downloadAttachmentFile(downloadUrl, a.filename).catch((e) =>
                                setError(String(e)),
                              )
                            }
                          >
                            Download
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                </div>
              )}
              <div id="inbox-preview-body">
                <AttachmentPreviewPanel
                  detail={detail}
                  showEmailBody
                  bodyHtml={bodyHtml}
                  focusTabKey={previewTabKey}
                  onTabChange={setPreviewTabKey}
                  pageScroll
                />
              </div>
            </div>
          )}
        </section>
      </div>

      {compareOpen && detail && (
        <div className="fixed inset-0 z-50 flex flex-col bg-[#0f0f0f]/90 backdrop-blur-sm">
          <div className="flex items-center gap-3 border-b border-[#333] bg-[#1a1a1a] px-4 py-3">
            <div className="text-sm font-semibold text-white">Comparison</div>
            <div className="min-w-0 flex-1 truncate text-xs text-zinc-400">
              {busy ? 'Loading email…' : detail.subject}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                disabled={!canComparePrev || busy}
                onClick={goComparePrev}
                className="cursor-pointer rounded-md bg-sky-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-40"
                title="Previous email (all filtered emails)"
              >
                ← Prev
              </button>
              <span className="min-w-[4.5rem] text-center text-xs font-medium text-zinc-300">
                {globalEmailIndex >= 0 ? globalEmailIndex + 1 : '—'} / {total}
              </span>
              <button
                type="button"
                disabled={!canCompareNext || busy}
                onClick={goCompareNext}
                className="cursor-pointer rounded-md bg-sky-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-40"
                title="Next email (all filtered emails)"
              >
                Next →
              </button>
            </div>
            <button
              type="button"
              disabled={extractionStatus !== 'completed' || !activeUid || sendingSheet || busy}
              onClick={() => activeUid && sendToSheet([activeUid])}
              className="cursor-pointer rounded bg-violet-700 px-2.5 py-1 text-[11px] text-white hover:bg-violet-600 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {sendingSheet
                ? 'Sending…'
                : detail.forward_status === 'sent' ||
                    emails.find((e) => e.uid === detail.uid)?.forward_status === 'sent'
                  ? 'Resend sheet'
                  : 'Send sheet'}
            </button>
            <button
              type="button"
              onClick={() => setCompareOpen(false)}
              className="cursor-pointer rounded bg-[#333] px-2.5 py-1 text-[11px] text-white hover:bg-[#444]"
            >
              Close
            </button>
          </div>
          <div className="relative grid min-h-0 flex-1 grid-cols-1 md:grid-cols-2">
            {busy && (
              <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-black/50 backdrop-blur-[2px]">
                <span className="inline-block h-9 w-9 animate-spin rounded-full border-[3px] border-white border-t-transparent" />
                <div className="rounded-md bg-[#1a1a1a] px-4 py-2 text-sm font-medium text-white shadow-lg">
                  Loading next email…
                </div>
              </div>
            )}
            <div className="flex min-h-0 flex-col border-r border-[#333] bg-white text-zinc-900">
              <div className="flex items-center gap-2 border-b border-zinc-200 bg-zinc-50 px-4 py-2.5">
                <div className="min-w-0 flex-1 text-xs font-semibold uppercase text-zinc-600">
                  Preview (email + PDF / Excel / Word)
                </div>
                <button
                  type="button"
                  disabled={!canComparePrev || busy}
                  onClick={goComparePrev}
                  className="cursor-pointer rounded-md bg-sky-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  ← Prev mail
                </button>
                <button
                  type="button"
                  disabled={!canCompareNext || busy}
                  onClick={goCompareNext}
                  className="cursor-pointer rounded-md bg-sky-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Next mail →
                </button>
              </div>
              <AttachmentPreviewPanel
                detail={detail}
                showEmailBody
                bodyHtml={bodyHtml}
              />
            </div>
            <OffersEditor
              extractionId={extractionId}
              offers={offers}
              status={extractionStatus}
              error={extractionError}
              emailDate={
                (detail.date_iso && String(detail.date_iso).slice(0, 10)) ||
                detail.date_str ||
                ''
              }
              onSaved={(next) => {
                setOffers(next)
                setExtractionStatus('completed')
                loadEmails()
              }}
            />
          </div>
        </div>
      )}
    </div>
  )
}
