// M5 restart reconciliation proof. Mock only; no network provider is reachable.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const dbPath = path.join(os.tmpdir(), `aaf-m5-restart-${Date.now()}.db`)
process.env.FACTORY_DB_PATH = dbPath
process.env.MOCK_VIDEO_DELAY_MS = '120'

const { runMigrations, openDatabase } = await import('../server/db/migrate.mjs')
runMigrations({ dbPath, log: { log: () => {}, error: console.error } })
const repo = await import('../server/db/repository.mjs')
const pt = await import('../server/db/productTestRepository.mjs')
const { materializeJobsForProductionRun } = await import('../server/lib/productionExecution.mjs')
const dispatcher = await import('../server/lib/dispatcher.mjs')

repo.setDb(openDatabase(dbPath))
try {
  const productId = repo.createProduct({ name: 'Restart Proof Product' })
  const test = pt.createProductTestForProduct({ productId, market: 'FR', language: 'fr' })
  const iterationId = pt.createIterationForTest({ productTestId: test.id, mode: 'exploratory', policyOverrides: { budgetCeilingMinor: 10000 } })
  const creativeId = pt.createCreativeForIteration({ iterationId, angle: 'restart', format: 'short', defaultProductionMethod: 'factory_generated' })
  const runId = pt.createProductionRunForCreative({ creativeId, productionMethod: 'factory_generated' })
  repo.freezeProductionRunSpec(runId, {
    schemaVersion: 1,
    planning: {
      plannedProvider: 'mock', plannedModel: 'mock-video',
      estimatedGenerationCounts: { images: 0, videoClips: 1 },
      generationPlan: { imageGenerations: 0, videoClips: [{ seconds: 1, purpose: 'restart proof' }], voiceRequired: false },
      requiredAssets: [],
    }, execution: null,
  })
  materializeJobsForProductionRun(runId)
  const job = repo.listJobsForProductionRun(runId)[0]
  const firstDispatch = await dispatcher.dispatchProductionRun(runId)
  assert.equal(firstDispatch.length, 1)
  const beforeRestart = repo.listPendingExecutionAttempts()
  assert.equal(beforeRestart.length, 1)
  assert.ok(beforeRestart[0].external_request_id)
  assert.equal(beforeRestart[0].reconciliation_status, 'pending')

  // Simulate process death: close the connection and reopen only the durable
  // DB. The provider request id remains the persisted source of truth.
  repo.closeDb()
  repo.setDb(openDatabase(dbPath))
  const afterRestartBeforeCompletion = await dispatcher.reconcileInFlightJobs()
  assert.equal(repo.listPendingExecutionAttempts().length, 1)
  assert.equal(repo.getJob(job.id).status, 'generating')
  assert.ok(afterRestartBeforeCompletion.some((x) => x.status === 'pending'))

  await new Promise((resolve) => setTimeout(resolve, 160))
  await dispatcher.reconcileInFlightJobs()
  const finalJob = repo.getJob(job.id)
  assert.equal(finalJob.status, 'complete')
  assert.equal(repo.listPendingExecutionAttempts().length, 0)
  assert.equal(repo.getDb().prepare('SELECT COUNT(*) AS n FROM job_execution_attempt WHERE job_id = ?').get(job.id).n, 1)
  assert.equal(repo.getDb().prepare('SELECT COUNT(*) AS n FROM budget_reservation WHERE job_id = ?').get(job.id).n, 0)
  assert.equal(repo.getDb().prepare("SELECT COUNT(*) AS n FROM asset_link WHERE job_id = ? AND role = 'job_output'").get(job.id).n, 1)

  console.log('M5 restart reconciliation: PASS')
  console.log(JSON.stringify({ runId, jobId: job.id, externalRequestId: beforeRestart[0].external_request_id, attempts: 1, reservations: 0, finalStatus: finalJob.status }, null, 2))
} finally {
  repo.closeDb()
  fs.rmSync(dbPath, { force: true })
}
