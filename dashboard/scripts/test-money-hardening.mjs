// Regression proofs use fake fal clients/fetch and a disposable database only.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'aaf-money-redteam-'))
const cwd = process.cwd(), originalFetch = globalThis.fetch
process.env.FACTORY_DB_PATH = path.join(temp, 'factory.db')
process.env.FAL_API_KEY = 'not-a-real-key-redteam'
process.env.FACTORY_MEDIA_ROOT = path.join(temp, 'configured media')
const repo = await import('../server/db/repository.mjs')
const pt = await import('../server/db/productTestRepository.mjs')
const fal = await import('../server/providers/falProvider.mjs')
const dispatch = await import('../server/lib/dispatcher.mjs')
const execution = await import('../server/lib/productionExecution.mjs')
const { runMigrations, openDatabase } = await import('../server/db/migrate.mjs')
runMigrations({ dbPath: process.env.FACTORY_DB_PATH, log: { log() {} } })
repo.setDb(openDatabase(process.env.FACTORY_DB_PATH))
process.chdir(temp)
let passed = 0, failed = 0, submits = 0, mode = 'pending'
const fake = { queue: {
  async submit() {
    submits++
    await new Promise((resolve) => setTimeout(resolve, 20))
    if (mode === 'submit-unknown') throw new TypeError('fetch failed')
    return { request_id: `redteam-${submits}`, status: 'IN_QUEUE' }
  },
  async status() {
    if (mode === 'status-unknown') throw new TypeError('fetch failed')
    return { status: mode === 'pending' ? 'IN_PROGRESS' : 'COMPLETED' }
  },
  async result() { return { data: { video: { url: 'https://example.invalid/video.mp4' } } } },
}, storage: { async upload() { throw new Error('unexpected upload') } }, async subscribe() { throw new Error('direct paid bypass') } }
fal.setFalClientForTests(fake)
globalThis.fetch = async () => { throw new TypeError('fetch failed') }
async function check(name, fn) { try { await fn(); passed++; console.log('PASS ' + name) } catch (e) { failed++; console.error('FAIL ' + name + ': ' + e.message) } }
const held = (jobId) => {
  const reservation = repo.getDb().prepare('SELECT * FROM budget_reservation WHERE job_id=?').get(jobId)
  assert.equal(reservation.status, 'active')
  assert.equal(repo.getJob(jobId).retry_count, 0)
  assert.equal(repo.getDb().prepare('SELECT count(*) n FROM cost WHERE job_id=?').get(jobId).n, 0)
  assert.equal(repo.getDb().prepare('SELECT reconciliation_status FROM job_execution_attempt WHERE job_id=?').get(jobId).reconciliation_status, 'reconciliation_required')
}
try {
  repo.setFxRate({ fromCurrency: 'USD', toCurrency: 'EUR', rate: 0.86534, source: 'test' })
  await check('planning affordability converts USD to EUR and blocks missing FX/unknown costs', async () => {
    const { planningBudgetPreview } = await import('../server/lib/productionPlanner.mjs')
    const policy = { currency: 'EUR', budgetTargetMinor: 90, budgetCeilingMinor: 95 }
    assert.deepEqual(planningBudgetPreview(100, policy), { budgetCurrency: 'EUR', fxRate: 0.86534, totalBudgetMinor: 87, status: 'WITHIN_TARGET' })
    assert.equal(planningBudgetPreview(100, policy, true).status, 'UNKNOWN_COST')
    assert.equal(planningBudgetPreview(100, { ...policy, currency: 'GBP' }).status, 'FX_RATE_MISSING')
  })
  const productId = repo.createProduct({ name: 'Disposable money redteam' })
  const test = pt.createProductTestForProduct({ productId, market: 'FR', language: 'fr' })
  const iterationId = pt.createIterationForTest({ productTestId: test.id, mode: 'exploratory', policyOverrides: { budgetCeilingMinor: 10000 } })
  const make = () => {
    const creativeId = pt.createCreativeForIteration({ iterationId, angle: 'redteam', format: 'short', defaultProductionMethod: 'factory_generated' })
    const [runId] = pt.approveProductionPlan({ plans: [{ creativeId, coarseProductionMethod: 'factory_generated', plannedProvider: 'fal', plannedModel: 'seedance-2.0-fast', generationPlan: { videoClips: [{ prompt: 'local mock', seconds: 5, generate_audio: false, resolution: '480p', aspect_ratio: '9:16' }] } }] })
    repo.freezeProductionRunSpec(runId, repo.getProductionRunExecution(runId).specSnapshot)
    execution.materializeJobsForProductionRun(runId)
    return { runId, jobId: repo.listJobsForProductionRun(runId)[0].id }
  }
  await check('concurrent dispatch makes only one paid submission', async () => {
    mode = 'pending'; const { jobId } = make(), before = submits
    await Promise.allSettled([dispatch.dispatchJob(jobId), dispatch.dispatchJob(jobId)])
    assert.equal(submits - before, 1)
  })
  for (const scenario of ['submit-unknown', 'status-unknown', 'download-unknown']) await check(`${scenario} holds reservation without resubmission`, async () => {
    const { jobId } = make(); mode = scenario; const before = submits
    await dispatch.dispatchJob(jobId)
    const row = repo.getDb().prepare('SELECT * FROM job_execution_attempt WHERE job_id=?').get(jobId)
    if (row?.reconciliation_status === 'pending') await dispatch.reconcileAttempt({ ...row, provider: 'fal' })
    held(jobId)
    repo.closeDb(); repo.setDb(openDatabase(process.env.FACTORY_DB_PATH))
    held(jobId)
    if (scenario === 'submit-unknown') assert.match(repo.getDb().prepare('SELECT external_request_id FROM job_execution_attempt WHERE job_id=?').get(jobId).external_request_id, /^submission-unresolved:/)
    assert.equal(submits - before, 1)
  })
  await check('restarting completed production never changes its terminal status', async () => {
    const { runId, jobId } = make(); repo.updateJobRuntime(jobId, { status: 'complete' }); repo.setProductionRunStatus(runId, 'complete', true)
    await execution.startProduction(iterationId, [runId])
    assert.equal(repo.getProductionRunExecution(runId).status, 'complete')
  })
  await check('legacy direct fal calls are blocked outside M5 accounting', async () => {
    assert.equal((await fal.generateImage({ prompt: 'do not generate', confirmed: true })).reason, 'production_required')
    assert.equal((await fal.generateVideo({ prompt: 'do not generate', confirmed: true })).reason, 'production_required')
  })
  await check('unpriced Pollinations credit generation is blocked, not treated as free', async () => {
    const previousKey = process.env.POLLINATIONS_API_KEY, previousFetch = globalThis.fetch
    process.env.POLLINATIONS_API_KEY = 'fake-pollinations-test-key'
    let calls = 0; globalThis.fetch = async () => { calls++; throw new Error('must not call') }
    try {
      const { runPollinations } = await import('../server/providers/pollinationsProvider.mjs')
      const { estimateComponentCost } = await import('../server/lib/rateCatalog.mjs')
      assert.equal(estimateComponentCost('image', 'pollinations', 1).unknown, true)
      assert.match((await runPollinations({ action_type: 'generate_image', input_prompt: 'mock' })).error, /COST_UNKNOWN/)
      assert.equal(calls, 0)
    } finally { if (previousKey === undefined) delete process.env.POLLINATIONS_API_KEY; else process.env.POLLINATIONS_API_KEY = previousKey; globalThis.fetch = previousFetch }
  })
  await check('fal cannot submit Seedance with a free Mock price/model', async () => {
    const { runId, jobId } = make(), before = submits
    repo.getDb().prepare('UPDATE job SET input_params=? WHERE id=?').run(JSON.stringify({ ...JSON.parse(repo.getJob(jobId).input_params), model: 'mock' }), jobId)
    await dispatch.dispatchJob(jobId)
    assert.equal(submits, before)
    assert.equal(repo.getJob(jobId).error_message, 'PROVIDER_MODEL_MISMATCH')
    assert.equal(repo.getDb().prepare('SELECT count(*) n FROM budget_reservation WHERE job_id=?').get(jobId).n, 0)
    const run = repo.getProductionRunExecution(runId)
    repo.getDb().prepare('UPDATE production_run SET status=?,spec_snapshot=? WHERE id=?').run('planned', JSON.stringify({ ...run.specSnapshot, planning: { ...run.specSnapshot.planning, plannedModel: 'mock' } }), runId)
    assert.equal(execution.preflightProduction(iterationId, [runId]).runs[0].reason, 'PROVIDER_MODEL_MISMATCH')
  })
  await check('predispatch validation releases without any generation submission', async () => {
    const { jobId } = make(), before = submits
    repo.getDb().prepare('UPDATE job SET input_params=? WHERE id=?').run(JSON.stringify({ ...JSON.parse(repo.getJob(jobId).input_params), generate_audio: 'false' }), jobId)
    await dispatch.dispatchJob(jobId)
    assert.equal(submits, before)
    assert.equal(repo.getDb().prepare('SELECT status FROM budget_reservation WHERE job_id=?').get(jobId).status, 'released')
  })
  await check('concurrent settlement is idempotent and honors configured media root', async () => {
    const { jobId } = make(); mode = 'pending'
    await dispatch.dispatchJob(jobId)
    mode = 'complete'
    const previous = globalThis.fetch
    globalThis.fetch = async () => new Response(Buffer.from('mock media bytes'), { headers: { 'content-type': 'video/mp4' } })
    try {
      const row = repo.getDb().prepare('SELECT * FROM job_execution_attempt WHERE job_id=?').get(jobId)
      await Promise.all([dispatch.reconcileAttempt({ ...row, provider: 'fal' }), dispatch.reconcileAttempt({ ...row, provider: 'fal' })])
      assert.equal(repo.getDb().prepare('SELECT count(*) n FROM cost WHERE job_id=?').get(jobId).n, 1)
      assert.equal(repo.getDb().prepare('SELECT count(*) n FROM asset_link WHERE job_id=?').get(jobId).n, 1)
      const asset = repo.getJobAssetLink(jobId)
      assert.ok(fs.existsSync(path.join(process.env.FACTORY_MEDIA_ROOT, asset.relative_path)))
      assert.ok(!/^https?:/.test(asset.relative_path))
    } finally { globalThis.fetch = previous }
  })
  await check('installed SDK cannot retry queue.submit on HTTP 503 or transport failure', async () => {
    const { createFalClient } = await import('@fal-ai/client')
    const client = createFalClient({ credentials: 'fake', fetch: fal.singleSubmissionFetch })
    for (const outcome of ['http', 'network']) {
      let calls = 0
      globalThis.fetch = async () => { calls++; if (outcome === 'network') throw new TypeError('fetch failed'); return new Response(JSON.stringify({ detail: 'unavailable' }), { status: 503 }) }
      await assert.rejects(client.queue.submit(fal.FAL_SEEDANCE_ENDPOINTS.t2v, { input: { prompt: 'mock' } }))
      assert.equal(calls, 1)
    }
  })
} finally {
  fal.setFalClientForTests(null); globalThis.fetch = originalFetch; repo.closeDb(); process.chdir(cwd)
  fs.rmSync(temp, { recursive: true, force: true })
}
console.log(`Money hardening: ${passed} passed, ${failed} failed; zero real provider calls`)
if (failed) process.exitCode = 1
