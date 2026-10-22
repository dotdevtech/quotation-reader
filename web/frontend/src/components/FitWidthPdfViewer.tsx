import { useEffect, useRef, useState } from 'react'
import * as pdfjs from 'pdfjs-dist'
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorker

type Props = {
  src: string
  className?: string
  /** Extra zoom on top of fit-to-width (1 = 100%) */
  zoom?: number
  /**
   * parent = let outer page scroll (no inner scrollbar).
   * self = this pane scrolls (Comparison mode).
   */
  scroll?: 'parent' | 'self'
}

export default function FitWidthPdfViewer({
  src,
  className = '',
  zoom = 1,
  scroll = 'self',
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const pagesRef = useRef<HTMLDivElement>(null)
  const pdfDocRef = useRef<pdfjs.PDFDocumentProxy | null>(null)
  const renderGenRef = useRef(0)
  const zoomRef = useRef(zoom)
  zoomRef.current = zoom

  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [pageCount, setPageCount] = useState(0)
  const [docReady, setDocReady] = useState(0)

  const renderAll = async (doc: pdfjs.PDFDocumentProxy) => {
    const host = hostRef.current
    const pagesEl = pagesRef.current
    if (!host || !pagesEl) return
    const gen = ++renderGenRef.current
    const z = Math.max(0.4, zoomRef.current)
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const paneW = Math.max(120, host.clientWidth - 16)
    pagesEl.replaceChildren()

    for (let n = 1; n <= doc.numPages; n++) {
      if (gen !== renderGenRef.current) return
      const page = await doc.getPage(n)
      if (gen !== renderGenRef.current) {
        page.cleanup()
        return
      }
      const unscaled = page.getViewport({ scale: 1 })
      const fitScale = paneW / unscaled.width
      const displayW = Math.floor(unscaled.width * fitScale * z)
      const scale = fitScale * z * dpr
      const viewport = page.getViewport({ scale })
      const canvas = document.createElement('canvas')
      canvas.width = Math.floor(viewport.width)
      canvas.height = Math.floor(viewport.height)
      canvas.style.width = `${displayW}px`
      canvas.style.maxWidth = z > 1 ? 'none' : '100%'
      canvas.style.height = 'auto'
      canvas.style.display = 'block'
      canvas.style.margin = '0 auto 12px'
      canvas.style.background = '#fff'
      canvas.style.boxShadow = '0 1px 4px rgba(0,0,0,0.12)'
      pagesEl.appendChild(canvas)

      const ctx = canvas.getContext('2d')
      if (!ctx) {
        page.cleanup()
        continue
      }
      await page.render({ canvasContext: ctx, viewport }).promise
      page.cleanup()
    }
  }

  // Load PDF document once per src (do not reload on zoom).
  useEffect(() => {
    const pagesEl = pagesRef.current
    if (!src) return

    let cancelled = false
    setLoading(true)
    setError('')
    setPageCount(0)

    ;(async () => {
      try {
        const doc = await pdfjs.getDocument({ url: src }).promise
        if (cancelled) {
          await doc.destroy()
          return
        }
        pdfDocRef.current = doc
        setPageCount(doc.numPages)
        await renderAll(doc)
        if (!cancelled) {
          setLoading(false)
          setDocReady((n) => n + 1)
        }
      } catch (e) {
        if (!cancelled) {
          setError(String(e))
          setLoading(false)
        }
      }
    })()

    return () => {
      cancelled = true
      renderGenRef.current += 1
      pagesEl?.replaceChildren()
      const doc = pdfDocRef.current
      pdfDocRef.current = null
      void doc?.destroy()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- zoom handled separately
  }, [src])

  // Re-draw canvases on zoom / resize without destroying the loaded PDF.
  useEffect(() => {
    const host = hostRef.current
    const doc = pdfDocRef.current
    if (!host || !doc || loading) return

    let resizeTimer: ReturnType<typeof setTimeout> | null = null
    void renderAll(doc)

    const resizeObs = new ResizeObserver(() => {
      if (resizeTimer) clearTimeout(resizeTimer)
      resizeTimer = setTimeout(() => {
        if (pdfDocRef.current) void renderAll(pdfDocRef.current)
      }, 120)
    })
    resizeObs.observe(host)

    return () => {
      if (resizeTimer) clearTimeout(resizeTimer)
      resizeObs.disconnect()
    }
    // docReady bumps after initial load so this effect can attach ResizeObserver
  }, [zoom, loading, docReady])

  const scrollCls =
    scroll === 'parent'
      ? 'overflow-visible'
      : 'min-h-0 flex-1 overflow-y-auto overflow-x-auto'

  return (
    <div ref={hostRef} className={`min-w-0 bg-slate-200/80 ${scrollCls} ${className}`}>
      {loading && (
        <div className="p-4 text-sm text-slate-600">Rendering PDF to fit width…</div>
      )}
      {error && <div className="p-4 text-sm text-red-600">{error}</div>}
      <div ref={pagesRef} className="box-border w-full max-w-full px-2 py-3" />
      {!loading && !error && pageCount > 0 && (
        <div className="pb-2 text-center text-[11px] text-slate-500">
          {pageCount} page{pageCount === 1 ? '' : 's'}
        </div>
      )}
    </div>
  )
}
