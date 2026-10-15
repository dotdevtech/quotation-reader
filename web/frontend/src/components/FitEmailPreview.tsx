import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

type Props = {
  html: string
  className?: string
  title?: string
  /** Extra zoom on top of fit-to-width (1 = 100%) */
  zoom?: number
  /**
   * parent = grow with content; outer pane is the only scrollbar.
   * self = this component scrolls (Comparison mode).
   */
  scroll?: 'parent' | 'self'
}

const FIT_CSS = `
html, body {
  margin: 0 !important;
  padding: 0 !important;
  background: #fff;
  color: #222;
  overflow: hidden !important;
  height: auto !important;
}
body {
  font-family: Segoe UI, Arial, sans-serif;
  padding: 14px !important;
  line-height: 1.45;
  box-sizing: border-box;
  transform-origin: top left;
}
/* Images may shrink; tables keep natural column widths (look normal).
   Wide emails are scaled as a whole by JS — do NOT crush table cells. */
img, svg, video {
  max-width: 100% !important;
  height: auto !important;
}
table {
  border-collapse: collapse;
  width: auto !important;
  max-width: none !important;
  table-layout: auto !important;
}
td, th {
  /* Keep readable cells — no mid-word wrapping that destroys quote tables */
  word-break: normal;
  overflow-wrap: normal;
  white-space: normal;
}
`

export default function FitEmailPreview({
  html,
  className = '',
  title = 'email-body',
  zoom = 1,
  scroll = 'self',
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [frameSize, setFrameSize] = useState({ w: '100%', h: 320 })

  const srcDoc = useMemo(
    () =>
      `<!DOCTYPE html><html><head><meta charset="utf-8">` +
      `<meta name="viewport" content="width=device-width,initial-scale=1">` +
      `<base target="_blank"><style>${FIT_CSS}</style></head>` +
      `<body>${html || '<p style="color:#888">(empty body)</p>'}</body></html>`,
    [html],
  )

  const fit = useCallback(() => {
    const wrap = wrapRef.current
    const iframe = iframeRef.current
    const doc = iframe?.contentDocument
    const body = doc?.body
    const htmlEl = doc?.documentElement
    if (!wrap || !iframe || !body || !htmlEl) return

    body.style.transform = 'none'
    body.style.width = ''
    htmlEl.style.overflow = 'hidden'
    body.style.overflow = 'hidden'

    const availW = Math.max(120, wrap.clientWidth)
    const contentW = Math.max(body.scrollWidth, htmlEl.scrollWidth, 1)
    const fitScale = contentW > availW + 1 ? availW / contentW : 1
    const z = Math.max(0.4, zoom)
    const scale = fitScale * z

    body.style.transformOrigin = 'top left'
    body.style.transform = scale !== 1 ? `scale(${scale})` : 'none'
    body.style.width = `${contentW}px`

    const naturalH = Math.max(body.scrollHeight, htmlEl.scrollHeight, 120)
    const displayW = Math.ceil(contentW * scale)
    const displayH = Math.ceil(naturalH * scale)

    // At 100% fit: iframe matches pane width (no horizontal bar).
    // When zoomed in: iframe grows wider so the OUTER pane can scroll horizontally.
    setFrameSize({
      w: z > 1.001 ? `${displayW}px` : '100%',
      h: displayH,
    })
  }, [zoom])

  useEffect(() => {
    const wrap = wrapRef.current
    if (!wrap) return
    let timer: ReturnType<typeof setTimeout> | null = null
    const schedule = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(fit, 40)
    }
    const obs = new ResizeObserver(schedule)
    obs.observe(wrap)
    schedule()
    return () => {
      if (timer) clearTimeout(timer)
      obs.disconnect()
    }
  }, [fit, srcDoc])

  const scrollCls =
    scroll === 'parent'
      ? 'overflow-visible'
      : 'min-h-0 flex-1 overflow-auto'

  return (
    <div
      ref={wrapRef}
      className={`bg-white ${
        scroll === 'parent' ? 'w-full min-w-0' : 'min-w-0 w-full max-w-full'
      } ${scrollCls} ${className}`}
    >
      <iframe
        ref={iframeRef}
        title={title}
        sandbox="allow-same-origin allow-popups"
        srcDoc={srcDoc}
        scrolling="no"
        onLoad={() => {
          fit()
          const doc = iframeRef.current?.contentDocument
          Array.from(doc?.images || []).forEach((img) => {
            if (!img.complete) img.addEventListener('load', fit, { once: true })
          })
        }}
        style={{
          height: frameSize.h,
          width: frameSize.w,
          overflow: 'hidden',
          display: 'block',
          border: 0,
          maxWidth: zoom > 1 ? 'none' : '100%',
        }}
        className="bg-white"
      />
    </div>
  )
}
