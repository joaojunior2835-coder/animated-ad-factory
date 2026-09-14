// Isolated M5 scope regressions. No port servers, real credentials or provider/network calls.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'aaf-production-scope-'))
const media = path.join(temp, 'media')
process.env.FACTORY_DB_PATH = path.join(temp, 'factory.db')
process.env.FACTORY_MEDIA_ROOT = media
for (const key of ['FAL_API_KEY', 'OPENAI_API_KEY', 'GROQ_API_KEY', 'OPENROUTER_API_KEY', 'POLLINATIONS_API_KEY', 'REPLICATE_API_TOKEN']) process.env[key] = ''
process.env.FAL_API_KEY = 'synthetic-scope-key-never-send'
fs.mkdirSync(media)

const originalFetch = globalThis.fetch
const requests = [], uploads = [], failures = [], fixtures = new Map()
let db, repo, fal, passed = 0, imageFixture = 'green', onSubmit = null
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
globalThis.fetch = async url => {
  const value = String(url), match = /^https:\/\/fal\.media\/scope\/(scope-\d+)\.(png|mp4)$/.exec(value)
  assert.ok(match, 'Every network request must target an intercepted local fixture URL')
  const record = requests.find(r => r.id === match[1]); assert.ok(record, 'Fixture request must belong to a submitted synthetic request')
  const bytes = match[2] === 'png' ? fixtures.get(record.fixture) : fs.readFileSync(path.join(root, 'public', 'mock-video-output.mp4'))
  assert.ok(bytes?.length)
  return new Response(bytes, { headers: { 'content-type': match[2] === 'png' ? 'image/png' : 'video/mp4' } })
}
const check = async (name, action) => {
  try { await action(); passed++; console.log(`PASS ${name}`) }
  catch (error) { failures.push({ name, message: error.stack || error.message }); console.error(`FAIL ${name}\n${error.stack || error.message}`) }
  finally { onSubmit = null }
}

