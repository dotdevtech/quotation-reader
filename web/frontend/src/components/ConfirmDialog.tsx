import { useEffect } from 'react'

export type ConfirmVariant = 'danger' | 'warning' | 'info'

export type ConfirmOptions = {
  title: string
  message: string
  detail?: string
  confirmLabel?: string
  cancelLabel?: string
  variant?: ConfirmVariant
}

type Props = ConfirmOptions & {
  open: boolean
  onConfirm: () => void
  onCancel: () => void
}

const VARIANT = {
  danger: {
    accent: 'border-rose-200 bg-gradient-to-br from-white to-rose-50',
    iconBg: 'bg-rose-100 text-rose-700',
    confirmBtn: 'bg-rose-700 hover:bg-rose-600 text-white',
    icon: (
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M12 9v4m0 4h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z"
        />
      </svg>
    ),
  },
  warning: {
    accent: 'border-amber-200 bg-gradient-to-br from-white to-amber-50',
    iconBg: 'bg-amber-100 text-amber-700',
    confirmBtn: 'bg-amber-600 hover:bg-amber-500 text-white',
    icon: (
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M12 9v4m0 4h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z"
        />
      </svg>
    ),
  },
  info: {
    accent: 'border-sky-200 bg-gradient-to-br from-white to-sky-50',
    iconBg: 'bg-sky-100 text-sky-700',
    confirmBtn: 'bg-sky-700 hover:bg-sky-600 text-white',
    icon: (
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M12 16v-4m0-4h.01M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z"
        />
      </svg>
    ),
  },
} as const

export default function ConfirmDialog({
  open,
  title,
  message,
  detail,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'info',
  onConfirm,
  onCancel,
}: Props) {
  const styles = VARIANT[variant]

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onCancel])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
    >
      <button
        type="button"
        className="absolute inset-0 cursor-pointer bg-slate-900/45 backdrop-blur-[2px]"
        aria-label="Dismiss"
        onClick={onCancel}
      />
      <div
        className={`relative w-full max-w-md overflow-hidden rounded-2xl border shadow-2xl shadow-slate-900/20 ${styles.accent}`}
      >
        <div className="flex gap-3 px-5 pt-5 pb-2">
          <div
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${styles.iconBg}`}
          >
            {styles.icon}
          </div>
          <div className="min-w-0 flex-1 pt-0.5">
            <h2 id="confirm-dialog-title" className="text-base font-bold text-slate-900">
              {title}
            </h2>
            <p className="mt-1.5 text-sm leading-relaxed text-slate-600 whitespace-pre-line">
              {message}
            </p>
            {detail ? (
              <p className="mt-2 rounded-lg border border-slate-200/80 bg-white/80 px-3 py-2 text-sm font-medium text-slate-800">
                {detail}
              </p>
            ) : null}
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2 px-5 py-4">
          <button
            type="button"
            onClick={onCancel}
            className="cursor-pointer rounded-lg bg-slate-200 px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-300"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`cursor-pointer rounded-lg px-4 py-2 text-sm font-semibold shadow-sm ${styles.confirmBtn}`}
            autoFocus
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
