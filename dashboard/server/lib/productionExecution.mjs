// M5 production-run materialization, preflight, start, and status derivation.
import { getDb } from '../db/repository.mjs'
import {
  createJob,
  createJobDependency,
  freezeProductionRunSpec,
  getProductionRunExecution,
  getBudgetSummary,
  getFxRate,
  listProductionRunStatusesForIteration,
  listJobsForProductionRun,
  setProductionRunStatus,
} from '../db/repository.mjs'
import { providerConfigured, providerModelIssue } from './providerAdapters.mjs'
import { getConfiguredRates, estimateComponentCost } from './rateCatalog.mjs'
import { dispatchProductionRun } from './dispatcher.mjs'

const BASE_CURRENCY = 'EUR'
const PAID_PROVIDERS = new Set(['replicate'])

function parseSnapshot(row) {
  try { return row && row.spec_snapshot ? JSON.parse(row.spec_snapshot) : null } catch { return null }
}

function runRow(runId) {
  const row = getDb().prepare(`SELECT pr.*, c.creative_code, c.iteration_id, i.execution_policy_snapshot
    FROM production_run pr JOIN creative c ON c.id = pr.creative_id
    JOIN iteration i ON i.id = c.iteration_id WHERE pr.id = ?`).get(runId)
  if (!row) throw new Error(`No production run with id ${runId}.`)
  return row
}

function generationPlan(snapshot) {
  const planning = snapshot && snapshot.planning || {}
  const gp = planning.generationPlan || {}
  return {
    imageGenerations: Math.max(0, Number(gp.imageGenerations ?? planning.estimatedGenerationCounts?.images) || 0),
    videoClips: Array.isArray(gp.videoClips) ? gp.videoClips : [],
    voiceRequired: gp.voiceRequired === true,
  }
}

function resolvedProvider(snapshot, capability) {
  const planning = snapshot && snapshot.planning || {}
  const requested = String(planning.plannedProvider || '').trim().toLowerCase()
  if (requested) return requested
  return capability === 'generate_video' ? 'mock' : capability === 'generate_image' ? 'mock' : ''
}

function resolvedModel(snapshot, capability, provider) {
  const planning = snapshot && snapshot.planning || {}
  const requested = String(planning.plannedModel || '').trim()
  if (requested) return requested
  if (provider === 'mock') return 'mock-video'
  if (provider === 'replicate') return 'ltx'
  if (provider === 'pollinations') return 'flux'
  return capability
}

function providerForPlan(snapshot, capability) {
  return resolvedProvider(snapshot, capability)
}

function videoRateKey(model, resolution = '480p') {
  return model === 'seedance-2.0-fast' ? `${model}-${resolution === '720p' ? '720p' : '480p'}` : model
}

function componentCost(capability, provider, model, quantity, options = {}) {
  if (provider === 'mock') return { minor: 0, currency: BASE_CURRENCY, paid: false, known: true }
  const key = capability === 'generate_video' ? videoRateKey(model, options.resolution) : provider
  const priced = estimateComponentCost(capability === 'generate_video' ? 'video' : 'image', key, quantity)
  if (priced.unknown) return { known: false, reason: priced.reason, paid: false }
  return { minor: priced.costMinor, currency: priced.currency, paid: priced.costMinor > 0, known: true }
}

