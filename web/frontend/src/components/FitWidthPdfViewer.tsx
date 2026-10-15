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
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [pageCount, setPageCount] = useState(0)

  useEffect(() => {
    const host = hostRef.current
    const pagesEl = pagesRef.current
    if (!host || !pagesEl || !src) return

    let cancelled = false
    let pdfDoc: pdfjs.PDFDocumentProxy | null = null
    let resizeObs: ResizeObserver | null = null
    let renderGen = 0
    let resizeTimer: ReturnType<typeof setTimeout> | null = null

    const renderAll = async (doc: pdfjs.PDFDocumentProxy) => {
      const gen = ++renderGen
      const z = Math.max(0.4, zoom)
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const paneW = Math.max(120, host.clientWidth - 16)
      pagesEl.replaceChildren()

      for (let n = 1; n <= doc.numPages; n++) {
        if (cancelled || gen !== renderGen) return
        const page = await doc.getPage(n)
        if (cancelled || gen !== renderGen) {
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

    ;(async () => {
      setLoading(true)
      setError('')
      try {
        pdfDoc = await pdfjs.getDocument({ url: src }).promise
        if (cancelled) {
          await pdfDoc.destroy()
          return
        }
        setPageCount(pdfDoc.numPages)
        await renderAll(pdfDoc)
        if (!cancelled) setLoading(false)

        resizeObs = new ResizeObserver(() => {
          if (!pdfDoc) return
          if (resizeTimer) clearTimeout(resizeTimer)
          resizeTimer = setTimeout(() => {
            if (pdfDoc) void renderAll(pdfDoc)
          }, 120)
        })
        resizeObs.observe(host)
      } catch (e) {
        if (!cancelled) {
          setError(String(e))
          setLoading(false)
        }
      }
    })()

    return () => {
      cancelled = true
      renderGen += 1
      if (resizeTimer) clearTimeout(resizeTimer)
      resizeObs?.disconnect()
      pagesEl.replaceChildren()
      void pdfDoc?.destroy()
    }
  }, [src, zoom])

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
