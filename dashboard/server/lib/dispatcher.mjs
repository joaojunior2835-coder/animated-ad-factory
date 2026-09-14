// M5 bounded-concurrency dispatcher and restart-safe reconciliation.
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import {
  getDb,
  getJob,
  listEligibleJobs,
  updateJobRuntime,
  createExecutionAttempt,
  updateExecutionAttempt,
  listPendingExecutionAttempts,
  getExecutionAttempt,
  reserveBudget,
  settleJob,
  completeFreeJob,
  getJobAssetLink,
  listJobDependencies,
  getProductionRunExecution,
  attachAssetLink,
  getOrCreateAsset,
  setProductionRunFinalAsset,
  setProductionRunStatus,
} from '../db/repository.mjs'
import { getProviderAdapter, classifyProviderError } from './providerAdapters.mjs'
import { estimateComponentCost, getConfiguredRates } from './rateCatalog.mjs'
import { getFxRate } from '../db/repository.mjs'

const BASE_CURRENCY = 'EUR'
const DEFAULT_PAID_CONCURRENCY = 2
const DEFAULT_FREE_CONCURRENCY = 5
const DEFAULT_POLL_INTERVAL_MS = 10_000

function settingNumber(key, fallback) {
  const row = getDb().prepare('SELECT value FROM app_settings WHERE key = ?').get(key)
  if (!row) return fallback
  try {
    const value = JSON.parse(row.value)
    return Number.isFinite(Number(value)) && Number(value) > 0 ? Math.floor(Number(value)) : fallback
  } catch {
    return fallback
  }
}

function inputParams(job) {
  return job.inputParams || {}
}

function plannedCost(job) {
  const params = inputParams(job)
  if (job.capability === 'generate_video') return estimateComponentCost('video', job.providerModel || params.model || 'mock', params.seconds || 0)
  if (job.capability === 'generate_image') return estimateComponentCost('image', job.providerModel || params.model || 'pollinations', 1)
  return { unknown: true, reason: `unpriceable_capability:${job.capability}` }
}

function costForJob(job) {
  const params = inputParams(job)
  const provider = String(job.provider || '').toLowerCase()
  if (provider === 'mock') return { unknown: false, minor: 0, currency: BASE_CURRENCY }
  const model = String(params.model || '').toLowerCase()
  const videoModelKey = model === 'seedance-2.0-fast'
    ? `${model}-${params.resolution === '720p' ? '720p' : '480p'}`
    : model
  const priced = job.capability === 'generate_video'
    ? estimateComponentCost('video', videoModelKey === 'mock-video' ? 'mock' : videoModelKey, params.seconds || params.duration || 0)
    : job.capability === 'generate_image'
      ? estimateComponentCost('image', provider, 1)
      : { unknown: true, reason: `unpriceable_capability:${job.capability}` }
  if (priced.unknown) return { unknown: true, reason: priced.reason }
  return { unknown: false, minor: priced.costMinor, currency: priced.currency }
}

function dependencyInputs(job) {
  if (job.capability !== 'generate_video' || !job.inputParams?.needs_start_frame || job.inputParams.start_frame) return {}
  const dependency = listJobDependencies(job.id).find((row) => row.dependency_type === 'start_frame')
  if (!dependency) return {}
  const asset = getJobAssetLink(dependency.depends_on_job_id)
  if (!asset || !asset.relative_path) return {}
  return { start_frame: `/media/${String(asset.relative_path).replace(/\\/g, '/')}` }
}

function nowIso() { return new Date().toISOString() }

function mediaFileForResult(result) {
  const local = String(result && result.local_url || '')
  if (!local) return null
  if (local === '/mock-video-output.mp4') return { path: path.resolve(process.cwd(), 'public', 'mock-video-output.mp4'), relativePath: 'mock-video-output.mp4' }
  if (local.startsWith('/media/')) {
    const relativePath = decodeURIComponent(local.slice('/media/'.length))
    const mediaRoot = path.resolve(process.cwd(), 'local-media')
    const filePath = path.resolve(mediaRoot, relativePath)
    const prefix = mediaRoot.endsWith(path.sep) ? mediaRoot : mediaRoot + path.sep
    if (!filePath.startsWith(prefix)) return null
    return { path: filePath, relativePath: relativePath.replace(/\\/g, '/') }
  }
  return null
}

