/** API client with session auth. */

const TOKEN_KEY = 'qr_session_token'

export function getToken(): string {
  return localStorage.getItem(TOKEN_KEY) || ''
}

export function setToken(value: string) {
  if (value) localStorage.setItem(TOKEN_KEY, value)
  else localStorage.removeItem(TOKEN_KEY)
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY)
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers || {})
  if (!headers.has('Content-Type') && init.body) {
    headers.set('Content-Type', 'application/json')
  }
  const token = getToken()
  if (token) headers.set('X-Session-Token', token)

  const res = await fetch(path, { ...init, headers })
  if (!res.ok) {
    let detail = res.statusText
    try {
      const data = await res.json()
      detail = data.detail || JSON.stringify(data)
    } catch {
      /* ignore */
    }
    const err = new Error(typeof detail === 'string' ? detail : JSON.stringify(detail)) as Error & {
      status?: number
    }
    err.status = res.status
    throw err
  }
  return res.json() as Promise<T>
}

export type Health = {
  ok: boolean
  imap_configured: boolean
  openai_configured: boolean
  webhook_configured: boolean
  auth_required: boolean
}

export type AppSettings = {
  imap_host: string
  imap_port: number
  imap_user: string
  imap_password: string
  openai_api_key: string
  openai_model: string
  forward_webhook_url: string
  forward_webhook_token: string
  forward_webhook_token_set: boolean
  login_password: string
  imap_configured: boolean
  openai_configured: boolean
  setup_required: boolean
  imap_password_set: boolean
  openai_api_key_set: boolean
  login_password_set: boolean
}

export type EmailSummary = {
  uid: string
  subject: string
  from_addr: string
  to_addr: string
  date_str: string
  date_iso: string | null
  has_attachments: number | boolean
  body_loaded?: number
  extraction_status?: string
  latest_extraction_id?: number | null
  extraction_error?: string | null
  forward_status?: string
  extraction_forwarded?: number | boolean
  /** Reviewed in Check Quote — required before Add to system */
  quote_checked?: boolean | number
}

export type EmailDetail = EmailSummary & {
  body_text: string | null
  body_html: string | null
  attachments: {
    filename: string
    content_type: string
    size: number
    index?: number
    stored?: boolean
  }[]
}

export type SyncStatus = {
  running: boolean
  phase: string
  message: string
  done: number
  total: number
  error: string | null
  last_sync_at?: string
  last_sync_count?: string
  cached_total?: number
}

export type Extraction = {
  id: number
  job_id: number
  email_uid: string
  status: string
  result: { offers?: Offer[]; offer_count?: number } | Record<string, unknown> | null
  error: string | null
  forwarded: boolean
}

export type Offer = Record<string, string | number>

export type Job = {
  id: number
  status: string
  email_uids: string[]
  error: string | null
  created_at: string
  updated_at: string
  extractions?: Extraction[]
}

export const PAGE_SIZE = 50

