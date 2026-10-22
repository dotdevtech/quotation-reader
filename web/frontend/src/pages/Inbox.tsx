import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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

/** Local calendar YYYY-MM-DD (not UTC — avoids off-by-one near midnight). */
function localISODate(d = new Date()) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function todayISO() {
  return localISODate()
}

function daysAgoISO(days: number) {
  const d = new Date()
  d.setDate(d.getDate() - days)
  return localISODate(d)
}

function shortFrom(from: string) {
  const m = from.match(/^"?([^"<]+)"?\s*</)
  if (m?.[1]?.trim()) return m[1].trim()
  return from.length > 42 ? from.slice(0, 42) + '…' : from
}

type MailFolder = 'email' | 'scanned' | 'checked' | 'sent'

const FOLDER_TABS: { value: MailFolder; label: string; hint: string }[] = [
  { value: 'email', label: 'Quote Received', hint: 'Synced — need to scan' },
  { value: 'scanned', label: 'Scanned', hint: 'Scanned — waiting Check Quote' },
  {
    value: 'checked',
    label: 'Checked',
    hint: 'Marked checked — ready to Add to system',
  },
  { value: 'sent', label: 'Added to system', hint: 'Sent to Google Sheet' },
]

const DATE_PRESETS = [
  { value: '', label: 'Custom dates' },
  { value: '30', label: 'Last 30 days' },
  { value: '60', label: 'Last 60 days' },
  { value: '90', label: 'Last 3 months' },
  { value: '270', label: 'Last 9 months' },
] as const

/** Workflow labels: Current status + Todo */
function quoteWorkflow(opts: {
  extraction_status?: string
  forward_status?: string
  quote_checked?: boolean | number
  extraction_error?: string | null
}) {
  const s = opts.extraction_status || 'none'
  const f = opts.forward_status || 'none'
  const checked = Boolean(opts.quote_checked)
  const todoClass = 'bg-amber-500 text-white border border-amber-600 shadow-sm'

  if (f === 'sent') {
    return {
      current: 'Added to system',
      todo: '',
      currentClass: 'bg-sky-600 text-white border border-sky-700 shadow-sm',
      todoClass,
    }
  }
  if (f === 'error') {
    return {
      current: checked ? 'Checked' : s === 'completed' ? 'Scanned' : 'Quote Received',
      // Must be checked before Add — if not checked yet, that comes first
      todo: checked ? 'Add to system (retry)' : 'Mark checked first',
      currentClass: 'bg-orange-600 text-white border border-orange-700 shadow-sm',
      todoClass,
    }
  }
  if (s === 'pending') {
    return {
      current: 'Quote Received',
      todo: 'Scan first',
      currentClass: 'bg-slate-700 text-white border border-slate-800 shadow-sm',
      todoClass,
    }
  }
  if (s === 'running') {
    return {
      current: 'Quote Received',
      todo: 'Scanning…',
      currentClass: 'bg-slate-700 text-white border border-slate-800 shadow-sm',
      todoClass: 'bg-amber-600 text-white border border-amber-700 shadow-sm',
    }
  }
  if (s === 'error') {
    return {
      current: 'Quote Received',
      todo: 'Scan first (fix error)',
      currentClass: 'bg-red-600 text-white border border-red-700 shadow-sm',
      todoClass: 'bg-red-500 text-white border border-red-600 shadow-sm',
      error: opts.extraction_error,
    }
  }
  if (s === 'completed' && checked) {
    return {
      current: 'Checked',
      todo: 'Add to system',
      currentClass: 'bg-violet-600 text-white border border-violet-700 shadow-sm',
      todoClass,
    }
  }
  if (s === 'completed') {
    return {
      current: 'Scanned',
      // Scanned but not marked checked — must review & Mark checked before Add
      todo: 'Mark checked first',
      currentClass: 'bg-emerald-600 text-white border border-emerald-700 shadow-sm',
      todoClass,
    }
  }
  return {
    current: 'Quote Received',
    todo: 'Scan first',
    currentClass: 'bg-slate-700 text-white border border-slate-800 shadow-sm',
    todoClass,
  }
}

