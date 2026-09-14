// M5 bounded-retry verification. Mock-only; no network provider is reachable.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const dbPath = path.join(os.tmpdir(), `aaf-m5-retry-${Date.now()}.db`)
process.env.FACTORY_DB_PATH = dbPath
process.env.MOCK_VIDEO_DELAY_MS = '0'

const { runMigrations, openDatabase } = await import('../server/db/migrate.mjs')
runMigrations({ dbPath, log: { log: () => {}, error: console.error } })
const repo = await import('../server/db/repository.mjs')
const pt = await import('../server/db/productTestRepository.mjs')
const { dispatchProductionRun } = await import('../server/lib/dispatcher.mjs')

repo.setDb(openDatabase(dbPath))
try {
  const productId = repo.createProduct({ name: 'Retry Proof Product' })
  const test = pt.createProductTestForProduct({ productId, market: 'FR', language: 'fr' })
  const iterationId = pt.createIterationForTest({ productTestId: test.id, mode: 'exploratory', policyOverrides: { budgetCeilingMinor: 10000 } })

  const makeRun = (failure, key) => {
    const creativeId = pt.createCreativeForIteration({ iterationId, angle: failure, format: 'short', defaultProductionMethod: 'factory_generated' })
    const runId = pt.createProductionRunForCreative({ creativeId, productionMethod: 'factory_generated' })
    repo.freezeProductionRunSpec(runId, { schemaVersion: 1, planning: { plannedProvider: 'mock', plannedModel: 'mock-video', estimatedGenerationCounts: { images: 0, videoClips: 1 }, generationPlan: { imageGenerations: 0, videoClips: [{ seconds: 1, purpose: failure }], voiceRequired: false }, requiredAssets: [] }, execution: null })
    repo.createJob({ productionRunId: runId, capability: 'generate_video', provider: 'mock', inputParams: { model: 'mock-video', seconds: 1, prompt: failure, test_failure: failure, test_failure_key: key } })
    return runId
  }

  const retryRun = makeRun('transient_once', 'retry-once')
  const retryJob = repo.listJobsForProductionRun(retryRun)[0]
  await dispatchProductionRun(retryRun)
  assert.equal(repo.getJob(retryJob.id).status, 'complete')
  assert.equal(repo.getJob(retryJob.id).retry_count, 1)
  assert.equal(repo.getDb().prepare('SELECT COUNT(*) AS n FROM job_execution_attempt WHERE job_id = ?').get(retryJob.id).n, 1)

  const nonRetryRun = makeRun('non_retryable', 'non-retry')
  const nonRetryJob = repo.listJobsForProductionRun(nonRetryRun)[0]
  await dispatchProductionRun(nonRetryRun)
  assert.equal(repo.getJob(nonRetryJob.id).status, 'failed')
  assert.equal(repo.getJob(nonRetryJob.id).retry_count, 0)
  assert.equal(repo.getDb().prepare('SELECT COUNT(*) AS n FROM job_execution_attempt WHERE job_id = ?').get(nonRetryJob.id).n, 0)

  const ambiguousRun = makeRun('ambiguous_billing', 'ambiguous')
  const ambiguousJob = repo.listJobsForProductionRun(ambiguousRun)[0]
  await dispatchProductionRun(ambiguousRun)
  assert.equal(repo.getJob(ambiguousJob.id).status, 'failed')
  assert.equal(repo.getJob(ambiguousJob.id).retry_count, 0)
  assert.match(repo.getJob(ambiguousJob.id).error_message, /^ambiguous_billing:/)
  assert.equal(repo.getDb().prepare('SELECT COUNT(*) AS n FROM job_execution_attempt WHERE job_id = ?').get(ambiguousJob.id).n, 0)

  console.log('M5 bounded retry classification: PASS')
  console.log(JSON.stringify({ retryJob: retryJob.id, retryCount: 1, retryAttempts: 1, nonRetryJob: nonRetryJob.id, ambiguousJob: ambiguousJob.id }, null, 2))
} finally {
  repo.closeDb()
  fs.rmSync(dbPath, { force: true })
}
