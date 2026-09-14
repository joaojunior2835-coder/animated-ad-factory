import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aaf-seedance-'))
const originalCwd = process.cwd()
const dbPath = path.join(tempRoot, 'factory.db')
const mediaRoot = path.join(tempRoot, 'local-media')
fs.mkdirSync(mediaRoot, { recursive: true })

process.env.FACTORY_DB_PATH = dbPath
process.env.REPLICATE_API_TOKEN = 'test-token-never-sent'
process.chdir(tempRoot)

const { runMigrations, openDatabase } = await import('../server/db/migrate.mjs')
runMigrations({ dbPath, log: { log() {}, error: console.error } })
const repo = await import('../server/db/repository.mjs')
const pt = await import('../server/db/productTestRepository.mjs')
const execution = await import('../server/lib/productionExecution.mjs')
const dispatcher = await import('../server/lib/dispatcher.mjs')
const replicate = await import('../server/providers/replicateVideoProvider.mjs')
const { getConfiguredRates } = await import('../server/lib/rateCatalog.mjs')

repo.setDb(openDatabase(dbPath))
const originalFetch = globalThis.fetch
const requests = []
let nextId = 1
replicate.setReplicateClientForTests({
  predictions: {
    async create(request) {
      requests.push(request)
      return { id: request.input.prompt.includes('fail') ? `fail-${nextId++}` : `success-${nextId++}` }
    },
    async get(id) {
      if (id.startsWith('fail-')) return { id, status: 'failed', error: 'mock Seedance failure' }
      return { id, status: 'succeeded', output: 'https://example.invalid/seedance.mp4' }
    },
  },
})
globalThis.fetch = async () => new Response(Buffer.from('mock-seedance-video'), {
  status: 200,
  headers: { 'content-type': 'video/mp4', 'content-length': '20' },
})