/** Compact tags for the email list (Queued / Scanned / Checked / etc.). */
function MailListTags({
  status,
  error,
  forwardStatus,
  quoteChecked,
}: {
  status?: string
  error?: string | null
  forwardStatus?: string
  quoteChecked?: boolean | number
}) {
  const s = status || 'none'
  const f = forwardStatus || 'none'
  const checked = Boolean(quoteChecked)

  let label = 'Quote Received'
  let cls = 'bg-slate-600 text-white'
  if (f === 'sent') {
    label = 'Added'
    cls = 'bg-sky-600 text-white'
  } else if (f === 'error') {
    label = 'Send failed'
    cls = 'bg-orange-600 text-white'
  } else if (s === 'pending') {
    label = 'Queued'
    cls = 'bg-sky-600 text-white'
  } else if (s === 'running') {
    label = 'Scanning'
    cls = 'bg-amber-600 text-white'
  } else if (s === 'error') {
    label = 'Scan error'
    cls = 'bg-red-600 text-white'
  } else if (s === 'completed' && checked) {
    label = 'Checked'
    cls = 'bg-lime-600 text-white'
  } else if (s === 'completed') {
    label = 'Scanned'
    cls = 'bg-emerald-600 text-white'
  }

  return (
    <div className="mt-1 flex flex-wrap gap-1">
      <span
        className={`rounded px-1.5 py-0.5 text-[10px] font-bold leading-tight ${cls}`}
        title={error || label}
      >
        {label}
      </span>
    </div>
  )
}

