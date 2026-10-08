import { useEffect, useMemo, useState } from 'react'
import { api, type Offer } from '../api'

/** Same for the whole email / quotation (vendor + tender + terms). */
const SHARED_FIELDS = [
  'QUOTE REFERENCE',
  'RFQ REFERENCE',
  'Quote Validity Days',
  'MOQ',
  'Minimum Line Amount $',
  'Minimum PO Amount $',
  'CREDIT CARD',
  'WIRE PAYMENT',
  'NOTES',
  'VENDOR COMPANY',
  'VENDOR CONTACT NAME',
  'INTERNATIONAL VENDOR',
  'VENDOR ADDRESS LINE 1',
  'VENDOR ADDRESS LINE 2',
  'VENDOR ADDRESS LINE 3',
  'VENDOR ADDRESS CITY',
  'VENDOR ADDRESS STATE',
  'VENDOR ADDRESS ZIP CODE',
  'VENDOR ADDRESS COUNTRY',
  'VENDOR PHONE',
  'VENDOR FAX',
  'VENDOR EMAIL',
  'VENDOR WEBSITE',
  'PLATFORM',
  'PRODUCT LINK',
] as const

/** Changes per part line inside one email. */
const PART_FIELDS = [
  'PART NUMBER',
  'ALTERNATE PART NUMBER',
  'NSN',
  'DESCRIPTION',
  'CONDITION',
  'PACKAGE',
  'PACKAGE TYPE',
  'PACKAGE QUANTITY',
  'QUANTITY OFFERED',
  'QUANTITY REQUIRED',
  'UOM',
  'CURRENCY',
  'PRICE TYPE',
  'PRICE UNIT',
  'TOTAL PRICE',
  'DELIVERY LEAD',
  'TRACE',
  'CERTIFICATION DOCUMENTS',
] as const

const DEFAULT_CONDITION = [
  'NE-NEW',
  'NS-New Surplus',
  'SN-Stock New',
  'OH-Overhauled',
  'RD-Repaired',
  'EX-Exchange',
  'AR-As Removed',
  'FN- Factory New',
  'ANY',
  'SV- Serviceable',
  'RB-Refurbish',
  'None Specified',
]

const DEFAULT_PRICE_TYPE = [
  'Outright',
  'Exchange',
  'Make Offer',
  'Negotiable',
  'Need info',
  'No quote',
]

const DEFAULT_CERTS = [
  'FAA 8130',
  'EASA Form 1',
  'COC',
  'NONE',
  'OEM CERT',
  'DUAL',
  'MATERIAL TEST CERT',
  'CALIBIRATION',
  'JAA F1',
]

const inputClass =
  'w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none ring-red-500/30 focus:border-red-500 focus:ring-2'

function parseCerts(value: unknown): string[] {
  if (value == null || value === '') return []
  return String(value)
    .split(/[;|,/]+/)
    .map((s) => s.trim())
    .filter(Boolean)
}

function pickShared(offers: Offer[]): Offer {
  const out: Offer = {}
  for (const key of SHARED_FIELDS) {
    for (const o of offers) {
      const v = o[key]
      if (v != null && String(v).trim()) {
        out[key] = v
        break
      }
    }
  }
  return out
}

function applySharedToAll(offers: Offer[], shared: Offer): Offer[] {
  return offers.map((o) => {
    const next = { ...o }
    for (const key of SHARED_FIELDS) {
      const v = shared[key]
      if (v == null || !String(v).trim()) delete next[key]
      else next[key] = v
    }
    return next
  })
}

type Props = {
  extractionId: number | null
  offers: Offer[]
  status?: string
  error?: string | null
  /** Email received date shown as read-only Date (YYYY-MM-DD or display string) */
  emailDate?: string
  onSaved?: (offers: Offer[]) => void
}

