import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aaf-seedance-fal-'))
const originalCwd = process.cwd()
const dbPath = path.join(tempRoot, 'factory.db')
const mediaRoot = path.join(tempRoot, 'local-media')
fs.mkdirSync(mediaRoot, { recursive: true })
process.env.FACTORY_DB_PATH = dbPath
process.env.FACTORY_MEDIA_ROOT = mediaRoot
process.env.FAL_API_KEY = 'test-token-never-sent'
process.chdir(tempRoot)

const { runMigrations, openDatabase } = await import('../server/db/migrate.mjs')
runMigrations({ dbPath, log: { log() {}, error: console.error } })
const repo = await import('../server/db/repository.mjs')
const pt = await import('../server/db/productTestRepository.mjs')
const execution = await import('../server/lib/productionExecution.mjs')
const dispatcher = await import('../server/lib/dispatcher.mjs')
const falProvider = await import('../server/providers/falProvider.mjs')
const { getConfiguredRates } = await import('../server/lib/rateCatalog.mjs')

repo.setDb(openDatabase(dbPath))
const originalFetch = globalThis.fetch
const submitted = []
const statusChecks = []
const resultChecks = []
const uploads = []
let nextId = 1
let expectedReservedJobId = null

const fakeFal = {
  storage: {
    async upload(blob) {
      uploads.push(Buffer.from(await blob.arrayBuffer()))
      return 'https://fal.media/input/frame.png'
    },
  },
  queue: {
    async submit(endpoint, options) {
      if (expectedReservedJobId) {
        const reservation = repo.getDb().prepare("SELECT status FROM budget_reservation WHERE job_id = ?").get(expectedReservedJobId)
        assert.equal(reservation?.status, 'active', 'budget must be reserved before fal submit')
      }
      submitted.push({ endpoint, options })
      return { request_id: `request-${nextId++}`, status: 'IN_QUEUE' }
    },
    async status(endpoint, options) {
      statusChecks.push({ endpoint, options })
      return { status: 'COMPLETED', request_id: options.requestId }
    },
    async result(endpoint, options) {
      resultChecks.push({ endpoint, options })
      return { requestId: options.requestId, data: { video: { url: 'https://fal.media/output/video.mp4' } } }
    },
  },
}
falProvider.setFalClientForTests(fakeFal)
globalThis.fetch = async () => new Response(Buffer.from('mock-seedance-video'), {
  status: 200,
  headers: { 'content-type': 'video/mp4', 'content-length': '20' },
})