function WorkflowBadges({
  workflow,
  size = 'md',
  checked,
  canMarkChecked,
  onMarkChecked,
}: {
  workflow: ReturnType<typeof quoteWorkflow>
  size?: 'md' | 'lg'
  checked?: boolean
  canMarkChecked?: boolean
  onMarkChecked?: () => void
}) {
  const pad = size === 'lg' ? 'px-3 py-1 text-sm' : 'px-2.5 py-1 text-xs'
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span
        className={`rounded-md font-bold leading-tight ${pad} ${workflow.currentClass}`}
        title={workflow.error || `Current: ${workflow.current}`}
      >
        Current: {workflow.current}
      </span>
      {workflow.todo ? (
        <span
          className={`rounded-md font-bold leading-tight ${pad} ${workflow.todoClass}`}
          title={`To do: ${workflow.todo}`}
        >
          To do: {workflow.todo}
        </span>
      ) : null}
      {checked ? (
        <span
          className={`rounded-md font-bold leading-tight ${pad} bg-lime-700 text-white border border-lime-800 shadow-sm`}
          title="Reviewed and marked checked"
        >
          Checked ✓
        </span>
      ) : onMarkChecked ? (
        <button
          type="button"
          disabled={!canMarkChecked}
          onClick={onMarkChecked}
          className={`cursor-pointer rounded-md font-bold leading-tight ${pad} bg-lime-600 text-white border border-lime-700 shadow-sm hover:bg-lime-500 disabled:cursor-not-allowed disabled:opacity-40`}
          title={canMarkChecked ? 'Confirm you reviewed this quote' : 'Scan first'}
        >
          Mark checked
        </button>
      ) : null}
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
  const [folder, setFolder] = useState<MailFolder>('email')
  const [folderCounts, setFolderCounts] = useState<Record<MailFolder, number>>({
    email: 0,
    scanned: 0,
    checked: 0,
    sent: 0,
  })
  const [datePreset, setDatePreset] = useState('')
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
  const loadSeq = useRef(0)

  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const rangeStart = total === 0 ? 0 : (page - 1) * pageSize + 1
  const rangeEnd = Math.min(page * pageSize, total)

  const filtersActive = !!(qDebounced || dateFrom || dateTo)

  const clearFilters = () => {
    setQ('')
    setQDebounced('')
    setDateFrom('')
    setDateTo('')
    setDatePreset('')
    setPage(1)
  }

  const applyDatePreset = (value: string) => {
    setDatePreset(value)
    if (!value) return
    const days = Number(value)
    if (!Number.isFinite(days) || days <= 0) return
    setDateFrom(daysAgoISO(days))
    setDateTo(todayISO())
    setPage(1)
  }

  const switchFolder = (next: MailFolder) => {
    if (next === folder) return
    setFolder(next)
    setSelected(new Set())
    setPage(1)
    setActiveUid(null)
    setDetail(null)
    setOffers([])
    setExtractionId(null)
    setExtractionStatus('none')
    setExtractionError(null)
    setCompareOpen(false)
    setPreviewTabKey('email')
  }

  useEffect(() => {
    const t = setTimeout(() => setQDebounced(q), 350)
    return () => clearTimeout(t)
  }, [q])

  /** Normalize range so From is never after To. */
  const filterDates = useMemo(() => {
    let from = dateFrom || undefined
    let to = dateTo || undefined
    if (from && to && from > to) {
      ;[from, to] = [to, from]
    }
    return { date_from: from, date_to: to }
  }, [dateFrom, dateTo])

  const loadEmails = useCallback(async () => {
    const seq = ++loadSeq.current
    try {
      const data = await api.emails({
        q: qDebounced,
        date_from: filterDates.date_from,
        date_to: filterDates.date_to,
        folder,
        limit: pageSize,
        offset: (page - 1) * pageSize,
      })
      if (seq !== loadSeq.current) return
      setEmails(data.items)
      setTotal(data.total)
      const maxPage = Math.max(1, Math.ceil(data.total / pageSize))
      if (page > maxPage) setPage(maxPage)
    } catch (e) {
      if (seq !== loadSeq.current) return
      setError(String(e))
    }
  }, [qDebounced, filterDates, folder, page, pageSize])

  const loadFolderCounts = useCallback(async () => {
    try {
      const entries = await Promise.all(
        (['email', 'scanned', 'checked', 'sent'] as MailFolder[]).map(async (f) => {
          const data = await api.emails({
            q: qDebounced,
            date_from: filterDates.date_from,
            date_to: filterDates.date_to,
            folder: f,
            limit: 1,
            offset: 0,
          })
          return [f, data.total] as const
        }),
      )
      setFolderCounts(Object.fromEntries(entries) as Record<MailFolder, number>)
    } catch {
      /* ignore */
    }
  }, [qDebounced, filterDates])

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
    void loadFolderCounts()
  }, [loadFolderCounts])

  // Reset to page 1 when filters change — do this before/with load by
  // syncing page in the same turn when filters change.
  useEffect(() => {
    setPage(1)
  }, [qDebounced, filterDates.date_from, filterDates.date_to, folder, pageSize])
  useEffect(() => {
    if (!sync?.running) return
    const t = setInterval(async () => {
      const s = await api.syncStatus()
      setSync(s)
      if (!s.running) {
        setPage(1)
        await loadEmails()
        void loadFolderCounts()
        api.health().then(setHealth).catch(() => undefined)
      }
    }, 2500)
    return () => clearInterval(t)
  }, [sync?.running, loadEmails, loadFolderCounts])

  // Live status for multi-user: any open inbox refreshes tags (Queued / Scanning / …)
  // so Computer B sees Computer A’s queue without a manual refresh.
  const compareOpenRef = useRef(compareOpen)
  const extractionStatusRef = useRef(extractionStatus)
  const activeUidRef = useRef(activeUid)
  compareOpenRef.current = compareOpen
  extractionStatusRef.current = extractionStatus
  activeUidRef.current = activeUid

  useEffect(() => {
    const t = setInterval(() => {
      void loadEmails()
      void loadFolderCounts()
      const uid = activeUidRef.current
      if (!uid) return
      // Keep Check Quote stable while reviewing a finished scan.
      if (compareOpenRef.current && extractionStatusRef.current === 'completed') return
      const prevStatus = extractionStatusRef.current
      api
        .emailExtraction(uid)
        .then((ext) => {
          const nextStatus = ext.status || 'none'
          setExtractionId(ext.id ?? null)
          setExtractionStatus(nextStatus)
          setExtractionError(ext.error || null)
          if (nextStatus !== 'completed' || prevStatus !== 'completed') {
            setOffers(ext.offers || [])
          }
        })
        .catch(() => undefined)
    }, 4000)
    return () => clearInterval(t)
  }, [loadEmails, loadFolderCounts])

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
        date_from: filterDates.date_from,
        date_to: filterDates.date_to,
        folder,
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
        `Queued ${uids.length} email(s) as job #${job_id}. Status will update as scanning finishes.`,
      )
    } catch (e) {
      setError(String(e))
    }
  }

  const isQuoteChecked = (uid: string) => {
    if (detail?.uid === uid && detail.quote_checked) return true
    return Boolean(emails.find((e) => e.uid === uid)?.quote_checked)
  }

  const markQuoteChecked = async (uidsOverride?: string[]) => {
    const uids = uidsOverride?.length
      ? uidsOverride
      : activeUid && selected.size === 0
        ? [activeUid]
        : [...selected]
    const ready = uids.filter((uid) => {
      if (uid === activeUid && extractionStatus === 'completed') {
        const already =
          Boolean(detail?.quote_checked) ||
          Boolean(emails.find((x) => x.uid === uid)?.quote_checked)
        return !already
      }
      const e = emails.find((x) => x.uid === uid)
      return (
        e?.extraction_status === 'completed' &&
        !e.quote_checked &&
        e.forward_status !== 'sent'
      )
    })
    if (ready.length === 0) {
      setError('Select scanned quotes that are not checked yet.')
      return
    }
    setError('')
    try {
      for (const uid of ready) {
        await api.setQuoteChecked(uid, true)
      }
      setEmails((prev) =>
        prev.map((e) => (ready.includes(e.uid) ? { ...e, quote_checked: true } : e)),
      )
      setDetail((prev) =>
        prev && ready.includes(prev.uid) ? { ...prev, quote_checked: true } : prev,
      )
      if (!uidsOverride && selected.size) setSelected(new Set())
      setJobMsg(
        ready.length === 1
          ? 'Marked as checked. You can Add to system now.'
          : `Marked ${ready.length} quotes as checked.`,
      )
      await loadEmails()
      void loadFolderCounts()
    } catch (e) {
      setError(String(e))
    }
  }

  const sendToSheet = async (uidsOverride?: string[]) => {
    const uids = uidsOverride?.length ? uidsOverride : [...selected]
    if (uids.length === 0 || sendingSheet) return
    const scannedUids = uids.filter((uid) => {
      if (uid === activeUid && extractionStatus === 'completed') return true
      return emails.some((e) => e.uid === uid && e.extraction_status === 'completed')
    })
    if (scannedUids.length === 0) {
      setError('Scan the quote first, then Check Quote and Mark checked before adding to system.')
      return
    }
    const readyUids = scannedUids.filter((uid) => isQuoteChecked(uid))
    if (readyUids.length === 0) {
      setError(
        'Only checked quotes can be added to the system. Open Check Quote, review, then click Mark checked.',
      )
      return
    }
    if (readyUids.length < scannedUids.length) {
      setJobMsg(
        `Skipping ${scannedUids.length - readyUids.length} unchecked quote(s). Sending ${readyUids.length}…`,
      )
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
      setDetail((prev) => {
        if (!prev || !readyUids.includes(prev.uid)) return prev
        const failed = res.errors?.some((x) => x.email_uid === prev.uid)
        return { ...prev, forward_status: failed ? 'error' : 'sent' }
      })
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
      void loadFolderCounts()
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

  const compareForward =
    detail?.forward_status ||
    (detail ? emails.find((e) => e.uid === detail.uid)?.forward_status : undefined) ||
    'none'
  const compareIsScanned = extractionStatus === 'completed'
  const compareIsSent = compareForward === 'sent'
  const compareChecked = Boolean(
    detail?.quote_checked ||
      (detail ? emails.find((e) => e.uid === detail.uid)?.quote_checked : false),
  )
  const compareWorkflow = quoteWorkflow({
    extraction_status: extractionStatus,
    forward_status: compareForward,
    quote_checked: compareChecked,
    extraction_error: extractionError,
  })
  const canAddToSystem =
    compareIsScanned && compareChecked && Boolean(activeUid) && !sendingSheet && !busy

  return (
    <div className="flex h-full max-w-[100vw] flex-col overflow-x-hidden">
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

      <div className="flex flex-wrap items-center gap-2 border-b border-sky-200/80 bg-gradient-to-r from-sky-50 via-white to-emerald-50 px-3 py-2">
        <input
          type="date"
          value={dateFrom}
          onChange={(e) => {
            setDateFrom(e.target.value)
            setDatePreset('')
          }}
          title="From date"
          className="cursor-pointer rounded border border-sky-200 bg-white px-1.5 py-1 text-xs text-slate-900"
        />
        <span className="text-[10px] text-slate-500">→</span>
        <input
          type="date"
          value={dateTo}
          onChange={(e) => {
            setDateTo(e.target.value)
            setDatePreset('')
          }}
          title="To date"
          className="cursor-pointer rounded border border-sky-200 bg-white px-1.5 py-1 text-xs text-slate-900"
        />
        <select
          value={datePreset}
          onChange={(e) => applyDatePreset(e.target.value)}
          title="Quick date range"
          className="cursor-pointer rounded border border-sky-300 bg-white px-2 py-1 text-[11px] font-semibold text-slate-800"
        >
          {DATE_PRESETS.map((p) => (
            <option key={p.value || 'custom'} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={clearFilters}
          disabled={!filtersActive}
          className="cursor-pointer rounded bg-rose-600 px-2.5 py-1 text-[11px] font-bold text-white shadow-sm hover:bg-rose-500 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Clear
        </button>
        <button
          type="button"
          onClick={loadEmails}
          className="cursor-pointer rounded bg-indigo-700 px-2 py-1 text-[11px] font-semibold text-white hover:bg-indigo-600"
        >
          Refresh
        </button>
        {sync?.running && (
          <span className="text-[11px] text-amber-700">
            Syncing… {sync.done}/{sync.total}
          </span>
        )}
        {!health?.imap_configured && (
          <Link to="/settings" className="cursor-pointer text-[11px] text-amber-700 hover:underline">
            Configure IMAP →
          </Link>
        )}
      </div>

      {(error || jobMsg || sendingSheet) && (
        <div className="border-b border-slate-200 px-4 py-2 text-sm">
          {sendingSheet && (
            <div className="mb-1 flex items-center gap-2 text-amber-700">
              <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-amber-300 border-t-transparent" />
              Sending to Google Sheet — please wait…
            </div>
          )}
          {error && <div className="text-red-600">{error}</div>}
          {jobMsg && !sendingSheet && <div className="text-emerald-700">{jobMsg}</div>}
          {jobMsg && sendingSheet && <div className="text-amber-800">{jobMsg}</div>}
        </div>
      )}

      <div className="grid min-h-0 min-w-0 flex-1 grid-cols-1 overflow-hidden lg:grid-cols-2">
        <section className="flex min-h-0 min-w-0 flex-col overflow-hidden border-r border-slate-200 bg-white/90">
          <div className="grid grid-cols-4 gap-1 border-b border-slate-200 bg-white px-1 py-1">
            {FOLDER_TABS.map((t) => {
              const active = folder === t.value
              const count = folderCounts[t.value]
              const styles =
                t.value === 'email'
                  ? {
                      active: 'bg-red-700 text-white shadow-sm ring-1 ring-red-300',
                      idle: 'bg-red-100 text-red-800 hover:bg-red-200',
                      badgeActive: 'bg-white text-red-700',
                      badgeIdle: 'bg-red-700 text-white',
                    }
                  : t.value === 'scanned'
                    ? {
                        active: 'bg-emerald-700 text-white shadow-sm ring-1 ring-emerald-300',
                        idle: 'bg-emerald-100 text-emerald-800 hover:bg-emerald-200',
                        badgeActive: 'bg-white text-emerald-700',
                        badgeIdle: 'bg-emerald-700 text-white',
                      }
                    : t.value === 'checked'
                      ? {
                          active: 'bg-lime-700 text-white shadow-sm ring-1 ring-lime-300',
                          idle: 'bg-lime-100 text-lime-900 hover:bg-lime-200',
                          badgeActive: 'bg-white text-lime-700',
                          badgeIdle: 'bg-lime-700 text-white',
                        }
                      : {
                          active: 'bg-sky-700 text-white shadow-sm ring-1 ring-sky-300',
                          idle: 'bg-sky-100 text-sky-800 hover:bg-sky-200',
                          badgeActive: 'bg-white text-sky-700',
                          badgeIdle: 'bg-sky-700 text-white',
                        }
              return (
                <button
                  key={t.value}
                  type="button"
                  title={t.hint}
                  onClick={() => switchFolder(t.value)}
                  className={`flex cursor-pointer items-center justify-center gap-1 rounded-md px-1.5 py-1 text-center transition-colors ${
                    active ? styles.active : styles.idle
                  }`}
                >
                  <span className="truncate text-[11px] font-bold leading-tight tracking-wide">
                    {t.label}
                  </span>
                  <span
                    className={`inline-block shrink-0 rounded-full px-1.5 py-px text-[10px] font-semibold leading-tight tabular-nums ${
                      active ? styles.badgeActive : styles.badgeIdle
                    }`}
                  >
                    {count.toLocaleString()}
                  </span>
                </button>
              )
            })}
          </div>
          <div className="border-b border-slate-200 p-3">
            <div className="flex items-center gap-2 rounded border border-slate-300 bg-white px-3">
              <span className="text-slate-500">⌕</span>
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search sender, subject, address…"
                className="w-full cursor-text bg-transparent py-2.5 text-sm outline-none placeholder:text-slate-500"
              />
            </div>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
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
                <label className="flex items-center gap-1.5 text-slate-500">
                  Per page
                  <select
                    value={pageSize}
                    onChange={(e) => setPageSize(Number(e.target.value))}
                    className="cursor-pointer rounded border border-slate-300 bg-white px-1.5 py-1 text-xs text-slate-900"
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
              <div className="p-8 text-center text-sm text-slate-500">
                {folder === 'email' && 'No Quote Received emails waiting to scan.'}
                {folder === 'scanned' && 'No scanned quotes waiting to be checked.'}
                {folder === 'checked' && 'No checked quotes waiting to Add to system.'}
                {folder === 'sent' && 'Nothing added to the system yet.'}
                {filtersActive && ' Try clearing search/date filters.'}{' '}
                {folder === 'email' && (
                  <>
                    <Link to="/sync" className="cursor-pointer text-red-700 hover:underline">
                      Sync Data
                    </Link>{' '}
                    to pull mail.
                  </>
                )}
              </div>
            )}
            {emails.map((e, i) => {
              const active = e.uid === activeUid
              const checked = selected.has(e.uid)
              return (
                <div
                  key={e.uid}
                  className={`flex cursor-pointer gap-2 border-b border-slate-200 px-3 py-3 ${
                    active ? 'bg-red-50 ring-1 ring-inset ring-red-200' : i % 2 ? 'bg-sky-50/40' : 'bg-white'
                  } hover:bg-amber-50/80`}
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
                        className={`truncate text-sm font-semibold ${active ? 'text-red-700' : 'text-slate-800'}`}
                      >
                        {shortFrom(e.from_addr)}
                      </span>
                      <span className="shrink-0 text-xs text-slate-500">{e.date_str}</span>
                    </div>
                    <div className="mt-0.5 flex items-center gap-2">
                      <span className="truncate text-sm text-slate-600">
                        {e.subject || '(no subject)'}
                      </span>
                      {!!e.has_attachments && <span className="shrink-0 text-red-600">📎</span>}
                    </div>
                    <MailListTags
                      status={e.extraction_status}
                      error={e.extraction_error}
                      forwardStatus={e.forward_status}
                      quoteChecked={e.quote_checked}
                    />
                  </div>
                </div>
              )
            })}
          </div>

          <div className="flex items-center justify-between gap-2 border-t border-sky-200 bg-gradient-to-r from-sky-50 to-emerald-50 px-3 py-2">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="cursor-pointer rounded bg-slate-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              ← Newer
            </button>
            <span className="text-xs font-medium text-slate-600">
              Page {page} of {totalPages}
            </span>
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              className="cursor-pointer rounded bg-slate-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Older →
            </button>
          </div>

          <div className="grid grid-cols-2 gap-1.5 border-t border-rose-200 bg-gradient-to-r from-rose-50 to-sky-50 px-2 py-2 sm:grid-cols-4">
            <button
              type="button"
              disabled={selected.size === 0}
              onClick={() => sendToAi(false)}
              title="Scan selected emails"
              className="cursor-pointer rounded bg-red-700 px-1 py-1.5 text-[11px] font-semibold text-white shadow-sm hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Scan{selected.size ? ` (${selected.size})` : ''}
            </button>
            <button
              type="button"
              disabled={selected.size === 0}
              onClick={() => sendToAi(true)}
              title="Re-scan selected (force, uses API again)"
              className="cursor-pointer rounded bg-amber-600 px-1 py-1.5 text-[11px] font-semibold text-white shadow-sm hover:bg-amber-500 disabled:opacity-40"
            >
              Re-scan
            </button>
            <button
              type="button"
              disabled={
                selected.size === 0 ||
                ![...selected].some((uid) =>
                  emails.some(
                    (e) =>
                      e.uid === uid &&
                      e.extraction_status === 'completed' &&
                      !e.quote_checked &&
                      e.forward_status !== 'sent',
                  ),
                )
              }
              onClick={() => void markQuoteChecked([...selected])}
              className="cursor-pointer rounded bg-lime-600 px-1 py-1.5 text-[11px] font-semibold text-white shadow-sm hover:bg-lime-500 disabled:cursor-not-allowed disabled:opacity-40"
              title="Mark selected scanned quotes as checked"
            >
              Mark{selected.size ? ` (${selected.size})` : ''}
            </button>
            <button
              type="button"
              disabled={
                sendingSheet ||
                selected.size === 0 ||
                ![...selected].some((uid) =>
                  emails.some(
                    (e) =>
                      e.uid === uid &&
                      e.extraction_status === 'completed' &&
                      Boolean(e.quote_checked),
                  ),
                )
              }
              onClick={() => sendToSheet()}
              className="cursor-pointer rounded bg-sky-700 px-1 py-1.5 text-[11px] font-semibold text-white shadow-sm hover:bg-sky-600 disabled:cursor-not-allowed disabled:opacity-40"
              title="Add checked quotes to system (Google Sheet)"
            >
              {sendingSheet ? 'Sending…' : 'Add'}
            </button>
          </div>
        </section>

        <section className="flex min-h-0 min-w-0 flex-col overflow-hidden bg-gradient-to-b from-sky-50/50 to-white text-slate-900">
          {!detail && (
            <div className="flex flex-1 items-center justify-center text-sm text-slate-500">
              {busy ? 'Loading message…' : 'Select an email to preview'}
            </div>
          )}
          {detail && (
            <div className="min-h-0 flex-1 overflow-auto">
              <div className="sticky top-0 z-40 border-b border-rose-100 bg-gradient-to-r from-white to-rose-50/95 px-3 py-2 shadow-sm backdrop-blur-sm">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <h2 className="truncate text-sm font-semibold leading-snug">{detail.subject}</h2>
                    <p className="mt-0.5 truncate text-[11px] text-slate-500">
                      {detail.from_addr}
                      <span className="mx-1 text-slate-600">·</span>
                      {detail.date_str}
                    </p>
                    <div className="mt-2">
                      <WorkflowBadges
                        workflow={compareWorkflow}
                        size="lg"
                        checked={compareChecked || compareIsSent}
                        canMarkChecked={
                          compareIsScanned && !compareChecked && !compareIsSent && !busy
                        }
                        onMarkChecked={() =>
                          void markQuoteChecked(activeUid ? [activeUid] : [])
                        }
                      />
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-1.5">
                    <button
                      type="button"
                      onClick={() => setCompareOpen(true)}
                      className="cursor-pointer rounded bg-red-700 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-red-600"
                    >
                      Check Quote
                    </button>
                    <button
                      type="button"
                      disabled={!canAddToSystem}
                      onClick={() => activeUid && sendToSheet([activeUid])}
                      className="cursor-pointer rounded bg-sky-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-40"
                      title={
                        compareIsSent
                          ? 'Already added — click to resend'
                          : !compareIsScanned
                            ? 'Scan first, then Check Quote and Mark checked'
                            : !compareChecked
                              ? 'Open Check Quote and Mark checked before adding'
                              : 'Add this quote to the system (Google Sheet)'
                      }
                    >
                      {sendingSheet
                        ? '…'
                        : compareIsSent
                          ? 'Resend'
                          : 'Add to system'}
                    </button>
                  </div>
                </div>
                {(extractionStatus === 'pending' || extractionStatus === 'running') && (
                  <div className="mt-1.5 text-[11px] text-amber-700">
                    {extractionStatus === 'pending' ? 'Queued' : 'Scanning'} — please wait…
                  </div>
                )}
                {extractionStatus === 'error' && (
                  <div className="mt-1.5 rounded border border-red-200 bg-red-50 px-2 py-1.5 text-[11px] text-red-800">
                    <div className="font-semibold">Scan error</div>
                    <div className="mt-0.5 line-clamp-3 whitespace-pre-wrap break-words">
                      {extractionError || 'Unknown error while scanning this email.'}
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
                      Re-scan
                    </button>
                  </div>
                )}
              </div>
              {detail.attachments?.length > 0 && (
                <div className="border-b border-slate-200 bg-slate-50 px-5 py-2.5">
                  <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
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
                              ? 'border-slate-800 bg-slate-100'
                              : 'border-slate-200 bg-white'
                          }`}
                        >
                          <span
                            className="mr-auto truncate font-medium text-slate-800"
                            title={a.filename}
                          >
                            📎 {a.filename}
                            <span className="ml-2 text-xs font-normal text-slate-500">{sizeKb}</span>
                          </span>
                          <button
                            type="button"
                            className={`cursor-pointer rounded px-3 py-1 text-xs text-slate-900 ${
                              isOpen ? 'bg-red-700 hover:bg-red-600' : 'bg-slate-800 hover:bg-slate-700'
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
                            className="cursor-pointer rounded border border-slate-300 px-3 py-1 text-xs text-slate-700 hover:bg-slate-100"
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
        <div className="fixed inset-0 z-50 flex max-w-[100vw] flex-col overflow-hidden bg-slate-900/40 backdrop-blur-sm">
          <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-4 py-2.5">
            <span className="text-sm font-semibold text-slate-800">Check Quote</span>
            <WorkflowBadges
              workflow={compareWorkflow}
              size="lg"
              checked={compareChecked || compareIsSent}
              canMarkChecked={
                compareIsScanned && !compareChecked && !compareIsSent && !busy && Boolean(activeUid)
              }
              onMarkChecked={() => void markQuoteChecked(activeUid ? [activeUid] : [])}
            />
            <span className="min-w-0 flex-1 truncate text-xs text-slate-500">
              {busy ? 'Loading…' : detail.subject}
            </span>
            <button
              type="button"
              disabled={!canComparePrev || busy}
              onClick={goComparePrev}
              className="cursor-pointer rounded-md bg-violet-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-violet-600 disabled:opacity-40"
            >
              ← Prev
            </button>
            <span className="text-xs tabular-nums text-slate-500">
              {globalEmailIndex >= 0 ? globalEmailIndex + 1 : '—'} / {total}
            </span>
            <button
              type="button"
              disabled={!canCompareNext || busy}
              onClick={goCompareNext}
              className="cursor-pointer rounded-md bg-indigo-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-600 disabled:opacity-40"
            >
              Next →
            </button>
            <button
              type="button"
              disabled={!canAddToSystem}
              onClick={() => activeUid && sendToSheet([activeUid])}
              className="cursor-pointer rounded-md bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-600 disabled:opacity-40"
              title={
                !compareChecked
                  ? 'Mark checked first'
                  : compareIsSent
                    ? 'Resend to Google Sheet'
                    : 'Add to system (Google Sheet)'
              }
            >
              {sendingSheet
                ? 'Sending…'
                : compareIsSent
                  ? 'Resend'
                  : 'Add to system'}
            </button>
            <button
              type="button"
              onClick={() => setCompareOpen(false)}
              className="cursor-pointer rounded-md bg-slate-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700"
            >
              Close
            </button>
          </div>
          <div className="relative grid min-h-0 min-w-0 flex-1 grid-cols-1 overflow-hidden md:grid-cols-2">
            {busy && (
              <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-black/40">
                <span className="inline-block h-8 w-8 animate-spin rounded-full border-[3px] border-white border-t-transparent" />
              </div>
            )}
            <div className="flex min-h-0 min-w-0 flex-col overflow-hidden border-r border-slate-200 bg-white">
              <AttachmentPreviewPanel
                detail={detail}
                showEmailBody
                bodyHtml={bodyHtml}
              />
            </div>
            <div className="flex min-h-0 min-w-0 flex-col overflow-hidden">
              <OffersEditor
                extractionId={extractionId}
                offers={offers}
                error={extractionError}
                emailDate={
                  (detail.date_iso && String(detail.date_iso).slice(0, 10)) ||
                  detail.date_str ||
                  ''
                }
                onSaved={(next) => {
                  setOffers(next)
                  setExtractionStatus('completed')
                  void loadEmails()
                  void loadFolderCounts()
                }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
