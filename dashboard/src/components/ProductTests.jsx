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
  const [showCreativeForm, setShowCreativeForm] = useState(false)
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
        <button className="primary small" data-testid="add-iteration" onClick={() => setShowIterationForm(true)}>
          + New Iteration
        </button>
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

      {iterations.length === 0 && !showIterationForm ? <p className="hint small">No iterations yet.</p> : null}

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
