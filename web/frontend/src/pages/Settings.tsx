import { useEffect, useState, type FormEvent } from 'react'
import { api, type AppSettings } from '../api'
import AppNav from '../components/AppNav'

export default function Settings() {
  const [form, setForm] = useState<Partial<AppSettings>>({})
  const [meta, setMeta] = useState<AppSettings | null>(null)
  const [msg, setMsg] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [clearBusy, setClearBusy] = useState(false)
  const [clearConfirm, setClearConfirm] = useState('')

  useEffect(() => {
    api
      .getSettings()
      .then((s) => {
        setMeta(s)
        setForm({
          imap_host: s.imap_host,
          imap_port: s.imap_port,
          imap_user: s.imap_user,
          imap_password: '',
          openai_api_key: '',
          openai_model: s.openai_model,
          forward_webhook_url: s.forward_webhook_url,
          forward_webhook_token: '',
          login_password: '',
        })
      })
      .catch((e) => setError(String(e)))
  }, [])

  const set = (key: keyof AppSettings, value: string | number) => {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    setMsg('')
    try {
      const payload: Record<string, unknown> = {
        imap_host: form.imap_host,
        imap_port: Number(form.imap_port) || 993,
        imap_user: form.imap_user,
        openai_model: form.openai_model,
        forward_webhook_url: form.forward_webhook_url || '',
      }
      if (form.imap_password) payload.imap_password = form.imap_password
      if (form.openai_api_key) payload.openai_api_key = form.openai_api_key
      if (form.login_password) payload.login_password = form.login_password
      if (form.forward_webhook_token) payload.forward_webhook_token = form.forward_webhook_token

      const res = await api.saveSettings(payload as Partial<AppSettings>)
      setMeta(res.settings)
      setForm((prev) => ({
        ...prev,
        imap_password: '',
        openai_api_key: '',
        login_password: '',
        forward_webhook_token: '',
      }))
      setMsg('Settings saved.')
    } catch (err) {
      setError(String(err))
    } finally {
      setBusy(false)
    }
  }

  const field = (
    label: string,
    key: keyof AppSettings,
    opts?: { type?: string; placeholder?: string; hint?: string }
  ) => (
    <label className="block text-xs text-slate-500">
      {label}
      <input
        type={opts?.type || 'text'}
        value={String(form[key] ?? '')}
        placeholder={opts?.placeholder}
        onChange={(e) =>
          set(key, key === 'imap_port' ? Number(e.target.value) || 0 : e.target.value)
        }
        className="mt-1 w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-red-500"
      />
      {opts?.hint && <span className="mt-1 block text-[11px] text-slate-600">{opts.hint}</span>}
    </label>
  )

  return (
    <div className="flex h-full flex-col">
      <AppNav />

      <div className="flex-1 overflow-y-auto p-6">
        <form onSubmit={onSubmit} className="mx-auto max-w-xl space-y-6">
          <section className="rounded-xl border border-rose-200 bg-gradient-to-br from-white to-rose-50/70 p-5 shadow-sm">
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-rose-800">
              Login password
            </h2>
            {field('New login password', 'login_password', {
              type: 'password',
              placeholder: meta?.login_password_set ? 'Leave blank to keep current' : 'Set password',
              hint: 'Used to sign in to this panel',
            })}
          </section>

          <section className="rounded-xl border border-sky-200 bg-gradient-to-br from-white to-sky-50/70 p-5 shadow-sm">
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-sky-800">
              Email (IMAP)
            </h2>
            <div className="grid gap-4 sm:grid-cols-2">
              {field('IMAP host', 'imap_host')}
              {field('Port', 'imap_port', { type: 'number' })}
            </div>
            <div className="mt-4 space-y-4">
              {field('Username / email', 'imap_user')}
              {field('Password', 'imap_password', {
                type: 'password',
                placeholder: meta?.imap_password_set ? 'Leave blank to keep current' : 'Mail password',
              })}
            </div>
          </section>

          <section className="rounded-xl border border-amber-200 bg-gradient-to-br from-white to-amber-50/70 p-5 shadow-sm">
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-amber-900">
              OpenAI
            </h2>
            <div className="space-y-4">
              {field('API key', 'openai_api_key', {
                type: 'password',
                placeholder: meta?.openai_api_key_set ? 'Leave blank to keep current' : 'sk-…',
              })}
              {field('Model', 'openai_model')}
            </div>
          </section>

          <section className="rounded-xl border border-emerald-200 bg-gradient-to-br from-white to-emerald-50/70 p-5 shadow-sm">
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-emerald-800">
              Google Sheet webhook
            </h2>
            <div className="space-y-4">
              {field('Webhook URL', 'forward_webhook_url', {
                placeholder: 'https://script.google.com/macros/s/…/exec',
                hint: 'Your Apps Script webapp URL that saves quotations to the sheet',
              })}
              {field('Webhook token', 'forward_webhook_token', {
                type: 'password',
                placeholder: meta?.forward_webhook_token_set
                  ? 'Leave blank to keep current'
                  : 'Token expected by your webapp',
                hint: 'Sent as JSON field "token" with each save',
              })}
            </div>
          </section>

          {error && <div className="text-sm text-red-600">{error}</div>}
          {msg && <div className="text-sm text-emerald-700">{msg}</div>}

          <button
            type="submit"
            disabled={busy}
            className="cursor-pointer rounded-lg bg-red-700 px-6 py-2.5 text-sm font-semibold text-white hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? 'Saving…' : 'Save settings'}
          </button>
        </form>

        <section className="mx-auto mt-8 max-w-xl rounded-xl border border-red-300 bg-gradient-to-br from-white to-red-50 p-5 shadow-sm">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-red-800">
            Danger zone — clear local inbox
          </h2>
          <p className="mt-2 text-sm text-slate-600">
            Removes every email from this app’s Inbox (Email / Scanned / Sent), including scanned
            data and saved attachment files on this computer. Your real mailbox on the mail server
            is not touched. Settings (IMAP, password, OpenAI, webhook) stay.
          </p>
          <p className="mt-2 text-sm font-medium text-red-700">
            Type <span className="rounded bg-red-100 px-1.5 py-0.5 font-mono">DELETE</span> below,
            then confirm.
          </p>
          <label className="mt-3 block text-xs text-slate-500">
            Confirmation
            <input
              type="text"
              value={clearConfirm}
              onChange={(e) => setClearConfirm(e.target.value)}
              placeholder="Type DELETE"
              autoComplete="off"
              className="mt-1 w-full rounded border border-red-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-red-500"
            />
          </label>
          <button
            type="button"
            disabled={clearBusy || clearConfirm.trim().toUpperCase() !== 'DELETE'}
            onClick={async () => {
              const ok = window.confirm(
                'Are you sure?\n\nThis will empty the Inbox on this system (all local emails, scans, and attachments).\n\nYour real email account is NOT deleted.\n\nContinue?',
              )
              if (!ok) return
              setClearBusy(true)
              setError('')
              setMsg('')
              try {
                const res = await api.clearInbox('DELETE')
                setClearConfirm('')
                setMsg(
                  `${res.message} Removed ${res.emails_deleted} email(s), ${res.extractions_deleted} scan(s).`,
                )
              } catch (err) {
                setError(String(err))
              } finally {
                setClearBusy(false)
              }
            }}
            className="mt-4 cursor-pointer rounded-lg bg-red-800 px-5 py-2.5 text-sm font-semibold text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {clearBusy ? 'Clearing…' : 'Clear all local emails'}
          </button>
        </section>
      </div>
    </div>
  )
}
