import { useEffect, useState } from 'react'
import { api, type Job, type Offer } from '../api'
import OffersEditor from '../components/OffersEditor'
import AppNav from '../components/AppNav'

function offersFromResult(result: Job['extractions'] extends (infer E)[] | undefined ? E : never): Offer[] {
  const r = result?.result as { offers?: Offer[] } | Offer[] | null
  if (!r) return []
  if (Array.isArray(r)) return r
  return r.offers || []
}

export default function Review() {
  const [jobs, setJobs] = useState<Job[]>([])
  const [activeJob, setActiveJob] = useState<Job | null>(null)
  const [activeExtId, setActiveExtId] = useState<number | null>(null)
  const [offers, setOffers] = useState<Offer[]>([])
  const [status, setStatus] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [emailUid, setEmailUid] = useState<string | null>(null)
  const [emailHtml, setEmailHtml] = useState('')
  const [subject, setSubject] = useState('')

  const refreshJobs = async () => {
    const data = await api.jobs()
    setJobs(data.items)
    if (activeJob) {
      const fresh = await api.job(activeJob.id)
      setActiveJob(fresh)
      if (activeExtId) {
        const ext = fresh.extractions?.find((e) => e.id === activeExtId)
        if (ext) {
          setStatus(ext.status)
          setError(ext.error)
          setOffers(offersFromResult(ext))
        }
      }
    }
  }

  useEffect(() => {
    refreshJobs().catch((e) => setError(String(e)))
    const t = setInterval(() => {
      refreshJobs().catch(() => undefined)
    }, 2000)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const openJob = async (id: number) => {
    const job = await api.job(id)
    setActiveJob(job)
    setActiveExtId(null)
    setOffers([])
    setEmailUid(null)
    setEmailHtml('')
  }

  const openExtraction = async (extId: number, uid: string) => {
    setActiveExtId(extId)
    setEmailUid(uid)
    const ext = activeJob?.extractions?.find((e) => e.id === extId)
    setStatus(ext?.status || '')
    setError(ext?.error || null)
    setOffers(offersFromResult(ext as never))
    try {
      const detail = await api.email(uid)
      setSubject(detail.subject)
      const html =
        detail.body_html ||
        `<pre style="white-space:pre-wrap;font-family:Segoe UI,sans-serif">${(detail.body_text || '').replace(/</g, '&lt;')}</pre>`
      setEmailHtml(html)
      const saved = await api.emailExtraction(uid)
      if (saved.offers?.length) setOffers(saved.offers)
      if (saved.id) setActiveExtId(saved.id)
      setStatus(saved.status)
    } catch (e) {
      setError(String(e))
    }
  }

  return (
    <div className="flex h-full flex-col">
      <AppNav />

      <div className="grid min-h-0 flex-1 grid-cols-1 xl:grid-cols-[240px_1fr_1fr]">
        <aside className="overflow-y-auto border-r border-[#333] bg-[#1e1e1e]">
          <div className="border-b border-[#333] px-4 py-3 text-xs uppercase tracking-wide text-zinc-500">
            AI queue jobs
          </div>
          {jobs.length === 0 && (
            <div className="p-4 text-sm text-zinc-500">
              No jobs yet. Select emails in Inbox → Send to OpenAI.
            </div>
          )}
          {jobs.map((j) => (
            <button
              key={j.id}
              type="button"
              onClick={() => openJob(j.id)}
              className={`block w-full cursor-pointer border-b border-[#2a2a2a] px-4 py-3 text-left hover:bg-[#2a2a2a] ${
                activeJob?.id === j.id ? 'bg-[#333]' : ''
              }`}
            >
              <div className="text-sm font-medium text-white">Job #{j.id}</div>
              <div className="text-xs text-zinc-400">
                {j.status} · {j.email_uids.length} email(s)
              </div>
            </button>
          ))}
          {activeJob && (
            <div className="border-t border-[#333] p-2">
              <div className="px-2 py-1 text-[11px] uppercase text-zinc-500">Emails in job</div>
              {(activeJob.extractions || []).map((ext) => (
                <button
                  key={ext.id}
                  type="button"
                  onClick={() => openExtraction(ext.id, ext.email_uid)}
                  className={`mb-1 block w-full cursor-pointer rounded px-2 py-2 text-left text-xs hover:bg-[#2a2a2a] ${
                    activeExtId === ext.id ? 'bg-[#3a3a3d] text-white' : 'text-zinc-300'
                  }`}
                >
                  UID {ext.email_uid} · {ext.status}
                  {ext.status === 'completed' ? ' ✓' : ''}
                </button>
              ))}
            </div>
          )}
        </aside>

        <div className="flex min-h-0 flex-col border-r border-[#333] bg-white text-zinc-900">
          {!emailUid && (
            <div className="flex flex-1 items-center justify-center text-sm text-zinc-500">
              Pick a job email to preview
            </div>
          )}
          {emailUid && (
            <>
              <div className="border-b border-zinc-200 px-4 py-3">
                <div className="font-semibold">{subject || `Email ${emailUid}`}</div>
                <div className="text-xs text-zinc-500">UID {emailUid}</div>
              </div>
              <iframe
                title="review-email"
                sandbox=""
                className="min-h-0 w-full flex-1"
                srcDoc={`<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{font-family:Segoe UI,Arial,sans-serif;padding:16px;color:#222;line-height:1.45}img{max-width:100%}</style></head><body>${emailHtml}</body></html>`}
              />
            </>
          )}
        </div>

        <OffersEditor
          extractionId={activeExtId}
          offers={offers}
          status={status}
          error={error}
          onSaved={setOffers}
        />
      </div>
    </div>
  )
}
