// Isolated M6/M7/M8 verification: synthetic local clips, no provider imports/calls.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'aaf operator spaces-'))
process.env.FACTORY_DB_PATH = path.join(temp, 'factory.db')
process.env.FACTORY_MEDIA_ROOT = path.join(temp, 'media')
fs.mkdirSync(process.env.FACTORY_MEDIA_ROOT)
const { runMigrations, openDatabase } = await import('../server/db/migrate.mjs')
const repo = await import('../server/db/repository.mjs')
const pt = await import('../server/db/productTestRepository.mjs')
const m6 = await import('../server/lib/assembly.mjs')
const op = await import('../server/lib/operator.mjs')
runMigrations({ dbPath: process.env.FACTORY_DB_PATH, log: { log() {} } })
repo.setDb(openDatabase(process.env.FACTORY_DB_PATH))
let passed = 0
async function check(name, fn) { await fn(); passed++; console.log(`PASS ${name}`) }
const reopen = () => { repo.closeDb(); repo.setDb(openDatabase(process.env.FACTORY_DB_PATH)) }
try {
  const ffmpeg = await m6.videoTool()
  const productId = repo.createProduct({ name: 'Isolated operator fixture' })
  const test = pt.createProductTestForProduct({ productId, market: 'FR', language: 'fr' })
  const iterationId = pt.createIterationForTest({ productTestId: test.id, mode: 'exploratory', policyOverrides: { budgetCeilingMinor: 1000 } })
  const creativeId = pt.createCreativeForIteration({ iterationId, angle: 'two colors', format: 'short', defaultProductionMethod: 'factory_generated' })
  let runId, finalAsset
  await check('M6 planning is non-spending and preserves audio false', () => {
    const plan = op.approveManualPlan({ creativeId, provider: 'mock', clips: ['red', 'blue'].map((prompt) => ({ prompt, seconds: 5, resolution: '480p', generate_audio: false })) })
    runId = plan.runId
    const run = repo.getProductionRunExecution(runId)
    assert.equal(run.jobs.length, 0)
    assert.equal(run.spec_frozen_at, null)
    assert.equal(run.specSnapshot.planning.generationPlan.videoClips[0].generate_audio, false)
    assert.equal(repo.getDb().prepare('SELECT count(*) n FROM budget_reservation').get().n, 0)
    repo.freezeProductionRunSpec(runId, run.specSnapshot)
  })
  await check('M6 mismatched codecs/fps/dimensions and silent fixture', async () => {
    for (const [sequence, color, dimensions, fps, audio] of [[2, 'blue', '640x360', 24, true], [1, 'red', '180x320', 15, false]]) {
      const name = `${color}.mp4`, file = path.join(m6.mediaRoot(), name)
      const args = ['-y', '-f', 'lavfi', '-i', `color=${color}:s=${dimensions}:r=${fps}`]
      if (audio) args.push('-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100')
      args.push('-t', '0.6', '-c:v', audio ? 'mpeg4' : 'libx264', '-pix_fmt', 'yuv420p')
      if (audio) args.push('-c:a', 'aac')
      args.push(file)
      const result = await m6.runVideoTool(ffmpeg, args)
      assert.equal(result.code, 0, result.stderr)
      const bytes = fs.readFileSync(file)
      const asset = repo.getOrCreateAsset({ contentHash: createHash('sha256').update(bytes).digest('hex'), relativePath: name, mimeType: 'video/mp4', source: 'generated' })
      const jobId = repo.createJob({ productionRunId: runId, capability: 'generate_video', provider: 'mock', inputParams: { sequence } })
      repo.attachAssetLink(asset.id, { jobId }, 'job_output')
      repo.updateJobRuntime(jobId, { status: 'complete' })
    }
    repo.setProductionRunStatus(runId, 'executing')
    assert.deepEqual(m6.assemblyInputs(runId).clips.map((clip) => clip.relativePath), ['red.mp4', 'blue.mp4'])
  })
  await check('M6 assembly produces decoded vertical final Asset and terminal run', async () => {
    finalAsset = (await m6.assembleProductionRun(runId)).asset
    const meta = await m6.inspectVideo(m6.localAssetPath(finalAsset.relative_path))
    assert.equal(meta.width, 720); assert.equal(meta.height, 1280); assert.equal(meta.decoded, true)
    assert.equal(meta.videoCodec, 'h264'); assert.equal(meta.audioCodec, 'aac')
    assert.ok(meta.duration >= 1.15 && meta.duration < 1.5); assert.equal(meta.audio, true)
    assert.equal(repo.getProductionRunExecution(runId).status, 'complete')
    assert.equal(repo.getProductionRunExecution(runId).final_asset_id, finalAsset.id)
  })
  await check('M6 video frames prove red then blue ordering', () => {
    const pixel = (at) => {
      const result = spawnSync(ffmpeg, ['-v', 'error', '-ss', at, '-i', m6.localAssetPath(finalAsset.relative_path), '-frames:v', '1', '-vf', 'crop=2:2:360:640,scale=1:1', '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-'], { windowsHide: true })
      assert.equal(result.status, 0); return [...result.stdout]
    }
    const red = pixel('0.2'), blue = pixel('0.9')
    assert.ok(red[0] > 200 && red[2] < 40); assert.ok(blue[2] > 200 && blue[0] < 40)
  })
  await check('M6 reopen/reprocess idempotency creates no duplicate final Asset', async () => {
    const before = repo.getDb().prepare('SELECT count(*) n FROM asset').get().n
    reopen()
    assert.equal((await m6.assembleProductionRun(runId)).asset.id, finalAsset.id)
    assert.equal(repo.getDb().prepare('SELECT count(*) n FROM asset').get().n, before)
    assert.equal(repo.getDb().prepare("SELECT count(*) n FROM asset_link WHERE production_run_id=? AND role='final_video'").get(runId).n, 1)
  })
  await check('M6 cleanup retains only final MP4 and never removes source clips', () => {
    const work = path.dirname(m6.localAssetPath(finalAsset.relative_path))
    assert.deepEqual(fs.readdirSync(work), ['final.mp4'])
    for (const name of ['red.mp4', 'blue.mp4']) assert.ok(fs.existsSync(path.join(m6.mediaRoot(), name)))
  })
  await check('M6 failed FFmpeg leaves no final Asset or scratch media', async () => {
    const badRun = pt.createProductionRunForCreative({ creativeId, productionMethod: 'factory_generated' })
    repo.freezeProductionRunSpec(badRun, { planning: {} })
    fs.writeFileSync(path.join(m6.mediaRoot(), 'corrupt.mp4'), 'not a video')
    const bad = repo.getOrCreateAsset({ contentHash: createHash('sha256').update('not a video').digest('hex'), relativePath: 'corrupt.mp4', mimeType: 'video/mp4', source: 'uploaded' })
    const jobId = repo.createJob({ productionRunId: badRun, capability: 'generate_video', provider: 'mock', inputParams: {} })
    repo.attachAssetLink(bad.id, { jobId }, 'job_output'); repo.updateJobRuntime(jobId, { status: 'complete' })
    await assert.rejects(m6.assembleProductionRun(badRun), /invalid|decoded/)
    assert.equal(repo.getProductionRunExecution(badRun).final_asset_id, null)
    assert.deepEqual(fs.readdirSync(path.join(m6.mediaRoot(), 'assembly', String(badRun))), [])
    assert.ok(fs.existsSync(path.join(m6.mediaRoot(), 'corrupt.mp4')))
  })
  await check('M6 active lock rejects concurrent assembly', async () => {
    const lock = path.join(m6.mediaRoot(), 'assembly', String(runId), 'assembly.lock')
    fs.writeFileSync(lock, String(process.pid))
    await assert.rejects(m6.assembleProductionRun(runId), /already running/)
    fs.unlinkSync(lock)
  })
  await check('M6 stale process lock recovers after restart without duplicate Asset', async () => {
    const lock = path.join(m6.mediaRoot(), 'assembly', String(runId), 'assembly.lock')
    fs.writeFileSync(lock, '2147483647')
    assert.equal((await m6.assembleProductionRun(runId)).asset.id, finalAsset.id)
    assert.equal(fs.existsSync(lock), false)
  })
  await check('M6 failure preserves lineage, Costs and reservations', async () => {
    const badRun = pt.createProductionRunForCreative({ creativeId, productionMethod: 'factory_generated' })
    repo.freezeProductionRunSpec(badRun, { planning: {} })
    const id = repo.createJob({ productionRunId: badRun, capability: 'generate_video', provider: 'mock', inputParams: {} })
    repo.updateJobRuntime(id, { status: 'complete' })
    await assert.rejects(m6.assembleProductionRun(badRun), /no local Asset/)
    assert.equal(repo.getProductionRunExecution(badRun).final_asset_id, null)
    assert.equal(repo.getProductionRunExecution(badRun).status, 'planned')
    assert.equal(repo.getDb().prepare('SELECT count(*) n FROM cost').get().n, 0)
    assert.equal(repo.getDb().prepare('SELECT count(*) n FROM budget_reservation').get().n, 0)
  })
  await check('M7 review queue selects completed final only', () => {
    assert.equal(op.reviewQueue().length, 1); assert.equal(op.reviewQueue()[0].approval_status, 'pending')
    assert.throws(() => op.requirePublishable(creativeId, runId), /Approve/)
  })
  await check('M6 imported manual video freezes normally and becomes reviewable', async () => {
    const manualCreative = pt.createCreativeForIteration({ iterationId, angle: 'manual', format: 'short', defaultProductionMethod: 'manual_external' })
    const manualRun = pt.createProductionRunForCreative({ creativeId: manualCreative, productionMethod: 'manual_external' })
    const original = repo.getDb().prepare("SELECT id FROM asset WHERE relative_path='blue.mp4'").get()
    assert.equal((await m6.inspectVideo(m6.localAssetPath('blue.mp4'))).videoCodec, 'mpeg4')
    await m6.completeExternalRun(manualRun, original.id)
    const result = repo.getProductionRunExecution(manualRun)
    const final = repo.getDb().prepare('SELECT relative_path FROM asset WHERE id=?').get(result.final_asset_id)
    assert.equal((await m6.inspectVideo(m6.localAssetPath(final.relative_path))).videoCodec, 'h264')
    assert.deepEqual(result.specSnapshot.execution.inputAssetIds, [original.id])
    assert.ok(result.spec_frozen_at); assert.equal(result.status, 'complete'); assert.equal(result.jobs.length, 0)
    op.reviewCreative({ creativeId: manualCreative, productionRunId: manualRun, decision: 'approved' })
    op.requirePublishable(manualCreative, manualRun)
    await assert.rejects(m6.completeExternalRun(manualRun, finalAsset.id), /unfinished/)
  })
  for (const decision of ['approved', 'rejected', 'regenerating']) await check(`M7 ${decision} persists without job dispatch`, () => {
    const jobs = repo.getDb().prepare('SELECT count(*) n FROM job').get().n
    op.reviewCreative({ creativeId, productionRunId: runId, decision, note: `operator ${decision}` })
    const reviews = pt.listReviewEventsForCreative(creativeId).length
    op.reviewCreative({ creativeId, productionRunId: runId, decision, note: `operator ${decision}` })
    assert.equal(pt.listReviewEventsForCreative(creativeId).length, reviews)
    reopen()
    assert.equal(op.reviewQueue().find((item) => item.runId === runId).approval_status, decision)
    assert.equal(repo.getDb().prepare('SELECT count(*) n FROM job').get().n, jobs)
    assert.equal(repo.getDb().prepare('SELECT count(*) n FROM job_execution_attempt').get().n, 0)
    assert.equal(pt.listReviewEventsForCreative(creativeId)[0].note, `operator ${decision}`)
  })
  let publication
  await check('M7 approved run is publication ready with frozen lineage', () => {
    op.reviewCreative({ creativeId, productionRunId: runId, decision: 'approved' })
    op.requirePublishable(creativeId, runId)
    const accountId = repo.createAccount({ platform: 'instagram', handle: 'local-fixture' })
    const body = { creativeId, productionRunId: runId, publishedAssetId: finalAsset.id, accountId, platform: 'instagram', surfaceType: 'reel', publishedAt: new Date().toISOString(), externalUrl: 'https://example.com/post' }
    publication = op.savePublication(body)
    assert.throws(() => op.savePublication({ ...body, platform: 'tiktok' }), /platform must match/)
    assert.equal(op.savePublication(body).id, publication.id)
    assert.equal(repo.getDb().prepare('SELECT count(*) n FROM publication').get().n, 1)
    assert.equal(publication.published_asset_id, finalAsset.id)
  })
  await check('M8 metrics persist and latest snapshot replaces, not adds', () => {
    for (const [date, views] of [['2026-09-12', 500], ['2026-09-14', 2000], ['2026-09-13', 700]]) op.saveMetrics(publication.id, { capturedAt: date, source: 'manual', rawMetrics: { views, impressions: views, link_clicks: 40, purchases: 2, spend_minor: 1000, revenue_minor: 3000, likes: 20, comments: 10, shares: 5, saves: 5 } })
    reopen()
    const summary = op.analysisSummary({ productTestId: test.id })
    assert.equal(summary.total.raw.views, 2000)
    assert.equal(summary.iterations[0].analysis.raw.views, 2000)
    assert.equal(summary.creatives[0].analysis.raw.views, 2000)
    assert.equal(summary.total.ctr, 2); assert.equal(summary.total.engagementRate, 2)
    assert.equal(summary.total.conversionRate, 5); assert.equal(summary.total.cpaMinor, 500)
    assert.equal(summary.total.roas, 3); assert.equal(summary.total.costPerViewMinor, 0.5)
  })
  await check('M8 missing and zero-denominator are distinct; zero remains zero', () => {
    assert.equal(op.analyzeMetrics({}).availability.ctr, 'missing data')
    assert.equal(op.analyzeMetrics({ link_clicks: 0, impressions: 0 }).availability.ctr, 'not applicable (zero denominator)')
    assert.equal(op.analyzeMetrics({ link_clicks: 0, impressions: 100 }).ctr, 0)
    assert.equal(op.analyzeMetrics({ views: 100 }).engagementRate, null)
    assert.throws(() => op.saveMetrics(publication.id, { capturedAt: '2026-09-14', rawMetrics: { views: -1 } }), /Invalid/)
  })
  await check('M8 repeated identical snapshot is idempotent; correction is append-only', () => {
    const body = { capturedAt: '2026-09-15', source: 'manual', rawMetrics: { views: 0, impressions: 0 } }
    const first = op.saveMetrics(publication.id, body)
    assert.equal(op.saveMetrics(publication.id, body).id, first.id)
    const corrected = op.saveMetrics(publication.id, { ...body, rawMetrics: { views: 10 } })
    assert.notEqual(corrected.id, first.id)
    assert.deepEqual(JSON.parse(repo.getDb().prepare('SELECT raw_metrics FROM metric_snapshot WHERE id=?').get(first.id).raw_metrics), body.rawMetrics)
    const summary = op.analysisSummary({ productTestId: test.id })
    assert.equal(summary.total.raw.views, 10); assert.equal(summary.total.ctr, null)
  })
  await check('M7 missing final media blocks publication and review, preserves IDs', () => {
    const file = m6.localAssetPath(finalAsset.relative_path), hidden = file + '.missing'
    fs.renameSync(file, hidden)
    try {
      assert.throws(() => op.requirePublishable(creativeId, runId))
      assert.throws(() => op.reviewCreative({ creativeId, productionRunId: runId, decision: 'approved' }))
      assert.equal(repo.getProductionRunExecution(runId).final_asset_id, finalAsset.id)
    } finally { fs.renameSync(hidden, file) }
  })
  await check('M8 deterministic thresholds and recommendation', () => {
    assert.equal(op.analyzeMetrics({ views: 999, link_clicks: 20 }).distribution, 'insufficient distribution')
    assert.equal(op.analyzeMetrics({ views: 1000, link_clicks: 19 }).distribution, 'keep collecting click data')
    assert.equal(op.analyzeMetrics({ views: 1000, link_clicks: 20 }).distribution, 'sufficient for directional judgment')
    assert.match(op.analyzeMetrics({ views: 1000, link_clicks: 20, purchases: 0 }).recommendation, /underperforming/)
    assert.match(op.analyzeMetrics({ views: 1000, link_clicks: 20, purchases: 1 }).recommendation, /promising/)
    assert.deepEqual(op.analyzeMetrics({}), op.analyzeMetrics({}))
  })
  console.log(`Operator M6/M7/M8: ${passed}/${passed} PASS; no provider calls`)
} finally {
  repo.closeDb()
  // Only the unique temporary directory created above is removed.
  fs.rmSync(temp, { recursive: true, force: true })
}