function attachResult(job, result) {
  if (!result || getJobAssetLink(job.id)) return null
  const file = mediaFileForResult(result)
  if (!file || !fs.existsSync(file.path)) return null
  const bytes = fs.readFileSync(file.path)
  const contentHash = createHash('sha256').update(bytes).digest('hex')
  const asset = getOrCreateAsset({
    contentHash,
    relativePath: file.relativePath,
    mimeType: result.mime_type || (job.capability === 'generate_video' ? 'video/mp4' : 'image/png'),
    fileSize: bytes.length,
    durationSeconds: job.capability === 'generate_video' ? Number(inputParams(job).seconds) || null : null,
    source: 'generated',
    provider: job.provider,
  })
  attachAssetLink(asset.id, { jobId: job.id }, 'job_output')
  return asset.id
}

function isSingleDirectOutput(run) {
  const planning = run.specSnapshot && run.specSnapshot.planning || {}
  const counts = planning.estimatedGenerationCounts || {}
  const voiceRequired = !!(planning.generationPlan && planning.generationPlan.voiceRequired)
  return Number(counts.images || 0) === 0 && Number(counts.videoClips || 0) === 1 && !voiceRequired
}

function maybeFinishRun(productionRunId) {
  const run = getProductionRunExecution(productionRunId)
  if (!run) return
  const jobs = run.jobs || []
  if (!jobs.length) return
  if (jobs.some((job) => job.status === 'generating' || job.status === 'planned')) {
    setProductionRunStatus(productionRunId, 'executing')
    return
  }
  if (jobs.some((job) => job.status === 'failed')) {
    setProductionRunStatus(productionRunId, 'failed', true)
    return
  }
  if (jobs.every((job) => job.status === 'complete')) {
    if (isSingleDirectOutput(run)) {
      const output = jobs.find((job) => getJobAssetLink(job.id))
      const asset = output && getJobAssetLink(output.id)
      if (asset) setProductionRunFinalAsset(productionRunId, asset.id)
    }
    // Multi-component runs intentionally remain executing until M6 assembly.
    if (isSingleDirectOutput(run)) setProductionRunStatus(productionRunId, 'complete', true)
    else setProductionRunStatus(productionRunId, 'executing')
  }
}

function reservationFor(jobId, dispatchAttempt) {
  return getDb().prepare('SELECT * FROM budget_reservation WHERE job_id = ? AND dispatch_attempt = ?').get(jobId, dispatchAttempt)
}

async function reconcileAttempt(attempt, { allowRetry = true } = {}) {
  const adapter = getProviderAdapter(attempt.provider)
  let checked
  try {
    checked = await adapter.checkStatus(attempt.external_request_id)
    updateExecutionAttempt(attempt.id, { providerStatus: checked.providerStatus, lastCheckedAt: nowIso() })
  } catch (error) {
    const classification = classifyProviderError(error, attempt.provider)
    updateExecutionAttempt(attempt.id, { lastCheckedAt: nowIso(), failureClassification: classification, errorMessage: error.message })
    if (error.requestUnknown) {
      updateExecutionAttempt(attempt.id, { reconciliationStatus: 'reconciliation_required' })
      return { status: 'reconciliation_required', jobId: attempt.job_id }
    }
    return handleFailure(attempt, classification, error.message, { allowRetry })
  }

  if (checked.status === 'pending') return { status: 'pending', jobId: attempt.job_id }
  if (checked.status === 'failed') {
    const error = new Error(`Provider reported failure (${checked.providerStatus || 'failed'}).`)
    const classification = classifyProviderError(error, attempt.provider)
    return handleFailure(attempt, classification, error.message, { allowRetry })
  }

  const job = getJob(attempt.job_id)
  const result = adapter.extractResult(checked.resultData || attempt.resultData)
  updateExecutionAttempt(attempt.id, { resultData: result, reconciliationStatus: 'reconciled', lastCheckedAt: nowIso() })
  const assetId = attachResult(job, result)
  const reservation = reservationFor(job.id, attempt.dispatch_attempt)
  if (reservation) {
    const planned = Number(reservation.original_amount_minor) || 0
    const actual = adapter.getActualCost(result)
    const amount = actual === null ? planned : actual
    const fx = Number(reservation.fx_rate)
    settleJob({
      jobId: job.id,
      reservationId: reservation.id,
      success: true,
      actualAmountMinor: amount,
      actualCurrency: reservation.original_currency,
      fxRate: fx,
      fxRateSource: reservation.fx_rate_source,
      fxRateCapturedAt: reservation.fx_rate_captured_at,
    })
  } else {
    completeFreeJob({ jobId: job.id, success: true })
  }
  if (assetId) maybeFinishRun(job.production_run_id)
  else maybeFinishRun(job.production_run_id)
  return { status: 'complete', jobId: job.id, assetId }
}

