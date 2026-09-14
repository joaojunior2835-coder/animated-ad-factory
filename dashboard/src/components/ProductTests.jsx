// Product Tests — the manual foundation for Organic Product Testing.
//
// A human enters product facts, creates iterations and creatives by hand,
// links a creative to existing Marketing Studio content, and records
// publications and metrics by hand. Nothing here generates angles, hooks or
// verdicts; the point is to exercise the real schema, lineage and budget rules
// end to end before any intelligence layer is built on top.
//
// Self-contained: it does not touch Marketing Studio or Node Canvas, it only
// reads the Studio's session list in order to link one.

import { useEffect, useMemo, useRef, useState } from 'react'
import { apiBase } from '../lib/ai/apiClient.js'

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

async function api(method, path, body) {
  const res = await fetch(apiBase() + path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  let json = null
  try {
    json = await res.json()
  } catch {
    json = null
  }
  if (!res.ok || !json || json.ok === false) {
    throw new Error((json && json.error) || `Request failed (HTTP ${res.status}).`)
  }
  return json
}

// Money is stored in integer minor units everywhere; these convert only at the
// edge, for display and for form input.
const toMinor = (text) => {
  const n = Number(String(text).replace(',', '.'))
  return Number.isFinite(n) ? Math.round(n * 100) : 0
}
const fromMinor = (minor) => (Number(minor || 0) / 100).toFixed(2)
const euro = (minor, currency = 'EUR') => `${currency === 'EUR' ? '€' : ''}${fromMinor(minor)}`

const nowLocalInput = () => {
  const d = new Date()
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset())
  return d.toISOString().slice(0, 16)
}

function Field({ label, children, hint }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint ? <span className="hint small">{hint}</span> : null}
    </label>
  )
}