export default function OffersEditor({
  extractionId,
  offers,
  status,
  error,
  emailDate = '',
  onSaved,
}: Props) {
  const [conditionOpts, setConditionOpts] = useState(DEFAULT_CONDITION)
  const [priceTypeOpts, setPriceTypeOpts] = useState(DEFAULT_PRICE_TYPE)
  const [certOpts, setCertOpts] = useState(DEFAULT_CERTS)
  const [draft, setDraft] = useState<Offer[]>(offers)
  const [shared, setShared] = useState<Offer>({})
  /** 'quote' = quote/vendor/terms tab; number = part line index */
  const [panel, setPanel] = useState<'quote' | number>('quote')
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const next = offers.length ? offers.map((o) => ({ ...o })) : [{}]
    setDraft(next)
    setShared(pickShared(next))
    setPanel('quote')
  }, [offers])
  useEffect(() => {
    api
      .masterFields()
      .then((r) => {
        if (r.condition_options?.length) setConditionOpts(r.condition_options)
        if (r.price_type_options?.length) setPriceTypeOpts(r.price_type_options)
        if (r.certification_options?.length) setCertOpts(r.certification_options)
      })
      .catch(() => undefined)
  }, [])

  const activePart = typeof panel === 'number' ? panel : 0
  const current = draft[activePart] || {}

  const setSharedField = (key: string, value: string) => {
    setShared((prev) => {
      const next = { ...prev }
      if (!value.trim()) delete next[key]
      else next[key] = value
      return next
    })
    setDraft((prev) =>
      prev.map((o) => {
        const copy = { ...o }
        if (!value.trim()) delete copy[key]
        else copy[key] = value
        return copy
      }),
    )
  }

  const setPartField = (key: string, value: string) => {
    setDraft((prev) => {
      const next = prev.map((o, i) => {
        if (i !== activePart) return o
        const copy = { ...o }
        if (!value.trim()) delete copy[key]
        else copy[key] = value
        return copy
      })
      return next
    })
  }

  const toggleCert = (opt: string) => {
    const selected = new Set(parseCerts(current['CERTIFICATION DOCUMENTS']))
    if (selected.has(opt)) selected.delete(opt)
    else {
      selected.add(opt)
      if (opt === 'NONE') {
        setPartField('CERTIFICATION DOCUMENTS', 'NONE')
        return
      }
      selected.delete('NONE')
    }
    setPartField('CERTIFICATION DOCUMENTS', [...selected].join('; '))
  }

  const addOffer = () => {
    const newIndex = draft.length
    setDraft((prev) => {
      const blank: Offer = { ...shared }
      for (const k of PART_FIELDS) delete blank[k]
      return [...prev, blank]
    })
    setPanel(newIndex)
  }

  const removeOffer = () => {
    if (typeof panel !== 'number') return
    if (draft.length <= 1) {
      setDraft([{ ...shared }])
      setPanel(0)
      return
    }
    const removeAt = panel
    setDraft((prev) => prev.filter((_, i) => i !== removeAt))
    setPanel(Math.max(0, removeAt - 1))
  }

  const save = async () => {
    if (!extractionId) return
    setBusy(true)
    setMsg('')
    setErr('')
    try {
      const merged = applySharedToAll(draft, shared)
      const cleaned = merged
        .map((o) => {
          const out: Offer = {}
          for (const [k, v] of Object.entries(o)) {
            if (v === null || v === undefined) continue
            const s = String(v).trim()
            if (!s || s === 'N/A' || s === 'Unknown') continue
            out[k] = s
          }
          return out
        })
        .filter((o) => Object.keys(o).length > 0)
      await api.updateExtraction(extractionId, { offers: cleaned, offer_count: cleaned.length })
      setDraft(cleaned.length ? cleaned : [{}])
      setShared(pickShared(cleaned.length ? cleaned : [{}]))
      setMsg(`Saved ${cleaned.length} part line(s) locally.`)
      onSaved?.(cleaned)
    } catch (e) {
      setErr(String(e))
    } finally {
      setBusy(false)
    }
  }

  const selectedCerts = useMemo(
    () => new Set(parseCerts(current['CERTIFICATION DOCUMENTS'])),
    [current],
  )
  const unknownCerts = [...selectedCerts].filter((c) => !certOpts.includes(c))

  const renderInput = (
    key: string,
    value: string,
    onChange: (v: string) => void,
    opts?: { readOnly?: boolean },
  ) => {
    if (key === 'CONDITION') {
      const known = !value || conditionOpts.includes(value)
      return (
        <select
          value={known ? value : ''}
          onChange={(e) => onChange(e.target.value)}
          className={`${inputClass} cursor-pointer`}
        >
          <option value="">— Select —</option>
          {conditionOpts.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      )
    }
    if (key === 'PRICE TYPE') {
      const known = !value || priceTypeOpts.includes(value)
      return (
        <select
          value={known ? value : ''}
          onChange={(e) => onChange(e.target.value)}
          className={`${inputClass} cursor-pointer`}
        >
          <option value="">— Select —</option>
          {priceTypeOpts.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      )
    }
    if (key === 'CERTIFICATION DOCUMENTS') {
      return (
        <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
          {certOpts.map((opt) => (
            <label
              key={opt}
              className="flex cursor-pointer items-center gap-2 rounded-md border border-zinc-200 bg-white px-2.5 py-1.5 text-sm text-zinc-800 hover:bg-zinc-50"
            >
              <input
                type="checkbox"
                className="cursor-pointer accent-red-600"
                checked={selectedCerts.has(opt)}
                onChange={() => toggleCert(opt)}
              />
              {opt}
            </label>
          ))}
          {unknownCerts.length > 0 && (
            <p className="col-span-full text-[11px] text-amber-700">
              Extra cert text: {unknownCerts.join('; ')}
            </p>
          )}
        </div>
      )
    }
    if (key === 'INTERNATIONAL VENDOR') {
      return (
        <select
          value={value || ''}
          onChange={(e) => onChange(e.target.value)}
          className={`${inputClass} cursor-pointer`}
        >
          <option value="">— Select —</option>
          <option value="Yes">Yes</option>
          <option value="No">No</option>
        </select>
      )
    }
    if (key === 'NOTES') {
      return (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={3}
          className={inputClass}
        />
      )
    }
    return (
      <input
        value={value}
        readOnly={opts?.readOnly}
        onChange={(e) => onChange(e.target.value)}
        className={`${inputClass} ${opts?.readOnly ? 'bg-zinc-100 text-zinc-600' : ''}`}
      />
    )
  }

  const labelFor = (key: string) => {
    const map: Record<string, string> = {
      'QUOTE REFERENCE': 'Quote Reference',
      'RFQ REFERENCE': 'RFQ Reference',
      'Quote Validity Days': 'Quote Validity Days',
      MOQ: 'MOQ',
      'Minimum Line Amount $': 'Minimum Line Amount',
      'Minimum PO Amount $': 'Minimum PO Amount',
      'CREDIT CARD': 'Credit Card Fee (%)',
      'WIRE PAYMENT': 'Wire Transfer Fee',
      NOTES: 'Additional Notes',
      'PART NUMBER': 'Part Number',
      'ALTERNATE PART NUMBER': 'Alternate Part Number',
      'QUANTITY OFFERED': 'Qty Offered',
      'QUANTITY REQUIRED': 'Qty Required',
      'PRICE UNIT': 'Price Each / Unit',
      'PRICE TYPE': 'Price Type',
      'DELIVERY LEAD': 'Delivery Lead',
      'CERTIFICATION DOCUMENTS': 'Certification Documents',
    }
    return map[key] || key
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#f7f7f8] text-zinc-900">
      <div className="flex items-center gap-2 border-b border-zinc-200 bg-white px-3 py-2">
        <div className="text-sm font-semibold text-zinc-900">Quotation data</div>
        {status && (
          <span className="rounded bg-zinc-200 px-2 py-0.5 text-[11px] text-zinc-700">{status}</span>
        )}
        <div className="ml-auto flex gap-2">
          <button
            type="button"
            onClick={addOffer}
            disabled={!extractionId}
            className="cursor-pointer rounded bg-zinc-200 px-2 py-1 text-xs text-zinc-800 hover:bg-zinc-300 disabled:opacity-40"
          >
            + Part
          </button>
          <button
            type="button"
            onClick={removeOffer}
            disabled={!extractionId || typeof panel !== 'number'}
            className="cursor-pointer rounded bg-zinc-200 px-2 py-1 text-xs text-zinc-800 hover:bg-zinc-300 disabled:opacity-40"
          >
            Remove part
          </button>
          <button
            type="button"
            disabled={!extractionId || busy}
            onClick={save}
            className="cursor-pointer rounded bg-emerald-600 px-3 py-1 text-xs text-white hover:bg-emerald-500 disabled:opacity-40"
          >
            {busy ? 'Saving…' : 'Save corrections'}
          </button>
        </div>
      </div>

      {(error || err || msg) && (
        <div className="border-b border-zinc-200 px-3 py-2 text-xs">
          {error && <div className="text-red-600">{error}</div>}
          {err && <div className="text-red-600">{err}</div>}
          {msg && <div className="text-emerald-700">{msg}</div>}
        </div>
      )}

      {extractionId && (
        <div className="flex gap-1 overflow-x-auto border-b border-zinc-200 bg-white px-3 pt-2">
          <button
            type="button"
            onClick={() => setPanel('quote')}
            className={`cursor-pointer rounded-t px-3 py-2 text-xs font-semibold ${
              panel === 'quote'
                ? 'border border-b-0 border-zinc-200 bg-[#f7f7f8] text-red-700'
                : 'text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900'
            }`}
          >
            Quote data
          </button>
          {draft.map((_, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setPanel(i)}
              className={`cursor-pointer rounded-t px-3 py-2 text-xs font-semibold ${
                panel === i
                  ? 'border border-b-0 border-zinc-200 bg-[#f7f7f8] text-red-700'
                  : 'text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900'
              }`}
            >
              Part {i + 1}
              {draft[i]?.['PART NUMBER']
                ? ` · ${String(draft[i]['PART NUMBER']).slice(0, 16)}`
                : ''}
            </button>
          ))}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {!extractionId && (
          <div className="text-sm text-zinc-600">
            Select emails and click “Send selected to OpenAI”. Results appear here to review and
            correct.
          </div>
        )}
        {extractionId && panel === 'quote' && (
          <div className="rounded-lg border border-zinc-200 bg-white p-3">
            <p className="mb-3 text-[11px] text-zinc-500">
              Vendor, tender, and terms — same for every part in this email. Date is from when the
              email was received.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block sm:col-span-2">
                <span className="mb-1 block text-xs font-semibold text-zinc-700">Date</span>
                <input
                  value={emailDate || '—'}
                  readOnly
                  className={`${inputClass} bg-zinc-100 text-zinc-600`}
                />
              </label>
              {SHARED_FIELDS.map((key) => (
                <label
                  key={key}
                  className={`block ${key === 'NOTES' || key.startsWith('VENDOR ADDRESS') ? 'sm:col-span-2' : ''}`}
                >
                  <span className="mb-1 block text-xs font-semibold text-zinc-700">
                    {labelFor(key)}
                  </span>
                  {renderInput(key, shared[key] != null ? String(shared[key]) : '', (v) =>
                    setSharedField(key, v),
                  )}
                </label>
              ))}
            </div>
          </div>
        )}
        {extractionId && typeof panel === 'number' && (
          <div className="rounded-lg border border-zinc-200 bg-white p-3">
            <p className="mb-3 text-[11px] text-zinc-500">
              Part line {panel + 1} — part number, qty, price, delivery, certs, and other line-level
              fields.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              {PART_FIELDS.map((key) => (
                <label
                  key={key}
                  className={`block ${
                    key === 'DESCRIPTION' || key === 'CERTIFICATION DOCUMENTS'
                      ? 'sm:col-span-2'
                      : ''
                  }`}
                >
                  <span className="mb-1 block text-xs font-semibold text-zinc-700">
                    {labelFor(key)}
                  </span>
                  {renderInput(
                    key,
                    current[key] != null ? String(current[key]) : '',
                    (v) => setPartField(key, v),
                  )}
                </label>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}