/** Materialize exactly once from the approved planning snapshot. */
export function materializeJobsForProductionRun(productionRunId) {
  const run = runRow(productionRunId)
  if (run.spec_frozen_at === null) throw new Error(`Cannot materialize run ${productionRunId} before its spec is frozen.`)
  const existing = listJobsForProductionRun(productionRunId)
  if (existing.length) return { created: false, jobs: existing }
  const snapshot = parseSnapshot(run)
  const gp = generationPlan(snapshot)
  const db = getDb()
  const result = db.transaction(() => {
    if (listJobsForProductionRun(productionRunId).length) return []
    const jobs = []
    const imageProvider = providerForPlan(snapshot, 'generate_image')
    const imageModel = resolvedModel(snapshot, 'generate_image', imageProvider)
    for (let i = 0; i < gp.imageGenerations; i++) {
      const cost = componentCost('generate_image', imageProvider, imageModel, 1)
      jobs.push({
        id: createJob({ productionRunId, capability: 'generate_image', provider: imageProvider, inputParams: {
          model: imageModel, sequence: i + 1, estimated_cost_minor: cost.known ? cost.minor : 0,
          estimated_currency: cost.currency || null,
        } }),
        capability: 'generate_image',
      })
    }

    const videoProvider = providerForPlan(snapshot, 'generate_video')
    const videoModel = resolvedModel(snapshot, 'generate_video', videoProvider)
    for (let i = 0; i < gp.videoClips.length; i++) {
      const clip = gp.videoClips[i] || {}
      const isSeedance = videoModel === 'seedance-2.0-fast'
      const seconds = Number(clip.seconds) || (isSeedance ? 5 : 0)
      const resolution = ['480p', '720p'].includes(clip.resolution) ? clip.resolution : '480p'
      const aspectRatio = clip.aspect_ratio || clip.aspectRatio || (isSeedance ? '9:16' : '16:9')
      const startFrame = clip.start_frame || clip.startFrame || clip.image || null
      const needsStartFrame = Boolean(startFrame || clip.needs_start_frame || clip.needsStartFrame || /image|frame|start/i.test(String(clip.purpose || '')))
      const cost = componentCost('generate_video', videoProvider, videoModel, seconds, { resolution })
      const videoJobId = createJob({ productionRunId, capability: 'generate_video', provider: videoProvider, inputParams: {
        model: videoModel, sequence: i + 1, seconds, duration: seconds,
        prompt: clip.prompt || clip.purpose || '', purpose: clip.purpose || '',
        aspect_ratio: aspectRatio, resolution,
        generate_audio: clip.generate_audio ?? clip.generateAudio ?? (isSeedance ? true : undefined),
        start_frame: startFrame, needs_start_frame: needsStartFrame,
        estimated_cost_minor: cost.known ? cost.minor : 0, estimated_currency: cost.currency || null,
      } })
      jobs.push({ id: videoJobId, capability: 'generate_video', sequence: i + 1 })
      const imageDependency = jobs.find((job) => job.capability === 'generate_image')
      if (imageDependency && needsStartFrame && !startFrame) {
        createJobDependency({ jobId: videoJobId, dependsOnJobId: imageDependency.id, dependencyType: 'start_frame' })
      }
    }    // There is no voice provider in the current catalog. It is represented in
    // the execution snapshot as a skipped component, not as an executable Job.
    return jobs
  }).immediate()
  return { created: true, jobs: listJobsForProductionRun(productionRunId), createdCount: result.length }
}

function requiredAssetBlocked(run, snapshot) {
  const required = snapshot?.planning?.requiredAssets
  if (!Array.isArray(required) || required.length === 0) return null
  const count = getDb().prepare(`SELECT COUNT(*) AS n FROM asset_link al
    JOIN asset a ON a.id = al.asset_id
    WHERE al.creative_id = ? OR al.production_run_id = ?`).get(run.creative_id, run.id).n
  if (count < required.length) return 'REQUIRED_ASSET_MISSING'
  return null
}