function ErrorNote({ error, onRetry }) {
  if (!error) return null
  return (
    <div className="note bad" data-testid="pt-error" style={{ marginBottom: '12px' }}>
      {error}
      {onRetry ? (
        <button className="ghost small" style={{ marginLeft: '8px' }} onClick={onRetry}>
          Retry
        </button>
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Margin preview — informational only. It never blocks submission: the user
// decides, the number just makes the decision an informed one.
// ---------------------------------------------------------------------------

function MarginBadge({ margin }) {
  if (!margin) return null
  const flags = margin.flags || []
  const negative = flags.includes('NEGATIVE_MARGIN')
  const highRisk = flags.includes('ECONOMICS_HIGH_RISK')
  const warning = flags.includes('ECONOMICS_WARNING')

  const tone = negative || highRisk ? 'bad' : warning ? 'warn' : 'good'
  const colors = {
    good: { background: '#123d21', border: '#2f7d4a', color: '#8ff0b0' },
    warn: { background: '#40320f', border: '#a07c1f', color: '#f4d47c' },
    bad: { background: '#4a1620', border: '#a32f43', color: '#ffb0be' },
  }[tone]

  const pct = margin.marginPercent === null ? '—' : `${margin.marginPercent.toFixed(1)}%`
  const label = negative ? 'NEGATIVE MARGIN' : highRisk ? 'ECONOMICS_HIGH_RISK' : warning ? 'ECONOMICS_WARNING' : 'Healthy'

  return (
    <div
      data-testid="margin-preview"
      style={{ ...colors, border: `1px solid ${colors.border}`, borderRadius: '6px', padding: '8px 10px', marginTop: '8px' }}
    >
      <b data-testid="margin-amount">
        Contribution margin: {euro(margin.marginMinor)} ({pct})
      </b>
      <span data-testid="margin-flag" style={{ marginLeft: '8px', fontWeight: 600 }}>
        {label}
      </span>
      <div className="hint small" style={{ marginTop: '4px', color: 'inherit', opacity: 0.85 }}>
        Thresholds: min {euro(margin.thresholds.minContributionMarginMinor)} and{' '}
        {margin.thresholds.minContributionMarginPercent}%. Informational only — you decide whether to run this test.
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// New Product Test
// ---------------------------------------------------------------------------

function NewProductTest({ onCancel, onCreated }) {
  const [form, setForm] = useState({
    name: '',
    productUrl: '',
    supplierUrl: '',
    market: 'FR',
    language: 'fr',
    sellingPrice: '',
    productCost: '',
    shippingCost: '',
    expectedShippingDays: '',
    notes: '',
  })
  const [margin, setMargin] = useState(null)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const timerRef = useRef(null)

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  // Debounced so typing a price does not fire a request per keystroke.
  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(async () => {
      if (!form.sellingPrice && !form.productCost && !form.shippingCost) {
        setMargin(null)
        return
      }
      try {
        const r = await api('POST', '/api/product-tests/new/margin-preview', {
          sellingPriceMinor: toMinor(form.sellingPrice),
          productCostMinor: toMinor(form.productCost),
          shippingCostMinor: toMinor(form.shippingCost),
        })
        setMargin(r.margin)
      } catch {
        setMargin(null)
      }
    }, 500)
    return () => timerRef.current && clearTimeout(timerRef.current)
  }, [form.sellingPrice, form.productCost, form.shippingCost])

  const submit = async () => {
    setSaving(true)
    setError('')
    try {
      const r = await api('POST', '/api/product-tests', {
        newProduct: { name: form.name, productUrl: form.productUrl, supplierUrl: form.supplierUrl, notes: form.notes },
        market: form.market,
        language: form.language,
        sellingPriceMinor: toMinor(form.sellingPrice),
        productCostMinor: toMinor(form.productCost),
        shippingCostMinor: toMinor(form.shippingCost),
        currency: 'EUR',
        expectedShippingDays: form.expectedShippingDays ? Number(form.expectedShippingDays) : null,
      })
      onCreated(r.item)
    } catch (e) {
      setError(e.message)
      setSaving(false)
    }
  }

  return (
    <section className="panel ms-panel">
      <div className="row between">
        <h2>New Product Test</h2>
        <button className="ghost small" onClick={onCancel}>
          ← Back
        </button>
      </div>
      <ErrorNote error={error} />

      <div className="fields">
        <Field label="Product name">
          <input className="ms-input" data-testid="pt-name" value={form.name} onChange={set('name')} placeholder="NuitCalme" />
        </Field>
        <Field label="Product URL">
          <input className="ms-input" value={form.productUrl} onChange={set('productUrl')} placeholder="https://…" />
        </Field>
        <Field label="Supplier URL">
          <input className="ms-input" value={form.supplierUrl} onChange={set('supplierUrl')} placeholder="https://…" />
        </Field>
        <Field label="Market">
          <input className="ms-input" data-testid="pt-market" value={form.market} onChange={set('market')} />
        </Field>
        <Field label="Language">
          <input className="ms-input" data-testid="pt-language" value={form.language} onChange={set('language')} />
        </Field>
        <Field label="Selling price (€)">
          <input className="ms-input" data-testid="pt-selling" value={form.sellingPrice} onChange={set('sellingPrice')} placeholder="29.99" />
        </Field>
        <Field label="Product cost (€)">
          <input className="ms-input" data-testid="pt-cost" value={form.productCost} onChange={set('productCost')} placeholder="8.00" />
        </Field>
        <Field label="Shipping cost (€)">
          <input className="ms-input" data-testid="pt-shipping" value={form.shippingCost} onChange={set('shippingCost')} placeholder="3.00" />
        </Field>
        <Field label="Expected shipping days">
          <input className="ms-input" value={form.expectedShippingDays} onChange={set('expectedShippingDays')} placeholder="9" />
        </Field>
        <Field label="Notes">
          <textarea className="ms-input" rows={2} value={form.notes} onChange={set('notes')} />
        </Field>
      </div>

      <MarginBadge margin={margin} />

      <div className="row" style={{ gap: '8px', marginTop: '12px' }}>
        <button className="primary" data-testid="pt-submit" disabled={saving || !form.name.trim()} onClick={submit}>
          {saving ? 'Creating…' : 'Create Product Test'}
        </button>
        <button className="ghost" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Iteration form — a plain repeatable matrix, not a generator.
// ---------------------------------------------------------------------------

function NewIterationForm({ productTestId, onCancel, onCreated }) {
  const [mode, setMode] = useState('exploratory')
  const [rows, setRows] = useState([{ angle: '', format: '', hook: '' }])
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const setRow = (i, k) => (e) => setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, [k]: e.target.value } : r)))

  const submit = async () => {
    setSaving(true)
    setError('')
    try {
      const matrix = rows.filter((r) => r.angle.trim() || r.format.trim() || r.hook.trim())
      const angles = [...new Set(matrix.map((r) => r.angle.trim()).filter(Boolean))]
      const r = await api('POST', `/api/product-tests/${productTestId}/iterations`, {
        mode,
        strategySnapshot: { angles, matrix },
        policyOverrides: {},
      })
      onCreated(r.item)
    } catch (e) {
      setError(e.message)
      setSaving(false)
    }
  }

  return (
    <div className="subpanel" data-testid="new-iteration-form" style={{ marginTop: '12px' }}>
      <h4>New Iteration</h4>
      <ErrorNote error={error} />
      <Field label="Mode">
        <select data-testid="iteration-mode" value={mode} onChange={(e) => setMode(e.target.value)}>
          <option value="exploratory">Exploratory</option>
          <option value="confirmatory">Confirmatory</option>
        </select>
      </Field>

      <div className="hint small" style={{ margin: '8px 0' }}>
        Strategy matrix — one row per angle / format / hook you intend to test.
      </div>
      {rows.map((r, i) => (
        <div className="row" key={i} style={{ gap: '6px', marginBottom: '6px' }}>
          <input className="ms-input" data-testid={`row-angle-${i}`} placeholder="Angle" value={r.angle} onChange={setRow(i, 'angle')} />
          <input className="ms-input" data-testid={`row-format-${i}`} placeholder="Format" value={r.format} onChange={setRow(i, 'format')} />
          <input className="ms-input" data-testid={`row-hook-${i}`} placeholder="Hook" value={r.hook} onChange={setRow(i, 'hook')} />
          {rows.length > 1 ? (
            <button className="ghost small danger" onClick={() => setRows((rs) => rs.filter((_, idx) => idx !== i))}>
              ✕
            </button>
          ) : null}
        </div>
      ))}
      <button className="ghost small" data-testid="add-row" onClick={() => setRows((rs) => [...rs, { angle: '', format: '', hook: '' }])}>
        + Add row
      </button>

      <div className="row" style={{ gap: '8px', marginTop: '12px' }}>
        <button className="primary small" data-testid="iteration-submit" disabled={saving} onClick={submit}>
          {saving ? 'Creating…' : 'Create Iteration'}
        </button>
        <button className="ghost small" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// AI-assisted strategy wizard — Step A (research) and Step B (strategy).
//
// Nothing here writes to the database until the final Approve action. Step A
// and Step B only call research/generate and strategy/generate, both of which
// are read-only from the database's point of view.
// ---------------------------------------------------------------------------

/** Editable list of plain strings — add / edit / remove rows. */
function EditableStringList({ items, onChange, placeholder, testId }) {
  const list = Array.isArray(items) ? items : []
  const setAt = (i, value) => onChange(list.map((v, idx) => (idx === i ? value : v)))
  const removeAt = (i) => onChange(list.filter((_, idx) => idx !== i))
  return (
    <div>
      {list.map((v, i) => (
        <div className="row" key={i} style={{ gap: '6px', marginBottom: '4px' }}>
          <input
            className="ms-input"
            data-testid={testId ? `${testId}-${i}` : undefined}
            value={v}
            placeholder={placeholder}
            onChange={(e) => setAt(i, e.target.value)}
          />
          <button className="ghost small danger" onClick={() => removeAt(i)}>
            ✕
          </button>
        </div>
      ))}
      <button className="ghost small" onClick={() => onChange([...list, ''])}>
        + Add
      </button>
    </div>
  )
}

/** Editable list of {momentOrTrigger, whyKey} pairs — used for moments/emotionalTriggers. */
function EditableRowPairList({ items, onChange, keyA, keyB, labelA, labelB }) {
  const list = Array.isArray(items) ? items : []
  const setField = (i, field, value) => onChange(list.map((v, idx) => (idx === i ? { ...v, [field]: value } : v)))
  const removeAt = (i) => onChange(list.filter((_, idx) => idx !== i))
  return (
    <div>
      {list.map((row, i) => (
        <div className="subpanel" key={i} style={{ marginBottom: '6px', padding: '8px' }}>
          <div className="row" style={{ gap: '6px' }}>
            <input className="ms-input" placeholder={labelA} value={row[keyA] || ''} onChange={(e) => setField(i, keyA, e.target.value)} />
            <button className="ghost small danger" onClick={() => removeAt(i)}>
              ✕
            </button>
          </div>
          <input className="ms-input" style={{ marginTop: '4px' }} placeholder={labelB} value={row[keyB] || ''} onChange={(e) => setField(i, keyB, e.target.value)} />
        </div>
      ))}
      <button className="ghost small" onClick={() => onChange([...list, { [keyA]: '', [keyB]: '' }])}>
        + Add
      </button>
    </div>
  )
}

/** Editable customerLanguage list — phrase + a SOURCE-DERIVED/INFERRED badge. */
function EditableCustomerLanguage({ items, onChange }) {
  const list = Array.isArray(items) ? items : []
  const setField = (i, field, value) => onChange(list.map((v, idx) => (idx === i ? { ...v, [field]: value } : v)))
  const removeAt = (i) => onChange(list.filter((_, idx) => idx !== i))
  return (
    <div>
      {list.map((row, i) => (
        <div className="row" key={i} style={{ gap: '6px', marginBottom: '4px', alignItems: 'center' }}>
          <input className="ms-input" value={row.phrase || ''} onChange={(e) => setField(i, 'phrase', e.target.value)} />
          <select value={row.provenance || 'INFERRED'} onChange={(e) => setField(i, 'provenance', e.target.value)}>
            <option value="SOURCE-DERIVED">SOURCE-DERIVED</option>
            <option value="INFERRED">INFERRED</option>
          </select>
          <button className="ghost small danger" onClick={() => removeAt(i)}>
            ✕
          </button>
        </div>
      ))}
      <button className="ghost small" onClick={() => onChange([...list, { phrase: '', provenance: 'INFERRED' }])}>
        + Add
      </button>
    </div>
  )
}

function ResearchStep({ test, draft, setDraft, sourceFetch, loading, error, onRegenerate, onContinue }) {
  const p = draft?.product || {}
  const vd = draft?.visualDemonstration || {}
  const av = draft?.primaryAvatar || {}
  const op = draft?.organicPotential || {}

  const patch = (path, value) => {
    setDraft((d) => {
      const next = JSON.parse(JSON.stringify(d))
      let obj = next
      for (let i = 0; i < path.length - 1; i++) obj = obj[path[i]]
      obj[path[path.length - 1]] = value
      return next
    })
  }

  return (
    <div data-testid="ai-wizard-step-a">
      <ErrorNote error={error} onRetry={onRegenerate} />

      {loading ? (
        <div className="ms-empty-state" data-testid="research-loading">
          <p>Researching {test.product_name}…</p>
        </div>
      ) : draft ? (
        <>
          <div className="note" data-testid="source-fetch-status" style={{ marginBottom: '12px' }}>
            {sourceFetch && sourceFetch.ok ? (
              <>
                Using product page content from <b>{sourceFetch.finalUrl}</b>, fetched {new Date(sourceFetch.fetchedAt).toLocaleString()}.
              </>
            ) : sourceFetch && sourceFetch.attempted ? (
              <>Product page could not be read automatically ({sourceFetch.reason}) — using Product Test details only.</>
            ) : (
              <>Product page fetch not attempted — using Product Test details only.</>
            )}
          </div>

          <div className="subpanel" style={{ marginBottom: '10px' }}>
            <h4>Product</h4>
            <Field label="What it is">
              <textarea className="ms-input" rows={2} value={p.whatItIs || ''} onChange={(e) => patch(['product', 'whatItIs'], e.target.value)} />
            </Field>
            <Field label="Mechanism">
              <textarea className="ms-input" rows={2} value={p.mechanism || ''} onChange={(e) => patch(['product', 'mechanism'], e.target.value)} />
            </Field>
            <Field label="Key characteristics">
              <EditableStringList items={p.keyCharacteristics} onChange={(v) => patch(['product', 'keyCharacteristics'], v)} />
            </Field>
            <Field label="Limitations">
              <EditableStringList items={p.limitations} onChange={(v) => patch(['product', 'limitations'], v)} />
            </Field>
            <Field label="Provenance">
              <select value={p.provenance || 'UNKNOWN'} onChange={(e) => patch(['product', 'provenance'], e.target.value)}>
                <option value="SOURCE FACT">SOURCE FACT</option>
                <option value="INFERENCE">INFERENCE</option>
                <option value="UNKNOWN">UNKNOWN</option>
              </select>
            </Field>
          </div>

          <div className="subpanel" style={{ marginBottom: '10px' }}>
            <h4>Visual demonstration</h4>
            <Field label="First seconds clarity">
              <textarea className="ms-input" rows={2} value={vd.firstSecondsClarity || ''} onChange={(e) => patch(['visualDemonstration', 'firstSecondsClarity'], e.target.value)} />
            </Field>
            <Field label="Strongest demo ideas">
              <EditableStringList items={vd.strongestDemoIdeas} onChange={(v) => patch(['visualDemonstration', 'strongestDemoIdeas'], v)} />
            </Field>
            <label className="row" style={{ gap: '6px', alignItems: 'center' }}>
              <input type="checkbox" checked={!!vd.isOutcomeVisible} onChange={(e) => patch(['visualDemonstration', 'isOutcomeVisible'], e.target.checked)} />
              <span>Outcome is visible</span>
            </label>
            <Field label="Risks">
              <EditableStringList items={vd.risks} onChange={(v) => patch(['visualDemonstration', 'risks'], v)} />
            </Field>
          </div>

          <div className="subpanel" style={{ marginBottom: '10px' }}>
            <h4>Primary avatar</h4>
            <Field label="Who they are">
              <textarea className="ms-input" rows={2} value={av.whoTheyAre || ''} onChange={(e) => patch(['primaryAvatar', 'whoTheyAre'], e.target.value)} />
            </Field>
            <Field label="Main problem">
              <textarea className="ms-input" rows={2} value={av.mainProblem || ''} onChange={(e) => patch(['primaryAvatar', 'mainProblem'], e.target.value)} />
            </Field>
            <Field label="Desired outcome">
              <textarea className="ms-input" rows={2} value={av.desiredOutcome || ''} onChange={(e) => patch(['primaryAvatar', 'desiredOutcome'], e.target.value)} />
            </Field>
            <Field label="Main objections">
              <EditableStringList items={av.mainObjections} onChange={(v) => patch(['primaryAvatar', 'mainObjections'], v)} />
            </Field>
            <Field label="Current alternatives">
              <textarea className="ms-input" rows={2} value={av.currentAlternatives || ''} onChange={(e) => patch(['primaryAvatar', 'currentAlternatives'], e.target.value)} />
            </Field>
          </div>

          <div className="subpanel" style={{ marginBottom: '10px' }}>
            <h4>Moments</h4>
            <EditableRowPairList items={draft.moments} onChange={(v) => patch(['moments'], v)} keyA="moment" keyB="whyItMatters" labelA="Moment" labelB="Why it matters" />
          </div>

          <div className="subpanel" style={{ marginBottom: '10px' }}>
            <h4>Emotional triggers</h4>
            <EditableRowPairList items={draft.emotionalTriggers} onChange={(v) => patch(['emotionalTriggers'], v)} keyA="trigger" keyB="whyItApplies" labelA="Trigger" labelB="Why it applies" />
          </div>

          <div className="subpanel" style={{ marginBottom: '10px' }}>
            <h4>Customer language</h4>
            <EditableCustomerLanguage items={draft.customerLanguage} onChange={(v) => patch(['customerLanguage'], v)} />
          </div>

          <div className="subpanel" style={{ marginBottom: '10px' }}>
            <h4>Organic potential</h4>
            <Field label="Strengths">
              <EditableStringList items={op.strengths} onChange={(v) => patch(['organicPotential', 'strengths'], v)} />
            </Field>
            <Field label="Risks">
              <EditableStringList items={op.risks} onChange={(v) => patch(['organicPotential', 'risks'], v)} />
            </Field>
            <Field label="Unknowns">
              <EditableStringList items={op.unknowns} onChange={(v) => patch(['organicPotential', 'unknowns'], v)} />
            </Field>
          </div>

          <div className="row" style={{ gap: '8px' }}>
            <button
              className="ghost"
              onClick={() => {
                if (window.confirm('Regenerate research? Your current edits will be discarded.')) onRegenerate()
              }}
            >
              🔄 Regenerate Research
            </button>
            <button className="primary" data-testid="continue-to-strategy" disabled={!draft} onClick={onContinue}>
              Continue to Strategy →
            </button>
          </div>
        </>
      ) : null}
    </div>
  )
}

function ExecutionCard({ execution, flaggedHooks, onChange, onRemove, onMoveUp, onMoveDown }) {
  const set = (field, value) => onChange({ ...execution, [field]: value })
  const isFlagged = flaggedHooks.has(execution.hookText)
  return (
    <div className="subpanel" data-testid="execution-card" style={{ marginBottom: '8px', border: isFlagged ? '1px solid #a32f43' : undefined }}>
      {isFlagged ? (
        <div className="note bad" data-testid="near-duplicate-warning" style={{ marginBottom: '6px' }}>
          ⚠ This hook is very similar to another execution — consider differentiating it further.
        </div>
      ) : null}
      <div className="fields">
        <Field label="Format">
          <input className="ms-input" value={execution.format || ''} onChange={(e) => set('format', e.target.value)} />
        </Field>
        <Field label="Hook family">
          <input className="ms-input" value={execution.hookFamily || ''} onChange={(e) => set('hookFamily', e.target.value)} />
        </Field>
        <Field label="Hook text">
          <input className="ms-input" data-testid="execution-hook-text" value={execution.hookText || ''} onChange={(e) => set('hookText', e.target.value)} />
        </Field>
        <Field label="First frame concept">
          <textarea className="ms-input" rows={2} value={execution.firstFrameConcept || ''} onChange={(e) => set('firstFrameConcept', e.target.value)} />
        </Field>
        <Field label="Core scenario">
          <textarea className="ms-input" rows={2} value={execution.coreScenario || ''} onChange={(e) => set('coreScenario', e.target.value)} />
        </Field>
        <Field label="Differentiation note">
          <textarea className="ms-input" rows={2} value={execution.differentiationNote || ''} onChange={(e) => set('differentiationNote', e.target.value)} />
        </Field>
        <Field label="Suggested duration range">
          <input className="ms-input" value={execution.suggestedDurationRange || ''} onChange={(e) => set('suggestedDurationRange', e.target.value)} />
        </Field>
        <Field label="Production notes">
          <input className="ms-input" value={execution.productionNotes || ''} onChange={(e) => set('productionNotes', e.target.value)} />
        </Field>
      </div>
      <div className="row" style={{ gap: '6px', marginTop: '6px' }}>
        <button className="ghost small" onClick={onMoveUp}>
          ↑
        </button>
        <button className="ghost small" onClick={onMoveDown}>
          ↓
        </button>
        <button className="ghost small danger" data-testid="remove-execution" onClick={onRemove}>
          Delete
        </button>
      </div>
    </div>
  )
}

const BLANK_EXECUTION = {
  format: '',
  hookFamily: '',
  hookText: '',
  firstFrameConcept: '',
  coreScenario: '',
  differentiationNote: '',
  suggestedDurationRange: null,
  productionNotes: null,
}

function StrategyStep({ angles, setAngles, duplicateWarnings, loading, error, targetCount, setTargetCount, mode, setMode, onGenerate, onApprove, approving }) {
  const flaggedHooks = useMemo(() => {
    const s = new Set()
    for (const w of duplicateWarnings || []) {
      s.add(w.hookA)
      s.add(w.hookB)
    }
    return s
  }, [duplicateWarnings])

  const updateAngle = (i, next) => setAngles((prev) => prev.map((a, idx) => (idx === i ? next : a)))
  const updateExecution = (ai, ei, next) =>
    updateAngle(ai, { ...angles[ai], executions: angles[ai].executions.map((e, idx) => (idx === ei ? next : e)) })
  const removeExecution = (ai, ei) =>
    updateAngle(ai, { ...angles[ai], executions: angles[ai].executions.filter((_, idx) => idx !== ei) })
  const addExecution = (ai) => updateAngle(ai, { ...angles[ai], executions: [...angles[ai].executions, { ...BLANK_EXECUTION }] })
  const moveExecution = (ai, ei, dir) => {
    const execs = [...angles[ai].executions]
    const target = ei + dir
    if (target < 0 || target >= execs.length) return
    ;[execs[ei], execs[target]] = [execs[target], execs[ei]]
    updateAngle(ai, { ...angles[ai], executions: execs })
  }
  const addAngle = () => setAngles((prev) => [...prev, { angleName: '', angleRationale: '', executions: [{ ...BLANK_EXECUTION }] }])
  const removeAngle = (ai) => setAngles((prev) => prev.filter((_, idx) => idx !== ai))

  const totalExecutions = (angles || []).reduce((n, a) => n + (a.executions || []).length, 0)

  return (
    <div data-testid="ai-wizard-step-b">
      <ErrorNote error={error} />
      <div className="row" style={{ gap: '12px', marginBottom: '10px' }}>
        <Field label="Target execution count">
          <select data-testid="target-count" value={targetCount} onChange={(e) => setTargetCount(Number(e.target.value))}>
            <option value={6}>6</option>
            <option value={8}>8</option>
            <option value={12}>12</option>
            <option value={16}>16</option>
          </select>
        </Field>
        <Field label="Mode">
          <select data-testid="strategy-mode" value={mode} onChange={(e) => setMode(e.target.value)}>
            <option value="exploratory">Exploratory</option>
            <option value="confirmatory">Confirmatory</option>
          </select>
        </Field>
        <button className="primary" data-testid="generate-strategy" onClick={onGenerate} disabled={loading} style={{ alignSelf: 'flex-end' }}>
          {loading ? 'Generating…' : angles.length ? '🔄 Regenerate Strategy' : '🤖 Generate Strategy'}
        </button>
      </div>

      {loading ? (
        <div className="ms-empty-state" data-testid="strategy-loading">
          <p>Generating strategy…</p>
        </div>
      ) : angles.length > 0 ? (
        <>
          <p className="hint small">
            {angles.length} angle{angles.length === 1 ? '' : 's'}, {totalExecutions} execution{totalExecutions === 1 ? '' : 's'} total.
          </p>
          {angles.map((angle, ai) => (
            <div className="subpanel" key={ai} data-testid={`angle-card-${ai}`} style={{ marginBottom: '14px' }}>
              <div className="row between">
                <input
                  className="ms-input"
                  style={{ fontWeight: 'bold' }}
                  value={angle.angleName || ''}
                  onChange={(e) => updateAngle(ai, { ...angle, angleName: e.target.value })}
                />
                <button className="ghost small danger" onClick={() => removeAngle(ai)}>
                  Delete angle
                </button>
              </div>
              <textarea
                className="ms-input"
                rows={2}
                style={{ marginTop: '6px' }}
                value={angle.angleRationale || ''}
                onChange={(e) => updateAngle(ai, { ...angle, angleRationale: e.target.value })}
              />
              <div style={{ marginTop: '10px' }}>
                {(angle.executions || []).map((execution, ei) => (
                  <ExecutionCard
                    key={ei}
                    execution={execution}
                    flaggedHooks={flaggedHooks}
                    onChange={(next) => updateExecution(ai, ei, next)}
                    onRemove={() => removeExecution(ai, ei)}
                    onMoveUp={() => moveExecution(ai, ei, -1)}
                    onMoveDown={() => moveExecution(ai, ei, 1)}
                  />
                ))}
              </div>
              <button className="ghost small" onClick={() => addExecution(ai)}>
                + Add execution
              </button>
            </div>
          ))}
          <button className="ghost small" onClick={addAngle}>
            + Add angle
          </button>

          <div className="row" style={{ gap: '8px', marginTop: '16px' }}>
            <button className="primary" data-testid="approve-strategy" disabled={approving || totalExecutions === 0} onClick={onApprove}>
              {approving ? 'Creating…' : '✅ Approve & Create Iteration'}
            </button>
          </div>
        </>
      ) : null}
    </div>
  )
}

function AiStrategyWizard({ productTestId, test, onCancel, onApproved }) {
  const [step, setStep] = useState('a')
  const [researchDraft, setResearchDraft] = useState(null)
  const [sourceFetch, setSourceFetch] = useState(null)
  const [researchLoading, setResearchLoading] = useState(true)
  const [researchError, setResearchError] = useState('')

  const [angles, setAngles] = useState([])
  const [duplicateWarnings, setDuplicateWarnings] = useState([])
  const [strategyLoading, setStrategyLoading] = useState(false)
  const [strategyError, setStrategyError] = useState('')
  const [targetCount, setTargetCount] = useState(12)
  const [mode, setMode] = useState('exploratory')
  const [approving, setApproving] = useState(false)
  const [approveError, setApproveError] = useState('')

  const runResearch = async () => {
    setResearchLoading(true)
    setResearchError('')
    setResearchDraft(null)
    try {
      const r = await api('POST', `/api/product-tests/${productTestId}/research/generate`, { useSourcePage: true })
      setResearchDraft(r.draft)
      setSourceFetch(r.sourceFetch)
    } catch (e) {
      setResearchError(e.message)
    } finally {
      setResearchLoading(false)
    }
  }

  useEffect(() => {
    runResearch()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const runStrategy = async () => {
    setStrategyLoading(true)
    setStrategyError('')
    try {
      const r = await api('POST', `/api/product-tests/${productTestId}/strategy/generate`, {
        researchDraft,
        targetCount,
        mode,
      })
      setAngles(r.draft.angles || [])
      setDuplicateWarnings(r.duplicateWarnings || [])
    } catch (e) {
      setStrategyError(e.message)
    } finally {
      setStrategyLoading(false)
    }
  }

  const approve = async () => {
    setApproving(true)
    setApproveError('')
    try {
      const strategyRows = []
      for (const angle of angles) {
        for (const execution of angle.executions || []) {
          strategyRows.push({ ...execution, angle: angle.angleName })
        }
      }
      const r = await api('POST', `/api/product-tests/${productTestId}/approve-strategy`, {
        mode,
        researchDraft,
        strategyRows,
        policyOverrides: {},
        targetCount,
      })
      onApproved(r.item)
    } catch (e) {
      setApproveError(e.message)
      setApproving(false)
    }
  }

  return (
    <div className="subpanel" data-testid="ai-strategy-wizard" style={{ marginTop: '12px' }}>
      <div className="row between">
        <h4>🤖 AI-Assisted Strategy — {step === 'a' ? 'Step 1: Research' : 'Step 2: Strategy'}</h4>
        <button className="ghost small" onClick={onCancel}>
          Cancel
        </button>
      </div>

      {step === 'a' ? (
        <ResearchStep
          test={test}
          draft={researchDraft}
          setDraft={setResearchDraft}
          sourceFetch={sourceFetch}
          loading={researchLoading}
          error={researchError}
          onRegenerate={runResearch}
          onContinue={() => setStep('b')}
        />
      ) : (
        <>
          <ErrorNote error={approveError} />
          <StrategyStep
            angles={angles}
            setAngles={setAngles}
            duplicateWarnings={duplicateWarnings}
            loading={strategyLoading}
            error={strategyError}
            targetCount={targetCount}
            setTargetCount={setTargetCount}
            mode={mode}
            setMode={setMode}
            onGenerate={runStrategy}
            onApprove={approve}
            approving={approving}
          />
          <button className="ghost small" style={{ marginTop: '8px' }} onClick={() => setStep('a')}>
            ← Back to Research
          </button>
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Production Planning wizard.
//
// Planning is not spending: nothing here writes to the database until
// Approve. Every edit re-prices deterministically — either purely
// client-side (choosing between an already-fetched recommended/cheap video
// option) or via the cheap /production-plan/reprice call — and NEVER
// triggers a new Groq call for a pure number or model change.
// ---------------------------------------------------------------------------

const AVAILABILITY_FIELDS = [
  ['usableSupplierFootage', 'Usable supplier footage?', 'tristate'],
  ['productSampleAvailable', 'Physical product sample available?', 'bool'],
  ['canFilmOriginalFootage', 'Can film original footage?', 'bool'],
  ['talkingHeadReferenceAvailable', 'Talking-head reference available?', 'bool'],
]

function AvailabilityForm({ value, onChange }) {
  const set = (k, v) => onChange({ ...value, [k]: v })
  return (
    <div className="fields">
      {AVAILABILITY_FIELDS.map(([key, label, kind]) =>
        kind === 'tristate' ? (
          <Field key={key} label={label}>
            <select data-testid={`avail-${key}`} value={value[key] || 'unknown'} onChange={(e) => set(key, e.target.value)}>
              <option value="yes">Yes</option>
              <option value="no">No</option>
              <option value="unknown">Unknown</option>
            </select>
          </Field>
        ) : (
          <label key={key} className="row" style={{ gap: '6px', alignItems: 'center' }}>
            <input type="checkbox" data-testid={`avail-${key}`} checked={!!value[key]} onChange={(e) => set(key, e.target.checked)} />
            <span>{label}</span>
          </label>
        )
      )}
    </div>
  )
}

const VIDEO_MODEL_OPTIONS = [
  { value: 'wan-720p', label: 'WAN 2.1 i2v 720p (higher quality)' },
  { value: 'ltx', label: 'LTX-Video (cheap)' },
  { value: 'mock', label: 'Mock (free, placeholder)' },
]

/** Derive the total cost for a specific chosen video model, purely from the
 * already-fetched componentBreakdown — zero network calls. `role` on each
 * breakdown row is 'recommended' (wan-720p) or 'cheap_fallback' (ltx). */
function selectedCostFromBreakdown(plan, plannedModel) {
  if (!plan || !plan.componentBreakdown) return null
  const imagesRow = plan.componentBreakdown.find((c) => c.component === 'images')
  const imageMinor = imagesRow && !imagesRow.unknown ? imagesRow.costMinor : 0
  const imageUnknown = imagesRow ? !!imagesRow.unknown : false

  if (plannedModel === 'mock') {
    return { minor: imageMinor, currency: 'USD', unknown: imageUnknown }
  }
  const role = plannedModel === 'ltx' ? 'cheap_fallback' : 'recommended'
  const rows = plan.componentBreakdown.filter((c) => c.component === 'video' && c.role === role)
  const anyUnknown = imageUnknown || rows.some((r) => r.unknown)
  const videoMinor = rows.reduce((sum, r) => sum + (r.unknown ? 0 : r.costMinor), 0)
  return { minor: imageMinor + videoMinor, currency: 'USD', unknown: anyUnknown }
}

function costLabel(cost) {
  if (!cost) return '—'
  const amount = (cost.minor / 100).toFixed(2)
  return cost.unknown ? `≥ $${amount} (includes unknown-cost components)` : `$${amount}`
}

function budgetBadgeStyle(status) {
  if (status === 'WITHIN_TARGET') return { background: '#123d21', border: '1px solid #2f7d4a', color: '#8ff0b0' }
  if (status === 'ABOVE_TARGET_BELOW_CEILING') return { background: '#40320f', border: '1px solid #a07c1f', color: '#f4d47c' }
  return { background: '#4a1620', border: '1px solid #a32f43', color: '#ffb0be' }
}

function PlanCard({ plan, availability, onUpdate, onReprice }) {
  const [local, setLocal] = useState({
    fineMethod: plan.draft.fineMethod,
    generationPlan: plan.draft.generationPlan,
    plannedProvider: plan.plannedProvider || 'replicate',
    plannedModel: plan.plannedModel || 'wan-720p',
    coarseProductionMethod: plan.coarseProductionMethod || 'factory_generated',
    notes: plan.notes || '',
  })
  const repriceTimer = useRef(null)

  const scheduleReprice = (nextDraft) => {
    if (repriceTimer.current) clearTimeout(repriceTimer.current)
    repriceTimer.current = setTimeout(() => onReprice(nextDraft), 400)
  }

  const setField = (field, value) => {
    const next = { ...local, [field]: value }
    setLocal(next)
    if (field === 'fineMethod' || field === 'generationPlan') {
      const nextDraft = { ...plan.draft, fineMethod: next.fineMethod, generationPlan: next.generationPlan }
      scheduleReprice(nextDraft)
    }
    onUpdate(next)
  }

  const setImageCount = (n) => setField('generationPlan', { ...local.generationPlan, imageGenerations: Math.max(0, Number(n) || 0) })
  const setClip = (i, field, value) => {
    const clips = local.generationPlan.videoClips.map((c, idx) => (idx === i ? { ...c, [field]: field === 'seconds' ? Math.max(0, Number(value) || 0) : value } : c))
    setField('generationPlan', { ...local.generationPlan, videoClips: clips })
  }
  const addClip = () => setField('generationPlan', { ...local.generationPlan, videoClips: [...local.generationPlan.videoClips, { seconds: 6, purpose: '' }] })
  const removeClip = (i) => setField('generationPlan', { ...local.generationPlan, videoClips: local.generationPlan.videoClips.filter((_, idx) => idx !== i) })

  const displayedCost = selectedCostFromBreakdown(plan, local.plannedModel)
  const missingAsset = (plan.flags || []).includes('MISSING_REQUIRED_ASSET')

  return (
    <div className="subpanel" data-testid={`plan-card-${plan.creativeId}`} style={{ marginBottom: '14px' }}>
      <div className="row between">
        <b>{plan.creativeCode}</b>
        <span className="ms-badge" data-testid={`plan-cost-${plan.creativeId}`}>
          {costLabel(displayedCost)}
        </span>
      </div>

      {missingAsset ? (
        <div className="note bad" data-testid={`missing-asset-${plan.creativeId}`} style={{ marginTop: '8px' }}>
          ⚠ MISSING_REQUIRED_ASSET — this method depends on an asset that isn't in inventory or marked available.
          {plan.fallbackMethod ? (
            <div style={{ marginTop: '4px' }}>
              Suggested fallback: <b>{plan.fallbackMethod}</b> — {plan.fallbackRationale}
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="fields" style={{ marginTop: '8px' }}>
        <Field label="Fine method">
          <input className="ms-input" data-testid={`fine-method-${plan.creativeId}`} value={local.fineMethod} onChange={(e) => setField('fineMethod', e.target.value)} />
        </Field>
        <Field label="Rationale" hint="from the AI proposal">
          <textarea className="ms-input" rows={2} value={plan.draft.rationale} readOnly />
        </Field>
        <Field label="Planned provider">
          <select data-testid={`planned-provider-${plan.creativeId}`} value={local.plannedProvider} onChange={(e) => setField('plannedProvider', e.target.value)}>
            <option value="mock">Mock (free, local-only)</option>
            <option value="replicate">Replicate (paid)</option>
          </select>
        </Field>
        <Field label="Planned video model">
          <select data-testid={`planned-model-${plan.creativeId}`} value={local.plannedModel} onChange={(e) => setField('plannedModel', e.target.value)}>
            {VIDEO_MODEL_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Coarse production method">
          <select data-testid={`coarse-method-${plan.creativeId}`} value={local.coarseProductionMethod} onChange={(e) => setField('coarseProductionMethod', e.target.value)}>
            <option value="factory_generated">factory_generated</option>
            <option value="manual_external">manual_external</option>
            <option value="mixed">mixed</option>
          </select>
        </Field>
        <Field label="Image generations">
          <input className="ms-input" data-testid={`image-count-${plan.creativeId}`} value={local.generationPlan.imageGenerations} onChange={(e) => setImageCount(e.target.value)} />
        </Field>
        <label className="row" style={{ gap: '6px', alignItems: 'center' }}>
          <input type="checkbox" checked={!!local.generationPlan.voiceRequired} onChange={(e) => setField('generationPlan', { ...local.generationPlan, voiceRequired: e.target.checked })} />
          <span>Voice required</span>
        </label>
        <Field label="Notes">
          <textarea className="ms-input" rows={2} value={local.notes} onChange={(e) => setField('notes', e.target.value)} />
        </Field>
      </div>

      <div className="hint small" style={{ margin: '8px 0' }}>
        Video clips
      </div>
      {local.generationPlan.videoClips.map((c, i) => (
        <div className="row" key={i} style={{ gap: '6px', marginBottom: '6px' }}>
          <input className="ms-input" style={{ maxWidth: '80px' }} value={c.seconds} onChange={(e) => setClip(i, 'seconds', e.target.value)} />
          <input className="ms-input" placeholder="purpose" value={c.purpose} onChange={(e) => setClip(i, 'purpose', e.target.value)} />
          <button className="ghost small danger" onClick={() => removeClip(i)}>
            ✕
          </button>
        </div>
      ))}
      <button className="ghost small" onClick={addClip}>
        + Add clip
      </button>
    </div>
  )
}

function ProductionPlanningWizard({ iterationId, creatives, onCancel, onApproved }) {
  const [step, setStep] = useState('availability')
  const [availability, setAvailability] = useState(() => {
    const init = {}
    for (const c of creatives) init[c.id] = { usableSupplierFootage: 'unknown', productSampleAvailable: false, canFilmOriginalFootage: false, talkingHeadReferenceAvailable: false }
    return init
  })
  const [plans, setPlans] = useState([])
  const [batchSummary, setBatchSummary] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [approving, setApproving] = useState(false)
  const [approveError, setApproveError] = useState('')
  const [editsById, setEditsById] = useState({})

  const generate = async () => {
    setLoading(true)
    setError('')
    try {
      const r = await api('POST', `/api/iterations/${iterationId}/production-plan/generate`, { availabilityByCreativeId: availability })
      setPlans(r.plans)
      setBatchSummary(r.batchSummary)
      const edits = {}
      for (const p of r.plans) {
        if (p.ok) edits[p.creativeId] = { fineMethod: p.draft.fineMethod, generationPlan: p.draft.generationPlan, plannedProvider: 'replicate', plannedModel: 'wan-720p', coarseProductionMethod: 'factory_generated', notes: '' }
      }
      setEditsById(edits)
      setStep('plans')
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  const reprice = async (creativeId, nextDraft) => {
    const plan = plans.find((p) => p.creativeId === creativeId)
    if (!plan || !plan.ok) return
    try {
      const priced = await api('POST', '/api/production-plan/reprice', {
        draft: nextDraft,
        availabilityDeclarations: availability[creativeId] || {},
        knownInventory: plan.knownInventory,
      })
      setPlans((prev) => prev.map((p) => (p.creativeId === creativeId ? { ...p, ...priced, draft: nextDraft } : p)))
    } catch {
      // A failed re-price leaves the last-known price on screen rather than
      // blanking it — the draft edit itself is not lost either way.
    }
  }

  // Batch total recomputed live from whatever is currently displayed per
  // plan (the selected model's cost), not the original generate-time total.
  const liveTotal = useMemo(() => {
    let minor = 0
    let anyUnknown = false
    for (const p of plans) {
      if (!p.ok) continue
      const edit = editsById[p.creativeId]
      const cost = selectedCostFromBreakdown(p, edit ? edit.plannedModel : 'wan-720p')
      if (cost) {
        minor += cost.minor
        if (cost.unknown) anyUnknown = true
      }
    }
    return { minor, currency: 'USD', unknown: anyUnknown }
  }, [plans, editsById])

  const liveStatus = useMemo(() => {
    if (!batchSummary) return null
    if (typeof batchSummary.budgetCeilingMinor === 'number' && liveTotal.minor > batchSummary.budgetCeilingMinor) return 'ABOVE_CEILING'
    if (typeof batchSummary.budgetTargetMinor === 'number' && liveTotal.minor > batchSummary.budgetTargetMinor) return 'ABOVE_TARGET_BELOW_CEILING'
    return 'WITHIN_TARGET'
  }, [batchSummary, liveTotal])

  const approve = async () => {
    setApproving(true)
    setApproveError('')
    try {
      const validPlans = plans.filter((p) => p.ok)
      const body = {
        plans: validPlans.map((p) => {
          const edit = editsById[p.creativeId]
          return {
            creativeId: p.creativeId,
            fineMethod: edit.fineMethod,
            rationale: p.draft.rationale,
            requiredAssets: p.draft.requiredAssets,
            plannedProvider: edit.plannedProvider,
            plannedModel: edit.plannedModel,
            generationPlan: edit.generationPlan,
            estimatedCost: selectedCostFromBreakdown(p, edit.plannedModel),
            notes: edit.notes,
            coarseProductionMethod: edit.coarseProductionMethod,
          }
        }),
      }
      const r = await api('POST', `/api/iterations/${iterationId}/production-plan/approve`, body)
      onApproved(r.items)
    } catch (e) {
      setApproveError(e.message)
      setApproving(false)
    }
  }

  return (
    <div className="subpanel" data-testid="production-planning-wizard" style={{ marginTop: '12px' }}>
      <div className="row between">
        <h4>📋 Plan Production</h4>
        <button className="ghost small" onClick={onCancel}>
          Cancel
        </button>
      </div>

      {step === 'availability' ? (
        <div data-testid="planning-step-availability">
          <ErrorNote error={error} />
          {creatives.map((c) => (
            <div key={c.id} className="subpanel" style={{ marginBottom: '10px' }}>
              <b>{c.creative_code}</b>
              <AvailabilityForm value={availability[c.id]} onChange={(v) => setAvailability((a) => ({ ...a, [c.id]: v }))} />
            </div>
          ))}
          <button className="primary" data-testid="generate-plans" disabled={loading} onClick={generate}>
            {loading ? 'Generating…' : '🤖 Generate Plans'}
          </button>
        </div>
      ) : (
        <div data-testid="planning-step-plans">
          <div className="note" data-testid="batch-summary-bar" style={{ marginBottom: '12px', ...budgetBadgeStyle(liveStatus) }}>
            <b data-testid="batch-total">Total estimated: {costLabel(liveTotal)}</b>
            {' · '}
            Target: ${((batchSummary.budgetTargetMinor || 0) / 100).toFixed(2)} · Ceiling: ${((batchSummary.budgetCeilingMinor || 0) / 100).toFixed(2)}
            {' · '}
            <span data-testid="batch-status-badge">{liveStatus}</span>
          </div>
          <div className="hint small" style={{ marginBottom: '10px' }}>{batchSummary.currencyNote}</div>

          <ErrorNote error={approveError} />

          {plans.map((p) =>
            p.ok ? (
              <PlanCard
                key={p.creativeId}
                plan={p}
                availability={availability[p.creativeId]}
                onUpdate={(edit) => setEditsById((prev) => ({ ...prev, [p.creativeId]: edit }))}
                onReprice={(nextDraft) => reprice(p.creativeId, nextDraft)}
              />
            ) : (
              <div key={p.creativeId} className="note bad" data-testid={`plan-error-${p.creativeId}`}>
                {p.creativeCode}: {p.error}
              </div>
            )
          )}

          <div className="row" style={{ gap: '8px', marginTop: '8px' }}>
            <button className="ghost small" onClick={generate}>
              🔄 Regenerate Plans
            </button>
            <button className="primary" data-testid="approve-production-plan" disabled={approving || plans.every((p) => !p.ok)} onClick={approve}>
              {approving ? 'Creating…' : '✅ Approve Production Plan'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Creative form
// ---------------------------------------------------------------------------

function NewCreativeForm({ iterationId, onCancel, onCreated }) {
  const [form, setForm] = useState({
    angle: '',
    format: '',
    hookFamily: '',
    hookText: '',
    conceptSummary: '',
    defaultProductionMethod: 'manual_external',
    marketingStudioSessionId: '',
  })
  const [sessions, setSessions] = useState([])
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const linksStudio = form.defaultProductionMethod === 'factory_generated' || form.defaultProductionMethod === 'mixed'

  useEffect(() => {
    if (!linksStudio) return
    api('GET', '/api/studio/sessions')
      .then((r) => setSessions(r.items || []))
      .catch(() => setSessions([]))
  }, [linksStudio])

  const submit = async () => {
    setSaving(true)
    setError('')
    try {
      const r = await api('POST', `/api/iterations/${iterationId}/creatives`, {
        ...form,
        marketingStudioSessionId: form.marketingStudioSessionId || null,
      })
      onCreated(r.item)
    } catch (e) {
      setError(e.message)
      setSaving(false)
    }
  }

  return (
    <div className="subpanel" data-testid="new-creative-form" style={{ marginTop: '12px' }}>
      <h4>New Creative</h4>
      <ErrorNote error={error} />
      <div className="fields">
        <Field label="Angle">
          <input className="ms-input" data-testid="creative-angle" value={form.angle} onChange={set('angle')} />
        </Field>
        <Field label="Format">
          <input className="ms-input" data-testid="creative-format" value={form.format} onChange={set('format')} />
        </Field>
        <Field label="Hook family">
          <input className="ms-input" value={form.hookFamily} onChange={set('hookFamily')} />
        </Field>
        <Field label="Hook text">
          <input className="ms-input" data-testid="creative-hook" value={form.hookText} onChange={set('hookText')} />
        </Field>
        <Field label="Concept summary">
          <textarea className="ms-input" rows={2} value={form.conceptSummary} onChange={set('conceptSummary')} />
        </Field>
        <Field label="Production method">
          <select data-testid="creative-method" value={form.defaultProductionMethod} onChange={set('defaultProductionMethod')}>
            <option value="manual_external">manual_external</option>
            <option value="factory_generated">factory_generated</option>
            <option value="mixed">mixed</option>
          </select>
        </Field>
        {linksStudio ? (
          <Field label="Link a Marketing Studio session" hint="Reuses existing Studio content — this does not create new content.">
            <select data-testid="creative-session" value={form.marketingStudioSessionId} onChange={set('marketingStudioSessionId')}>
              <option value="">(none)</option>
              {sessions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
        ) : null}
      </div>
      <div className="row" style={{ gap: '8px', marginTop: '12px' }}>
        <button className="primary small" data-testid="creative-submit" disabled={saving || !form.angle.trim()} onClick={submit}>
          {saving ? 'Creating…' : 'Create Creative'}
        </button>
        <button className="ghost small" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Metric snapshot form
// ---------------------------------------------------------------------------

const RAW_METRIC_FIELDS = ['views', 'likes', 'comments', 'shares', 'profile_visits', 'link_clicks', 'atcs', 'purchases']

function AddMetricForm({ publicationId, onAdded, onCancel }) {
  const [capturedAt, setCapturedAt] = useState(nowLocalInput())
  const [source, setSource] = useState('manual')
  const [expName, setExpName] = useState('views')
  const [expValue, setExpValue] = useState('')
  const [raw, setRaw] = useState({})
  const [notes, setNotes] = useState('')
  const [error, setError] = useState('')

  const submit = async () => {
    setError('')
    try {
      const rawMetrics = {}
      for (const k of RAW_METRIC_FIELDS) if (raw[k] !== undefined && raw[k] !== '') rawMetrics[k] = Number(raw[k])
      await api('POST', `/api/publications/${publicationId}/metrics`, {
        capturedAt: new Date(capturedAt).toISOString(),
        source,
        qualifiedExposureMetricName: expName || null,
        qualifiedExposureValue: expValue === '' ? null : Number(expValue),
        rawMetrics,
        notes: notes || null,
      })
      onAdded()
    } catch (e) {
      setError(e.message)
    }
  }

  return (
    <div className="subpanel" data-testid="add-metric-form" style={{ marginTop: '8px' }}>
      <h5>Add Metric Snapshot</h5>
      <ErrorNote error={error} />
      <div className="fields">
        <Field label="Captured at">
          <input className="ms-input" type="datetime-local" data-testid="metric-captured" value={capturedAt} onChange={(e) => setCapturedAt(e.target.value)} />
        </Field>
        <Field label="Source">
          <select data-testid="metric-source" value={source} onChange={(e) => setSource(e.target.value)}>
            <option value="manual">manual</option>
            <option value="api">api</option>
            <option value="csv">csv</option>
            <option value="agent">agent</option>
          </select>
        </Field>
        <Field label="Qualified exposure metric">
          <input className="ms-input" value={expName} onChange={(e) => setExpName(e.target.value)} />
        </Field>
        <Field label="Qualified exposure value">
          <input className="ms-input" data-testid="metric-exposure" value={expValue} onChange={(e) => setExpValue(e.target.value)} />
        </Field>
      </div>
      <div className="hint small" style={{ margin: '8px 0' }}>
        Raw metrics
      </div>
      <div className="fields">
        {RAW_METRIC_FIELDS.map((k) => (
          <Field key={k} label={k}>
            <input
              className="ms-input"
              data-testid={`metric-${k}`}
              value={raw[k] === undefined ? '' : raw[k]}
              onChange={(e) => setRaw((r) => ({ ...r, [k]: e.target.value }))}
            />
          </Field>
        ))}
      </div>
      <Field label="Notes">
        <textarea className="ms-input" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
      <div className="row" style={{ gap: '8px', marginTop: '8px' }}>
        <button className="primary small" data-testid="metric-submit" onClick={submit}>
          Add Snapshot
        </button>
        <button className="ghost small" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  )
}

function ProductionDispatchPanel({ iterationId }) {
  const [statuses, setStatuses] = useState([])
  const [preflight, setPreflight] = useState(null)
  const [selected, setSelected] = useState([])
  const [loading, setLoading] = useState(false)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState('')

  const loadStatus = async () => {
    try {
      const r = await api('GET', `/api/iterations/${iterationId}/production/status`)
      setStatuses(r.items || [])
      setError('')
    } catch (e) { setError(e.message) }
  }

  useEffect(() => {
    loadStatus()
    const timer = setInterval(loadStatus, 3000)
    return () => clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [iterationId])

  const runPreflight = async () => {
    setLoading(true)
    setError('')
    try {
      const r = await api('POST', `/api/iterations/${iterationId}/production/preflight`, { productionRunIds: 'all_eligible' })
      setPreflight(r.preflight)
      setSelected((r.preflight.runs || []).filter((run) => run.state === 'READY').map((run) => run.runId))
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }

  const start = async () => {
    if (!selected.length) return
    if (!window.confirm(`Start ${selected.length} ready production run${selected.length === 1 ? '' : 's'}? This dispatches generation jobs and may spend the approved per-job budget.`)) return
    setStarting(true)
    setError('')
    try {
      await api('POST', `/api/iterations/${iterationId}/production/start`, { productionRunIds: selected })
      setPreflight(null)
      setSelected([])
      await loadStatus()
    } catch (e) { setError(e.message) }
    finally { setStarting(false) }
  }

  const toggle = (id) => setSelected((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]))

  return (
    <div className="subpanel" data-testid="production-dispatch-panel" style={{ marginTop: '12px' }}>
      <div className="row between"><b>🚀 Batch Production Dispatch</b><button className="ghost small" data-testid="production-preflight" disabled={loading} onClick={runPreflight}>{loading ? 'Checking…' : 'Preflight'}</button></div>
      {error ? <ErrorNote error={error} onRetry={loadStatus} /> : null}
      {preflight ? (
        <div className="note" data-testid="production-preflight-summary" style={{ marginTop: '10px' }}>
          <b>Preflight summary</b>
          <div className="ms-badge-row" style={{ marginTop: '6px' }}>
            <span className="ms-badge">ready: {preflight.readyCount}</span><span className="ms-badge">blocked: {preflight.blockedCount}</span><span className="ms-badge">manual external: {preflight.manualExternalCount}</span><span className="ms-badge">settled: €{((preflight.currentSettledSpendMinor || 0) / 100).toFixed(2)}</span><span className="ms-badge">reserved: €{((preflight.activeReservedMinor || 0) / 100).toFixed(2)}</span><span className="ms-badge">new estimate: €{((preflight.newEstimatedPaidSpendMinor || 0) / 100).toFixed(2)}</span><span className="ms-badge">ceiling: €{((preflight.budgetCeilingMinor || 0) / 100).toFixed(2)}</span>
          </div>
          <div className="hint small" style={{ marginTop: '6px' }}>Current FX: {preflight.currentFxRate ? `${preflight.currentFxRate} (${preflight.fxUpdatedAt || 'updated time unavailable'})` : 'not required / not configured'}</div>
          {(preflight.runs || []).filter((run) => run.state !== 'READY').map((run) => <div key={run.runId} className="hint small" style={{ marginTop: '4px' }} data-testid={`preflight-run-${run.runId}`}>Run {run.runId}: <b>{run.state}</b> — {run.reason || '—'}</div>)}
          <div className="row" style={{ gap: '8px', marginTop: '8px' }}><button className="primary small" data-testid="start-selected-production" disabled={starting || selected.length === 0} onClick={start}>{starting ? 'Starting…' : `Start selected (${selected.length})`}</button><button className="ghost small" onClick={() => setPreflight(null)}>Close summary</button></div>
          <div style={{ marginTop: '8px' }}>{(preflight.runs || []).filter((run) => run.state === 'READY').map((run) => <label key={run.runId} className="row" style={{ gap: '6px', marginTop: '4px' }}><input type="checkbox" checked={selected.includes(run.runId)} onChange={() => toggle(run.runId)} /><span>Run {run.runId} — ready</span></label>)}</div>
        </div>
      ) : null}
      <div className="ms-session-list" style={{ marginTop: '10px' }}>
        {statuses.length === 0 ? <p className="hint small">No ProductionRuns yet. Approve a production plan first.</p> : null}
        {statuses.map((run) => <div className="ms-session-row-item" key={run.id} data-testid={`production-status-${run.id}`}><div className="ms-session-info"><b>{run.creative_code} · attempt {run.attempt_number}</b><div className="ms-badge-row"><span className="ms-badge">{run.derivedState}</span><span className="ms-badge">jobs {run.complete_job_count || 0}/{run.job_count || 0}</span>{run.failed_job_count ? <span className="ms-badge ms-badge-warn">failed: {run.failed_job_count}</span> : null}</div></div></div>)}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Creative detail — production runs and publications
// ---------------------------------------------------------------------------

function CreativeDetail({ creativeId, onBack, onOpenStudio }) {
  const [creative, setCreative] = useState(null)
  const [runs, setRuns] = useState([])
  const [publications, setPublications] = useState([])
  const [metricsByPub, setMetricsByPub] = useState({})
  const [accounts, setAccounts] = useState([])
  const [error, setError] = useState('')
  const [assetPath, setAssetPath] = useState({})
  const [showPubForm, setShowPubForm] = useState(false)
  const [metricFormFor, setMetricFormFor] = useState(null)
  const [pubForm, setPubForm] = useState({
    productionRunId: '',
    accountId: '',
    newHandle: '',
    platform: 'tiktok',
    surfaceType: 'tiktok_standard',
    externalPostId: '',
    externalUrl: '',
    publishedAt: nowLocalInput(),
  })

  const load = async () => {
    try {
      const [c, r, p, a] = await Promise.all([
        api('GET', `/api/creatives/${creativeId}`),
        api('GET', `/api/creatives/${creativeId}/production-runs`),
        api('GET', `/api/creatives/${creativeId}/publications`),
        api('GET', '/api/accounts'),
      ])
      setCreative(c.item)
      setRuns(r.items || [])
      setPublications(p.items || [])
      setAccounts(a.items || [])
      const metrics = {}
      for (const pub of p.items || []) {
        const m = await api('GET', `/api/publications/${pub.id}/metrics`)
        metrics[pub.id] = m.items || []
      }
      setMetricsByPub(metrics)
      setError('')
    } catch (e) {
      setError(e.message)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [creativeId])

  const addRun = async () => {
    try {
      await api('POST', `/api/creatives/${creativeId}/production-runs`, { productionMethod: creative.default_production_method })
      await load()
    } catch (e) {
      setError(e.message)
    }
  }

  // Register a path under local-media/ as an Asset, then make it the run's final
  // asset. Deliberately minimal — a manual-entry convenience, not an upload UI.
  const registerFinalAsset = async (runId) => {
    const rel = (assetPath[runId] || '').trim()
    if (!rel) return
    try {
      const reg = await api('POST', '/api/assets/register-external', { relativePath: rel, mimeType: 'video/mp4', source: 'uploaded' })
      await api('POST', `/api/production-runs/${runId}/final-asset`, { assetId: reg.item.id })
      setAssetPath((m) => ({ ...m, [runId]: '' }))
      await load()
    } catch (e) {
      setError(e.message)
    }
  }

  const runsWithAsset = runs.filter((r) => r.final_asset_id)

  const submitPublication = async () => {
    try {
      let accountId = pubForm.accountId
      if (!accountId && pubForm.newHandle.trim()) {
        const acc = await api('POST', '/api/accounts', { platform: pubForm.platform, handle: pubForm.newHandle.trim() })
        accountId = acc.item.id
      }
      const run = runs.find((r) => String(r.id) === String(pubForm.productionRunId))
      await api('POST', `/api/creatives/${creativeId}/publications`, {
        productionRunId: Number(pubForm.productionRunId),
        publishedAssetId: run ? run.final_asset_id : null,
        accountId: Number(accountId),
        platform: pubForm.platform,
        surfaceType: pubForm.surfaceType,
        externalPostId: pubForm.externalPostId || null,
        externalUrl: pubForm.externalUrl || null,
        publishedAt: new Date(pubForm.publishedAt).toISOString(),
      })
      setShowPubForm(false)
      await load()
    } catch (e) {
      setError(e.message)
    }
  }

  if (!creative) return <section className="panel ms-panel">{error ? <ErrorNote error={error} onRetry={load} /> : <p>Loading…</p>}</section>

  return (
    <section className="panel ms-panel" data-testid="creative-detail">
      <div className="row between">
        <h2 data-testid="creative-code">{creative.creative_code}</h2>
        <button className="ghost small" onClick={onBack}>
          ← Back to iteration
        </button>
      </div>
      <ErrorNote error={error} onRetry={load} />

      <div className="ms-badge-row">
        <span className="ms-badge">{creative.angle}</span>
        <span className="ms-badge">{creative.format}</span>
        {creative.hook_text ? <span className="ms-badge">“{creative.hook_text}”</span> : null}
        <span className="ms-badge">{creative.approval_status}</span>
        <span className="ms-badge">{creative.default_production_method}</span>
      </div>

      {creative.marketing_studio_session_id ? (
        <div className="note" style={{ marginTop: '10px' }} data-testid="linked-session">
          Linked Marketing Studio session: <b>{creative.marketing_studio_session_name || creative.marketing_studio_session_id}</b>
          <button className="ghost small" style={{ marginLeft: '8px' }} onClick={() => onOpenStudio(creative.marketing_studio_session_id)}>
            Open in Marketing Studio →
          </button>
        </div>
      ) : null}

      <h3 style={{ marginTop: '18px' }}>Production Runs</h3>
      <button className="primary small" data-testid="add-run" onClick={addRun}>
        + New Production Run
      </button>
      <div className="ms-session-list" style={{ marginTop: '10px' }}>
        {runs.length === 0 ? <p className="hint small">No production runs yet.</p> : null}
        {runs.map((r) => (
          <div className="ms-session-row-item" key={r.id} data-testid={`run-${r.id}`}>
            <div className="ms-session-info">
              <b>Attempt {r.attempt_number}</b>
              <div className="ms-badge-row">
                <span className="ms-badge">{r.status}</span>
                <span className="ms-badge">{r.production_method}</span>
                {r.final_asset_id ? (
                  <span className="ms-badge ms-badge-style" data-testid={`run-${r.id}-asset`}>
                    final asset: {r.final_asset_path}
                  </span>
                ) : (
                  <span className="ms-badge ms-badge-warn">no final asset</span>
                )}
              </div>
              {!r.final_asset_id ? (
                <div className="row" style={{ gap: '6px', marginTop: '6px' }}>
                  <input
                    className="ms-input"
                    data-testid={`asset-path-${r.id}`}
                    placeholder="projects/<id>/assets/file.mp4"
                    value={assetPath[r.id] || ''}
                    onChange={(e) => setAssetPath((m) => ({ ...m, [r.id]: e.target.value }))}
                  />
                  <button className="ghost small" data-testid={`register-asset-${r.id}`} onClick={() => registerFinalAsset(r.id)}>
                    Register as Asset + Set Final
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        ))}
      </div>

      <h3 style={{ marginTop: '18px' }}>Publications</h3>
      <button
        className="primary small"
        data-testid="add-publication"
        disabled={runsWithAsset.length === 0}
        onClick={() => {
          setPubForm((f) => ({ ...f, productionRunId: String(runsWithAsset[0].id) }))
          setShowPubForm(true)
        }}
      >
        + New Publication
      </button>
      {runsWithAsset.length === 0 ? (
        <span className="hint small" style={{ marginLeft: '8px' }}>
          Set a final asset on a run first.
        </span>
      ) : null}

      {showPubForm ? (
        <div className="subpanel" data-testid="publication-form" style={{ marginTop: '10px' }}>
          <div className="fields">
            <Field label="Production run (must have a final asset)">
              <select data-testid="pub-run" value={pubForm.productionRunId} onChange={(e) => setPubForm((f) => ({ ...f, productionRunId: e.target.value }))}>
                {runsWithAsset.map((r) => (
                  <option key={r.id} value={r.id}>
                    Attempt {r.attempt_number} — {r.final_asset_path}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Account">
              <select data-testid="pub-account" value={pubForm.accountId} onChange={(e) => setPubForm((f) => ({ ...f, accountId: e.target.value }))}>
                <option value="">(new account below)</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.platform} {a.handle}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="…or new account handle">
              <input className="ms-input" data-testid="pub-new-handle" value={pubForm.newHandle} onChange={(e) => setPubForm((f) => ({ ...f, newHandle: e.target.value }))} placeholder="@handle" />
            </Field>
            <Field label="Platform">
              <input className="ms-input" data-testid="pub-platform" value={pubForm.platform} onChange={(e) => setPubForm((f) => ({ ...f, platform: e.target.value }))} />
            </Field>
            <Field label="Surface type">
              <input className="ms-input" data-testid="pub-surface" value={pubForm.surfaceType} onChange={(e) => setPubForm((f) => ({ ...f, surfaceType: e.target.value }))} />
            </Field>
            <Field label="External post ID">
              <input className="ms-input" data-testid="pub-post-id" value={pubForm.externalPostId} onChange={(e) => setPubForm((f) => ({ ...f, externalPostId: e.target.value }))} />
            </Field>
            <Field label="External URL">
              <input className="ms-input" value={pubForm.externalUrl} onChange={(e) => setPubForm((f) => ({ ...f, externalUrl: e.target.value }))} />
            </Field>
            <Field label="Published at">
              <input className="ms-input" type="datetime-local" value={pubForm.publishedAt} onChange={(e) => setPubForm((f) => ({ ...f, publishedAt: e.target.value }))} />
            </Field>
          </div>
          <div className="row" style={{ gap: '8px', marginTop: '8px' }}>
            <button className="primary small" data-testid="pub-submit" onClick={submitPublication}>
              Create Publication
            </button>
            <button className="ghost small" onClick={() => setShowPubForm(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      <div className="ms-session-list" style={{ marginTop: '10px' }}>
        {publications.length === 0 ? <p className="hint small">No publications yet.</p> : null}
        {publications.map((p) => (
          <div className="ms-session-row-item" key={p.id} data-testid={`publication-${p.id}`}>
            <div className="ms-session-info" style={{ width: '100%' }}>
              <b>
                {p.platform} · {p.account_handle}
              </b>
              <div className="ms-badge-row">
                <span className="ms-badge">{p.surface_type}</span>
                {p.external_post_id ? <span className="ms-badge">{p.external_post_id}</span> : null}
                <span className="ms-badge">published {String(p.published_at).slice(0, 16).replace('T', ' ')}</span>
                <span className="ms-badge" data-testid={`pub-${p.id}-metric-count`}>
                  {p.metric_count} metric snapshot{p.metric_count === 1 ? '' : 's'}
                </span>
              </div>

              <div style={{ marginTop: '6px' }}>
                {(metricsByPub[p.id] || []).map((m) => (
                  <div className="hint small" key={m.id} data-testid={`metric-row-${m.id}`}>
                    {String(m.captured_at).slice(0, 16).replace('T', ' ')} · {m.qualified_exposure_metric_name}={m.qualified_exposure_value} ·{' '}
                    {Object.entries(m.rawMetrics || {})
                      .map(([k, v]) => `${k}:${v}`)
                      .join(' ')}
                  </div>
                ))}
              </div>

              {metricFormFor === p.id ? (
                <AddMetricForm
                  publicationId={p.id}
                  onCancel={() => setMetricFormFor(null)}
                  onAdded={async () => {
                    setMetricFormFor(null)
                    await load()
                  }}
                />
              ) : (
                <button className="ghost small" data-testid={`add-metric-${p.id}`} style={{ marginTop: '6px' }} onClick={() => setMetricFormFor(p.id)}>
                  + Add Metric Snapshot
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Product Test detail (iterations + creatives)
// ---------------------------------------------------------------------------

function ProductTestDetail({ productTestId, onBack, onOpenCreative, onOpenStudio }) {
  const [test, setTest] = useState(null)
  const [iterations, setIterations] = useState([])
  const [creativesByIteration, setCreativesByIteration] = useState({})
  const [openIteration, setOpenIteration] = useState(null)
  const [showIterationForm, setShowIterationForm] = useState(false)
  const [showAiWizard, setShowAiWizard] = useState(false)
  const [showCreativeForm, setShowCreativeForm] = useState(false)
  const [planningIteration, setPlanningIteration] = useState(null)
  const [plannedRuns, setPlannedRuns] = useState(null)
  const [error, setError] = useState('')

  const load = async () => {
    try {
      const [t, i] = await Promise.all([
        api('GET', `/api/product-tests/${productTestId}`),
        api('GET', `/api/product-tests/${productTestId}/iterations`),
      ])
      setTest(t.item)
      setIterations(i.items || [])
      const byIteration = {}
      for (const it of i.items || []) {
        const c = await api('GET', `/api/iterations/${it.id}/creatives`)
        byIteration[it.id] = c.items || []
      }
      setCreativesByIteration(byIteration)
      if (!openIteration && (i.items || []).length) setOpenIteration(i.items[0].id)
      setError('')
    } catch (e) {
      setError(e.message)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productTestId])

  if (!test) return <section className="panel ms-panel">{error ? <ErrorNote error={error} onRetry={load} /> : <p>Loading…</p>}</section>

  const policy = test.policy || {}

  return (
    <section className="panel ms-panel" data-testid="product-test-detail">
      <div className="row between">
        <h2 data-testid="pt-code">
          {test.code} · {test.product_name}
        </h2>
        <button className="ghost small" onClick={onBack}>
          ← All Product Tests
        </button>
      </div>
      <ErrorNote error={error} onRetry={load} />

      <div className="ms-badge-row">
        <span className="ms-badge">
          {test.market} / {test.language}
        </span>
        <span className="ms-badge">{test.status}</span>
        <span className="ms-badge">
          {euro(test.selling_price_minor, test.currency)} selling
        </span>
        <span className="ms-badge">{test.iteration_count} iteration(s)</span>
      </div>

      {/* The frozen policy this test runs under — read-only on purpose. */}
      <div className="subpanel" style={{ marginTop: '12px' }} data-testid="policy-snapshot">
        <b>Policy snapshot (frozen at creation)</b>
        <div className="ms-badge-row" style={{ marginTop: '6px' }}>
          <span className="ms-badge">budget ceiling {euro(policy.budgetCeilingMinor)}</span>
          <span className="ms-badge">target {euro(policy.budgetTargetMinor)}</span>
          <span className="ms-badge">min margin {euro(policy.minContributionMarginMinor)}</span>
          <span className="ms-badge">min margin {policy.minContributionMarginPercent}%</span>
        </div>
        <div className="hint small" style={{ marginTop: '6px' }}>
          Sufficiency floors:{' '}
          {Object.entries(policy.sufficiency || {})
            .map(([k, v]) => `${k}: ${v}`)
            .join(' · ')}
        </div>
      </div>

      <div className="row between" style={{ marginTop: '18px' }}>
        <h3>Iterations</h3>
        <div className="row" style={{ gap: '8px' }}>
          <button className="primary small" data-testid="add-iteration" onClick={() => setShowIterationForm(true)}>
            + New Iteration
          </button>
          <button className="ghost small" data-testid="ai-generate-strategy" onClick={() => setShowAiWizard(true)}>
            🤖 Generate Strategy with AI
          </button>
        </div>
      </div>

      {showIterationForm ? (
        <NewIterationForm
          productTestId={productTestId}
          onCancel={() => setShowIterationForm(false)}
          onCreated={async (it) => {
            setShowIterationForm(false)
            setOpenIteration(it.id)
            await load()
          }}
        />
      ) : null}

      {showAiWizard ? (
        <AiStrategyWizard
          productTestId={productTestId}
          test={test}
          onCancel={() => setShowAiWizard(false)}
          onApproved={async ({ iteration }) => {
            setShowAiWizard(false)
            setOpenIteration(iteration.id)
            await load()
          }}
        />
      ) : null}

      {iterations.length === 0 && !showIterationForm && !showAiWizard ? <p className="hint small">No iterations yet.</p> : null}

      {iterations.map((it) => (
        <div className="subpanel" key={it.id} style={{ marginTop: '12px' }} data-testid={`iteration-${it.id}`}>
          <div className="row between">
            <b>
              Iteration {it.number} · {it.mode}
            </b>
            <button className="ghost small" onClick={() => setOpenIteration(openIteration === it.id ? null : it.id)}>
              {openIteration === it.id ? 'Hide' : 'Show'} creatives ({it.creative_count})
            </button>
          </div>
          <div className="hint small" style={{ marginTop: '4px' }}>
            Ceiling {euro((it.executionPolicy || {}).budgetCeilingMinor)} · angles:{' '}
            {((it.strategy || {}).angles || []).join(', ') || '—'}
          </div>

          {openIteration === it.id ? (
            <div style={{ marginTop: '10px' }}>
              <button className="primary small" data-testid="add-creative" onClick={() => setShowCreativeForm(true)}>
                + New Creative
              </button>
              {showCreativeForm ? (
                <NewCreativeForm
                  iterationId={it.id}
                  onCancel={() => setShowCreativeForm(false)}
                  onCreated={async () => {
                    setShowCreativeForm(false)
                    await load()
                  }}
                />
              ) : null}

              <div className="ms-session-list" style={{ marginTop: '10px' }}>
                {(creativesByIteration[it.id] || []).length === 0 ? <p className="hint small">No creatives yet.</p> : null}
                {(creativesByIteration[it.id] || []).map((c) => (
                  <div className="ms-session-row-item" key={c.id} data-testid={`creative-${c.id}`}>
                    <div className="ms-session-info">
                      <b>{c.creative_code}</b>
                      <div className="ms-badge-row">
                        <span className="ms-badge">{c.angle}</span>
                        <span className="ms-badge">{c.format}</span>
                        {c.hook_text ? <span className="ms-badge">“{c.hook_text}”</span> : null}
                        <span className="ms-badge">{c.approval_status}</span>
                      </div>
                    </div>
                    <div className="row">
                      <button className="primary small" data-testid={`open-creative-${c.id}`} onClick={() => onOpenCreative(c.id)}>
                        Open
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              {(creativesByIteration[it.id] || []).length > 0 ? (
                <button
                  className="ghost small"
                  data-testid="plan-production"
                  style={{ marginTop: '10px' }}
                  onClick={() => {
                    setPlannedRuns(null)
                    setPlanningIteration(it.id)
                  }}
                >
                  📋 Plan Production
                </button>
              ) : null}

              {planningIteration === it.id ? (
                <ProductionPlanningWizard
                  iterationId={it.id}
                  creatives={creativesByIteration[it.id] || []}
                  onCancel={() => setPlanningIteration(null)}
                  onApproved={async (items) => {
                    setPlanningIteration(null)
                    setPlannedRuns(items)
                    await load()
                  }}
                />
              ) : null}

              <ProductionDispatchPanel iterationId={it.id} />

              {plannedRuns && planningIteration === null ? (
                <div className="subpanel" data-testid="planned-runs-summary" style={{ marginTop: '10px' }}>
                  <b>✅ Production plan approved — {plannedRuns.length} ProductionRun(s) created</b>
                  <div className="ms-session-list" style={{ marginTop: '8px' }}>
                    {plannedRuns.map((r) => (
                      <div className="ms-session-row-item" key={r.id} data-testid={`planned-run-${r.id}`}>
                        <div className="ms-session-info">
                          <b>
                            {r.creative_code} · attempt {r.attempt_number}
                          </b>
                          <div className="ms-badge-row">
                            <span className="ms-badge">{r.status}</span>
                            <span className="ms-badge">{r.production_method}</span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ))}
    </section>
  )
}

// ---------------------------------------------------------------------------
// Home
// ---------------------------------------------------------------------------

function ProductTestsHome({ tests, loading, error, onReload, onNew, onOpen }) {
  return (
    <section className="panel ms-panel">
      <div className="ms-hero">
        <span className="ms-hero-eyebrow">Organic Product Testing</span>
        <h2 className="ms-hero-title">Product Tests</h2>
        <p className="ms-hero-sub">
          One product, tested through iterations of creatives, published and measured by hand. Manual foundation — no
          generation, no verdicts.
        </p>
      </div>

      <ErrorNote error={error} onRetry={onReload} />

      <div className="row between ms-home-head">
        <p className="hint small">Each Product Test freezes its policy at creation, so past results stay interpretable.</p>
        <button className="primary" data-testid="new-product-test" onClick={onNew}>
          + New Product Test
        </button>
      </div>

      {loading ? (
        <div className="ms-empty-state" data-testid="pt-loading">
          <p>Loading Product Tests…</p>
        </div>
      ) : tests.length === 0 ? (
        <div className="ms-empty-state" data-testid="pt-empty">
          <p>No product tests yet. Start by entering a product's economics.</p>
          <button className="primary" onClick={onNew}>
            Create your first Product Test →
          </button>
        </div>
      ) : (
        <div className="ms-session-list" data-testid="pt-list">
          {tests.map((t) => (
            <div className="ms-session-row-item" key={t.id} data-testid={`pt-row-${t.id}`}>
              <div className="ms-session-info">
                <b>
                  {t.code} · {t.product_name}
                </b>
                <div className="ms-badge-row">
                  <span className="ms-badge">
                    {t.market} / {t.language}
                  </span>
                  <span className="ms-badge">{t.status}</span>
                  <span className="ms-badge">{t.iteration_count} iteration(s)</span>
                  <span className="ms-badge">{t.creative_count} creative(s)</span>
                </div>
              </div>
              <div className="row">
                <button className="primary small" data-testid={`open-pt-${t.id}`} onClick={() => onOpen(t.id)}>
                  Open
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

// ---------------------------------------------------------------------------

export default function ProductTests({ onOpenStudioSession }) {
  const [view, setView] = useState({ name: 'home' })
  const [tests, setTests] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const loadTests = async () => {
    setLoading(true)
    try {
      const r = await api('GET', '/api/product-tests')
      setTests(r.items || [])
      setError('')
    } catch (e) {
      setError(`Could not reach the local backend: ${e.message} Start it with npm run dev, then Retry.`)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadTests()
  }, [])

  if (view.name === 'new') {
    return (
      <NewProductTest
        onCancel={() => setView({ name: 'home' })}
        onCreated={async (item) => {
          await loadTests()
          setView({ name: 'test', id: item.id })
        }}
      />
    )
  }
  if (view.name === 'test') {
    return (
      <ProductTestDetail
        productTestId={view.id}
        onBack={async () => {
          await loadTests()
          setView({ name: 'home' })
        }}
        onOpenCreative={(creativeId) => setView({ name: 'creative', id: creativeId, testId: view.id })}
        onOpenStudio={onOpenStudioSession}
      />
    )
  }
  if (view.name === 'creative') {
    return <CreativeDetail creativeId={view.id} onBack={() => setView({ name: 'test', id: view.testId })} onOpenStudio={onOpenStudioSession} />
  }
  return (
    <ProductTestsHome
      tests={tests}
      loading={loading}
      error={error}
      onReload={loadTests}
      onNew={() => setView({ name: 'new' })}
      onOpen={(id) => setView({ name: 'test', id })}
    />
  )
}