export const api = {
  authStatus: () =>
    request<{ setup_required: boolean; ok: boolean; logged_in?: boolean }>('/api/auth/status'),
  setup: (password: string) =>
    request<{ ok: boolean; token: string }>('/api/auth/setup', {
      method: 'POST',
      body: JSON.stringify({ password }),
    }),
  login: (password: string) =>
    request<{ ok: boolean; token: string }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ password }),
    }),
  logout: () => request<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }),
  health: () => request<Health>('/api/health'),
  getSettings: () => request<AppSettings>('/api/settings'),
  saveSettings: (body: Partial<AppSettings>) =>
    request<{ ok: boolean; settings: AppSettings }>('/api/settings', {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  /** Wipe local inbox cache. confirm must be the string "DELETE". */
  clearInbox: (confirm: string) =>
    request<{
      ok: boolean
      message: string
      emails_deleted: number
      extractions_deleted: number
      jobs_deleted: number
      attachment_folders_deleted: number
    }>('/api/inbox/clear', {
      method: 'POST',
      body: JSON.stringify({ confirm }),
    }),
  sync: (opts?: { mode?: 'all' | 'range' | 'new'; date_from?: string; date_to?: string }) =>
    request<{ ok: boolean; error?: string }>('/api/sync', {
      method: 'POST',
      body: JSON.stringify({
        mode: opts?.mode || 'range',
        date_from: opts?.date_from,
        date_to: opts?.date_to,
      }),
    }),
  syncStatus: () => request<SyncStatus>('/api/sync/status'),
  getAutoSync: () =>
    request<{
      enabled: boolean
      interval_minutes: number
      min_interval_minutes: number
      last_run_at?: string | null
      next_run_at?: string | null
    }>('/api/sync/auto'),
  setAutoSync: (body: { enabled: boolean; interval_minutes: number }) =>
    request<{
      enabled: boolean
      interval_minutes: number
      min_interval_minutes: number
      last_run_at?: string | null
      next_run_at?: string | null
    }>('/api/sync/auto', {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  emails: (params: {
    q?: string
    date_from?: string
    date_to?: string
    extraction_status?: string
    forward_status?: string
    /** email | scanned (unchecked) | checked (ready to add) | sent */
    folder?: 'email' | 'scanned' | 'checked' | 'sent'
    limit?: number
    offset?: number
  }) => {
    const sp = new URLSearchParams()
    if (params.q) sp.set('q', params.q)
    if (params.date_from) sp.set('date_from', params.date_from)
    if (params.date_to) sp.set('date_to', params.date_to)
    if (params.folder) {
      sp.set('folder', params.folder)
    } else {
      if (params.extraction_status && params.extraction_status !== 'all') {
        sp.set('extraction_status', params.extraction_status)
      }
      if (params.forward_status && params.forward_status !== 'all') {
        sp.set('forward_status', params.forward_status)
      }
    }
    sp.set('limit', String(params.limit ?? PAGE_SIZE))
    sp.set('offset', String(params.offset ?? 0))
    return request<{ items: EmailSummary[]; total: number; limit: number; offset: number }>(
      `/api/emails?${sp}`,
    )
  },
  email: (uid: string) => request<EmailDetail>(`/api/emails/${encodeURIComponent(uid)}`),
  extract: (email_uids: string[], force = false) =>
    request<{ job_id: number }>('/api/extract', {
      method: 'POST',
      body: JSON.stringify({ email_uids, force }),
    }),
  extractStatus: () =>
    request<{
      scanning: boolean
      stop_requested: boolean
      pending_or_running_emails: number
      active_jobs: number
    }>('/api/extract/status'),
  stopExtract: () =>
    request<{
      ok: boolean
      message: string
      cancelled_extractions: number
      reset_emails: number
      cancelled_jobs: number
      pending_or_running_emails: number
      active_jobs: number
    }>('/api/extract/stop', { method: 'POST', body: JSON.stringify({}) }),
  emailExtraction: (uid: string) =>
    request<{
      id?: number
      email_uid: string
      status: string
      error?: string | null
      offers: Offer[]
      result?: unknown
    }>(`/api/emails/${encodeURIComponent(uid)}/extraction`),
  masterFields: () =>
    request<{
      fields: string[]
      condition_options?: string[]
      price_type_options?: string[]
      currency_options?: string[]
      certification_options?: string[]
    }>('/api/meta/fields'),
  jobs: () => request<{ items: Job[] }>('/api/jobs'),
  job: (id: number) => request<Job>(`/api/jobs/${id}`),
  updateExtraction: (id: number, result: Record<string, unknown>) =>
    request<Extraction>(`/api/extractions/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ result }),
    }),
  forward: (id: number) =>
    request<{ ok: boolean; forwarded: boolean; message?: string; export_path?: string }>(
      `/api/extractions/${id}/forward`,
      { method: 'POST', body: JSON.stringify({}) },
    ),
  forwardSelected: (email_uids: string[]) =>
    request<{
      ok: boolean
      sent: number
      failed: number
      results: unknown[]
      errors: { email_uid: string; error: string }[]
    }>('/api/forward', {
      method: 'POST',
      body: JSON.stringify({ email_uids }),
    }),
  setQuoteChecked: (uid: string, checked = true) =>
    request<{ ok: boolean; uid: string; quote_checked: boolean }>(
      `/api/emails/${encodeURIComponent(uid)}/quote-check`,
      { method: 'POST', body: JSON.stringify({ checked }) },
    ),
  exportUrl: (id: number) => `/api/extractions/${id}/download`,
  attachmentUrl: (emailUid: string, index: number, inline = true) => {
    const token = getToken()
    const sp = new URLSearchParams()
    if (inline) sp.set('inline', 'true')
    if (token) sp.set('token', token)
    return `/api/emails/${encodeURIComponent(emailUid)}/attachments/${index}?${sp}`
  },
  attachmentText: (emailUid: string, index: number) =>
    request<{ filename: string; text: string }>(
      `/api/emails/${encodeURIComponent(emailUid)}/attachments/${index}/text`,
    ),
}
