/** Open attachment in a new tab (view) vs force download. */

import { getToken } from './api'

function guessType(filename: string, fallback = 'application/octet-stream') {
  const ext = filename.toLowerCase().split('.').pop() || ''
  const map: Record<string, string> = {
    pdf: 'application/pdf',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    xls: 'application/vnd.ms-excel',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    doc: 'application/msword',
    csv: 'text/csv',
    txt: 'text/plain',
  }
  return map[ext] || fallback
}

export async function openAttachmentInBrowser(url: string, filename: string) {
  // Open the blank tab synchronously on the click path so popup blockers allow it.
  const win = window.open('about:blank', '_blank')
  if (!win) {
    throw new Error('Popup blocked — allow popups for this site to open files in a new tab.')
  }

  try {
    const headers = new Headers()
    const token = getToken()
    if (token) headers.set('X-Session-Token', token)
    const res = await fetch(url, { headers })
    if (!res.ok) throw new Error(`Could not open file (${res.status})`)
    const buf = await res.arrayBuffer()
    const headerType = res.headers.get('content-type') || undefined
    const type = guessType(filename, headerType)
    const blob = new Blob([buf], { type })
    const objUrl = URL.createObjectURL(blob)
    win.location.href = objUrl
    win.opener = null
    setTimeout(() => URL.revokeObjectURL(objUrl), 120_000)
  } catch (e) {
    try {
      win.close()
    } catch {
      /* ignore */
    }
    throw e
  }
}

export async function downloadAttachmentFile(url: string, filename: string) {
  const headers = new Headers()
  const token = getToken()
  if (token) headers.set('X-Session-Token', token)
  const res = await fetch(url, { headers })
  if (!res.ok) throw new Error(`Could not download file (${res.status})`)
  const buf = await res.arrayBuffer()
  const headerType = res.headers.get('content-type') || undefined
  const blob = new Blob([buf], { type: guessType(filename, headerType) })
  const objUrl = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = objUrl
  a.download = filename || 'attachment'
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(objUrl), 30_000)
}
