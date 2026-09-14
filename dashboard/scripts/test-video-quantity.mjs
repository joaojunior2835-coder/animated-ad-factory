// Isolated quantity/M5/M6 regressions. Synthetic fal only; all network is intercepted.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'aaf-video-quantity-'))
process.env.FACTORY_DB_PATH = path.join(temp, 'factory.db')
process.env.FACTORY_MEDIA_ROOT = path.join(temp, 'media')
process.env.MOCK_VIDEO_DELAY_MS = '0'
for (const key of ['FAL_API_KEY', 'OPENAI_API_KEY', 'GROQ_API_KEY', 'OPENROUTER_API_KEY', 'POLLINATIONS_API_KEY', 'REPLICATE_API_TOKEN']) process.env[key] = ''
process.env.FAL_API_KEY = 'synthetic-video-quantity-key-never-send'
fs.mkdirSync(process.env.FACTORY_MEDIA_ROOT)
const originalFetch = globalThis.fetch, submissions = [], uploads = [], videos = [], failures = []
let repo, fal, passed = 0
globalThis.fetch = async url => {
  const match = /^https:\/\/fal\.media\/quantity\/(\d+)\.mp4$/.exec(String(url))
  assert.ok(match, 'Unmocked network is forbidden')
  return new Response(videos[Number(match[1]) % videos.length], { headers: { 'content-type': 'video/mp4' } })
}
const check = async (name, run) => { try { await run(); passed++; console.log(`PASS ${name}`) } catch (error) { failures.push(name); console.error(`FAIL ${name}\n${error.stack || error.message}`) } }
try {
  const { runMigrations } = await import('../server/db/migrate.mjs')
  runMigrations({ dbPath: process.env.FACTORY_DB_PATH, log: { log() {} } })
  repo = await import('../server/db/repository.mjs')
  const pt = await import('../server/db/productTestRepository.mjs')
  const g = await import('../server/lib/creativeGenerator.mjs')
  const m6 = await import('../server/lib/assembly.mjs')
  const dispatcher = await import('../server/lib/dispatcher.mjs')
  const rates = await import('../server/lib/rateCatalog.mjs')
  fal = await import('../server/providers/falProvider.mjs')
  const db = repo.getDb()
  for (const [index, color] of ['red', 'blue'].entries()) {
    const file = path.join(temp, `video-${index}.mp4`)
    assert.equal((await m6.runVideoTool(await m6.videoTool(), ['-hide_banner', '-f', 'lavfi', '-i', `color=c=${color}:s=80x120:r=5`, '-t', '1', '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', file])).code, 0)
    videos.push(fs.readFileSync(file))
  }
  fal.setFalClientForTests({
    queue: {
      async submit(endpoint, { input }) {
        assert.ok(db.prepare("SELECT count(*) n FROM budget_reservation WHERE status='active'").get().n > 0)
        assert.ok(db.prepare("SELECT count(*) n FROM job_execution_attempt WHERE provider_status='SUBMISSION_UNRESOLVED'").get().n > 0)
        const id = String(submissions.length); submissions.push({ endpoint, input: structuredClone(input) }); return { request_id: id, status: 'IN_QUEUE' }
      },
      async status() { return { status: 'COMPLETED' } },
      async result(endpoint, { requestId }) { assert.ok(submissions[Number(requestId)]); return { data: { video: { url: `https://fal.media/quantity/${requestId}.mp4` } } } },
    },
    storage: { async upload(blob) { uploads.push(Buffer.from(await blob.arrayBuffer())); return `https://fal.media/quantity/input-${uploads.length}.png` } },
  })
  const productId = repo.createProduct({ name: 'Quantity fixture' }), productTest = pt.createProductTestForProduct({ productId, market: 'FR', language: 'fr' })
  const creative = angle => g.createGeneratorCreative({ productTestId: productTest.id, angle }).creativeId
  const scene = values => ({ name: 'Product scene', prompt: 'A ceramic product on a clean surface', provider: 'mock', mode: 'text-to-video', seconds: 5, resolution: '480p', aspectRatio: '9:16', generateAudio: false, startAssetId: null, ...values })
  const quote = (id, workspace) => g.quoteGenerator(id, { revision: workspace.revision, sceneIds: workspace.scenes.map(s => s.id) })
  const mockId = creative('Two local variants'), paidId = creative('Two paid-shaped variants')
  let mock, paid, paidQuote

  await check('Video quantity defaults to one, rejects invalid counts, and preserves omission on existing multi-output drafts', () => {
    mock = g.saveGeneratorScenes(mockId, { revision: 0, scenes: [scene()] }); assert.equal(mock.scenes[0].quantity, 1)
    for (const quantity of [0, -1, 1.5, 5, NaN]) assert.throws(() => g.saveGeneratorScenes(mockId, { revision: mock.revision, scenes: [scene({ quantity })] }), /1–4 video/)
    mock = g.saveGeneratorScenes(mockId, { revision: mock.revision, scenes: [scene({ quantity: 2 })] })
    const withoutQuantity = { ...mock.scenes[0] }; delete withoutQuantity.quantity
    mock = g.saveGeneratorScenes(mockId, { revision: mock.revision, scenes: [withoutQuantity] }); assert.equal(mock.scenes[0].quantity, 2)
  })
  await check('Quantity two is one scene, two frozen draft steps and zero Jobs before confirmation', () => {
    const result = quote(mockId, mock); mock = result.workspace
    const run = repo.getProductionRunExecution(result.quote.runIds[0]), steps = run.specSnapshot.planning.generationPlan.steps
    assert.equal(result.quote.outputCount, 2); assert.equal(result.quote.sceneIds.length, 1); assert.equal(result.quote.runIds.length, 1); assert.equal(result.quote.totalMinor, 0)
    assert.equal(run.jobs.length, 0); assert.equal(run.spec_frozen_at, null); assert.equal(steps.length, 2); assert.notEqual(steps[0].id, steps[1].id)
    assert.ok(steps.every(s => s.capability === 'generate_video' && s.params.seconds === 5 && s.params.generate_audio === false))
    assert.equal(db.prepare('SELECT count(*) n FROM budget_reservation').get().n, 0)
  })
  await check('Mock quantity two dispatches exactly two single-attempt Jobs and completes with stable outputs', async () => {
    const result = quote(mockId, mock)
    await g.startGenerator(mockId, { ...result.quote, confirmed: true }); mock = g.generatorWorkspace(mockId)
    assert.equal(mock.scenes.length, 1); const live = mock.scenes[0]
    assert.equal(live.status, 'Complete'); assert.equal(live.details.run.jobs.length, 2); assert.equal(live.outputs.length, 2)
    assert.ok(live.details.run.jobs.every(j => j.inputParams.max_attempts === 1 && j.inputParams.generate_audio === false && j.capability === 'generate_video'))
    assert.equal(live.media.id, [...live.outputs].sort((a, b) => a.job_id - b.job_id)[0].id)
    assert.equal(live.details.costs.length, 0); assert.equal(live.details.reservations.length, 0)
    await assert.rejects(g.startGenerator(mockId, { ...result.quote, confirmed: true })); assert.equal(g.generatorWorkspace(mockId).scenes[0].details.run.jobs.length, 2)
  })
  await check('Paid batch needs FX and estimates each Job before multiplying, preserving rounding', () => {
    paid = g.saveGeneratorScenes(paidId, { revision: 0, scenes: [scene({ provider: 'fal', quantity: 2 })] })
    assert.equal(g.estimateGenerator(paidId, paid.scenes.map(s => s.id)).totalMinor, null); assert.throws(() => quote(paidId, paid), /FX/)
    const fx = .86534; repo.setFxRate({ fromCurrency: 'USD', toCurrency: 'EUR', rate: fx, source: 'synthetic-quantity' })
    const single = rates.estimateVideoJobCost('seedance-2.0-fast', { seconds: 5, resolution: '480p', aspect_ratio: '9:16' })
    const estimate = g.estimateGenerator(paidId, paid.scenes.map(s => s.id))
    assert.equal(estimate.totalMinor, Math.round(single.costMinor * fx) * 2)
    assert.notEqual(estimate.totalMinor, Math.round(single.costMinor * fx * 2), 'Fixture must distinguish per-Job rounding from aggregate rounding')
    assert.equal(estimate.rows[0].sourceMinor, single.costMinor * 2); assert.equal(estimate.rows[0].outputCount, 2)
    const result = quote(paidId, paid); paid = result.workspace; paidQuote = result.quote
    assert.equal(paidQuote.totalMinor, estimate.totalMinor); assert.equal(paidQuote.outputCount, 2); assert.equal(paidQuote.attemptLimit, 1); assert.equal(repo.getProductionRunExecution(paidQuote.runIds[0]).jobs.length, 0)
  })
  await check('Quantity changes invalidate confirmation without dispatch and preserve the previous frozen scope', async () => {
    const old = paidQuote, oldSnapshot = repo.getProductionRunExecution(old.runIds[0]).specSnapshot
    paid = g.saveGeneratorScenes(paidId, { revision: paid.revision, scenes: [{ ...paid.scenes[0], quantity: 3 }] }); assert.equal(paid.quote, null)
    await assert.rejects(g.startGenerator(paidId, { ...old, confirmed: true })); assert.equal(submissions.length, 0)
    assert.deepEqual(repo.getProductionRunExecution(old.runIds[0]).specSnapshot, oldSnapshot); assert.equal(oldSnapshot.planning.generationPlan.steps.length, 2)
    paid = g.saveGeneratorScenes(paidId, { revision: paid.revision, scenes: [{ ...paid.scenes[0], quantity: 2 }] })
    const result = quote(paidId, paid); paid = result.workspace; paidQuote = result.quote
  })
  await check('Two synthetic fal calls have exact audio/settings, one durable Job and reservation each', async () => {
    await g.startGenerator(paidId, { ...paidQuote, confirmed: true }); paid = g.generatorWorkspace(paidId)
    assert.equal(submissions.length, 2); assert.ok(submissions.every(s => s.endpoint === fal.FAL_SEEDANCE_ENDPOINTS.t2v && s.input.duration === 5 && s.input.resolution === '480p' && s.input.aspect_ratio === '9:16' && s.input.generate_audio === false))
    assert.ok(submissions.every(s => !('num_videos' in s.input) && !('quantity' in s.input)))
    assert.equal(paid.scenes[0].details.reservations.length, 2); assert.ok(paid.scenes[0].details.reservations.every(r => r.status === 'active'))
    assert.ok(paid.scenes[0].details.run.jobs.every(j => j.inputParams.max_attempts === 1 && j.inputParams.authorized_fx_signature))
    await dispatcher.reconcileInFlightJobs(); paid = g.generatorWorkspace(paidId)
    assert.equal(paid.scenes[0].status, 'Complete'); assert.equal(paid.scenes[0].outputs.length, 2); assert.notEqual(paid.scenes[0].outputs[0].id, paid.scenes[0].outputs[1].id)
    assert.equal(paid.scenes[0].details.costs.length, 2); assert.equal(paid.recordedMinor, paidQuote.totalMinor)
  })
  await check('Choosing another current video output retains Run, signature and history; approval stays explicit', () => {
    const live = paid.scenes[0], runId = live.runId, history = structuredClone(live.history || []), chosen = live.outputs[1]
    paid = g.chooseGeneratorResult(paidId, { revision: paid.revision, sceneId: live.id, assetId: chosen.id })
    assert.equal(paid.scenes[0].media.id, chosen.id); assert.equal(paid.scenes[0].runId, runId); assert.equal(paid.scenes[0].current, true); assert.equal(paid.scenes[0].approved, false)
    assert.deepEqual(paid.scenes[0].history || [], history); assert.equal(submissions.length, 2)
    paid = g.chooseGeneratorResult(paidId, { revision: paid.revision, sceneId: live.id, approved: true }); assert.equal(paid.scenes[0].approved, true)
  })
  await check('M6 assembles the one selected take once, never concatenating alternative outputs', async () => {
    const chosen = paid.scenes[0].media.id, sourceRunId = paid.scenes[0].runId
    paid = await g.assembleGenerator(paidId, { revision: paid.revision })
    assert.equal(paid.final.sources.length, 1); assert.equal(paid.final.sources[0].assetId, chosen); assert.equal(paid.final.sources[0].sourceRunId, sourceRunId)
    assert.equal(paid.final.run.jobs.length, 0); assert.equal(paid.final.run.status, 'complete'); assert.ok(fs.existsSync(m6.localAssetPath(paid.final.finalAsset.relative_path)))
    const metadata = await m6.inspectVideo(m6.localAssetPath(paid.final.finalAsset.relative_path)); assert.ok(metadata.duration <= 1.5, 'One one-second take should not become a two-take concatenation')
    assert.equal(submissions.length, 2)
  })
  await check('Regeneration creates another finite batch and preserves the selected prior output in history', async () => {
    const old = paid.scenes[0], result = quote(paidId, paid)
    assert.equal(result.quote.outputCount, 2); assert.notEqual(result.quote.runIds[0], old.runId); assert.equal(repo.getProductionRunExecution(result.quote.runIds[0]).jobs.length, 0)
    await g.startGenerator(paidId, { ...result.quote, confirmed: true }); await dispatcher.reconcileInFlightJobs(); paid = g.generatorWorkspace(paidId)
    assert.equal(submissions.length, 4); assert.equal(paid.scenes[0].approved, false); assert.equal(paid.scenes[0].history.at(-1).runId, old.runId); assert.equal(paid.scenes[0].history.at(-1).assetId, old.media.id)
    assert.equal(repo.getProductionRunExecution(old.runId).status, 'complete'); assert.ok(paid.final.finalAsset)
  })
  await check('Quantity one remains on the legacy planning route and existing approvals remain current', async () => {
    const id = creative('Single-output backward compatibility')
    let w = g.saveGeneratorScenes(id, { revision: 0, scenes: [scene()] }), result = quote(id, w)
    const plan = repo.getProductionRunExecution(result.quote.runIds[0]).specSnapshot.planning.generationPlan
    assert.equal(plan.steps, undefined); assert.equal(plan.videoClips.length, 1)
    await g.startGenerator(id, { ...result.quote, confirmed: true }); w = g.generatorWorkspace(id)
    w = g.chooseGeneratorResult(id, { revision: w.revision, sceneId: w.scenes[0].id, approved: true })
    const key = `creative_generator_${id}`, raw = JSON.parse(db.prepare('SELECT value FROM app_settings WHERE key=?').get(key).value)
    delete raw.scenes[0].quantity; db.prepare('UPDATE app_settings SET value=? WHERE key=?').run(JSON.stringify(raw), key)
    w = g.generatorWorkspace(id); assert.equal(w.scenes[0].quantity, 1); assert.equal(w.scenes[0].current, true); assert.equal(w.scenes[0].approved, true)
    w = g.saveGeneratorScenes(id, { revision: w.revision, scenes: w.scenes }); assert.equal(w.scenes[0].current, true); assert.equal(w.scenes[0].approved, true)
  })
  await check('Image-to-video quantity repeats the real local reference in every frozen step and upload', async () => {
    const imageFile = path.join(process.env.FACTORY_MEDIA_ROOT, 'start.png')
    assert.equal((await m6.runVideoTool(await m6.videoTool(), ['-hide_banner', '-f', 'lavfi', '-i', 'color=c=white:s=64x64', '-frames:v', '1', '-update', '1', imageFile])).code, 0)
    const bytes = fs.readFileSync(imageFile), a = repo.getOrCreateAsset({ contentHash: createHash('sha256').update(bytes).digest('hex'), relativePath: 'start.png', mimeType: 'image/png', source: 'uploaded' })
    const id = creative('Multiple start-frame outputs')
    let w = g.saveGeneratorScenes(id, { revision: 0, scenes: [scene({ provider: 'fal', mode: 'image-to-video', startAssetId: a.id, quantity: 2 })] })
    const result = quote(id, w), steps = repo.getProductionRunExecution(result.quote.runIds[0]).specSnapshot.planning.generationPlan.steps, before = submissions.length
    assert.ok(steps.every(s => s.params.start_frame === '/media/start.png' && s.params.needs_start_frame && s.params.generate_audio === false))
    assert.equal(db.prepare("SELECT count(*) n FROM asset_link WHERE production_run_id=? AND role='start_frame'").get(result.quote.runIds[0]).n, 1)
    await g.startGenerator(id, { ...result.quote, confirmed: true }); assert.equal(submissions.length, before + 2); assert.equal(uploads.length, 2); assert.ok(uploads.every(upload => upload.equals(bytes)))
    assert.ok(submissions.slice(before).every(s => s.endpoint === fal.FAL_SEEDANCE_ENDPOINTS.i2v && s.input.image_url.startsWith('https://fal.media/quantity/input-')))
    await dispatcher.reconcileInFlightJobs(); w = g.generatorWorkspace(id); assert.equal(w.scenes[0].status, 'Complete')
  })
  await check('Refresh/reconciliation cannot repeat paid calls or settlements; SQLite stays valid', async () => {
    const count = submissions.length, costCount = db.prepare('SELECT count(*) n FROM cost').get().n
    await dispatcher.reconcileInFlightJobs(); assert.equal(submissions.length, count); assert.equal(db.prepare('SELECT count(*) n FROM cost').get().n, costCount)
    assert.equal(db.prepare('SELECT count(*) n FROM job_execution_attempt WHERE dispatch_attempt>1').get().n, 0); assert.equal(db.pragma('integrity_check', { simple: true }), 'ok')
  })
  console.log(`\nVideo quantity: ${passed}/${passed + failures.length} passed; ${failures.length} failed. Paid provider calls: 0.`)
  if (failures.length) process.exitCode = 1
} finally {
  globalThis.fetch = originalFetch; fal?.setFalClientForTests(null); repo?.closeDb()
  const resolved = path.resolve(temp), prefix = path.resolve(os.tmpdir()) + path.sep
  if (resolved.startsWith(prefix) && path.basename(resolved).startsWith('aaf-video-quantity-')) fs.rmSync(resolved, { recursive: true, force: true })
}