function preflightOne(runId) {
  const run = runRow(runId)
  const snapshot = parseSnapshot(run)
  if (run.status === 'superseded') return { runId, creativeId: run.creative_id, state: 'BLOCKED', reason: 'SUPERSEDED' }
  if (run.status !== 'planned') return { runId, creativeId: run.creative_id, state: 'BLOCKED', reason: 'RUN_ALREADY_STARTED' }
  if (run.production_method === 'manual_external') return { runId, creativeId: run.creative_id, state: 'MANUAL_EXTERNAL', reason: 'MANUAL_EXTERNAL' }
  const gp = generationPlan(snapshot)
  if (!gp.imageGenerations && !gp.videoClips.length) return { runId, creativeId: run.creative_id, state: 'BLOCKED', reason: 'EMPTY_PRODUCTION_PLAN' }
  const capabilities = []
  if (gp.imageGenerations > 0) capabilities.push('generate_image')
  if (gp.videoClips.length > 0) capabilities.push('generate_video')
  if (gp.voiceRequired) capabilities.push('generate_voice')
  for (const capability of capabilities) {
    const provider = providerForPlan(snapshot, capability)
    if (!provider || !providerConfigured(provider)) return { runId, creativeId: run.creative_id, state: 'BLOCKED', reason: 'PROVIDER_NOT_CONFIGURED', capability, provider }
    if (capability === 'generate_voice') return { runId, creativeId: run.creative_id, state: 'BLOCKED', reason: 'PROVIDER_NOT_CONFIGURED', capability, provider }
    const modelIssue = providerModelIssue(capability, provider, resolvedModel(snapshot, capability, provider))
    if (modelIssue) return { runId, creativeId: run.creative_id, state: 'BLOCKED', reason: modelIssue, capability, provider }
  }
  const assetReason = requiredAssetBlocked(run, snapshot)
  if (assetReason) return { runId, creativeId: run.creative_id, state: 'BLOCKED', reason: assetReason }

  let estimatedPaidMinor = 0
  let currentFxRate = null
  let fxUpdatedAt = null
  const addCost = (capability, provider, model, qty) => {
    const cost = componentCost(capability, provider, model, qty)
    if (!cost.known) return { reason: cost.reason }
    if (cost.paid) {
      if (cost.currency !== BASE_CURRENCY) {
        const fx = getFxRate(cost.currency, BASE_CURRENCY)
        if (!fx) return { reason: 'FX_RATE_MISSING' }
        currentFxRate = fx.rate
        fxUpdatedAt = fx.updatedAt
        estimatedPaidMinor += Math.round(cost.minor * fx.rate)
      } else estimatedPaidMinor += cost.minor
    }
    return null
  }
  if (gp.imageGenerations) {
    const provider = providerForPlan(snapshot, 'generate_image')
    const model = resolvedModel(snapshot, 'generate_image', provider)
    const issue = addCost('generate_image', provider, model, gp.imageGenerations)
    if (issue) return { runId, creativeId: run.creative_id, state: 'BLOCKED', reason: issue.reason, currentFxRate, fxUpdatedAt }
  }
  for (const clip of gp.videoClips) {
    const provider = providerForPlan(snapshot, 'generate_video')
    const model = resolvedModel(snapshot, 'generate_video', provider)
    const issue = addCost('generate_video', provider, videoRateKey(model, clip.resolution), Number(clip.seconds) || (model === 'seedance-2.0-fast' ? 5 : 0))
    if (issue) return { runId, creativeId: run.creative_id, state: 'BLOCKED', reason: issue.reason, currentFxRate, fxUpdatedAt }
  }
  const originalEstimate = snapshot?.planning?.estimatedCost
  const originalMinor = originalEstimate && Number(originalEstimate.minor)
  const originalCurrency = originalEstimate && String(originalEstimate.currency || BASE_CURRENCY).toUpperCase()
  let originalEstimateBaseMinor = Number.isFinite(originalMinor) ? originalMinor : null
  if (originalEstimateBaseMinor !== null && originalCurrency !== BASE_CURRENCY) {
    const originalFx = getFxRate(originalCurrency, BASE_CURRENCY)
    originalEstimateBaseMinor = originalFx ? Math.round(originalEstimateBaseMinor * originalFx.rate) : null
  }
  const estimateChanged = originalEstimateBaseMinor !== null && originalEstimateBaseMinor > 0
    ? Math.abs(estimatedPaidMinor - originalEstimateBaseMinor) / originalEstimateBaseMinor > 0.1
    : false
  return { runId, creativeId: run.creative_id, state: 'READY', estimatedPaidMinor, originalEstimatedPaidMinor: originalEstimateBaseMinor, estimateChanged, currentFxRate, fxUpdatedAt, providerSummary: { video: providerForPlan(snapshot, 'generate_video') } }
}