try {
  const { runMigrations } = await import('../server/db/migrate.mjs')
  runMigrations({ dbPath: process.env.FACTORY_DB_PATH, log: { log() {} } })
  repo = await import('../server/db/repository.mjs')
  const pt = await import('../server/db/productTestRepository.mjs')
  const execution = await import('../server/lib/productionExecution.mjs')
  const dispatcher = await import('../server/lib/dispatcher.mjs')
  const generator = await import('../server/lib/creativeGenerator.mjs')
  const { validateProductionSteps } = await import('../server/lib/productionSteps.mjs')
  const assembly = await import('../server/lib/assembly.mjs')
  fal = await import('../server/providers/falProvider.mjs')
  db = repo.getDb()
  for (const [name, color] of [['green', '0x3a9065'], ['blue', '0x276db0'], ['gold', '0xc29c36']]) {
    const file = path.join(temp, `${name}.png`)
    const result = await assembly.runVideoTool(await assembly.videoTool(), ['-hide_banner', '-f', 'lavfi', '-i', `color=c=${color}:s=512x512`, '-frames:v', '1', '-update', '1', file])
    assert.equal(result.code, 0, 'Local fixture generation must succeed')
    fixtures.set(name, fs.readFileSync(file))
  }
  const setFx = rate => repo.setFxRate({ fromCurrency: 'USD', toCurrency: 'EUR', rate, source: `synthetic-scope-${rate}` })
  setFx(.86)
  fal.setFalClientForTests({
    queue: {
      async submit(endpoint, { input }) {
        assert.ok(endpoint === 'fal-ai/flux/schnell' || Object.values(fal.FAL_SEEDANCE_ENDPOINTS).includes(endpoint), 'No unknown provider endpoint may be submitted')
        assert.ok(db.prepare("SELECT count(*) n FROM budget_reservation WHERE status='active'").get().n > 0)
        assert.ok(db.prepare("SELECT count(*) n FROM job_execution_attempt WHERE provider_status='SUBMISSION_UNRESOLVED'").get().n > 0)
        const record = { id: `scope-${requests.length + 1}`, endpoint, input: structuredClone(input), fixture: imageFixture, status: 'IN_PROGRESS' }
        requests.push(record)
        onSubmit?.(record)
        return { request_id: record.id, status: 'IN_QUEUE' }
      },
      async status(endpoint, { requestId }) { const record = requests.find(r => r.id === requestId); assert.ok(record); assert.equal(record.endpoint, endpoint); return { status: record.status } },
      async result(endpoint, { requestId }) {
        const record = requests.find(r => r.id === requestId); assert.ok(record); assert.equal(record.endpoint, endpoint); assert.equal(record.status, 'COMPLETED')
        return endpoint === 'fal-ai/flux/schnell'
          ? { data: { images: [{ url: `https://fal.media/scope/${requestId}.png`, width: 512, height: 512 }], has_nsfw_concepts: [false] } }
          : { data: { video: { url: `https://fal.media/scope/${requestId}.mp4` } } }
      },
    },
    storage: { async upload(blob) { const bytes = Buffer.from(await blob.arrayBuffer()), url = `https://fal.media/scope/upload-${uploads.length + 1}.png`; uploads.push({ bytes, url }); return url } },
  })

  const productId = repo.createProduct({ name: 'Scope regression fixture' })
  const productTest = pt.createProductTestForProduct({ productId, market: 'FR', language: 'fr' })
  const video = (id = 'video', params = {}) => ({ id, capability: 'generate_video', provider: 'fal', model: 'seedance-2.0-fast', modelId: 'fal-seedance-fast', prompt: 'A ceramic cup on a wooden table', params: { duration: 5, resolution: '480p', aspect_ratio: '9:16', generate_audio: false, ...params }, dependencies: [] })
  const image = (id = 'image') => ({ id, capability: 'generate_image', provider: 'fal', model: 'flux-schnell', modelId: 'fal-flux-schnell', prompt: 'A green ceramic cup, neutral background', params: { image_size: 'square', output_format: 'png', num_images: 1 }, dependencies: [] })
  const makePlan = steps => {
    const creativeId = generator.createGeneratorCreative({ productTestId: productTest.id, angle: `Scope regression ${Date.now()}-${requests.length}` }).creativeId
    const iterationId = db.prepare('SELECT iteration_id FROM creative WHERE id=?').get(creativeId).iteration_id
    const validated = validateProductionSteps(steps)
    const [runId] = pt.approveProductionPlan({ plans: [{ creativeId, fineMethod: 'scope_fixture', coarseProductionMethod: 'factory_generated', plannedProvider: 'fal', plannedModel: validated[0].model, generationPlan: { steps: validated }, estimatedCost: null }] })
    return { creativeId, iterationId, runId }
  }
  const start = async plan => { const result = await execution.startProduction(plan.iterationId, [plan.runId]); assert.equal(result.outcomes[0].outcome, 'started', result.outcomes[0].reason); return result }
  const reservations = runId => db.prepare('SELECT br.* FROM budget_reservation br JOIN job j ON j.id=br.job_id WHERE j.production_run_id=? ORDER BY br.id').all(runId)
  const costs = runId => db.prepare('SELECT * FROM cost WHERE production_run_id=?').all(runId)
  const attempts = runId => db.prepare('SELECT a.* FROM job_execution_attempt a JOIN job j ON j.id=a.job_id WHERE j.production_run_id=?').all(runId)

  await check('Malformed frame sources, cycles and conflicting model identities fail before any Job or submit', () => {
    const count = requests.length, before = db.prepare('SELECT count(*) n FROM job').get().n
    assert.throws(() => validateProductionSteps([video('missing', { needs_start_frame: true })]), /start frame is missing/)
    assert.throws(() => validateProductionSteps([image(), { ...video('competing', { start_frame: '/media/local.png' }), dependencies: [{ stepId: 'image' }] }]), /fixed start frame OR/)
    assert.throws(() => validateProductionSteps([{ ...video(), dependencies: [{ stepId: 'future' }] }]), /earlier validated step/)
    assert.throws(() => validateProductionSteps([{ ...image(), dependencies: [{ stepId: 'image' }] }]), /earlier validated step/)
    for (const changed of [{ modelId: 'mock-video' }, { provider: 'mock' }, { model: 'mock-video' }, { capability: 'generate_image' }]) assert.throws(() => validateProductionSteps([{ ...video(), ...changed }]), /identity|MISMATCH|duration|audio/)
    assert.equal(requests.length, count); assert.equal(db.prepare('SELECT count(*) n FROM job').get().n, before)
  })

  await check('Duration-only 15-second step is canonical in frozen M5 Jobs and actual provider payload', async () => {
    const plan = makePlan([video('duration-only', { duration: 15 })]), before = requests.length
    assert.equal(repo.getProductionRunExecution(plan.runId).jobs.length, 0)
    assert.equal(execution.preflightOne(plan.runId).state, 'READY')
    await start(plan)
    assert.equal(requests.length, before + 1); assert.equal(requests[before].input.duration, 15); assert.equal(requests[before].endpoint, fal.FAL_SEEDANCE_ENDPOINTS.t2v)
    const job = repo.getProductionRunExecution(plan.runId).jobs[0]
    assert.equal(job.inputParams.seconds, 15); assert.equal(job.inputParams.duration, 15); assert.equal(job.inputParams.max_attempts, 1)
    requests[before].status = 'COMPLETED'; await dispatcher.reconcileInFlightJobs()
    const done = repo.getProductionRunExecution(plan.runId)
    assert.equal(done.status, 'complete'); assert.equal(done.jobs[0].status, 'complete'); assert.equal(repo.getJobAssetLink(job.id).mime_type, 'video/mp4'); assert.equal(costs(plan.runId).length, 1)
  })

  await check('Steps-only multiple-video run becomes complete after every Job completes', async () => {
    const plan = makePlan([video('one'), video('two')]), before = requests.length
    await start(plan); assert.equal(requests.length, before + 2)
    requests.slice(before).forEach(r => { r.status = 'COMPLETED' }); await dispatcher.reconcileInFlightJobs()
    const run = repo.getProductionRunExecution(plan.runId)
    assert.equal(run.specSnapshot.planning.estimatedGenerationCounts.videoClips, 0)
    assert.ok(run.jobs.every(j => j.status === 'complete')); assert.equal(run.status, 'complete'); assert.equal(costs(plan.runId).length, 2)
  })

  await check('Image→video executes once in dependency order using the exact upstream Asset bytes', async () => {
    imageFixture = 'green'
    const plan = makePlan([image('start'), { ...video('motion'), dependencies: [{ stepId: 'start', type: 'start_frame' }] }]), before = requests.length, beforeUploads = uploads.length
    await start(plan); assert.equal(requests.length, before + 1); assert.equal(requests[before].endpoint, 'fal-ai/flux/schnell')
    let run = repo.getProductionRunExecution(plan.runId), imageJob = run.jobs.find(j => j.capability === 'generate_image'), videoJob = run.jobs.find(j => j.capability === 'generate_video')
    assert.equal(videoJob.status, 'planned'); const deps = repo.listJobDependencies(videoJob.id); assert.equal(deps.length, 1); assert.equal(deps[0].depends_on_job_id, imageJob.id)
    requests[before].status = 'COMPLETED'; await dispatcher.reconcileInFlightJobs()
    assert.equal(requests.length, before + 2); assert.equal(uploads.length, beforeUploads + 1)
    assert.equal(requests[before + 1].endpoint, fal.FAL_SEEDANCE_ENDPOINTS.i2v); assert.equal(requests[before + 1].input.image_url, uploads[beforeUploads].url)
    assert.deepEqual(uploads[beforeUploads].bytes, fixtures.get('green'))
    requests[before + 1].status = 'COMPLETED'; await dispatcher.reconcileInFlightJobs()
    run = repo.getProductionRunExecution(plan.runId); assert.equal(run.status, 'complete'); assert.equal(costs(plan.runId).length, 2)
    const finalAsset = db.prepare('SELECT a.mime_type FROM production_run pr JOIN asset a ON a.id=pr.final_asset_id WHERE pr.id=?').get(plan.runId)
    assert.equal(finalAsset.mime_type, 'video/mp4'); assert.ok(run.jobs.every(j => j.status === 'complete'))
    await dispatcher.reconcileInFlightJobs(); assert.equal(requests.length, before + 2); assert.equal(costs(plan.runId).length, 2)
  })

  await check('Mid-batch FX change stops unsent explicit image Jobs and preserves submitted reservations', async () => {
    setFx(.86)
    const plan = makePlan([image('a'), image('b'), image('c'), image('d')]), before = requests.length
    assert.equal(execution.preflightOne(plan.runId).estimatedPaidMinor, 4)
    onSubmit = () => { if (requests.length === before + 2) setFx(1.2) }
    await start(plan); onSubmit = null
    const run = repo.getProductionRunExecution(plan.runId), held = reservations(plan.runId)
    assert.equal(requests.length, before + 2); assert.equal(run.jobs.filter(j => j.status === 'failed' && j.error_message === 'FX_CHANGED_AFTER_CONFIRMATION').length, 2)
    assert.equal(held.length, 2); assert.ok(held.every(r => r.status === 'active' && r.base_currency_amount_minor === 1 && r.fx_rate === .86)); assert.equal(costs(plan.runId).length, 0)
    assert.equal(attempts(plan.runId).length, 2); assert.ok(attempts(plan.runId).every(a => a.external_request_id.startsWith('fal-image:')))
    await dispatcher.dispatchProductionRun(plan.runId); assert.equal(requests.length, before + 2); assert.equal(reservations(plan.runId).filter(r => r.status === 'active').length, 2)
    setFx(.86)
  })

  await check('Generator video batch also blocks later unsent legacy clips after FX changes', async () => {
    setFx(.86)
    const creativeId = generator.createGeneratorCreative({ productTestId: productTest.id, angle: 'Legacy generator FX scope fixture' }).creativeId
    const draft = name => ({ name, prompt: 'A cup on a table', provider: 'fal', mode: 'text-to-video', seconds: 5, resolution: '480p', aspectRatio: '9:16', generateAudio: false, startAssetId: null })
    let work = generator.saveGeneratorScenes(creativeId, { revision: 0, scenes: [draft('First'), draft('Second')] })
    const quoted = generator.quoteGenerator(creativeId, { revision: work.revision, sceneIds: work.scenes.map(s => s.id) }), before = requests.length
    onSubmit = () => { if (requests.length === before + 1) setFx(1.2) }
    await generator.startGenerator(creativeId, { ...quoted.quote, confirmed: true }); onSubmit = null
    work = generator.generatorWorkspace(creativeId)
    assert.equal(requests.length, before + 1); assert.equal(work.scenes[0].details.reservations[0].status, 'active')
    assert.equal(work.scenes[1].details.run.jobs[0].error_message, 'FX_CHANGED_AFTER_CONFIRMATION'); assert.equal(work.scenes[1].details.reservations.length, 0)
    assert.equal(work.scenes[0].details.costs.length, 0); assert.equal(work.scenes[1].details.costs.length, 0)
    setFx(.86)
  })

  await check('Corrupted existing image cache holds billing, keeps evidence, and does not settle or retry', async () => {
    imageFixture = 'blue'; setFx(.86)
    const expected = fixtures.get('blue'), destination = path.join(media, 'generated', `fal-image-${hash(expected)}.png`), corrupt = Buffer.from('synthetic corrupt cache, preserve until investigation')
    fs.mkdirSync(path.dirname(destination), { recursive: true }); fs.writeFileSync(destination, corrupt)
    const plan = makePlan([image('corrupt-cache')]), before = requests.length
    await start(plan); requests[before].status = 'COMPLETED'; await dispatcher.reconcileInFlightJobs()
    const run = repo.getProductionRunExecution(plan.runId), attempt = attempts(plan.runId)[0]
    assert.equal(attempt.reconciliation_status, 'reconciliation_required'); assert.equal(attempt.failure_classification, 'ambiguous_billing'); assert.match(attempt.error_message, /cache is corrupt/)
    assert.equal(reservations(plan.runId)[0].status, 'active'); assert.equal(costs(plan.runId).length, 0); assert.equal(repo.getJobAssetLink(run.jobs[0].id), null)
    assert.deepEqual(fs.readFileSync(destination), corrupt); assert.equal(fs.readdirSync(path.join(media, 'temp')).filter(f => f.startsWith('fal-image-validation')).length, 0)
    await dispatcher.reconcileInFlightJobs(); assert.equal(requests.length, before + 1); assert.equal(attempts(plan.runId).length, 1); assert.equal(costs(plan.runId).length, 0)
  })

  await check('Dedup to an older missing Asset path holds billing despite a valid fresh download', async () => {
    imageFixture = 'gold'; setFx(.86)
    const expected = fixtures.get('gold'), contentHash = hash(expected), missingPath = 'missing/original-gold.png'
    const old = repo.getOrCreateAsset({ contentHash, relativePath: missingPath, mimeType: 'image/png', fileSize: expected.length, width: 512, height: 512, source: 'uploaded', provider: 'scope-fixture' })
    const plan = makePlan([image('missing-dedup')]), before = requests.length
    await start(plan); requests[before].status = 'COMPLETED'; await dispatcher.reconcileInFlightJobs()
    const run = repo.getProductionRunExecution(plan.runId), attempt = attempts(plan.runId)[0]
    assert.equal(attempt.reconciliation_status, 'reconciliation_required'); assert.equal(attempt.failure_classification, 'ambiguous_billing'); assert.match(attempt.error_message, /no local media Asset/)
    assert.equal(reservations(plan.runId)[0].status, 'active'); assert.equal(costs(plan.runId).length, 0); assert.equal(repo.getJobAssetLink(run.jobs[0].id), null)
    assert.equal(db.prepare('SELECT relative_path FROM asset WHERE id=?').get(old.id).relative_path, missingPath)
    assert.equal(db.prepare('SELECT count(*) n FROM asset WHERE content_hash=?').get(contentHash).n, 1)
    assert.ok(fs.existsSync(path.join(media, 'generated', `fal-image-${contentHash}.png`))); assert.equal(fs.existsSync(path.join(media, missingPath)), false)
    await dispatcher.reconcileInFlightJobs(); assert.equal(requests.length, before + 1); assert.equal(attempts(plan.runId).length, 1); assert.equal(costs(plan.runId).length, 0)
  })

  await check('Synthetic run leaves valid SQLite, exact one-use attempts and no real provider calls', () => {
    assert.equal(db.pragma('integrity_check', { simple: true }), 'ok')
    assert.equal(db.prepare('SELECT count(*) n FROM job_execution_attempt WHERE dispatch_attempt>1').get().n, 0)
    assert.ok(requests.every(r => r.id.startsWith('scope-'))); assert.ok(uploads.every(u => u.url.startsWith('https://fal.media/scope/')))
  })
  console.log(`\nProduction scope: ${passed}/${passed + failures.length} passed; ${failures.length} failed. Paid provider calls: 0. Port servers: 0.`)
  if (failures.length) process.exitCode = 1
} finally {
  globalThis.fetch = originalFetch
  fal?.setFalClientForTests(null)
  repo?.closeDb()
  const temporaryRoot = path.resolve(os.tmpdir()) + path.sep, resolved = path.resolve(temp)
  if (resolved.startsWith(temporaryRoot) && path.basename(resolved).startsWith('aaf-production-scope-')) fs.rmSync(resolved, { recursive: true, force: true })
}
