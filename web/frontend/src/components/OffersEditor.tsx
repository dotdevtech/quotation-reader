import { useEffect, useMemo, useRef, useState } from 'react'
import { api, type Offer } from '../api'

/** Shown first and largest on Quote data tab. */
const QUOTE_HERO_FIELDS = ['VENDOR COMPANY', 'VENDOR ADDRESS COUNTRY'] as const

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
  'VENDOR ADDRESS COUNTRY',
  'VENDOR ADDRESS CITY',
  'VENDOR ADDRESS STATE',
  'VENDOR ADDRESS ZIP CODE',
  'VENDOR PHONE',
  'VENDOR FAX',
  'VENDOR EMAIL',
  'VENDOR WEBSITE',
  'PLATFORM',
  'PRODUCT LINK',
] as const

// Keep Country in the address block too (also shown in the hero at top).
const SHARED_FIELDS_REST = SHARED_FIELDS.filter((k) => k !== 'VENDOR COMPANY')

/** Distinct colors per part tab (cycles if more parts than colors). */
const PART_TAB_COLORS = [
  { active: 'border-2 border-b-0 border-sky-600 bg-sky-100 text-sky-950 shadow-sm', idle: 'border-2 border-sky-400 bg-sky-50 text-sky-800 hover:bg-sky-100' },
  { active: 'border-2 border-b-0 border-cyan-600 bg-cyan-100 text-cyan-950 shadow-sm', idle: 'border-2 border-cyan-400 bg-cyan-50 text-cyan-800 hover:bg-cyan-100' },
  { active: 'border-2 border-b-0 border-amber-600 bg-amber-100 text-amber-950 shadow-sm', idle: 'border-2 border-amber-400 bg-amber-50 text-amber-900 hover:bg-amber-100' },
  { active: 'border-2 border-b-0 border-emerald-600 bg-emerald-100 text-emerald-950 shadow-sm', idle: 'border-2 border-emerald-400 bg-emerald-50 text-emerald-800 hover:bg-emerald-100' },
  { active: 'border-2 border-b-0 border-rose-600 bg-rose-100 text-rose-950 shadow-sm', idle: 'border-2 border-rose-400 bg-rose-50 text-rose-800 hover:bg-rose-100' },
  { active: 'border-2 border-b-0 border-orange-600 bg-orange-100 text-orange-950 shadow-sm', idle: 'border-2 border-orange-400 bg-orange-50 text-orange-900 hover:bg-orange-100' },
  { active: 'border-2 border-b-0 border-teal-600 bg-teal-100 text-teal-950 shadow-sm', idle: 'border-2 border-teal-400 bg-teal-50 text-teal-800 hover:bg-teal-100' },
  { active: 'border-2 border-b-0 border-lime-600 bg-lime-100 text-lime-950 shadow-sm', idle: 'border-2 border-lime-400 bg-lime-50 text-lime-800 hover:bg-lime-100' },
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

const DEFAULT_CURRENCY = ['USD', 'EUR', 'CAD', 'GBP', 'YEN', 'PKR', 'AED', 'OTHER']

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
  'box-border w-full max-w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-center text-base text-slate-900 outline-none ring-red-500/30 focus:border-red-500 focus:ring-2'

/** Filled fields: tinted background, bold, larger, centered. */
const filledInputClass =
  'box-border w-full max-w-full rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2.5 text-center text-xl font-bold text-emerald-950 outline-none ring-emerald-500/30 focus:border-emerald-500 focus:ring-2'

function fieldInputClass(value: string, readOnly = false) {
  const has = Boolean(value.trim()) && value.trim() !== '—'
  if (readOnly && has) return `${filledInputClass} bg-emerald-50/80 text-slate-800`
  if (readOnly) return `${inputClass} bg-slate-100 text-slate-600`
  return has ? filledInputClass : inputClass
}

/** Labels: strong color so they are easy to spot (separate from filled values). */
const labelClass =
  'mb-1.5 block text-center rounded bg-sky-100 px-2 py-0.5 text-xs font-bold uppercase tracking-wide text-sky-900'

const heroLabelClass =
  'mb-1 block text-center rounded bg-amber-200 px-2 py-0.5 text-xs font-bold uppercase tracking-wide text-amber-950'

function heroInputClass(value: string) {
  const has = Boolean(value.trim())
  return has
    ? 'box-border w-full max-w-full rounded-md border-2 border-amber-400 bg-amber-50 px-3 py-2.5 text-center text-xl font-bold text-amber-950 outline-none ring-amber-500/30 focus:border-amber-500 focus:ring-2'
    : 'box-border w-full max-w-full rounded-md border-2 border-dashed border-amber-300 bg-white px-3 py-2.5 text-center text-lg text-slate-500 outline-none focus:border-amber-500 focus:ring-2'
}

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

function cleanOffers(offers: Offer[]): Offer[] {
  return offers
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
}

function serializeOffers(offers: Offer[]): string {
  return JSON.stringify(cleanOffers(offers))
}

type Props = {
  extractionId: number | null
  offers: Offer[]
  error?: string | null
  /** Email received date shown as read-only Date (YYYY-MM-DD or display string) */
  emailDate?: string
  onSaved?: (offers: Offer[]) => void
  /** Notifies parent when unsaved edits change (for Prev/Next warnings). */
  onDirtyChange?: (dirty: boolean) => void
}

export default function OffersEditor({
  extractionId,
  offers,
  error,
  emailDate = '',
  onSaved,
  onDirtyChange,
}: Props) {
  const [conditionOpts, setConditionOpts] = useState(DEFAULT_CONDITION)
  const [priceTypeOpts, setPriceTypeOpts] = useState(DEFAULT_PRICE_TYPE)
  const [currencyOpts, setCurrencyOpts] = useState(DEFAULT_CURRENCY)
  const [certOpts, setCertOpts] = useState(DEFAULT_CERTS)
  const initialOffers = offers.length ? offers.map((o) => ({ ...o })) : [{}]
  const initialShared = pickShared(initialOffers)
  const [draft, setDraft] = useState<Offer[]>(initialOffers)
  const [shared, setShared] = useState<Offer>(initialShared)
  /** 'quote' = quote/vendor/terms tab; number = part line index */
  const [panel, setPanel] = useState<'quote' | number>('quote')
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [baseline, setBaseline] = useState(() =>
    serializeOffers(applySharedToAll(initialOffers, initialShared)),
  )
  // undefined = not synced yet (force first load of quote data)
  const prevExtractionIdRef = useRef<number | null | undefined>(undefined)
  const baselineRef = useRef(baseline)
  const dirtyRef = useRef(false)

  const isDirty = useMemo(() => {
    return serializeOffers(applySharedToAll(draft, shared)) !== baseline
  }, [draft, shared, baseline])
  dirtyRef.current = isDirty
  baselineRef.current = baseline

  useEffect(() => {
    onDirtyChange?.(isDirty)
  }, [isDirty, onDirtyChange])

  useEffect(() => {
    const next = offers.length ? offers.map((o) => ({ ...o })) : [{}]
    const sharedNext = pickShared(next)
    const serialized = serializeOffers(applySharedToAll(next, sharedNext))
    const firstLoad = prevExtractionIdRef.current === undefined
    const extractionChanged = prevExtractionIdRef.current !== extractionId
    prevExtractionIdRef.current = extractionId

    // Background scan polls refresh `offers` often — don't kick the user off a Part tab
    // or wipe unsaved edits while staying on the same extraction.
    // Always apply on first load so Quote data is not left empty.
    if (!firstLoad && !extractionChanged && dirtyRef.current) return
    if (!firstLoad && !extractionChanged && serialized === baselineRef.current) return

    setDraft(next)
    setShared(sharedNext)
    setBaseline(serialized)
    baselineRef.current = serialized
    if (firstLoad || extractionChanged) {
      setPanel('quote')
      setMsg('')
    } else {
      setPanel((p) => {
        if (p === 'quote') return p
        if (typeof p === 'number' && p < next.length) return p
        return 'quote'
      })
    }
  }, [offers, extractionId])
  useEffect(() => {
    api
      .masterFields()
      .then((r) => {
        if (r.condition_options?.length) setConditionOpts(r.condition_options)
        if (r.price_type_options?.length) setPriceTypeOpts(r.price_type_options)
        if (r.currency_options?.length) setCurrencyOpts(r.currency_options)
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
    if (!extractionId || !isDirty) return
    setBusy(true)
    setMsg('')
    setErr('')
    try {
      const cleaned = cleanOffers(applySharedToAll(draft, shared))
      await api.updateExtraction(extractionId, { offers: cleaned, offer_count: cleaned.length })
      const next = cleaned.length ? cleaned : [{}]
      const sharedNext = pickShared(next)
      setDraft(next)
      setShared(sharedNext)
      setBaseline(serializeOffers(applySharedToAll(next, sharedNext)))
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
    const cls = `${fieldInputClass(value, opts?.readOnly)} cursor-pointer`
    if (key === 'CONDITION') {
      const known = !value || conditionOpts.includes(value)
      return (
        <select
          value={known ? value : ''}
          onChange={(e) => onChange(e.target.value)}
          className={cls}
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
          className={cls}
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
    if (key === 'CURRENCY') {
      const known = !value || currencyOpts.includes(value)
      return (
        <select
          value={known ? value : ''}
          onChange={(e) => onChange(e.target.value)}
          className={cls}
        >
          <option value="">— Select —</option>
          {currencyOpts.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      )
    }
    if (key === 'CERTIFICATION DOCUMENTS') {
      const hasAny = selectedCerts.size > 0
      return (
        <div
          className={`grid grid-cols-1 gap-1.5 rounded-md p-2 sm:grid-cols-2 ${
            hasAny ? 'border border-emerald-300 bg-emerald-50' : ''
          }`}
        >
          {certOpts.map((opt) => {
            const on = selectedCerts.has(opt)
            return (
              <label
                key={opt}
                className={`flex cursor-pointer items-center gap-2 rounded-md border px-2.5 py-1.5 hover:bg-slate-50 ${
                  on
                    ? 'border-emerald-400 bg-emerald-100 text-center text-xl font-bold text-emerald-950'
                    : 'border-slate-200 bg-white text-center text-base text-slate-800'
                }`}
              >
                <input
                  type="checkbox"
                  className="cursor-pointer accent-emerald-600"
                  checked={on}
                  onChange={() => toggleCert(opt)}
                />
                {opt}
              </label>
            )
          })}
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
          className={cls}
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
          className={fieldInputClass(value)}
        />
      )
    }
    return (
      <input
        value={value}
        readOnly={opts?.readOnly}
        onChange={(e) => onChange(e.target.value)}
        className={fieldInputClass(value, opts?.readOnly)}
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
      'VENDOR COMPANY': 'Vendor Name',
      'VENDOR ADDRESS COUNTRY': 'Vendor Country',
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
    <div className="flex h-full min-h-0 min-w-0 max-w-full flex-col overflow-hidden bg-slate-50 text-slate-900">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-3 py-2">
        <div className="ml-auto flex flex-wrap gap-2">
          <button
            type="button"
            onClick={addOffer}
            disabled={!extractionId}
            className="cursor-pointer rounded bg-slate-800 px-2 py-1 text-xs text-white hover:bg-slate-700 disabled:opacity-40"
          >
            + Part
          </button>
          <button
            type="button"
            onClick={removeOffer}
            disabled={!extractionId || typeof panel !== 'number'}
            className="cursor-pointer rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-40"
          >
            Remove part
          </button>
          <button
            type="button"
            disabled={!extractionId || busy || !isDirty}
            onClick={save}
            title={
              !isDirty
                ? 'No changes yet — edit a field to enable save'
                : 'Save your corrections'
            }
            className="cursor-pointer rounded bg-emerald-600 px-3 py-1 text-xs text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? 'Saving…' : 'Save corrections'}
          </button>
        </div>
      </div>

      {(error || err || msg) && (
        <div className="border-b border-slate-200 px-3 py-2 text-xs">
          {error && <div className="text-red-600">{error}</div>}
          {err && <div className="text-red-600">{err}</div>}
          {msg && <div className="text-emerald-700">{msg}</div>}
        </div>
      )}

      {extractionId && (
        <div className="flex gap-1 overflow-x-auto border-b border-slate-200 bg-white px-3 pt-2">
          <button
            type="button"
            onClick={() => setPanel('quote')}
            className={`cursor-pointer rounded-t px-3 py-2 text-xs font-semibold ${
              panel === 'quote'
                ? 'border border-b-0 border-slate-200 bg-slate-50 text-red-800'
                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
            }`}
          >
            Quote data
          </button>
          {draft.map((_, i) => {
            const colors = PART_TAB_COLORS[i % PART_TAB_COLORS.length]
            const active = panel === i
            return (
              <button
                key={i}
                type="button"
                onClick={() => setPanel(i)}
                className={`cursor-pointer rounded-t px-3.5 py-2.5 text-xs font-bold ${
                  active ? colors.active : colors.idle
                }`}
              >
                Part {i + 1}
                {draft[i]?.['PART NUMBER']
                  ? ` · ${String(draft[i]['PART NUMBER']).slice(0, 16)}`
                  : ''}
              </button>
            )
          })}
        </div>
      )}

      <div className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto p-3">
        {!extractionId && (
          <div className="text-sm text-slate-600">
            Select emails and click “Scan”. Results appear here to review and correct.
          </div>
        )}
        {extractionId && panel === 'quote' && (
          <div className="space-y-3">
            <div className="rounded-lg border-2 border-amber-300 bg-amber-50/60 p-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {QUOTE_HERO_FIELDS.map((key) => {
                  const value = shared[key] != null ? String(shared[key]) : ''
                  return (
                    <label key={key} className="block min-w-0">
                      <span className={heroLabelClass}>{labelFor(key)}</span>
                      <input
                        value={value}
                        onChange={(e) => setSharedField(key, e.target.value)}
                        placeholder={key === 'VENDOR COMPANY' ? 'Vendor company name' : 'Country'}
                        className={heroInputClass(value)}
                      />
                    </label>
                  )
                })}
              </div>
            </div>

            <div className="rounded-lg border-2 border-sky-300 bg-sky-50/70 p-3">
              <div className="mb-2 flex flex-wrap items-center justify-center gap-2 text-center">
                <span className="rounded bg-sky-200 px-2 py-0.5 text-xs font-bold uppercase tracking-wide text-sky-950">
                  Products quoted
                </span>
                <span className="rounded-md bg-sky-600 px-4 py-1.5 text-3xl font-extrabold leading-none text-white">
                  {draft.length}
                </span>
                <span className="text-xs font-semibold text-sky-800">
                  {draft.length === 1 ? 'part line' : 'part lines'} in this email
                </span>
              </div>
              <div className="flex flex-wrap justify-center gap-2">
                {draft.map((o, i) => {
                  const pn = o['PART NUMBER'] != null ? String(o['PART NUMBER']).trim() : ''
                  const colors = PART_TAB_COLORS[i % PART_TAB_COLORS.length]
                  return (
                    <button
                      key={i}
                      type="button"
                      onClick={() => setPanel(i)}
                      title={`Open Part ${i + 1}`}
                      className={`cursor-pointer rounded-md border-2 px-3 py-1.5 text-sm font-bold ${colors.idle}`}
                    >
                      {pn || `Part ${i + 1} (no P/N)`}
                    </button>
                  )
                })}
                {draft.length === 0 && (
                  <span className="text-sm text-sky-700">No part lines yet.</span>
                )}
              </div>
            </div>

            <div className="rounded-lg border border-slate-200 bg-white p-3">
              <p className="mb-3 text-[11px] text-slate-500">
                Quote date, references, terms, and other vendor details.
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block sm:col-span-2">
                  <span className={labelClass}>Date</span>
                  <input
                    value={emailDate || '—'}
                    readOnly
                    className={fieldInputClass(emailDate || '—', true)}
                  />
                </label>
                {SHARED_FIELDS_REST.map((key) => (
                  <label
                    key={key}
                    className={`block ${key === 'NOTES' || key.startsWith('VENDOR ADDRESS') ? 'sm:col-span-2' : ''}`}
                  >
                    <span className={labelClass}>{labelFor(key)}</span>
                    {renderInput(key, shared[key] != null ? String(shared[key]) : '', (v) =>
                      setSharedField(key, v),
                    )}
                  </label>
                ))}
              </div>
            </div>
          </div>
        )}
        {extractionId && typeof panel === 'number' && (
          <div className="rounded-lg border border-slate-200 bg-white p-3">
            <p className="mb-3 text-[11px] text-slate-500">
              Part line {panel + 1} — part number, qty, price, delivery, certs, and other line-level
              fields.
            </p>
            {(() => {
              const partField = (key: string, className = 'block min-w-0') => {
                const value = current[key] != null ? String(current[key]) : ''
                const isHero = key === 'PART NUMBER'
                return (
                  <label key={key} className={className}>
                    <span className={isHero ? heroLabelClass : labelClass}>{labelFor(key)}</span>
                    {isHero ? (
                      <input
                        value={value}
                        onChange={(e) => setPartField(key, e.target.value)}
                        placeholder="Part number"
                        className={heroInputClass(value)}
                      />
                    ) : (
                      renderInput(key, value, (v) => setPartField(key, v))
                    )}
                  </label>
                )
              }
              return (
                <div className="space-y-3">
                  {/* 1. Part number — most visible */}
                  <div className="rounded-lg border-2 border-amber-300 bg-amber-50/60 p-3">
                    {partField('PART NUMBER')}
                  </div>
                  {/* 2. Description + Condition */}
                  <div className="grid gap-3 sm:grid-cols-2">
                    {partField('DESCRIPTION')}
                    {partField('CONDITION')}
                  </div>
                  {/* 3. Alternate + NSN */}
                  <div className="grid gap-3 sm:grid-cols-2">
                    {partField('ALTERNATE PART NUMBER')}
                    {partField('NSN')}
                  </div>
                  {/* 4. Qty offered + Qty required + UOM */}
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    {partField('QUANTITY OFFERED')}
                    {partField('QUANTITY REQUIRED')}
                    {partField('UOM')}
                  </div>
                  {/* 5. Currency + Price each + Total */}
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    {partField('CURRENCY')}
                    {partField('PRICE UNIT')}
                    {partField('TOTAL PRICE')}
                  </div>
                  {/* 6. Price type + Delivery + Trace */}
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    {partField('PRICE TYPE')}
                    {partField('DELIVERY LEAD')}
                    {partField('TRACE')}
                  </div>
                  {/* 7. Certificates */}
                  {partField('CERTIFICATION DOCUMENTS')}
                  {/* 8. Package + Package qty + Package type */}
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    {partField('PACKAGE')}
                    {partField('PACKAGE QUANTITY')}
                    {partField('PACKAGE TYPE')}
                  </div>
                </div>
              )
            })()}
          </div>
        )}
      </div>
    </div>
  )
}