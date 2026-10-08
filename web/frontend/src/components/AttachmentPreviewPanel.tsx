import { useEffect, useMemo, useState } from 'react'
import { api, getToken, type EmailDetail } from '../api'
import { downloadAttachmentFile, openAttachmentInBrowser } from '../openAttachment'

type Props = {
  detail: EmailDetail
  /** When true, include email body + attachment viewers (comparison left pane) */
  showEmailBody?: boolean
  bodyHtml?: string
  compact?: boolean
  /** Parent page scrolls; give preview a tall min-height instead of a cramped flex pane */
  pageScroll?: boolean
  /** Switch to this tab key (e.g. "email" or "att-0") when it changes */
  focusTabKey?: string | null
  onTabChange?: (key: string) => void
}

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

  const selectTab = (key: string) => {
    setTab(key)
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
      <div className="p-4 text-sm text-zinc-500">No document attachments on this email.</div>
    )
  }

  const filenameFor = (index: number) =>
    atts.find((a, i) => (a.index ?? i) === index)?.filename || 'file'

  const contentMin = pageScroll ? 'min-h-[75vh]' : 'min-h-0 flex-1'

  return (
    <div
      className={`flex flex-col ${compact ? '' : pageScroll ? '' : 'h-full min-h-0'}`}
    >
      <div
        className={`sticky top-0 z-10 flex flex-wrap gap-1 border-b border-zinc-200 bg-zinc-100 px-2 py-2 ${
          pageScroll ? 'shadow-sm' : ''
        }`}
      >
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => selectTab(t.key)}
            className={`max-w-[180px] cursor-pointer truncate rounded px-3 py-1.5 text-xs ${
              tab === t.key
                ? 'bg-zinc-900 text-white'
                : 'bg-white text-zinc-700 hover:bg-zinc-200'
            }`}
            title={t.label}
          >
            {t.kind === 'email' ? '📧 ' : t.kind === 'pdf' ? '📄 ' : '📎 '}
            {t.label}
          </button>
        ))}
      </div>

      {active?.kind === 'email' && (
        <iframe
          title="email-body"
          sandbox=""
          className={`w-full bg-white ${contentMin}`}
          srcDoc={`<!DOCTYPE html><html><head><meta charset="utf-8"><base target="_blank"><style>html,body{margin:0;min-height:100%}body{font-family:Segoe UI,Arial,sans-serif;padding:18px;color:#222;line-height:1.45}img{max-width:100%}</style></head><body>${bodyHtml}</body></html>`}
        />
      )}

      {active?.kind === 'pdf' && (
        <div className={`flex flex-col bg-zinc-200 ${contentMin}`}>
          {loadingPdf && (
            <div className="p-4 text-sm text-zinc-600">Loading PDF preview…</div>
          )}
          {err && <div className="p-4 text-sm text-red-600">{err}</div>}
          {!loadingPdf && !err && pdfBlobUrl && (
            <iframe
              title="pdf-preview"
              className={`w-full bg-zinc-200 ${pageScroll ? 'min-h-[75vh] flex-1' : 'min-h-0 flex-1'}`}
              src={pdfBlobUrl}
            />
          )}
          {active.index != null && (
            <div className="flex gap-2 border-t border-zinc-300 bg-white px-3 py-2">
              <button
                type="button"
                className="cursor-pointer rounded bg-zinc-900 px-3 py-1.5 text-xs text-white"
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
                className="cursor-pointer rounded border border-zinc-300 px-3 py-1.5 text-xs"
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
        <div className={`overflow-auto bg-white p-4 ${contentMin}`}>
          {loadingText && <div className="text-sm text-zinc-500">Loading document text…</div>}
          {err && <div className="text-sm text-red-600">{err}</div>}
          {!loadingText && !err && (
            <pre className="whitespace-pre-wrap break-words font-sans text-sm text-zinc-800">
              {textPreview}
            </pre>
          )}
          {active.index != null && (
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                className="cursor-pointer rounded bg-zinc-900 px-3 py-1.5 text-xs text-white"
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
                className="cursor-pointer rounded border border-zinc-300 px-3 py-1.5 text-xs"
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