async function handleFailure(attempt, classification, message, { allowRetry }) {
  updateExecutionAttempt(attempt.id, { failureClassification: classification, errorMessage: message, reconciliationStatus: 'reconciled', lastCheckedAt: nowIso() })
  const job = getJob(attempt.job_id)
  const reservation = reservationFor(job.id, attempt.dispatch_attempt)
  if (reservation) {
    settleJob({
      jobId: job.id,
      reservationId: reservation.id,
      success: false,
      actualAmountMinor: 0,
      actualCurrency: reservation.original_currency,
      fxRate: Number(reservation.fx_rate),
      fxRateSource: reservation.fx_rate_source,
      fxRateCapturedAt: reservation.fx_rate_captured_at,
    })
  } else {
    completeFreeJob({ jobId: job.id, success: false, errorMessage: `${classification}: ${message}` })
  }
  if (classification === 'transient_retryable' && allowRetry && Number(job.retry_count) === 0) {
    updateJobRuntime(job.id, { status: 'planned', retryCount: 1, errorMessage: message, completedAt: null })
    await dispatchJob(job.id, { retry: true })
    return { status: 'retried', jobId: job.id }
  }
  updateJobRuntime(job.id, { status: 'failed', errorMessage: `${classification}: ${message}` })
  maybeFinishRun(job.production_run_id)
  return { status: 'failed', jobId: job.id, classification }
}

async function dispatchJob(jobId) {
  const job = getJob(jobId)
  if (!job || job.status !== 'planned') return { status: 'skipped', jobId }
  const params = inputParams(job)
  const adapter = getProviderAdapter(job.provider)
  const attemptNumber = Number(job.retry_count || 0) + 1
  const cost = costForJob(job)
  let reservation = null

  if (cost.unknown) {
    updateJobRuntime(job.id, { status: 'failed', errorMessage: cost.reason, completedAt: nowIso() })
    maybeFinishRun(job.production_run_id)
    return { status: 'failed', jobId, reason: cost.reason }
  }
  if (cost.minor > 0) {
    if (cost.currency !== BASE_CURRENCY) {
      const fx = getFxRate(cost.currency, BASE_CURRENCY)
      if (!fx) {
        updateJobRuntime(job.id, { status: 'failed', errorMessage: 'FX_RATE_MISSING', completedAt: nowIso() })
        maybeFinishRun(job.production_run_id)
        return { status: 'failed', jobId, reason: 'FX_RATE_MISSING' }
      }
      reservation = reserveBudget({
        jobId, dispatchAttempt: attemptNumber, originalAmountMinor: cost.minor, originalCurrency: cost.currency,
        fxRate: fx.rate, fxRateSource: fx.source || 'app_settings', fxRateCapturedAt: fx.updatedAt || nowIso()
      })
    } else {
      reservation = reserveBudget({ jobId, dispatchAttempt: attemptNumber, originalAmountMinor: cost.minor, originalCurrency: cost.currency, fxRate: 1, fxRateSource: 'base_currency', fxRateCapturedAt: nowIso() })
    }
    if (!reservation.allowed) {
      updateJobRuntime(job.id, { status: 'failed', errorMessage: 'BUDGET_BLOCKED', completedAt: nowIso() })
      maybeFinishRun(job.production_run_id)
      return { status: 'failed', jobId, reason: 'BUDGET_BLOCKED' }
    }
  }

  let dispatched
  try {
    dispatched = await adapter.dispatch({
      ...params,
      ...dependencyInputs(job),
      provider: job.provider,
      model_id: params.model || job.providerModel,
      action_type: job.capability,
      input_prompt: params.input_prompt || params.prompt || params.output_prompt || `Production ${job.capability} ${params.sequence || ''}`,
      prompt: params.prompt || params.output_prompt || `Production ${job.capability} ${params.sequence || ''}`,
      duration: params.seconds,
    })
  } catch (error) {
    if (reservation) {
      const classification = classifyProviderError(error, job.provider)
      await handleFailure({ id: 0, job_id: job.id, dispatch_attempt: attemptNumber, provider: job.provider, resultData: null }, classification, error.message, { allowRetry: true })
    } else {
      const classification = classifyProviderError(error, job.provider)
      if (classification === 'transient_retryable' && Number(job.retry_count) === 0) {
        updateJobRuntime(job.id, { status: 'planned', retryCount: 1, errorMessage: error.message })
        return dispatchJob(job.id)
      }
      updateJobRuntime(job.id, { status: 'failed', errorMessage: `${classification}: ${error.message}`, completedAt: nowIso() })
      maybeFinishRun(job.production_run_id)
    }
    return { status: 'failed', jobId, reason: error.message }
  }

  const externalId = dispatched.externalRequestId
  if (!externalId) {
    const error = new Error('Provider did not return an external request id.')
    if (reservation) return handleFailure({ id: 0, job_id: job.id, dispatch_attempt: attemptNumber, provider: job.provider, resultData: null }, 'ambiguous_billing', error.message, { allowRetry: false })
    updateJobRuntime(job.id, { status: 'failed', errorMessage: error.message, completedAt: nowIso() })
    return { status: 'failed', jobId }
  }
  // externalRequestId/providerStatus are recorded on job_execution_attempt
  // only (the source of truth) — job itself just needs its own status/timestamp.
  createExecutionAttempt({ jobId: job.id, dispatchAttempt: attemptNumber, externalRequestId: externalId, providerStatus: dispatched.initialStatus, resultData: dispatched.resultData || null })
  updateJobRuntime(job.id, { status: 'generating', startedAt: nowIso() })
  const attempt = getDb().prepare(`SELECT a.*, j.provider, j.production_run_id, j.capability, j.input_params
    FROM job_execution_attempt a JOIN job j ON j.id = a.job_id
    WHERE a.job_id = ? AND a.dispatch_attempt = ?`).get(job.id, attemptNumber)
  if (dispatched.initialStatus === 'complete') return reconcileAttempt({ ...attempt, inputParams: params, resultData: dispatched.resultData }, { allowRetry: true })
  return { status: 'dispatched', jobId, externalRequestId: externalId }
}