try {
  const textInput = replicate.buildReplicateVideoInput({
    model_id: 'seedance-2.0-fast', prompt: 'text mode', duration: 5,
    resolution: '480p', aspect_ratio: '9:16', generate_audio: true,
  })
  assert.deepEqual(textInput, {
    prompt: 'text mode', duration: 5, resolution: '480p', aspect_ratio: '9:16', generate_audio: true,
  })

  const frameBytes = Buffer.from('local-frame')
  fs.writeFileSync(path.join(mediaRoot, 'frame.png'), frameBytes)
  const imageInput = replicate.buildReplicateVideoInput({
    model_id: 'seedance-2.0-fast', prompt: 'image mode', start_frame: '/media/frame.png',
    duration: 5, resolution: '480p', aspect_ratio: '9:16', generate_audio: true, media_root: mediaRoot,
  })
  assert.ok(Buffer.isBuffer(imageInput.image))
  assert.deepEqual(imageInput.image, frameBytes)

  const rates = getConfiguredRates().video
  assert.equal(rates['seedance-2.0-fast-480p'].costPerSecondMinor, 7)
  assert.equal(rates['seedance-2.0-fast-720p'].costPerSecondMinor, 15)
  assert.equal(rates['seedance-2.0-fast-480p'].costPerSecondWithVideoInputMinor, 8)
  assert.equal(rates['seedance-2.0-fast-720p'].costPerSecondWithVideoInputMinor, 17)

  repo.setFxRate({ fromCurrency: 'USD', toCurrency: 'EUR', rate: 1, source: 'seedance-test' })
  const productId = repo.createProduct({ name: 'Seedance Test Product' })
  const test = pt.createProductTestForProduct({ productId, market: 'FR', language: 'fr' })
  const iterationId = pt.createIterationForTest({ productTestId: test.id, mode: 'exploratory', policyOverrides: { budgetCeilingMinor: 10000 } })

  const materializedCreative = pt.createCreativeForIteration({ iterationId, angle: 'materialize', format: 'short', defaultProductionMethod: 'factory_generated' })
  const materializedRun = pt.createProductionRunForCreative({ creativeId: materializedCreative, productionMethod: 'factory_generated' })
  repo.freezeProductionRunSpec(materializedRun, {
    schemaVersion: 1,
    planning: {
      plannedProvider: 'replicate', plannedModel: 'seedance-2.0-fast',
      estimatedGenerationCounts: { images: 0, videoClips: 1 },
      generationPlan: { imageGenerations: 0, videoClips: [{ prompt: 'survives materialization', purpose: 'hero', seconds: 5, resolution: '480p', aspect_ratio: '9:16', generate_audio: true, start_frame: '/media/frame.png' }], voiceRequired: false },
      requiredAssets: [],
    }, execution: null,
  })
  execution.materializeJobsForProductionRun(materializedRun)
  const materializedJob = repo.listJobsForProductionRun(materializedRun)[0]
  assert.equal(materializedJob.inputParams.prompt, 'survives materialization')
  assert.equal(materializedJob.inputParams.seconds, 5)
  assert.equal(materializedJob.inputParams.resolution, '480p')
  assert.equal(materializedJob.inputParams.aspect_ratio, '9:16')
  assert.equal(materializedJob.inputParams.start_frame, '/media/frame.png')
  repo.updateJobRuntime(materializedJob.id, { status: 'cancelled', completedAt: new Date().toISOString() })

  const dependencyCreative = pt.createCreativeForIteration({ iterationId, angle: 'dependency', format: 'short', defaultProductionMethod: 'factory_generated' })
  const dependencyRun = pt.createProductionRunForCreative({ creativeId: dependencyCreative, productionMethod: 'factory_generated' })
  const imageJobId = repo.createJob({ productionRunId: dependencyRun, capability: 'generate_image', provider: 'mock', inputParams: {} })
  repo.updateJobRuntime(imageJobId, { status: 'complete', completedAt: new Date().toISOString() })
  const asset = repo.getOrCreateAsset({
    contentHash: crypto.createHash('sha256').update(frameBytes).digest('hex'), relativePath: 'frame.png',
    mimeType: 'image/png', fileSize: frameBytes.length, source: 'generated', provider: 'mock',
  })
  repo.attachAssetLink(asset.id, { jobId: imageJobId }, 'job_output')
  const failedVideoJobId = repo.createJob({ productionRunId: dependencyRun, capability: 'generate_video', provider: 'replicate', inputParams: {
    model: 'seedance-2.0-fast', prompt: 'fail dependency request', seconds: 5, resolution: '480p', aspect_ratio: '9:16', generate_audio: true,
    needs_start_frame: true, estimated_cost_minor: 35, estimated_currency: 'USD',
  } })
  repo.createJobDependency({ jobId: failedVideoJobId, dependsOnJobId: imageJobId, dependencyType: 'start_frame' })
  repo.setProductionRunStatus(dependencyRun, 'executing')
  await dispatcher.dispatchProductionRun(dependencyRun)
  const dependencyRequest = requests.find((request) => request.input.prompt === 'fail dependency request')
  assert.equal(dependencyRequest.model, 'bytedance/seedance-2.0-fast')
  assert.ok(Buffer.isBuffer(dependencyRequest.input.image))
  assert.deepEqual(dependencyRequest.input.image, frameBytes)
  await dispatcher.reconcileInFlightJobs()
  assert.equal(repo.getJob(failedVideoJobId).status, 'failed')
  assert.equal(repo.getDb().prepare('SELECT status FROM budget_reservation WHERE job_id = ?').get(failedVideoJobId).status, 'released')

  const successCreative = pt.createCreativeForIteration({ iterationId, angle: 'success', format: 'short', defaultProductionMethod: 'factory_generated' })
  const successRun = pt.createProductionRunForCreative({ creativeId: successCreative, productionMethod: 'factory_generated' })
  const successJobId = repo.createJob({ productionRunId: successRun, capability: 'generate_video', provider: 'replicate', inputParams: {
    model: 'seedance-2.0-fast', prompt: 'successful text request', seconds: 5, resolution: '480p', aspect_ratio: '9:16', generate_audio: true,
    estimated_cost_minor: 35, estimated_currency: 'USD',
  } })
  repo.setProductionRunStatus(successRun, 'executing')
  await dispatcher.dispatchProductionRun(successRun)
  await dispatcher.reconcileInFlightJobs()
  assert.equal(repo.getJob(successJobId).status, 'complete')
  const outputAsset = repo.getJobAssetLink(successJobId)
  assert.ok(outputAsset)
  assert.match(outputAsset.relative_path, /^temp\/replicate-seedance-2-fast-/)
  assert.ok(fs.existsSync(path.join(mediaRoot, outputAsset.relative_path)))

  console.log('PASS  Seedance 2.0 Fast via Replicate: mapping, materialization, dependency, pricing, failure, local result')
} finally {
  replicate.setReplicateClientForTests(null)
  globalThis.fetch = originalFetch
  repo.closeDb()
  process.chdir(originalCwd)
  fs.rmSync(tempRoot, { recursive: true, force: true })
}
