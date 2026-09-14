import { useEffect, useRef, useState } from 'react'
import { apiBase } from '../lib/ai/apiClient.js'

async function request(route, body) {
  const response = await fetch(apiBase() + route, { method: body === undefined ? 'GET' : 'POST', headers: body === undefined ? {} : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
  const result = await response.json()
  if (!response.ok || result.ok === false) throw new Error(result.error || 'Request failed')
  return result
}
const op = (route, body) => request('/api/operator/' + route, body)
const mediaUrl = (asset) => apiBase() + (asset.relative_path === 'mock-video-output.mp4' ? '/' : '/media/') + asset.relative_path.split('/').map(encodeURIComponent).join('/')
const money = (minor) => minor == null ? 'unrecorded' : `€${(minor / 100).toFixed(2)}`
const display = (value, suffix = '', unavailable = 'missing data') => value == null ? `— (${unavailable})` : `${value.toFixed(2)}${suffix}`
const stateLabel = (state) => state === 'regenerating' ? 'Needs revision' : state
function ErrorLine({ error }) { return error ? <p className="note bad" role="alert">{error}</p> : null }

export function VideoPreview({ asset, compact = false }) {
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [asset?.relative_path])
  if (!asset?.relative_path) return null
  const url = mediaUrl(asset)
  return <div>
    <video controls preload="metadata" src={url} onError={() => setFailed(true)} style={{ width: '100%', maxWidth: 280, maxHeight: 420 }} />
    {failed && <ErrorLine error="Local video is missing or cannot be played. Check the file before review/publication." />}
    <p className="hint small">{asset.width ? `${asset.width}×${asset.height} · ` : ''}{asset.duration_seconds ? `${asset.duration_seconds.toFixed(2)} s · ` : ''}{asset.file_size ? `${Math.round(asset.file_size / 1024)} KB` : ''}</p>
    <a href={url} target="_blank" rel="noreferrer" style={{ color: '#92bdff' }}>Open / download video</a>
    {!compact && <p className="hint small" style={{ overflowWrap: 'anywhere' }}>{url}</p>}
  </div>
}

export function OperatorSettings() {
  const [info, setInfo] = useState(null), [rate, setRate] = useState(''), [source, setSource] = useState(''), [ffmpeg, setFfmpeg] = useState('')
  const [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const load = () => op('settings').then((r) => { setInfo(r); setRate(r.fx?.rate ?? ''); setSource(r.fx?.source || '') }).catch((e) => setError(e.message))
  useEffect(() => { load() }, [])
  return <details className="subpanel"><summary>Operator settings · FX and local assembly</summary><ErrorLine error={error} />
    <p>FFmpeg: {info?.ffmpeg ? 'available' : 'unavailable'}. USD → EUR: {info?.fx ? `${info.fx.rate} (${info.fx.source})` : 'not configured; paid generation is blocked'}.</p>
    <div className="fields"><label className="field">Verified USD → EUR rate<input aria-label="USD to EUR rate" value={rate} onChange={(e) => setRate(e.target.value)} /></label>
      <label className="field">Rate source<input value={source} onChange={(e) => setSource(e.target.value)} /></label>
      <label className="field">FFmpeg executable path (optional override)<input value={ffmpeg} onChange={(e) => setFfmpeg(e.target.value)} /></label></div>
    <button className="ghost" disabled={busy} onClick={async () => { setBusy(true); setError(''); try { await op('settings', { ...(rate !== '' ? { fxRate: Number(rate), fxSource: source } : {}), ...(ffmpeg ? { ffmpegPath: ffmpeg } : {}) }); await load() } catch (e) { setError(e.message) } finally { setBusy(false) } }}>Save settings (no generation)</button>
  </details>
}

export function ManualProductionPlan({ creativeId, onCreated }) {
  const [open, setOpen] = useState(false), [provider, setProvider] = useState('mock')
  const newClip = () => ({ prompt: '', seconds: 5, resolution: '480p', generate_audio: true })
  const [clips, setClips] = useState([newClip()]), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const creating = useRef(false)
  const change = (i, field, value) => setClips((items) => items.map((clip, index) => index === i ? { ...clip, [field]: value } : clip))
  return <div className="subpanel" data-testid="manual-production-plan">
    <button className="ghost" onClick={() => setOpen(!open)}>Configure video production</button>
    {open && <><h3>Scene plan · vertical 9:16</h3><ErrorLine error={error} />
      <label className="field">Provider<select aria-label="Production provider" value={provider} onChange={(e) => setProvider(e.target.value)}><option value="mock">Mock — free local placeholder</option><option value="fal">fal.ai — Seedance 2.0 Fast (paid)</option></select></label>
      {clips.map((clip, i) => <div className="subpanel" key={i}><b>Scene {i + 1}</b><label className="field">Prompt<textarea aria-label={`Scene ${i + 1} prompt`} value={clip.prompt} onChange={(e) => change(i, 'prompt', e.target.value)} /></label>
        <div className="fields"><label className="field">Seconds<input type="number" min="4" max="15" value={clip.seconds} onChange={(e) => change(i, 'seconds', Number(e.target.value))} /></label>
          <label className="field">Resolution<select value={clip.resolution} onChange={(e) => change(i, 'resolution', e.target.value)}><option>480p</option><option>720p</option></select></label>
          <label><input type="checkbox" checked={clip.generate_audio} onChange={(e) => change(i, 'generate_audio', e.target.checked)} /> Generate audio</label></div>
        <button className="ghost small" disabled={clips.length === 1} onClick={() => setClips((items) => items.filter((_, index) => index !== i))}>Remove scene</button>
      </div>)}
      <button className="ghost" disabled={clips.length >= 12} onClick={() => setClips([...clips, newClip()])}>Add scene</button>
      <p>Approving this plan creates a production run. Start generation separately after checking its budget.</p>
      <button className="primary" disabled={busy} onClick={async () => { if (creating.current) return; creating.current = true; setBusy(true); setError(''); try { await op('plan', { creativeId, provider, clips }); setOpen(false); await onCreated() } catch (e) { setError(e.message) } finally { creating.current = false; setBusy(false) } }}>Approve scene plan (no spend)</button>
    </>}
  </div>
}

export function RunOperator({ runId, iterationId, creativeId, onChange }) {
  const [data, setData] = useState(null), [error, setError] = useState(''), [note, setNote] = useState(''), [busy, setBusy] = useState(false)
  const mutex = useRef(false)
  const sequence = useRef(0)
  const load = async () => { const current = ++sequence.current; try { const result = await op(`runs/${runId}`); if (current === sequence.current) { setData(result); setError('') } return result } catch (e) { if (current === sequence.current) setError(e.message); throw e } }
  useEffect(() => { const tick = () => { if (!mutex.current) load().catch(() => {}) }; tick(); const timer = setInterval(tick, 3000); return () => { sequence.current++; clearInterval(timer) } }, [runId])
  const act = async (fn) => { if (mutex.current) return; mutex.current = true; setBusy(true); setError(''); try { await fn(); await load(); await onChange() } catch (e) { setError(e.message) } finally { mutex.current = false; setBusy(false) } }
  if (!data) return <ErrorLine error={error} />
  const held = data.attempts.some((a) => a.reconciliation_status === 'reconciliation_required')
  const ambiguous = held || data.run.jobs.some((j) => (j.error_message || '').includes('ambiguous_billing'))
  const canStart = data.run.status === 'planned' && !data.run.jobs.length && data.run.production_method !== 'manual_external'
  const canAssemble = data.run.jobs.length > 0 && data.run.jobs.every((j) => j.status === 'complete') && !data.finalAsset
  return <div data-testid={`operator-run-${runId}`}>
    <ErrorLine error={error} />
    <p>Run state: {held ? 'reconciliation required' : data.run.status} · {data.run.specSnapshot?.planning?.plannedProvider || data.run.production_method} · {data.run.specSnapshot?.planning?.plannedModel || ''}</p>
    <p className="hint small">Recorded generation cost: {money(data.costs.reduce((sum, c) => sum + c.base_currency_amount_minor, 0))} · Active reservations: {money(data.reservations.filter((r) => r.status === 'active').reduce((sum, r) => sum + r.base_currency_amount_minor, 0))}. fal settlement may use catalog estimates, not a verified invoice.</p>
    {ambiguous && <p className="note bad">Ambiguous billing — manual reconciliation required. Investigate the existing provider request before any new generation. {held ? 'Reservation remains held.' : 'Historical failure: reservation was released; provider billing is still unverified.'}</p>}
    {data.run.jobs.map((job) => <p className="hint small" key={job.id}>Scene {job.inputParams.sequence || '—'} · {job.status}{job.retry_count ? ` · retries ${job.retry_count}` : ''}{job.error_message ? ` · ${job.error_message}` : ''}</p>)}
    {held && <details><summary>Safe provider diagnostics</summary><pre style={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify(data.attempts.map((a) => ({ request: a.external_request_id, status: a.provider_status, diagnostic: a.result_data ? JSON.parse(a.result_data) : null })), null, 2)}</pre></details>}
    {canStart && <button className="primary" disabled={busy} onClick={() => act(async () => {
      const { preflight } = await request(`/api/iterations/${iterationId}/production/preflight`, { productionRunIds: [runId] })
      if (preflight.readyCount !== 1 || preflight.expectedTotalIfAllSucceedMinor > preflight.budgetCeilingMinor) throw new Error(preflight.runs[0]?.reason || 'Production budget or preflight blocked.')
      if (!window.confirm(`Start this production run? Estimated new spend ${money(preflight.newEstimatedPaidSpendMinor)}; ceiling ${money(preflight.budgetCeilingMinor)}. Paid provider requests cannot be undone.`)) return
      const response = await request(`/api/iterations/${iterationId}/production/start`, { productionRunIds: [runId], confirmed: true })
      const outcome = response.outcomes?.[0]
      if (outcome?.outcome !== 'started') throw new Error(outcome?.reason || 'Production did not start.')
    })}>Preflight & start generation</button>}
    {data.assets.length > 0 && <details><summary>Generated scene assets ({data.assets.length})</summary>{data.assets.map((asset) => <VideoPreview key={`${asset.id}-${asset.job_id}`} asset={asset.relative_path === 'mock-video-output.mp4' ? { ...asset, relative_path: asset.relative_path } : asset} />)}</details>}
    {canAssemble && <button className="primary" disabled={busy} onClick={() => act(() => op(`runs/${runId}/assemble`, {}))}>{busy ? 'Assembling…' : 'Assemble Final Video (local / free)'}</button>}
    {data.finalAsset && <><VideoPreview asset={data.finalAsset} /><label className="field">Review note<textarea value={note} onChange={(e) => setNote(e.target.value)} /></label><div className="row" style={{ gap: 8 }}>
      {[['approved', 'Approve / Ready to publish'], ['rejected', 'Reject'], ['regenerating', 'Needs revision']].map(([decision, label]) => <button className="ghost" key={decision} disabled={busy || data.run.status !== 'complete'} onClick={() => act(() => op('review', { creativeId, productionRunId: runId, decision, note }))}>{label}</button>)}</div></>}
  </div>
}

export function ReviewQueue({ onOpen }) {
  const [rows, setRows] = useState([]), [filter, setFilter] = useState('pending'), [error, setError] = useState('')
  useEffect(() => { op('review').then((r) => setRows(r.items)).catch((e) => setError(e.message)) }, [])
  return <section className="panel" data-testid="review-queue"><h2>Review Queue</h2><ErrorLine error={error} />
    <select className="ms-input" aria-label="Review filter" value={filter} onChange={(e) => setFilter(e.target.value)}>{['pending', 'approved', 'rejected', 'regenerating', 'all'].map((value) => <option key={value} value={value}>{stateLabel(value)}</option>)}</select>
    {rows.filter((row) => filter === 'all' || row.approval_status === filter).map((row) => <div className="subpanel" key={row.runId}><h3>{row.product_name} · {row.creative_code}</h3><p>{row.product_test_code} · Iteration {row.iteration_number} · {stateLabel(row.approval_status)} · {row.created_at}</p>
      <p>{row.planning.plannedProvider} · {row.planning.plannedModel} · Recorded cost {money(row.cost_minor)}{row.planning.estimatedCost ? ` · Plan estimate ${(row.planning.estimatedCost.minor / 100).toFixed(2)} ${row.planning.estimatedCost.currency} (not an invoice)` : ''}</p><VideoPreview asset={row} /><p>{row.review_note}</p>
      <button className="primary" onClick={() => onOpen(row.creativeId, row.product_test_id)}>Review / publication / metrics</button></div>)}
    {!rows.some((r) => filter === 'all' || r.approval_status === filter) && <p>No finished creatives in this review state.</p>}
  </section>
}

export function AnalysisPanel({ productTestId, creativeId, revision }) {
  const [data, setData] = useState(null), [error, setError] = useState('')
  const sequence = useRef(0)
  const load = () => { const current = ++sequence.current; return op(`analysis?${new URLSearchParams(productTestId ? { productTestId } : creativeId ? { creativeId } : {})}`).then((result) => { if (current === sequence.current) { setData(result); setError('') } }).catch((e) => { if (current === sequence.current) setError(e.message) }) }
  useEffect(() => { load(); return () => { sequence.current++ } }, [productTestId, creativeId, revision])
  const show = (a) => <><p>{a.distribution} · {a.recommendation}</p><p className="hint small">Engagement {display(a.engagementRate, '%', a.availability.engagementRate)} · CTR {display(a.ctr, '%', a.availability.ctr)} · Conversion {display(a.conversionRate, '%', a.availability.conversionRate)} · CPA {a.cpaMinor == null ? a.availability.cpaMinor : money(a.cpaMinor)} · ROAS {display(a.roas, '×', a.availability.roas)} · Cost/view {a.costPerViewMinor == null ? a.availability.costPerViewMinor : money(a.costPerViewMinor)}</p></>
  return <div className="subpanel" data-testid="analysis-panel"><div className="row between"><h3>Distribution & analysis</h3><button className="ghost" onClick={load}>Refresh analysis</button></div><ErrorLine error={error} />
    {data && <><p className="hint small">Rules: at least {data.rules.minimumViews} impressions (views if impressions are missing), then {data.rules.minimumClicks} link clicks for directional conversion judgment. “Promising” means at least one observed purchase after these thresholds, not statistical proof.</p><p className="hint small">{data.basis} Blank metrics are missing; explicit 0 is zero. Ratios with no denominator are not applicable.</p>
      {show(data.total)}{data.iterations.map((group) => <details key={group.id}><summary>Iteration {group.id}</summary>{show(group.analysis)}</details>)}
      {data.publications.map((pub) => <details key={pub.id} open><summary>{pub.creative_code} · {pub.platform} · {pub.handle} · {pub.captured_at || 'No metrics'}</summary>{show(pub.analysis)}</details>)}
      {!data.publications.length && <p>No publications yet. Publish an approved video, then record metrics.</p>}</>}
  </div>
}
