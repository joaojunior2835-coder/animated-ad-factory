// M5 Mock-only orchestration verification. Never calls a remote provider.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const dbPath = path.join(os.tmpdir(), `aaf-m5-test-${Date.now()}.db`)
process.env.FACTORY_DB_PATH = dbPath
process.env.MOCK_VIDEO_DELAY_MS = '0'
process.env.PRODUCTION_POLL_INTERVAL_MS = '50'

const { runMigrations, openDatabase } = await import('../server/db/migrate.mjs')
runMigrations({ dbPath, log: { log: () => {}, error: console.error } })
const repo = await import('../server/db/repository.mjs')
const pt = await import('../server/db/productTestRepository.mjs')
const { materializeJobsForProductionRun } = await import('../server/lib/productionExecution.mjs')
const { dispatchProductionRun, reconcileInFlightJobs } = await import('../server/lib/dispatcher.mjs')

repo.setDb(openDatabase(dbPath))
try {
  const productId = repo.createProduct({ name: 'M5 Mock Product' })
  const test = pt.createProductTestForProduct({ productId, market: 'FR', language: 'fr' })
  const iterationId = pt.createIterationForTest({ productTestId: test.id, mode: 'exploratory', policyOverrides: { budgetCeilingMinor: 100000 } })
  const creativeId = pt.createCreativeForIteration({ iterationId, angle: 'mock', format: 'short', defaultProductionMethod: 'factory_generated' })

  const directRun = pt.createProductionRunForCreative({ creativeId, productionMethod: 'factory_generated' })
  const directSnapshot = {
    schemaVersion: 1,
    planning: {
      plannedProvider: 'mock', plannedModel: 'mock-video',
      estimatedGenerationCounts: { images: 0, videoClips: 1 },
      generationPlan: { imageGenerations: 0, videoClips: [{ seconds: 1, purpose: 'direct output' }], voiceRequired: false },
      requiredAssets: [],
    },
    execution: null,
  }
  repo.freezeProductionRunSpec(directRun, directSnapshot)
  const materialized = materializeJobsForProductionRun(directRun)
  assert.equal(materialized.createdCount, 1)
  const directJobs = repo.listJobsForProductionRun(directRun)
  assert.equal(directJobs[0].status, 'planned')
  await dispatchProductionRun(directRun)
  await reconcileInFlightJobs()
  const directExecution = repo.getProductionRunExecution(directRun)
  assert.equal(directExecution.jobs[0].status, 'complete')
  assert.equal(repo.getDb().prepare('SELECT COUNT(*) AS n FROM job_execution_attempt WHERE job_id = ? AND reconciliation_status = \'reconciled\'').get(directJobs[0].id).n, 1)
  const directRow = repo.getDb().prepare('SELECT final_asset_id, status FROM production_run WHERE id = ?').get(directRun)
  assert.ok(directRow.final_asset_id)
  assert.equal(directRow.status, 'complete')

  const multiRun = pt.createProductionRunForCreative({ creativeId, productionMethod: 'factory_generated' })
  const multiSnapshot = {
    schemaVersion: 1,
    planning: {
      plannedProvider: 'mock', plannedModel: 'mock-video',
      estimatedGenerationCounts: { images: 1, videoClips: 1 },
      generationPlan: { imageGenerations: 1, videoClips: [{ seconds: 1, purpose: 'start frame image-to-video' }], voiceRequired: false },
      requiredAssets: [],
    },
    execution: null,
  }
  repo.freezeProductionRunSpec(multiRun, multiSnapshot)
  materializeJobsForProductionRun(multiRun)
  const multiJobs = repo.listJobsForProductionRun(multiRun)
  assert.equal(multiJobs.length, 2)
  assert.equal(repo.listJobDependencies(multiJobs[1].id).length, 1)
  await dispatchProductionRun(multiRun)
  await reconcileInFlightJobs()
  const multiRow = repo.getDb().prepare('SELECT final_asset_id, status FROM production_run WHERE id = ?').get(multiRun)
  assert.equal(multiRow.final_asset_id, null)
  assert.equal(multiRow.status, 'executing')
  const multiLinks = repo.getDb().prepare('SELECT job_id, role FROM asset_link WHERE job_id IN (?, ?)').all(multiJobs[0].id, multiJobs[1].id)
  assert.equal(repo.getDb().prepare('SELECT COUNT(*) AS n FROM asset_link WHERE job_id IN (?, ?) AND role = \'job_output\'').get(multiJobs[0].id, multiJobs[1].id).n, 2)

  // A paid job with a ceiling below its estimate must fail before provider
  // dispatch. The fake token only makes the rate catalog visible; the
  // replicate adapter is never reached because reservation is denied.
  process.env.REPLICATE_API_TOKEN = 'test-only-not-a-real-token'
  repo.setFxRate({ fromCurrency: 'USD', toCurrency: 'EUR', rate: 0.92, source: 'test' })
  repo.getDb().prepare("UPDATE iteration SET execution_policy_snapshot = json_set(execution_policy_snapshot, '$.budgetCeilingMinor', 1) WHERE id = ?").run(iterationId)
  const blockedRun = pt.createProductionRunForCreative({ creativeId, productionMethod: 'factory_generated' })
  const blockedSnapshot = {
    schemaVersion: 1,
    planning: {
      plannedProvider: 'replicate', plannedModel: 'ltx',
      estimatedGenerationCounts: { images: 0, videoClips: 1 },
      generationPlan: { imageGenerations: 0, videoClips: [{ seconds: 1, purpose: 'paid video' }], voiceRequired: false },
      requiredAssets: [],
    },
    execution: null,
  }
  repo.freezeProductionRunSpec(blockedRun, blockedSnapshot)
  materializeJobsForProductionRun(blockedRun)
  const blockedJob = repo.listJobsForProductionRun(blockedRun)[0]
  await dispatchProductionRun(blockedRun)
  const blockedRow = repo.getJob(blockedJob.id)
  assert.equal(blockedRow.status, 'failed')
  assert.equal(blockedRow.error_message, 'BUDGET_BLOCKED')
  assert.equal(repo.getDb().prepare('SELECT COUNT(*) AS n FROM budget_reservation WHERE job_id = ?').get(blockedJob.id).n, 0)

  console.log('M5 Mock orchestration: PASS')
  console.log(JSON.stringify({ directRun, multiRun, blockedRun, directFinalAsset: directRow.final_asset_id, multiFinalAsset: multiRow.final_asset_id, blockedReason: blockedRow.error_message }, null, 2))
} finally {
  repo.closeDb()
  fs.rmSync(dbPath, { force: true })
}