export async function dispatchProductionRun(productionRunId) {
  const outcomes = []
  // A synchronous provider may unlock a dependent Job immediately. Keep
  // walking the dependency graph until no newly-eligible planned Jobs remain;
  // async providers simply stop here and the poller resumes the walk later.
  while (true) {
    const jobs = listEligibleJobs(productionRunId)
    if (!jobs.length) break
    const paid = jobs.filter((job) => Number(job.inputParams && job.inputParams.estimated_cost_minor || 0) > 0 || ['replicate'].includes(job.provider))
    const free = jobs.filter((job) => !paid.includes(job))
    const paidLimit = settingNumber('production_paid_concurrency', DEFAULT_PAID_CONCURRENCY)
    const freeLimit = settingNumber('production_free_concurrency', DEFAULT_FREE_CONCURRENCY)
    let pass = []
    for (let i = 0; i < paid.length; i += paidLimit) pass.push(...await Promise.all(paid.slice(i, i + paidLimit).map((j) => dispatchJob(j.id))))
    for (let i = 0; i < free.length; i += freeLimit) pass.push(...await Promise.all(free.slice(i, i + freeLimit).map((j) => dispatchJob(j.id))))
    outcomes.push(...pass)
    // Planned jobs may remain because a dependency is still pending, or
    // because every current job became terminal. Either way the next query is
    // the authoritative stop condition.
  }
  return outcomes
}

export async function reconcileInFlightJobs() {
  const pending = listPendingExecutionAttempts()
  const outcomes = []
  const runIds = new Set()
  for (const attempt of pending) {
    runIds.add(Number(attempt.production_run_id))
    outcomes.push(await reconcileAttempt(attempt, { allowRetry: true }))
  }
  // Reconciliation can complete a dependency. Walk each affected run once so
  // synchronous Mock/Pollinations providers unlock their dependants without
  // waiting for another external event.
  for (const runId of runIds) outcomes.push(...(await dispatchProductionRun(runId)))
  return outcomes
}

let poller = null
export function startExecutionPoller(intervalMs = Number(process.env.PRODUCTION_POLL_INTERVAL_MS) || DEFAULT_POLL_INTERVAL_MS) {
  if (poller) return poller
  poller = setInterval(() => { reconcileInFlightJobs().catch((error) => console.error('[dispatcher] reconciliation failed:', error.message)) }, intervalMs)
  if (poller.unref) poller.unref()
  return poller
}

export function stopExecutionPoller() {
  if (poller) clearInterval(poller)
  poller = null
}

export function getDispatcherConstants() {
  return { paidConcurrency: settingNumber('production_paid_concurrency', DEFAULT_PAID_CONCURRENCY), freeConcurrency: settingNumber('production_free_concurrency', DEFAULT_FREE_CONCURRENCY), pollIntervalMs: Number(process.env.PRODUCTION_POLL_INTERVAL_MS) || DEFAULT_POLL_INTERVAL_MS, rates: getConfiguredRates() }
}

export { dispatchJob, reconcileAttempt, maybeFinishRun }