export function preflightProduction(iterationId, selection) {
  const ids = selection === 'all_eligible' ? getDb().prepare(`SELECT pr.id FROM production_run pr JOIN creative c ON c.id = pr.creative_id WHERE c.iteration_id = ? AND pr.status = 'planned' AND pr.spec_frozen_at IS NULL`).all(iterationId).map((r) => Number(r.id)) : Array.isArray(selection) ? selection.map(Number) : []
  const runs = ids.map((id) => {
    const row = runRow(id)
    if (Number(row.iteration_id) !== Number(iterationId)) return { runId: id, creativeId: row.creative_id, state: 'BLOCKED', reason: 'RUN_NOT_IN_ITERATION' }
    return preflightOne(id)
  })
  const budget = getBudgetSummary(iterationId)
  const ready = runs.filter((r) => r.state === 'READY')
  const blocked = runs.filter((r) => r.state === 'BLOCKED')
  const manualExternal = runs.filter((r) => r.state === 'MANUAL_EXTERNAL')
  return {
    iterationId, runs, readyCount: ready.length, blockedCount: blocked.length, manualExternalCount: manualExternal.length,
    currentSettledSpendMinor: budget.currentSettledSpendMinor, activeReservedMinor: budget.activeReservedMinor,
    newEstimatedPaidSpendMinor: ready.reduce((sum, r) => sum + (r.estimatedPaidMinor || 0), 0),
    materiallyDifferentEstimateRuns: ready.filter((r) => r.estimateChanged).map((r) => r.runId),
    expectedTotalIfAllSucceedMinor: budget.currentSettledSpendMinor + budget.activeReservedMinor + ready.reduce((sum, r) => sum + (r.estimatedPaidMinor || 0), 0),
    budgetTargetMinor: budget.budgetTargetMinor, budgetCeilingMinor: budget.budgetCeilingMinor,
    currentFxRate: ready.find((r) => r.currentFxRate != null)?.currentFxRate || null,
    fxUpdatedAt: ready.find((r) => r.fxUpdatedAt)?.fxUpdatedAt || null,
  }
}

function executionSnapshot(run) {
  const snapshot = parseSnapshot(run) || {}
  const planning = snapshot.planning || {}
  const provider = String(planning.plannedProvider || 'mock').toLowerCase()
  const model = planning.plannedModel || (provider === 'mock' ? 'mock-video' : provider)
  const gp = generationPlan(snapshot)
  const voiceNote = gp.voiceRequired ? { code: 'PROVIDER_NOT_CONFIGURED', component: 'generate_voice' } : null
  return { ...snapshot, execution: { provider, model, settings: { productionMethod: run.production_method }, inputAssetIds: [], frozenAt: new Date().toISOString(), voiceNote } }
}

export async function startProduction(iterationId, runIds) {
  const outcomes = []
  for (const runId of Array.isArray(runIds) ? runIds.map(Number) : []) {
    try {
      const preflight = preflightOne(runId)
      const ownership = runRow(runId)
      if (Number(ownership.iteration_id) !== Number(iterationId)) {
        outcomes.push({ runId, outcome: 'skipped', state: 'BLOCKED', reason: 'RUN_NOT_IN_ITERATION' })
        continue
      }
      if (preflight.state === 'MANUAL_EXTERNAL') {
        setProductionRunStatus(runId, 'executing')
        outcomes.push({ runId, outcome: 'manual-external-marked-awaiting', state: 'AWAITING_EXTERNAL_PRODUCTION' })
        continue
      }
      if (preflight.state !== 'READY') {
        outcomes.push({ runId, outcome: 'skipped', state: 'BLOCKED', reason: preflight.reason })
        continue
      }
      const run = runRow(runId)
      if (run.spec_frozen_at === null) freezeProductionRunSpec(runId, executionSnapshot(run))
      materializeJobsForProductionRun(runId)
      setProductionRunStatus(runId, 'executing')
      const dispatch = await dispatchProductionRun(runId)
      outcomes.push({ runId, outcome: 'started', dispatch })
    } catch (error) {
      outcomes.push({ runId, outcome: 'skipped', state: 'BLOCKED', reason: error.message })
    }
  }
  return { iterationId, outcomes }
}

export function productionStatus(iterationId) {
  const rows = listProductionRunStatusesForIteration(iterationId)
  return rows.map((row) => {
    let state = 'Queued'
    if (row.production_method === 'manual_external' && row.status === 'executing') state = 'Awaiting external step'
    else if (row.reconciliation_required_count > 0 || row.needs_review_job_count > 0) state = 'Needs review'
    else if (row.fx_blocked_count > 0) state = 'FX blocked'
    else if (row.budget_blocked_count > 0) state = 'Budget blocked'
    else if (row.failed_job_count > 0 || row.status === 'failed') state = 'Failed'
    else if (row.status === 'complete') state = 'Succeeded'
    else if (row.job_count > 0 && row.complete_job_count === row.job_count) state = 'Awaiting assembly'
    else if (row.job_count > row.complete_job_count && row.job_count > 0 && row.generating_job_count === 0) state = 'Waiting on dependency'
    else if (row.generating_job_count > 0 || row.status === 'executing') state = 'Running'
    return { ...row, derivedState: state }
  })
}

export function currentRates() { return getConfiguredRates() }

export { preflightOne }
