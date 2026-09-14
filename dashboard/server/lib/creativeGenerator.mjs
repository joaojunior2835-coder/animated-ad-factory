// Operator composition over existing M4/M5/M6. No new ledger or schema.
import { randomUUID } from 'node:crypto'
import { getDb, getFxRate, getBudgetSummary, freezeProductionRunSpec, attachAssetLink, setProductionRunStatus } from '../db/repository.mjs'
import * as pt from '../db/productTestRepository.mjs'
import { getConfiguredRates, estimateComponentCost } from './rateCatalog.mjs'
import { preflightProduction, startProduction } from './productionExecution.mjs'
import { runDetails } from './operator.mjs'
import { localAssetPath, assembleProductionRun, videoTool } from './assembly.mjs'

const key = (id) => `creative_generator_${id}`
const parse = (s, fallback = {}) => { try { return JSON.parse(s) ?? fallback } catch { return fallback } }
const fail = (condition, message) => { if (!condition) throw new Error(message) }
function creative(id) {
  const row = getDb().prepare('SELECT * FROM creative WHERE id=?').get(Number(id))
  fail(row, 'Choose an existing Creative.'); return row
}
function read(id) {
  creative(id)
  return parse(getDb().prepare('SELECT value FROM app_settings WHERE key=?').get(key(id))?.value, { revision: 0, scenes: [], quote: null, final: null })
}
function write(id, value) {
  value.revision++
  getDb().prepare("INSERT INTO app_settings(key,value,updated_at) VALUES(?,?,datetime('now')) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at").run(key(id), JSON.stringify(value))
  return value
}
function version(state, revision) { fail(state.revision === revision, 'This Creative changed in another window. Reload before continuing.') }
const config = (s) => ({ name: s.name, prompt: s.prompt, provider: s.provider, mode: s.mode, seconds: s.seconds, resolution: s.resolution, aspectRatio: s.aspectRatio, generateAudio: s.generateAudio, startAssetId: s.startAssetId })
const signature = (s) => JSON.stringify(config(s))
function asset(id, type) {
  const a = getDb().prepare('SELECT * FROM asset WHERE id=?').get(Number(id))
  fail(a && (type === 'image' ? /^image\/(png|jpeg|webp)$/.test(a.mime_type) : a.mime_type === 'video/mp4'), `Choose an existing local ${type}.`)
  localAssetPath(a.relative_path); return a
}
function stateOf(s) {
  const details = s.runId ? runDetails(s.runId) : null
  const ambiguous = details?.attempts.some(a => a.reconciliation_status === 'reconciliation_required') || details?.run.jobs.some(j => /ambiguous_billing/.test(j.error_message || ''))
  // Keep a missing-file scene editable; preview reports the missing media and
  // approval/assembly validate its real local file before accepting it.
  const media = s.selectedAssetId ? getDb().prepare('SELECT * FROM asset WHERE id=?').get(s.selectedAssetId) : details?.finalAsset || null
  const status = ambiguous ? 'Reconciliation required' : details?.run.status === 'failed' ? 'Failed' : details?.run.status === 'executing' ? (details.attempts.some(a => a.provider_status === 'IN_PROGRESS') ? 'Generating' : 'Queued') : media ? 'Complete' : details?.run.status === 'planned' ? 'Ready' : 'Ready'
  const current = !s.runId || s.generatedSignature === signature(s)
  return { ...s, status, current, media, approved: Boolean(s.approved && current && media), details }
}
function editable(s) {
  const live = stateOf(s)
  fail(!['Queued', 'Generating', 'Reconciliation required'].includes(live.status), live.status === 'Reconciliation required' ? 'Billing status uncertain — investigate the existing request. New generation is blocked.' : 'This scene is generating. Wait for its result.')
}
export async function generatorOptions() {
  const rates = getConfiguredRates()
  const models = [{ id: 'mock', provider: 'mock', model: 'mock-video', label: 'Mock Video', providerLabel: 'Local · free placeholder' }]
  if (rates.video['seedance-2.0-fast-480p'].configured) models.unshift({ id: 'fal', provider: 'fal', model: 'seedance-2.0-fast', label: 'Seedance 2.0 Fast', providerLabel: 'fal.ai' })
  let ffmpeg = false; try { ffmpeg = Boolean(await videoTool()) } catch {}
  return { models, imageModels: [], imageUnavailableReason: 'Image generation is unavailable: fal images are not integrated with M5 accounting; Pollinations pricing is unverified. Upload or choose a local image instead.', falConfigured: rates.video['seedance-2.0-fast-480p'].configured, fx: getFxRate('USD', 'EUR'), ffmpeg,
    productTests: getDb().prepare('SELECT pt.id,p.name,pt.code FROM product_test pt JOIN product p ON p.id=pt.product_id ORDER BY pt.id DESC').all(),
    creatives: getDb().prepare('SELECT c.*,i.product_test_id FROM creative c JOIN iteration i ON i.id=c.iteration_id ORDER BY c.id DESC').all(),
    media: getDb().prepare("SELECT * FROM asset WHERE mime_type IN ('image/png','image/jpeg','image/webp','video/mp4') ORDER BY id DESC").all().filter(a => { try { localAssetPath(a.relative_path); return true } catch { return false } }) }
}
export function createGeneratorCreative({ productTestId, angle }) {
  fail(typeof angle === 'string' && angle.trim() && angle.length <= 300, 'Enter a Creative title / angle (up to 300 characters).')
  return getDb().transaction(() => {
    fail(getDb().prepare('SELECT id FROM product_test WHERE id=?').get(Number(productTestId)), 'Choose a Product Test.')
    const iterationId = getDb().prepare('SELECT id FROM iteration WHERE product_test_id=? ORDER BY number DESC LIMIT 1').get(Number(productTestId))?.id || pt.createIterationForTest({ productTestId: Number(productTestId), mode: 'exploratory' })
    const creativeId = pt.createCreativeForIteration({ iterationId, angle: angle.trim(), format: 'Vertical ad', conceptSummary: angle.trim(), defaultProductionMethod: 'factory_generated' })
    return { creativeId }
  }).immediate()
}
export function generatorWorkspace(id) {
  const state = read(id), c = creative(id)
  const recordedMinor = getDb().prepare('SELECT COALESCE(SUM(base_currency_amount_minor),0) AS minor FROM cost WHERE creative_id=?').get(Number(id)).minor
  return { ...state, creative: c, recordedMinor, scenes: state.scenes.map(stateOf), budget: getBudgetSummary(c.iteration_id), final: state.final ? { ...state.final, ...runDetails(state.final.runId) } : null }
}
function normalizeScene(raw, previous) {
  const text = (value, max) => { fail(typeof value === 'string' && value.length <= max, 'Scene text is too long.'); return value }
  const s = { id: previous?.id || randomUUID(), name: text(raw.name || 'Scene', 150), prompt: text(raw.prompt || '', 6000), provider: raw.provider, mode: raw.mode, seconds: Number(raw.seconds), resolution: raw.resolution, aspectRatio: raw.aspectRatio, generateAudio: raw.generateAudio, startAssetId: raw.startAssetId ? Number(raw.startAssetId) : null }
  fail(['mock', 'fal'].includes(s.provider), 'Unsupported video model.')
  fail(['text-to-video', 'image-to-video'].includes(s.mode), 'Choose text-to-video or image-to-video.')
  fail(Number.isInteger(s.seconds) && s.seconds >= 4 && s.seconds <= 15, 'Duration must be 4–15 whole seconds.')
  fail(['480p', '720p'].includes(s.resolution), 'Choose 480p or 720p.')
  fail(['9:16', '16:9', '1:1'].includes(s.aspectRatio), 'Choose a supported aspect ratio.')
  fail(typeof s.generateAudio === 'boolean', 'Choose whether to generate audio.')
  if (s.startAssetId) asset(s.startAssetId, 'image')
  return s
}
export function saveGeneratorScenes(id, { revision, scenes }) {
  return getDb().transaction(() => {
    const state = read(id); version(state, revision)
    fail(Array.isArray(scenes) && scenes.length <= 12, 'Use up to 12 scenes.')
    const seen = new Set()
    const next = scenes.map(raw => {
      fail(!raw.id || !seen.has(raw.id), 'Duplicate scene.'); if (raw.id) seen.add(raw.id)
      const prev = state.scenes.find(s => s.id === raw.id)
      fail(!raw.id || prev, 'Scene does not belong to this Creative.')
      const normalized = normalizeScene(raw, prev)
      if (prev && signature(prev) !== signature(normalized)) editable(prev)
      return { ...prev, ...normalized, approved: prev?.approved && signature(prev) === signature(normalized) }
    })
    for (const old of state.scenes.filter(s => !next.some(n => n.id === s.id))) fail(!old.runId && !old.selectedAssetId && !old.history?.length, 'Produced scenes cannot be deleted. Keep their history and mark them unapproved to exclude them.')
    state.scenes = next; state.quote = null; write(id, state)
    return generatorWorkspace(id)
  }).immediate()
}
export function estimateGenerator(id, sceneIds) {
  const state = read(id), c = creative(id), selected = selectedScenes(state, sceneIds)
  const rows = selected.map(s => {
    const cost = estimateComponentCost('video', s.provider === 'fal' ? `seedance-2.0-fast-${s.resolution}` : 'mock', s.seconds)
    if (cost.unknown) return { sceneId: s.id, error: 'Provider not configured or model price unavailable.' }
    const fx = s.provider === 'mock' ? { rate: 1 } : getFxRate(cost.currency, 'EUR')
    return fx ? { sceneId: s.id, minor: Math.round(cost.costMinor * fx.rate), sourceMinor: cost.costMinor, sourceCurrency: cost.currency } : { sceneId: s.id, error: 'FX rate unavailable.' }
  })
  return { rows, totalMinor: rows.some(r => r.error) ? null : rows.reduce((sum,r) => sum+r.minor,0), budget: getBudgetSummary(c.iteration_id) }
}
function selectedScenes(state, ids) {
  fail(Array.isArray(ids) && ids.length && ids.length === new Set(ids).size, 'Select at least one unique scene.')
  const selected = ids.map(id => state.scenes.find(s => s.id === id)); fail(selected.every(Boolean), 'Scene not found.'); return selected
}
export function quoteGenerator(id, { revision, sceneIds }) {
  return getDb().transaction(() => {
    const state = read(id); version(state, revision)
    const selected = selectedScenes(state, sceneIds), c = creative(id)
    for (const s of selected) {
      editable(s); fail(s.prompt.trim(), 'Every scene needs a generation prompt.')
      if (s.mode === 'image-to-video') asset(s.startAssetId, 'image')
    }
    const estimate = estimateGenerator(id, sceneIds); fail(estimate.totalMinor !== null, estimate.rows.find(r => r.error)?.error)
    const runIds = selected.map(s => {
      if (s.pendingRunId && runDetails(s.pendingRunId).run.status === 'planned' && s.pendingSignature === signature(s)) return s.pendingRunId
      const start = s.mode === 'image-to-video' ? asset(s.startAssetId, 'image') : null
      const [runId] = pt.approveProductionPlan({ plans: [{ creativeId: Number(id), fineMethod: 'ai_generated_full', coarseProductionMethod: 'factory_generated', plannedProvider: s.provider, plannedModel: s.provider === 'fal' ? 'seedance-2.0-fast' : 'mock-video',
        notes: 'creative_generator_scene',
        generationPlan: { imageGenerations: 0, voiceRequired: false, videoClips: [{ prompt: s.prompt.trim(), purpose: 'video scene', seconds: s.seconds, resolution: s.resolution, aspect_ratio: s.aspectRatio, generate_audio: s.generateAudio, ...(start ? { start_frame: '/media/' + start.relative_path } : {}) }] },
        estimatedCost: { minor: estimate.rows.find(r => r.sceneId === s.id).sourceMinor, currency: s.provider === 'fal' ? 'USD' : 'EUR' } }] })
      if (start) attachAssetLink(start.id, { productionRunId: runId }, 'start_frame')
      s.pendingRunId = runId; s.pendingSignature = signature(s)
      return runId
    })
    const preflight = preflightProduction(c.iteration_id, runIds)
    fail(preflight.readyCount === runIds.length && !preflight.blockedCount, preflight.runs.find(r => r.reason)?.reason || 'Production safety check failed.')
    fail(preflight.expectedTotalIfAllSucceedMinor <= preflight.budgetCeilingMinor, 'Insufficient budget. Increase the next iteration budget in Product Tests.')
    state.quote = { token: randomUUID(), sceneIds, runIds, totalMinor: preflight.newEstimatedPaidSpendMinor, expiresAt: Date.now() + 300000, used: false }
    write(id, state)
    return { workspace: generatorWorkspace(id), quote: { ...state.quote, revision: state.revision, preflight } }
  }).immediate()
}
export async function startGenerator(id, { confirmed, token, revision }) {
  fail(confirmed === true, 'confirmed:true is required before production can spend money.')
  const claim = getDb().transaction(() => {
    const state = read(id); version(state, revision); const q = state.quote
    fail(q && q.token === token && !q.used && q.expiresAt > Date.now(), 'Confirmation expired or already used. Check current status; request a fresh estimate if still ready.')
    const selected = selectedScenes(state, q.sceneIds)
    for (const [i, s] of selected.entries()) { editable(s); fail(s.pendingSignature === signature(s) && s.pendingRunId === q.runIds[i], 'Scene changed. Estimate again.') }
    const iterationId = creative(id).iteration_id, preflight = preflightProduction(iterationId, q.runIds)
    fail(preflight.readyCount === q.runIds.length && !preflight.blockedCount, 'Production preflight no longer passes.')
    fail(preflight.newEstimatedPaidSpendMinor === q.totalMinor, 'Price or FX changed. Request a fresh estimate and confirm again.')
    fail(preflight.expectedTotalIfAllSucceedMinor <= preflight.budgetCeilingMinor, 'Insufficient budget.')
    for (const s of selected) {
      if (s.runId || s.selectedAssetId) s.history = [...(s.history || []), { runId: s.runId || null, assetId: s.selectedAssetId || null }]
      s.runId = s.pendingRunId; s.selectedAssetId = null; s.generatedSignature = signature(s); s.approved = false; s.pendingRunId = null
    }
    q.used = true; write(id, state) // Durable one-use confirmation, before any await/submission.
    return { iterationId, runIds: q.runIds }
  }).immediate()
  return startProduction(claim.iterationId, claim.runIds)
}
export function chooseGeneratorResult(id, { revision, sceneId, approved, assetId }) {
  return getDb().transaction(() => {
    const state = read(id); version(state, revision); const [s] = selectedScenes(state, [sceneId]); editable(s)
    if (assetId) {
      const a = asset(assetId, 'video')
      if (s.runId || s.selectedAssetId) s.history = [...(s.history || []), { runId: s.runId || null, assetId: s.selectedAssetId || null }]
      s.selectedAssetId = a.id; s.runId = null; s.generatedSignature = signature(s); s.approved = false
      attachAssetLink(a.id, { creativeId: Number(id) }, 'scene_source')
    }
    if (approved !== undefined) {
      fail(typeof approved === 'boolean', 'Approval must be explicit.')
      const live = stateOf(s); fail(!approved || (live.media && live.current && live.status === 'Complete'), 'Only the current completed scene can be approved.')
      if (approved) asset(live.media.id, 'video')
      s.approved = approved
    }
    state.quote = null; write(id, state); return generatorWorkspace(id)
  }).immediate()
}
export async function assembleGenerator(id, { revision }) {
  const runId = getDb().transaction(() => {
    const state = read(id); version(state, revision)
    const approved = state.scenes.map(stateOf).filter(s => s.approved)
    fail(approved.length, 'Approve at least one completed scene before assembly.')
    const sources = approved.map(s => ({ sceneId: s.id, assetId: s.media.id, sourceRunId: s.runId || null }))
    if (state.final && JSON.stringify(state.final.sources) === JSON.stringify(sources)) return state.final.runId
    const runId = pt.createProductionRunForCreative({ creativeId: Number(id), productionMethod: 'factory_generated' })
    for (const source of sources) attachAssetLink(source.assetId, { productionRunId: runId }, 'assembly_input')
    freezeProductionRunSpec(runId, { schemaVersion: 1, planning: { fineMethod: 'local_assembly', generationPlan: { imageGenerations: 0, videoClips: [], voiceRequired: false } }, execution: { provider: 'local-ffmpeg', assemblySources: sources, frozenAt: new Date().toISOString() } })
    setProductionRunStatus(runId, 'executing')
    state.final = { runId, sources }; write(id, state); return runId
  }).immediate()
  await assembleProductionRun(runId)
  return generatorWorkspace(id)
}