try {
  const t2v = await falProvider.createFalSeedanceVideoJob({
    prompt: 'text mode', duration: 5, resolution: '480p', aspect_ratio: '9:16', generate_audio: true, confirmed: true,
  })
  assert.equal(submitted[0].endpoint, falProvider.FAL_SEEDANCE_ENDPOINTS.t2v)
  assert.deepEqual(submitted[0].options.input, { prompt: 'text mode', resolution: '480p', duration: 5, aspect_ratio: '9:16', generate_audio: true })
  assert.match(t2v.jobId, /^fal-seedance:t2v:request-1$/)

  const frameBytes = Buffer.from('local-frame')
  fs.writeFileSync(path.join(mediaRoot, 'frame.png'), frameBytes)
  const i2v = await falProvider.createFalSeedanceVideoJob({
    prompt: 'image mode', start_frame: '/media/frame.png', duration: 5, resolution: '480p', aspect_ratio: '9:16', generate_audio: true,
    media_root: mediaRoot, confirmed: true,
  })
  assert.equal(submitted[1].endpoint, falProvider.FAL_SEEDANCE_ENDPOINTS.i2v)
  assert.equal(submitted[1].options.input.image_url, 'https://fal.media/input/frame.png')
  assert.deepEqual(uploads[0], frameBytes)
  assert.ok(!JSON.stringify(submitted[1]).match(/localhost|127\.0\.0\.1/))

  const polled = await falProvider.getFalSeedanceVideoJob(i2v.jobId, { media_root: mediaRoot })
  assert.equal(statusChecks[0].endpoint, falProvider.FAL_SEEDANCE_ENDPOINTS.i2v)
  assert.equal(statusChecks[0].options.requestId, 'request-2')
  assert.equal(resultChecks.length, 1)
  assert.match(polled.result.local_url, /^\/media\/temp\/fal-seedance-2-fast-/)
  assert.ok(fs.existsSync(path.join(mediaRoot, polled.result.local_url.slice('/media/'.length))))

  const pendingFal = {
    ...fakeFal,
    queue: { ...fakeFal.queue, async status() { return { status: 'IN_PROGRESS' } }, async result() { throw new Error('result fetched before completion') } },
  }
  falProvider.setFalClientForTests(pendingFal)
  assert.equal((await falProvider.getFalSeedanceVideoJob(t2v.jobId, { media_root: mediaRoot })).status, 'IN_PROGRESS')
  falProvider.setFalClientForTests(fakeFal)

  const rates = getConfiguredRates().video
  assert.equal(rates['seedance-2.0-fast-480p'].costPerSecondMinor, 10.76)
  assert.equal(rates['seedance-2.0-fast-720p'].costPerSecondMinor, 24.19)
  assert.equal(rates['seedance-2.0-fast-480p'].configured, true)

  repo.setFxRate({ fromCurrency: 'USD', toCurrency: 'EUR', rate: 1, source: 'seedance-test' })
  const productId = repo.createProduct({ name: 'Seedance fal Test Product' })
  const test = pt.createProductTestForProduct({ productId, market: 'FR', language: 'fr' })
  const iterationId = pt.createIterationForTest({ productTestId: test.id, mode: 'exploratory', policyOverrides: { budgetCeilingMinor: 10000 } })
  const creativeId = pt.createCreativeForIteration({ iterationId, angle: 'fal', format: 'short', defaultProductionMethod: 'factory_generated' })
  const runId = pt.createProductionRunForCreative({ creativeId, productionMethod: 'factory_generated' })
  repo.freezeProductionRunSpec(runId, {
    schemaVersion: 1,
    planning: {
      plannedProvider: 'fal', plannedModel: 'seedance-2.0-fast',
      estimatedGenerationCounts: { images: 0, videoClips: 1 },
      generationPlan: { imageGenerations: 0, videoClips: [{ prompt: 'materialized fal clip', purpose: 'hero', seconds: 5, resolution: '480p', aspect_ratio: '9:16', generate_audio: false }], voiceRequired: false },
      requiredAssets: [],
    }, execution: null,
  })
  execution.materializeJobsForProductionRun(runId)
  const job = repo.listJobsForProductionRun(runId)[0]
  assert.equal(job.provider, 'fal')
  assert.deepEqual({ seconds: job.inputParams.seconds, resolution: job.inputParams.resolution, aspect_ratio: job.inputParams.aspect_ratio }, { seconds: 5, resolution: '480p', aspect_ratio: '9:16' })
  assert.equal(job.inputParams.generate_audio, false)
  assert.equal(job.inputParams.estimated_cost_minor, 54)

  const dependencyCreativeId = pt.createCreativeForIteration({ iterationId, angle: 'dependency', format: 'short', defaultProductionMethod: 'factory_generated' })
  const dependencyRunId = pt.createProductionRunForCreative({ creativeId: dependencyCreativeId, productionMethod: 'factory_generated' })
  const imageJobId = repo.createJob({ productionRunId: dependencyRunId, capability: 'generate_image', provider: 'mock', inputParams: {} })
  repo.updateJobRuntime(imageJobId, { status: 'complete', completedAt: new Date().toISOString() })
  const imageAsset = repo.getOrCreateAsset({
    contentHash: crypto.createHash('sha256').update(frameBytes).digest('hex'), relativePath: 'frame.png',
    mimeType: 'image/png', fileSize: frameBytes.length, source: 'generated', provider: 'mock',
  })
  repo.attachAssetLink(imageAsset.id, { jobId: imageJobId }, 'job_output')
  const dependencyVideoJobId = repo.createJob({ productionRunId: dependencyRunId, capability: 'generate_video', provider: 'fal', inputParams: {
    model: 'seedance-2.0-fast', prompt: 'dependency fal clip', seconds: 5, duration: 5, resolution: '480p', aspect_ratio: '9:16', generate_audio: true,
    needs_start_frame: true, estimated_cost_minor: 54, estimated_currency: 'USD',
  } })
  repo.createJobDependency({ jobId: dependencyVideoJobId, dependsOnJobId: imageJobId, dependencyType: 'start_frame' })
  repo.setProductionRunStatus(dependencyRunId, 'executing')
  expectedReservedJobId = dependencyVideoJobId
  const submitCount = submitted.length
  const uploadCount = uploads.length
  await dispatcher.dispatchProductionRun(dependencyRunId)
  expectedReservedJobId = null
  assert.equal(submitted.length, submitCount + 1)
  assert.equal(uploads.length, uploadCount + 1)
  assert.equal(submitted.at(-1).options.input.image_url, 'https://fal.media/input/frame.png')
  await dispatcher.reconcileInFlightJobs()
  assert.equal(submitted.length, submitCount + 1, 'polling must not redispatch')
  assert.equal(repo.getJob(dependencyVideoJobId).status, 'complete')
  assert.equal(repo.getDb().prepare('SELECT status FROM budget_reservation WHERE job_id = ?').get(dependencyVideoJobId).status, 'consumed')
  assert.ok(repo.getJobAssetLink(dependencyVideoJobId))

  const retryCreativeId = pt.createCreativeForIteration({ iterationId, angle: 'retry', format: 'short', defaultProductionMethod: 'factory_generated' })
  const retryRunId = pt.createProductionRunForCreative({ creativeId: retryCreativeId, productionMethod: 'factory_generated' })
  const retryJobId = repo.createJob({ productionRunId: retryRunId, capability: 'generate_video', provider: 'fal', inputParams: {
    model: 'seedance-2.0-fast', prompt: 'bounded retry', seconds: 5, resolution: '480p', aspect_ratio: '9:16', generate_audio: true,
    estimated_cost_minor: 54, estimated_currency: 'USD',
  } })
  let retrySubmits = 0
  falProvider.setFalClientForTests({ ...fakeFal, queue: { ...fakeFal.queue, async submit(endpoint, options) {
    retrySubmits += 1
    if (retrySubmits === 1) throw Object.assign(new Error('temporary fal failure'), { status: 503 })
    return fakeFal.queue.submit(endpoint, options)
  } } })
  repo.setProductionRunStatus(retryRunId, 'executing')
  await dispatcher.dispatchProductionRun(retryRunId)
  assert.equal(retrySubmits, 1, '503 submission outcome is unknown: never submit again')
  assert.equal(repo.getJob(retryJobId).retry_count, 0)
  await dispatcher.reconcileInFlightJobs()
  assert.equal(repo.getJob(retryJobId).status, 'generating')
  assert.equal(repo.getDb().prepare('SELECT status FROM budget_reservation WHERE job_id=?').get(retryJobId).status, 'active')
  assert.equal(retrySubmits, 1, 'unknown submission must require manual reconciliation')
  falProvider.setFalClientForTests(fakeFal)

  const ambiguousRunId = runId
  const ambiguousJobId = job.id
  const validationError = Object.assign(new Error(`Unprocessable Entity ${process.env.FAL_API_KEY}`), {
    name: 'ValidationError', status: 422, requestId: 'request-ambiguous',
    headers: { authorization: `Bearer ${process.env.FAL_API_KEY}` },
    body: { detail: [{
      input: { api_key: process.env.FAL_API_KEY },
      loc: ['body', 'generated_video'], msg: 'Output audio has sensitive content. Potential copyright violation.', type: 'content_policy_violation',
      ctx: { extra_info: { reason: 'partner_validation_failed', cause: 'copyright' } },
    }] },
  })
  let ambiguousSubmits = 0
  let ambiguousPolls = 0
  const ambiguousFal = {
    ...fakeFal,
    queue: {
      async submit(endpoint, options) {
        ambiguousSubmits += 1
        submitted.push({ endpoint, options })
        return { request_id: 'request-ambiguous', status: 'IN_QUEUE' }
      },
      async status() { ambiguousPolls += 1; return { status: 'COMPLETED', request_id: 'request-ambiguous' } },
      async result() { throw validationError },
    },
  }
  falProvider.setFalClientForTests(ambiguousFal)
  repo.setProductionRunStatus(ambiguousRunId, 'executing')
  const capturedProviderLogs = []
  const originalConsoleLog = console.log
  const originalConsoleError = console.error
  console.log = (...args) => capturedProviderLogs.push(args)
  console.error = (...args) => capturedProviderLogs.push(args)
  try {
    await dispatcher.dispatchProductionRun(ambiguousRunId)
    await dispatcher.reconcileInFlightJobs()
    await dispatcher.reconcileInFlightJobs()
  } finally {
    console.log = originalConsoleLog
    console.error = originalConsoleError
  }
  assert.equal(submitted.at(-1).options.input.generate_audio, false)
  const ambiguousJob = repo.getJob(ambiguousJobId)
  const ambiguousAttemptId = repo.getDb().prepare('SELECT id FROM job_execution_attempt WHERE job_id = ? AND dispatch_attempt = 1').get(ambiguousJobId).id
  const ambiguousAttempt = repo.getExecutionAttempt(ambiguousAttemptId)
  const ambiguousReservation = repo.getDb().prepare('SELECT * FROM budget_reservation WHERE job_id = ?').get(ambiguousJobId)
  assert.equal(ambiguousSubmits, 1, 'completed-result ambiguity must not submit again')
  assert.equal(ambiguousPolls, 1, 'manual reconciliation must not be automatically polled again')
  assert.equal(ambiguousJob.retry_count, 0, 'completed-result ambiguity must not retry')
  assert.equal(ambiguousJob.status, 'generating')
  assert.equal(ambiguousReservation.status, 'active', 'ambiguous billing must hold the reservation')
  assert.equal(repo.getDb().prepare('SELECT COUNT(*) AS n FROM cost WHERE job_id = ?').get(ambiguousJobId).n, 0)
  assert.equal(ambiguousAttempt.external_request_id, 'fal-seedance:t2v:request-ambiguous')
  assert.equal(ambiguousAttempt.reconciliation_status, 'reconciliation_required')
  assert.equal(ambiguousAttempt.provider_status, 'COMPLETED')
  assert.equal(ambiguousAttempt.failure_classification, 'ambiguous_billing')
  assert.equal(repo.getDb().prepare('SELECT COUNT(*) AS n FROM job_execution_attempt WHERE job_id = ?').get(ambiguousJobId).n, 1)
  assert.equal(ambiguousAttempt.resultData.provider_error.status, 422)
  assert.equal(ambiguousAttempt.resultData.provider_error.requestId, 'request-ambiguous')
  assert.equal(ambiguousAttempt.resultData.provider_error.message, 'Unprocessable Entity [REDACTED]')
  assert.deepEqual(ambiguousAttempt.resultData.provider_error.body.detail[0], {
    loc: ['body', 'generated_video'], msg: 'Output audio has sensitive content. Potential copyright violation.', type: 'content_policy_violation',
    ctx: { extra_info: { reason: 'partner_validation_failed', cause: 'copyright' } },
  })
  assert.ok(!JSON.stringify({ ambiguousJob, ambiguousAttempt, ambiguousReservation }).includes(process.env.FAL_API_KEY))
  assert.ok(!JSON.stringify(capturedProviderLogs).includes(process.env.FAL_API_KEY))

  const rejectedCreativeId = pt.createCreativeForIteration({ iterationId, angle: 'known pre-submit failure', format: 'short', defaultProductionMethod: 'factory_generated' })
  const rejectedRunId = pt.createProductionRunForCreative({ creativeId: rejectedCreativeId, productionMethod: 'factory_generated' })
  const rejectedJobId = repo.createJob({ productionRunId: rejectedRunId, capability: 'generate_video', provider: 'fal', inputParams: {
    model: 'seedance-2.0-fast', prompt: 'known pre-submit failure', seconds: 5, resolution: '480p', aspect_ratio: '9:16', generate_audio: false,
    estimated_cost_minor: 54, estimated_currency: 'USD',
  } })
  falProvider.setFalClientForTests({ ...fakeFal, queue: { ...fakeFal.queue, async submit() {
    throw Object.assign(new Error('request rejected before provider acceptance'), { failure_classification: 'non_retryable' })
  } } })
  repo.setProductionRunStatus(rejectedRunId, 'executing')
  await dispatcher.dispatchProductionRun(rejectedRunId)
  assert.equal(repo.getJob(rejectedJobId).status, 'failed')
  assert.equal(repo.getDb().prepare('SELECT status FROM budget_reservation WHERE job_id = ?').get(rejectedJobId).status, 'released')
  assert.equal(repo.getDb().prepare('SELECT COUNT(*) AS n FROM cost WHERE job_id = ?').get(rejectedJobId).n, 0)
  falProvider.setFalClientForTests(fakeFal)

  const submitBeforeConfirmationCheck = submitted.length
  await assert.rejects(() => falProvider.createFalSeedanceVideoJob({ prompt: 'no confirmation' }), /confirmation_required/)
  assert.equal(submitted.length, submitBeforeConfirmationCheck)

  console.log('PASS  Seedance 2.0 Fast via fal.ai: durable queue, upload, materialization, pricing, reservation, reconciliation, local result')
} finally {
  falProvider.setFalClientForTests(null)
  globalThis.fetch = originalFetch
  repo.closeDb()
  process.chdir(originalCwd)
  fs.rmSync(tempRoot, { recursive: true, force: true })
}
