// Operator composition over existing M4/M5/M6. No new ledger or schema.
import { randomUUID, createHash } from 'node:crypto'
import fs from 'node:fs'
import { getDb, getFxRate, getBudgetSummary, freezeProductionRunSpec, attachAssetLink, setProductionRunStatus, createProduct } from '../db/repository.mjs'
import * as pt from '../db/productTestRepository.mjs'
import { getConfiguredRates, estimateVideoJobCost } from './rateCatalog.mjs'
import { normalizeRemix, remixParams, buildRemixPrompt, REFERENCE_ROLES, REMIX_MODES } from './referenceRemix.mjs'
import { preflightProduction, startProduction } from './productionExecution.mjs'
import { runDetails } from './operator.mjs'
import { localAssetPath, assembleProductionRun, videoTool } from './assembly.mjs'
import { modelCapabilities } from './modelCapabilities.mjs'
import { validateProductionSteps, priceProductionStep } from './productionSteps.mjs'

const key = (id) => `creative_generator_${id}`
const quickKey = workspace => `quick_create_${workspace}_${new Date().toISOString().slice(0, 10)}`
const quickSelectionKey = workspace => `creative_quick_selection_${workspace}`
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
function isInternalQuickCreative(id) {
  const row = getDb().prepare(`SELECT c.id,c.concept_summary,i.product_test_id,p.name AS product_name
    FROM creative c JOIN iteration i ON i.id=c.iteration_id JOIN product_test pt ON pt.id=i.product_test_id JOIN product p ON p.id=pt.product_id
    WHERE c.id=?`).get(Number(id))
  return row && row.product_name === 'Quick Create' && /Quick Create draft/i.test(row.concept_summary || '') ? row : null
}
function rememberQuickSelection(workspace, ids) {
  const kind = ['image', 'video', 'remix', 'studio', 'canvas'].includes(workspace) ? workspace : 'video'
  getDb().prepare("INSERT INTO app_settings(key,value,updated_at) VALUES(?,?,datetime('now')) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at")
    .run(quickSelectionKey(kind), JSON.stringify({ ...ids, workspace: kind, source: 'backend', updatedAt: new Date().toISOString() }))
}
function activeQuickSelection(workspace) {
  const kind = ['image', 'video', 'remix', 'studio', 'canvas'].includes(workspace) ? workspace : 'video'
  const saved = parse(getDb().prepare('SELECT value FROM app_settings WHERE key=?').get(quickSelectionKey(kind))?.value, null)
  if (!saved?.creativeId) return null
  const row = isInternalQuickCreative(saved.creativeId)
  if (!row) return null
  return { productTestId: row.product_test_id, creativeId: row.id, workspace: kind }
}
function version(state, revision) { fail(state.revision === revision, 'This Creative changed in another window. Reload before continuing.') }
// Omit the default video quantity from signatures so existing completed single
// outputs and their approvals remain current across this additive extension.
const config = (s) => s.kind === 'image' ? {kind:s.kind,name:s.name,prompt:s.prompt,provider:s.provider,model:s.model,mode:s.mode,imageSize:s.imageSize,outputFormat:s.outputFormat,quantity:s.quantity} : ({ name: s.name, prompt: s.prompt, provider: s.provider, mode: s.mode, seconds: s.seconds, resolution: s.resolution, aspectRatio: s.aspectRatio, generateAudio: s.generateAudio, startAssetId: s.startAssetId, ...(Number(s.quantity || 1)>1 ? {quantity:Number(s.quantity)} : {}), ...(s.remix ? {remix:s.remix} : {}) })
const signature = (s) => JSON.stringify(config(s))
function asset(id, type) {
  const a = getDb().prepare('SELECT * FROM asset WHERE id=?').get(Number(id))
  fail(a && (type === 'image' ? /^image\/(png|jpeg|webp)$/.test(a.mime_type) : a.mime_type === 'video/mp4'), `Choose an existing local ${type}.`)
  localAssetPath(a.relative_path); return a
}
function stateOf(s) {
  const details = s.runId ? runDetails(s.runId) : null
  const activeProgress = a => {
    const p=parse(a.result_data).operatorProgress
    if (!p || a.failure_classification || !['Preparing references','Uploading references','Downloading'].includes(p.phase) || Date.now()-Date.parse(p.at)>600000) return null
    try { process.kill(p.pid,0); return p.phase } catch { return null }
  }
  const ambiguous = details?.attempts.some(a => a.reconciliation_status === 'reconciliation_required' && !(a.provider_status==='SUBMISSION_UNRESOLVED' && activeProgress(a))) || details?.run.jobs.some(j => /ambiguous_billing/.test(j.error_message || ''))
  // Keep a missing-file scene editable; preview reports the missing media and
  // approval/assembly validate its real local file before accepting it.
  const outputs = details?.assets ? [...details.assets].sort((a,b)=>(a.job_id-b.job_id)||(a.id-b.id)) : []
  const historyOutputs = (s.history || []).flatMap(entry => {
    if (entry.assetId) {
      const a = getDb().prepare('SELECT * FROM asset WHERE id=?').get(entry.assetId)
      return a ? [a] : []
    }
    if (entry.runId) {
      try { return runDetails(entry.runId).assets || [] } catch { return [] }
    }
    return []
  }).filter(a => s.kind === 'image' ? /^image\//.test(a.mime_type) : a.mime_type === 'video/mp4')
  const media = s.selectedAssetId ? getDb().prepare('SELECT * FROM asset WHERE id=?').get(s.selectedAssetId) : details?.finalAsset || (s.kind!=='image' && Number(s.quantity || 1)>1 && details?.run.status==='complete' ? outputs.find(a=>a.mime_type==='video/mp4') : null) || null
  const status = ambiguous ? 'Reconciliation required' : details?.run.status === 'failed' ? 'Failed' : details?.run.status === 'executing' ? (details.attempts.some(a => a.provider_status === 'IN_PROGRESS') ? 'Generating' : 'Queued') : media ? 'Complete' : details?.run.status === 'planned' ? 'Ready' : 'Ready'
  const current = !s.runId || s.generatedSignature === signature(s)
  const displayStatus=['Queued','Generating'].includes(status) ? details?.attempts.map(activeProgress).find(Boolean) || status : status
  return { ...s, quantity:Number(s.quantity ?? 1), status, displayStatus, current, media, outputs:outputs.length ? outputs : (media ? [media] : []), historyOutputs, approved: Boolean(s.approved && current && media), details }
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
  const capabilities = modelCapabilities()
  return { referenceRoles:REFERENCE_ROLES, remixModes:REMIX_MODES, models, capabilities, imageModels: capabilities.filter(m=>m.capability==='generate_image' && m.configured && m.priced), imageUnavailableReason: 'FLUX Schnell is text-only. Generate an image in Image, or upload/select a local product photo for image-to-video.', falConfigured: rates.video['seedance-2.0-fast-480p'].configured, fx: getFxRate('USD', 'EUR'), ffmpeg,
    quickSelections: { image: activeQuickSelection('image'), video: activeQuickSelection('video'), remix: activeQuickSelection('remix') },
    productTests: getDb().prepare('SELECT pt.id,p.name,pt.code FROM product_test pt JOIN product p ON p.id=pt.product_id ORDER BY pt.id DESC').all(),
    creatives: getDb().prepare('SELECT c.*,i.product_test_id FROM creative c JOIN iteration i ON i.id=c.iteration_id ORDER BY c.id DESC').all(),
    media: getDb().prepare("SELECT * FROM asset WHERE mime_type IN ('image/png','image/jpeg','image/webp','video/mp4','video/quicktime','audio/mpeg','audio/wav','audio/x-wav') ORDER BY id DESC").all().filter(a => { try { localAssetPath(a.relative_path); return true } catch { return false } }) }
}
export function createGeneratorCreative({ productTestId, angle, marketingStudioSessionId = null }) {
  fail(typeof angle === 'string' && angle.trim() && angle.length <= 300, 'Enter a Creative title / angle (up to 300 characters).')
  return getDb().transaction(() => {
    fail(getDb().prepare('SELECT id FROM product_test WHERE id=?').get(Number(productTestId)), 'Choose a Product Test.')
    const iterationId = getDb().prepare('SELECT id FROM iteration WHERE product_test_id=? ORDER BY number DESC LIMIT 1').get(Number(productTestId))?.id || pt.createIterationForTest({ productTestId: Number(productTestId), mode: 'exploratory' })
    if (marketingStudioSessionId) fail(getDb().prepare('SELECT id FROM marketing_studio_session WHERE id=?').get(marketingStudioSessionId), 'Studio session not found.')
    const creativeId = pt.createCreativeForIteration({ iterationId, angle: angle.trim(), format: 'Vertical ad', conceptSummary: angle.trim(), defaultProductionMethod: 'factory_generated', marketingStudioSessionId })
    return { creativeId }
  }).immediate()
}

export function createQuickGeneratorCreative({ workspace = 'video', title = '', source = 'ui' } = {}) {
  const kind = ['image', 'video', 'remix', 'studio', 'canvas'].includes(workspace) ? workspace : 'video'
  const label = String(title || '').trim().slice(0, 300) || `Quick ${kind.replace('_', ' ')} draft`
  const productId = createProduct({ name: 'Quick Create', notes: `Internal lineage for ${quickKey(kind)}. Not used as prompt context unless explicitly linked.` })
  const test = pt.createProductTestForProduct({ productId, market: 'FR', language: 'en', currency: 'EUR' })
  const iterationId = pt.createIterationForTest({
    productTestId: test.id,
    mode: 'exploratory',
    strategySnapshot: { purpose: 'Internal Quick Create lineage', workspace: kind },
  })
  const creativeId = pt.createCreativeForIteration({
    iterationId,
    angle: label,
    format: kind === 'image' ? 'Image generation' : 'Vertical media',
    conceptSummary: 'Quick Create draft. Prompt context is isolated from project/testing data.',
    defaultProductionMethod: 'factory_generated',
  })
  const result = { productTestId: test.id, iterationId, creativeId, quick: true }
  if (source === 'mcp') rememberQuickSelection(kind, result)
  return result
}
export function generatorWorkspace(id) {
  const state = read(id), c = creative(id)
  const recordedMinor = getDb().prepare('SELECT COALESCE(SUM(base_currency_amount_minor),0) AS minor FROM cost WHERE creative_id=?').get(Number(id)).minor
  return { ...state, creative: c, recordedMinor, scenes: state.scenes.map(stateOf), budget: getBudgetSummary(c.iteration_id), final: state.final ? { ...state.final, ...runDetails(state.final.runId) } : null }
}
export function promptForRemix(id, scene) {
  const c=creative(id), product=getDb().prepare('SELECT p.name FROM product p JOIN product_test pt ON pt.product_id=p.id JOIN iteration i ON i.product_test_id=pt.id WHERE i.id=?').get(c.iteration_id)
  return buildRemixPrompt(scene,product?.name || 'your product',c)
}
function normalizeScene(raw, previous) {
  const text = (value, max) => { fail(typeof value === 'string' && value.length <= max, 'Scene text is too long.'); return value }
  if (raw.kind === 'image') {
    const s = {id:previous?.id || randomUUID(),kind:'image',name:text(raw.name || 'Image',150),prompt:text(raw.prompt || '',6000),provider:raw.provider,model:raw.model || (raw.provider==='fal' ? 'flux-schnell' : 'mock-image'),mode:'text-to-image',imageSize:raw.imageSize || 'square_hd',outputFormat:raw.outputFormat || 'png',quantity:Number(raw.quantity ?? 1)}
    fail(Number.isInteger(s.quantity) && s.quantity>=1 && s.quantity<=4,'Choose 1–4 image outputs.')
    fail(!raw.startAssetId && !raw.referenceAssetIds?.length,'This image model cannot use reference photos. Use image-to-video or Remix.')
    validateProductionSteps(imageSteps({...s,prompt:s.prompt || 'Draft'}),{requireConfigured:false})
    return s
  }
  const s = { id: previous?.id || randomUUID(), name: text(raw.name || 'Scene', 150), prompt: text(raw.prompt || '', 6000), provider: raw.provider, mode: raw.mode, seconds: Number(raw.seconds), resolution: raw.resolution, aspectRatio: raw.aspectRatio, generateAudio: raw.generateAudio, startAssetId: raw.startAssetId ? Number(raw.startAssetId) : null, quantity:Number(raw.quantity ?? previous?.quantity ?? 1) }
  fail(Number.isInteger(s.quantity) && s.quantity>=1 && s.quantity<=4,'Choose 1–4 video outputs.')
  fail(['mock', 'fal'].includes(s.provider), 'Unsupported video model.')
  fail(['text-to-video', 'image-to-video', 'reference-to-video'].includes(s.mode), 'Choose a supported video mode.')
  if (s.mode === 'reference-to-video') s.remix = normalizeRemix(raw.remix)
  fail(Number.isInteger(s.seconds) && s.seconds >= 4 && s.seconds <= 15, 'Duration must be 4–15 whole seconds.')
  fail(['480p', '720p'].includes(s.resolution), 'Choose 480p or 720p.')
  fail((s.mode === 'reference-to-video' ? ['9:16','auto'] : ['9:16','16:9','1:1']).includes(s.aspectRatio), 'Choose a supported aspect ratio.')
  fail(typeof s.generateAudio === 'boolean', 'Choose whether to generate audio.')
  if (s.startAssetId) asset(s.startAssetId, 'image')
  return s
}
function imageSteps(s) {
  return Array.from({length:s.quantity},(_,i)=>({id:`${s.id}-${i+1}`,capability:'generate_image',provider:s.provider,model:s.model,prompt:s.prompt,params:{image_size:s.imageSize,output_format:s.outputFormat,num_images:1},dependencies:[]}))
}
function videoSteps(s) {
  const start = s.mode==='image-to-video' ? asset(s.startAssetId,'image') : null
  const params = { seconds:s.seconds, resolution:s.resolution, aspect_ratio:s.aspectRatio, generate_audio:s.generateAudio, ...(s.mode==='reference-to-video' ? remixParams(s) : {}), ...(start ? {start_frame:'/media/'+start.relative_path,needs_start_frame:true} : {}) }
  return Array.from({length:Number(s.quantity || 1)},(_,i)=>({id:`${s.id}-video-${i+1}`,capability:'generate_video',provider:s.provider,model:s.provider==='fal'?'seedance-2.0-fast':'mock-video',prompt:s.prompt,params:{...params},dependencies:[]}))
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
    if (s.kind === 'image') {
      try {
        const steps=validateProductionSteps(imageSteps({...s,prompt:s.prompt || 'Draft'})), costs=steps.map(priceProductionStep)
        const issue=costs.find(c=>c.unknown); if(issue) throw new Error(issue.reason)
        return {sceneId:s.id,minor:costs.reduce((n,c)=>n+c.minor,0),sourceMinor:costs.reduce((n,c)=>n+c.sourceMinor,0),sourceCurrency:costs[0].currency,sourceUsd:costs.reduce((n,c)=>n+(c.sourceUsd || 0),0),pricingBasis:'catalog_estimate',outputCount:s.quantity,rounding:'Each image is a separate Job; source and EUR cents round up conservatively.'}
      } catch(error) { return {sceneId:s.id,error:error.message} }
    }
    if (Number(s.quantity || 1)>1) {
      try {
        const steps=validateProductionSteps(videoSteps({...s,prompt:s.prompt || 'Draft'})), costs=steps.map(priceProductionStep)
        const issue=costs.find(c=>c.unknown); if(issue) throw new Error(issue.reason)
        return {sceneId:s.id,minor:costs.reduce((n,c)=>n+c.minor,0),sourceMinor:costs.reduce((n,c)=>n+c.sourceMinor,0),sourceCurrency:costs[0].currency,sourceUsd:costs.reduce((n,c)=>n+(c.sourceUsd ?? (c.currency==='USD'?c.costMinor/100:0)),0),inputSeconds:costs[0].inputSeconds,pricingBasis:costs[0].pricingBasis || 'catalog_estimate',geometryBasis:costs[0].geometryBasis,outputCount:s.quantity,rounding:'Each video output is one Job; source and EUR estimates are rounded per Job before summing.'}
      } catch(error) { return {sceneId:s.id,error:error.message} }
    }
    let refs = {}; try { if (s.mode === 'reference-to-video') refs=remixParams(s) } catch(error) { return {sceneId:s.id,error:error.message} }
    const cost = estimateVideoJobCost(s.provider === 'fal' ? 'seedance-2.0-fast' : 'mock', {...refs,seconds:s.seconds,resolution:s.resolution,aspect_ratio:s.aspectRatio})
    if (cost.unknown) return { sceneId: s.id, error: 'Provider not configured or model price unavailable.' }
    const fx = s.provider === 'mock' ? { rate: 1 } : getFxRate(cost.currency, 'EUR')
    return fx ? { sceneId: s.id, minor: Math.round(cost.costMinor * fx.rate), sourceMinor: cost.costMinor, sourceCurrency: cost.currency, inputSeconds:cost.inputSeconds, sourceUsd:cost.sourceUsd, pricingBasis:cost.pricingBasis, geometryBasis:cost.geometryBasis } : { sceneId: s.id, error: 'FX rate unavailable.' }
  })
  return { rows, totalMinor: rows.some(r => r.error) ? null : rows.reduce((sum,r) => sum+r.minor,0), budget: getBudgetSummary(c.iteration_id) }
}
function selectedScenes(state, ids) {
  fail(Array.isArray(ids) && ids.length && ids.length === new Set(ids).size, 'Select at least one unique scene.')
  const selected = ids.map(id => state.scenes.find(s => s.id === id)); fail(selected.every(Boolean), 'Scene not found.'); return selected
}
function referenceVersions(scenes) {
  const ids=[...new Set(scenes.flatMap(s=>[s.startAssetId,s.remix?.sourceAssetId,s.remix?.preparedAssetId,...(s.remix?.images||[]).map(i=>i.assetId),s.remix?.audioAssetId].filter(Boolean)))].sort((a,b)=>a-b)
  return ids.map(id=>{const a=getDb().prepare('SELECT * FROM asset WHERE id=?').get(id);fail(a,'Reference Asset is missing.');return {id,hash:createHash('sha256').update(fs.readFileSync(localAssetPath(a.relative_path))).digest('hex')}})
}
export function quoteGenerator(id, { revision, sceneIds }) {
  return getDb().transaction(() => {
    const state = read(id); version(state, revision)
    const selected = selectedScenes(state, sceneIds), c = creative(id)
    for (const s of selected) {
      editable(s); fail(s.prompt.trim(), 'Every scene needs a generation prompt.')
      if (s.mode === 'image-to-video') asset(s.startAssetId, 'image')
      if (s.mode === 'reference-to-video') remixParams(s)
    }
    const estimate = estimateGenerator(id, sceneIds); fail(estimate.totalMinor !== null, estimate.rows.find(r => r.error)?.error)
    const references=referenceVersions(selected)
    const runIds = selected.map(s => {
      const priceSignature=JSON.stringify({estimate:estimate.rows.find(r=>r.sceneId===s.id),fx:s.provider==='fal'?getFxRate('USD','EUR'):null,references})
      if (s.pendingRunId && runDetails(s.pendingRunId).run.status === 'planned' && s.pendingSignature === signature(s) && s.pendingPriceSignature===priceSignature) return s.pendingRunId
      s.pendingPriceSignature=priceSignature
      const start = s.mode === 'image-to-video' ? asset(s.startAssetId, 'image') : null
      if (s.kind === 'image') {
        const [runId]=pt.approveProductionPlan({plans:[{creativeId:Number(id),fineMethod:'ai_generated_image',coarseProductionMethod:'factory_generated',plannedProvider:s.provider,plannedModel:s.model,notes:'creative_generator_image',generationPlan:{steps:validateProductionSteps(imageSteps(s)),imageGenerations:s.quantity,videoClips:[],voiceRequired:false},estimatedCost:{minor:estimate.rows.find(r=>r.sceneId===s.id).sourceMinor,currency:s.provider==='fal'?'USD':'EUR'}}]})
        s.pendingRunId=runId;s.pendingSignature=signature(s);return runId
      }
      if (Number(s.quantity || 1)>1) {
        const [runId]=pt.approveProductionPlan({plans:[{creativeId:Number(id),fineMethod:'ai_generated_full',coarseProductionMethod:'factory_generated',plannedProvider:s.provider,plannedModel:s.provider==='fal'?'seedance-2.0-fast':'mock-video',notes:'creative_generator_scene',generationPlan:{steps:validateProductionSteps(videoSteps(s)),imageGenerations:0,videoClips:[],voiceRequired:false},estimatedCost:{minor:estimate.rows.find(r=>r.sceneId===s.id).sourceMinor,currency:s.provider==='fal'?'USD':'EUR'}}]})
        if(start)attachAssetLink(start.id,{productionRunId:runId},'start_frame')
        if(s.remix)for(const aid of [s.remix.sourceAssetId,s.remix.preparedAssetId,...s.remix.images.map(a=>a.assetId),s.remix.audioAssetId].filter(Boolean))attachAssetLink(aid,{productionRunId:runId},'remix_reference')
        s.pendingRunId=runId;s.pendingSignature=signature(s);return runId
      }
      const [runId] = pt.approveProductionPlan({ plans: [{ creativeId: Number(id), fineMethod: 'ai_generated_full', coarseProductionMethod: 'factory_generated', plannedProvider: s.provider, plannedModel: s.provider === 'fal' ? 'seedance-2.0-fast' : 'mock-video',
        notes: 'creative_generator_scene',
        generationPlan: { imageGenerations: 0, voiceRequired: false, videoClips: [{ prompt: s.prompt.trim(), purpose: 'video scene', seconds: s.seconds, resolution: s.resolution, aspect_ratio: s.aspectRatio, generate_audio: s.generateAudio, max_attempts:1, authorized_fx_signature:s.provider==='fal'?JSON.stringify(getFxRate('USD','EUR')):null,catalog_source_minor:estimate.rows.find(r=>r.sceneId===s.id).sourceMinor, ...(s.mode === 'reference-to-video' ? remixParams(s) : {}), ...(start ? { start_frame: '/media/' + start.relative_path } : {}) }] },
        estimatedCost: { minor: estimate.rows.find(r => r.sceneId === s.id).sourceMinor, currency: s.provider === 'fal' ? 'USD' : 'EUR' } }] })
      if (start) attachAssetLink(start.id, { productionRunId: runId }, 'start_frame')
      if (s.remix) for (const aid of [s.remix.sourceAssetId,s.remix.preparedAssetId,...s.remix.images.map(a=>a.assetId),s.remix.audioAssetId].filter(Boolean)) attachAssetLink(aid,{productionRunId:runId},'remix_reference')
      s.pendingRunId = runId; s.pendingSignature = signature(s)
      return runId
    })
    const preflight = preflightProduction(c.iteration_id, runIds)
    fail(preflight.readyCount === runIds.length && !preflight.blockedCount, preflight.runs.find(r => r.reason)?.reason || 'Production safety check failed.')
    fail(preflight.expectedTotalIfAllSucceedMinor <= preflight.budgetCeilingMinor, 'Insufficient budget. Increase the next iteration budget in Product Tests.')
    state.quote = { token: randomUUID(), sceneIds, runIds, totalMinor: preflight.newEstimatedPaidSpendMinor, estimateSignature:JSON.stringify(estimate.rows), fxSignature:selected.some(s=>s.provider==='fal') ? JSON.stringify(getFxRate('USD','EUR')) : null, outputCount:selected.reduce((n,s)=>n+Number(s.quantity || 1),0), attemptLimit:1, expiresAt: Date.now() + 300000, used: false }
    state.quote.referenceVersions=references
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
    fail(!q.referenceVersions || JSON.stringify(q.referenceVersions)===JSON.stringify(referenceVersions(selected)), 'Reference media changed. Request a fresh estimate and confirm again.')
    for (const [i, s] of selected.entries()) { editable(s); fail(s.pendingSignature === signature(s) && s.pendingRunId === q.runIds[i], 'Scene changed. Estimate again.') }
    const iterationId = creative(id).iteration_id, preflight = preflightProduction(iterationId, q.runIds)
    fail(preflight.readyCount === q.runIds.length && !preflight.blockedCount, 'Production preflight no longer passes.')
    fail(preflight.newEstimatedPaidSpendMinor === q.totalMinor, 'Price or FX changed. Request a fresh estimate and confirm again.')
    fail(!q.fxSignature || q.fxSignature === JSON.stringify(getFxRate('USD','EUR')), 'Price or FX changed. Request a fresh estimate and confirm again.')
    fail(!q.estimateSignature || q.estimateSignature === JSON.stringify(estimateGenerator(id,q.sceneIds).rows), 'Price changed. Request a fresh estimate and confirm again.')
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
      const a = asset(assetId, s.kind === 'image' ? 'image' : 'video')
      if (s.kind === 'image') {
        fail(stateOf(s).outputs.some(output=>output.id===a.id),'Choose an output from this image generation.')
        s.selectedAssetId=a.id;s.approved=false
        attachAssetLink(a.id,{creativeId:Number(id)},'image_output')
      } else if (s.runId && stateOf(s).outputs.some(output=>output.id===a.id)) {
        // Selecting another take from the same confirmed batch is free and
        // retains the run, frozen signature, and regeneration history.
        s.selectedAssetId=a.id;s.approved=false
        attachAssetLink(a.id,{creativeId:Number(id)},'scene_source')
      } else {
      if (s.runId || s.selectedAssetId) s.history = [...(s.history || []), { runId: s.runId || null, assetId: s.selectedAssetId || null }]
      s.selectedAssetId = a.id; s.runId = null; s.generatedSignature = signature(s); s.approved = false
      attachAssetLink(a.id, { creativeId: Number(id) }, 'scene_source')
      }
    }
    if (approved !== undefined) {
      fail(typeof approved === 'boolean', 'Approval must be explicit.')
      const live = stateOf(s); fail(!approved || (live.media && live.current && live.status === 'Complete'), 'Only the current completed scene can be approved.')
      if (approved) asset(live.media.id, s.kind === 'image' ? 'image' : 'video')
      s.approved = approved
    }
    state.quote = null; write(id, state); return generatorWorkspace(id)
  }).immediate()
}
export function reuseGeneratorScene(id, {revision,sceneId,targetCreativeId,newCreativeTitle}) {
  return getDb().transaction(()=>{
    const state=read(id);version(state,revision)
    const [source]=selectedScenes(state,[sceneId]);editable(source)
    const live=stateOf(source)
    fail(live.media && live.current && live.status==='Complete','Choose a completed, current scene to reuse.')
    const output=asset(live.media.id,'video'), owner=creative(id)
    const productTestId=getDb().prepare('SELECT product_test_id FROM iteration WHERE id=?').get(owner.iteration_id).product_test_id
    if (!targetCreativeId) targetCreativeId=createGeneratorCreative({productTestId,angle:newCreativeTitle}).creativeId
    const target=creative(targetCreativeId)
    fail(Number(target.id)!==Number(id),'Choose another Creative, or use the current scene controls.')
    fail(getDb().prepare('SELECT product_test_id FROM iteration WHERE id=?').get(target.iteration_id).product_test_id===productTestId,'Choose a Creative for the same Product Test.')
    const next=read(target.id)
    const existing=next.scenes.find(s=>s.reuseSource?.creativeId===Number(id) && s.reuseSource?.sceneId===sceneId && s.selectedAssetId===output.id)
    if (existing) return {creativeId:target.id,sceneId:existing.id,reused:true}
    fail(next.scenes.length<12,'The destination already has 12 scenes.')
    const copied={...config(source),id:randomUUID(),selectedAssetId:output.id,approved:false,reuseSource:{creativeId:Number(id),sceneId,runId:source.runId || null,assetId:output.id}}
    copied.generatedSignature=signature(copied)
    next.scenes.push(copied);next.quote=null;write(target.id,next)
    attachAssetLink(output.id,{creativeId:target.id},'scene_source')
    return {creativeId:target.id,sceneId:copied.id,reused:false}
  }).immediate()
}
export async function assembleGenerator(id, { revision }) {
  const runId = getDb().transaction(() => {
    const state = read(id); version(state, revision)
    const approved = state.scenes.map(stateOf).filter(s => s.approved && s.kind !== 'image')
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
