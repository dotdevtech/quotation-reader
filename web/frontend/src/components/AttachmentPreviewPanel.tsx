import { useEffect, useMemo, useState } from 'react'
import { api, getToken, type EmailDetail } from '../api'
import { downloadAttachmentFile, openAttachmentInBrowser } from '../openAttachment'
import FitWidthPdfViewer from './FitWidthPdfViewer'
import FitEmailPreview from './FitEmailPreview'

type Props = {
  detail: EmailDetail
  showEmailBody?: boolean
  bodyHtml?: string
  compact?: boolean
  /** Parent page scrolls; preview grows with content (no inner scrollbar) */
  pageScroll?: boolean
  focusTabKey?: string | null
  onTabChange?: (key: string) => void
}

const ZOOM_MIN = 0.5
const ZOOM_MAX = 2
const ZOOM_STEP = 0.25

export default function AttachmentPreviewPanel({
  detail,
  showEmailBody = false,
  bodyHtml = '',
  compact = false,
  pageScroll = false,
  focusTabKey = null,
  onTabChange,
}: Props) {
  const atts = detail.attachments || []
  const tabs = useMemo(() => {
    const list: { key: string; label: string; kind: 'email' | 'pdf' | 'text'; index?: number }[] = []
    if (showEmailBody) list.push({ key: 'email', label: 'Email', kind: 'email' })
    atts.forEach((a, i) => {
      const idx = typeof a.index === 'number' ? a.index : i
      const name = a.filename || `file-${idx}`
      const ext = name.toLowerCase().split('.').pop() || ''
      if (ext === 'pdf') list.push({ key: `att-${idx}`, label: name, kind: 'pdf', index: idx })
      else list.push({ key: `att-${idx}`, label: name, kind: 'text', index: idx })
    })
    return list
  }, [atts, showEmailBody])

  const [tab, setTab] = useState(tabs[0]?.key || 'email')
  const [textPreview, setTextPreview] = useState('')
  const [pdfBlobUrl, setPdfBlobUrl] = useState('')
  const [loadingText, setLoadingText] = useState(false)
  const [loadingPdf, setLoadingPdf] = useState(false)
  const [err, setErr] = useState('')
  const [zoom, setZoom] = useState(1)

  const selectTab = (key: string) => {
    setTab(key)
    setZoom(1)
    onTabChange?.(key)
  }

  useEffect(() => {
    if (focusTabKey && tabs.some((t) => t.key === focusTabKey)) {
      setTab(focusTabKey)
    }
  }, [focusTabKey, tabs])

  useEffect(() => {
    if (!tabs.find((t) => t.key === tab)) setTab(tabs[0]?.key || 'email')
  }, [tabs, tab])

  const active = tabs.find((t) => t.key === tab)
  const activeKind = active?.kind
  const activeIndex = active?.index
  const scrollMode = pageScroll ? 'parent' : 'self'
  const canZoom = activeKind === 'email' || activeKind === 'pdf'

  useEffect(() => {
    if (activeKind !== 'text' || activeIndex == null) {
      setTextPreview('')
      return
    }
    let cancelled = false
    setLoadingText(true)
    setErr('')
    api
      .attachmentText(detail.uid, activeIndex)
      .then((r) => {
        if (!cancelled) setTextPreview(r.text)
      })
      .catch((e) => {
        if (!cancelled) setErr(String(e))
      })
      .finally(() => {
        if (!cancelled) setLoadingText(false)
      })
    return () => {
      cancelled = true
    }
  }, [activeKind, activeIndex, detail.uid])

  useEffect(() => {
    if (activeKind !== 'pdf' || activeIndex == null) {
      setPdfBlobUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev)
        return ''
      })
      return
    }
    let cancelled = false
    let objUrl = ''
    setLoadingPdf(true)
    setErr('')
    const headers = new Headers()
    const token = getToken()
    if (token) headers.set('X-Session-Token', token)
    fetch(api.attachmentUrl(detail.uid, activeIndex, true), { headers })
      .then(async (res) => {
        if (!res.ok) throw new Error(`Could not load PDF (${res.status})`)
        const buf = await res.arrayBuffer()
        const blob = new Blob([buf], { type: 'application/pdf' })
        objUrl = URL.createObjectURL(blob)
        if (!cancelled) setPdfBlobUrl(objUrl)
      })
      .catch((e) => {
        if (!cancelled) setErr(String(e))
      })
      .finally(() => {
        if (!cancelled) setLoadingPdf(false)
      })
    return () => {
      cancelled = true
      if (objUrl) URL.revokeObjectURL(objUrl)
    }
  }, [activeKind, activeIndex, detail.uid])

  if (!showEmailBody && atts.length === 0) {
    return (
      <div className="p-4 text-sm text-slate-500">No document attachments on this email.</div>
    )
  }

  const filenameFor = (index: number) =>
    atts.find((a, i) => (a.index ?? i) === index)?.filename || 'file'

  const contentMin = pageScroll ? '' : 'min-h-0 flex-1'

  return (
    <div
      className={`flex flex-col ${
        compact
          ? 'min-w-0 max-w-full'
          : pageScroll
            ? 'min-w-0 w-full'
            : 'h-full min-h-0 min-w-0 max-w-full overflow-hidden'
      }`}
    >
      <div
        className={`sticky z-30 flex max-w-full flex-wrap items-center gap-1 border-b border-slate-200 bg-slate-100/95 px-2 py-2 backdrop-blur-sm ${
          pageScroll ? 'top-[3.25rem] shadow-md' : 'top-0'
        }`}
      >
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => selectTab(t.key)}
            className={`max-w-[min(180px,100%)] cursor-pointer truncate rounded px-3 py-1.5 text-xs ${
              tab === t.key
                ? 'bg-red-700 text-white'
                : 'bg-white text-slate-700 hover:bg-red-50'
            }`}
            title={t.label}
          >
            {t.kind === 'email' ? '📧 ' : t.kind === 'pdf' ? '📄 ' : '📎 '}
            {t.label}
          </button>
        ))}

        {canZoom && (
          <div className="ml-auto flex items-center gap-1 rounded-md bg-white px-1 py-0.5 shadow-sm ring-1 ring-slate-200">
            <button
              type="button"
              title="Zoom out"
              disabled={zoom <= ZOOM_MIN}
              onClick={() => setZoom((z) => Math.max(ZOOM_MIN, +(z - ZOOM_STEP).toFixed(2)))}
              className="cursor-pointer rounded bg-violet-700 px-2 py-1 text-xs font-bold text-white hover:bg-violet-600 disabled:opacity-40"
            >
              −
            </button>
            <button
              type="button"
              title="Reset zoom"
              onClick={() => setZoom(1)}
              className="min-w-[3.25rem] cursor-pointer rounded px-1 py-1 text-center text-[11px] font-semibold tabular-nums text-slate-700 hover:bg-slate-100"
            >
              {Math.round(zoom * 100)}%
            </button>
            <button
              type="button"
              title="Zoom in"
              disabled={zoom >= ZOOM_MAX}
              onClick={() => setZoom((z) => Math.min(ZOOM_MAX, +(z + ZOOM_STEP).toFixed(2)))}
              className="cursor-pointer rounded bg-indigo-700 px-2 py-1 text-xs font-bold text-white hover:bg-indigo-600 disabled:opacity-40"
            >
              +
            </button>
          </div>
        )}
      </div>

      {active?.kind === 'email' && (
        <FitEmailPreview
          html={bodyHtml}
          className={contentMin}
          zoom={zoom}
          scroll={scrollMode}
        />
      )}

      {active?.kind === 'pdf' && (
        <div
          className={`flex min-w-0 max-w-full flex-col bg-slate-100 ${
            pageScroll ? '' : 'min-h-0 flex-1 overflow-hidden'
          }`}
        >
          {loadingPdf && (
            <div className="p-4 text-sm text-slate-600">Loading PDF preview…</div>
          )}
          {err && <div className="p-4 text-sm text-red-600">{err}</div>}
          {!loadingPdf && !err && pdfBlobUrl && (
            <FitWidthPdfViewer src={pdfBlobUrl} zoom={zoom} scroll={scrollMode} />
          )}
          {active.index != null && (
            <div className="flex shrink-0 gap-2 border-t border-slate-300 bg-white px-3 py-2">
              <button
                type="button"
                className="cursor-pointer rounded bg-slate-800 px-3 py-1.5 text-xs text-white"
                onClick={() =>
                  openAttachmentInBrowser(
                    api.attachmentUrl(detail.uid, active.index!, true),
                    filenameFor(active.index!),
                  ).catch((e) => setErr(String(e)))
                }
              >
                Open in tab
              </button>
              <button
                type="button"
                className="cursor-pointer rounded border border-slate-300 px-3 py-1.5 text-xs"
                onClick={() =>
                  downloadAttachmentFile(
                    api.attachmentUrl(detail.uid, active.index!, false),
                    filenameFor(active.index!),
                  ).catch((e) => setErr(String(e)))
                }
              >
                Download
              </button>
            </div>
          )}
        </div>
      )}

      {active?.kind === 'text' && (
        <div
          className={`bg-white p-4 ${
            pageScroll ? '' : 'min-h-0 flex-1 overflow-auto'
          }`}
        >
          {loadingText && <div className="text-sm text-slate-500">Loading document text…</div>}
          {err && <div className="text-sm text-red-600">{err}</div>}
          {!loadingText && !err && (
            <pre className="whitespace-pre-wrap break-words font-sans text-sm text-slate-800">
              {textPreview}
            </pre>
          )}
          {active.index != null && (
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                className="cursor-pointer rounded bg-slate-800 px-3 py-1.5 text-xs text-white"
                onClick={() =>
                  openAttachmentInBrowser(
                    api.attachmentUrl(detail.uid, active.index!, true),
                    filenameFor(active.index!),
                  ).catch((e) => setErr(String(e)))
                }
              >
                Open file
              </button>
              <button
                type="button"
                className="cursor-pointer rounded border border-slate-300 px-3 py-1.5 text-xs"
                onClick={() =>
                  downloadAttachmentFile(
                    api.attachmentUrl(detail.uid, active.index!, false),
                    filenameFor(active.index!),
                  ).catch((e) => setErr(String(e)))
                }
              >
                Download
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
