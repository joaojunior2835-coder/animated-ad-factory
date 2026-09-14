// Workstation recovery boundaries: isolated SQLite, synthetic fal, no network.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'aaf-workstation-recovery-'))
process.env.FACTORY_DB_PATH = path.join(temp, 'factory.db')
process.env.FACTORY_MEDIA_ROOT = path.join(temp, 'media')
process.env.MOCK_VIDEO_DELAY_MS = '0'
for (const key of ['FAL_API_KEY', 'OPENAI_API_KEY', 'GROQ_API_KEY', 'OPENROUTER_API_KEY', 'POLLINATIONS_API_KEY', 'REPLICATE_API_TOKEN']) process.env[key] = ''
process.env.FAL_API_KEY = 'synthetic-workstation-key-never-send'
fs.mkdirSync(process.env.FACTORY_MEDIA_ROOT)
const originalFetch = globalThis.fetch, submissions = [], uploads = [], failures = []
let repo, fal, passed = 0, networkAttempts = 0
globalThis.fetch = async () => { networkAttempts++; throw new Error('Unmocked network is forbidden') }
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const check = async (name, run) => {
  try { await run(); passed++; console.log(`PASS ${name}`) }
  catch (error) { failures.push(name); console.error(`FAIL ${name}\n${error.stack || error.message}`) }
}

try {
  const { runMigrations } = await import('../server/db/migrate.mjs')
  runMigrations({ dbPath: process.env.FACTORY_DB_PATH, log: { log() {} } })
  repo = await import('../server/db/repository.mjs')
  const pt = await import('../server/db/productTestRepository.mjs')
  const generator = await import('../server/lib/creativeGenerator.mjs')
  const steps = await import('../server/lib/productionSteps.mjs')
  const models = await import('../server/lib/modelCapabilities.mjs')
  const rates = await import('../server/lib/rateCatalog.mjs')
  const mockImage = await import('../server/providers/mockImageProvider.mjs')
  const m6 = await import('../server/lib/assembly.mjs')
  fal = await import('../server/providers/falProvider.mjs')
  const db = repo.getDb()
  fal.setFalClientForTests({
    queue: {
      async submit(endpoint, { input }) {
        assert.ok(db.prepare("SELECT count(*) n FROM budget_reservation WHERE status='active'").get().n > 0)
        assert.ok(db.prepare("SELECT count(*) n FROM job_execution_attempt WHERE provider_status='SUBMISSION_UNRESOLVED'").get().n > 0)
        const requestId = `synthetic-recovery-${submissions.length + 1}`
        submissions.push({ requestId, endpoint, input: structuredClone(input) })
        return { request_id: requestId, status: 'IN_QUEUE' }
      },
      async status() { return { status: 'IN_PROGRESS' } },
      async result() { throw new Error('Recovery tests never download paid-shaped results') },
    },
    storage: { async upload(blob) { uploads.push(Buffer.from(await blob.arrayBuffer())); return `https://fal.media/recovery/input-${uploads.length}.png` } },
  })
  const productId = repo.createProduct({ name: 'Recovery fixture' })
  const productTest = pt.createProductTestForProduct({ productId, market: 'FR', language: 'fr' })
  const creative = angle => generator.createGeneratorCreative({ productTestId: productTest.id, angle }).creativeId
  const scene = values => ({ name: 'Product detail', prompt: 'A ceramic product on a neutral surface', provider: 'fal', mode: 'text-to-video', seconds: 5, resolution: '480p', aspectRatio: '9:16', generateAudio: false, quantity: 1, startAssetId: null, ...values })
  const quote = (id, workspace) => generator.quoteGenerator(id, { revision: workspace.revision, sceneIds: workspace.scenes.map(s => s.id) })
  const counts = () => ({ jobs: db.prepare('SELECT count(*) n FROM job').get().n, holds: db.prepare('SELECT count(*) n FROM budget_reservation').get().n, submits: submissions.length })
  const captureFx = (rate, capturedAt) => {
    repo.setFxRate({ fromCurrency: 'USD', toCurrency: 'EUR', rate, source: 'synthetic-recovery' })
    // Fix only this isolated fixture's capture timestamp, avoiding clock/sleep races.
    const key = 'fx_rate_USD_EUR', payload = JSON.parse(db.prepare('SELECT value FROM app_settings WHERE key=?').get(key).value)
    payload.updatedAt = capturedAt
    db.prepare('UPDATE app_settings SET value=? WHERE key=?').run(JSON.stringify(payload), key)
    return repo.getFxRate('USD', 'EUR')
  }

  const fxId = creative('Same-rate FX recapture'), inputId = creative('Changed local input')
  let oldFxQuote, freshFxQuote, originalFx, restoredFx, oldInputQuote, freshInputQuote, originalInput, replacementInput, inputAsset
  await check('An FX recapture with the same numeric rate invalidates the old confirmation before Jobs or submissions', async () => {
    originalFx = captureFx(.91, '2026-09-15T01:00:00.000Z')
    let workspace = generator.saveGeneratorScenes(fxId, { revision: 0, scenes: [scene()] })
    oldFxQuote = quote(fxId, workspace)
    const before = counts(), oldRun = repo.getProductionRunExecution(oldFxQuote.quote.runIds[0])
    assert.equal(oldRun.jobs.length, 0)
    assert.equal(oldRun.specSnapshot.planning.generationPlan.videoClips[0].authorized_fx_signature, JSON.stringify(originalFx))
    captureFx(.92, '2026-09-15T01:01:00.000Z')
    restoredFx = captureFx(.91, '2026-09-15T01:02:00.000Z')
    assert.equal(originalFx.rate, restoredFx.rate); assert.equal(originalFx.source, restoredFx.source)
    assert.notEqual(originalFx.updatedAt, restoredFx.updatedAt)
    assert.equal(generator.estimateGenerator(fxId, oldFxQuote.quote.sceneIds).totalMinor, oldFxQuote.quote.totalMinor)
    await assert.rejects(generator.startGenerator(fxId, { ...oldFxQuote.quote, confirmed: true }), /FX changed/)
    assert.deepEqual(counts(), before)
    assert.equal(generator.generatorWorkspace(fxId).quote.used, false)
    assert.deepEqual(repo.getProductionRunExecution(oldRun.id).specSnapshot, oldRun.specSnapshot)
  })
  await check('A fresh FX quote creates a new plan and dispatches its newly authorized frozen clip', async () => {
    freshFxQuote = quote(fxId, generator.generatorWorkspace(fxId))
    const runId = freshFxQuote.quote.runIds[0], previousId = oldFxQuote.quote.runIds[0]
    assert.notEqual(runId, previousId, 'Do not reuse a pending clip with an obsolete FX capture')
    assert.equal(freshFxQuote.quote.totalMinor, oldFxQuote.quote.totalMinor)
    assert.equal(freshFxQuote.quote.fxSignature, JSON.stringify(restoredFx))
    assert.equal(repo.getProductionRunExecution(runId).jobs.length, 0)
    const snapshot = structuredClone(repo.getProductionRunExecution(runId).specSnapshot)
    assert.equal(snapshot.planning.generationPlan.videoClips[0].authorized_fx_signature, JSON.stringify(restoredFx))
    await generator.startGenerator(fxId, { ...freshFxQuote.quote, confirmed: true })
    const live = generator.generatorWorkspace(fxId).scenes[0], run = live.details.run
    assert.equal(submissions.length, 1); assert.equal(run.id, runId); assert.equal(run.jobs.length, 1)
    assert.ok(run.spec_frozen_at); assert.equal(run.jobs[0].inputParams.authorized_fx_signature, JSON.stringify(restoredFx))
    assert.equal(run.jobs[0].inputParams.max_attempts, 1); assert.equal(run.jobs[0].inputParams.generate_audio, false)
    assert.deepEqual(run.specSnapshot.planning, snapshot.planning)
    assert.equal(live.details.reservations.length, 1); assert.equal(live.details.reservations[0].status, 'active')
    assert.equal(repo.getProductionRunExecution(previousId).jobs.length, 0)
    await assert.rejects(generator.startGenerator(fxId, { ...freshFxQuote.quote, confirmed: true }))
    assert.equal(submissions.length, 1)
  })
  await check('Changing actual I2V file bytes invalidates the quote even when Asset identity/hash metadata are unchanged', async () => {
    for (const [index, color] of ['white', 'blue'].entries()) {
      const target = path.join(temp, `input-${index}.png`)
      const result = await m6.runVideoTool(await m6.videoTool(), ['-hide_banner', '-nostdin', '-f', 'lavfi', '-i', `color=c=${color}:s=64x64`, '-frames:v', '1', '-threads', '1', '-update', '1', target])
      assert.equal(result.code, 0, result.stderr)
    }
    originalInput = fs.readFileSync(path.join(temp, 'input-0.png')); replacementInput = fs.readFileSync(path.join(temp, 'input-1.png'))
    assert.notEqual(hash(originalInput), hash(replacementInput))
    const file = path.join(process.env.FACTORY_MEDIA_ROOT, 'product-reference.png')
    fs.copyFileSync(path.join(temp, 'input-0.png'), file)
    inputAsset = repo.getOrCreateAsset({ contentHash: hash(originalInput), relativePath: 'product-reference.png', mimeType: 'image/png', source: 'uploaded' })
    const workspace = generator.saveGeneratorScenes(inputId, { revision: 0, scenes: [scene({ mode: 'image-to-video', startAssetId: inputAsset.id })] })
    oldInputQuote = quote(inputId, workspace)
    assert.deepEqual(oldInputQuote.quote.referenceVersions, [{ id: inputAsset.id, hash: hash(originalInput) }])
    const before = counts()
    fs.copyFileSync(path.join(temp, 'input-1.png'), file)
    assert.equal(db.prepare('SELECT content_hash FROM asset WHERE id=?').get(inputAsset.id).content_hash, hash(originalInput))
    await assert.rejects(generator.startGenerator(inputId, { ...oldInputQuote.quote, confirmed: true }), /Reference media changed/)
    assert.deepEqual(counts(), before); assert.equal(uploads.length, 0)
    assert.equal(repo.getProductionRunExecution(oldInputQuote.quote.runIds[0]).jobs.length, 0)
    assert.equal(generator.generatorWorkspace(inputId).quote.used, false)
  })
  await check('A fresh reference quote uses the changed bytes and leaves the obsolete draft without Jobs', async () => {
    freshInputQuote = quote(inputId, generator.generatorWorkspace(inputId))
    assert.notEqual(freshInputQuote.quote.runIds[0], oldInputQuote.quote.runIds[0])
    assert.deepEqual(freshInputQuote.quote.referenceVersions, [{ id: inputAsset.id, hash: hash(replacementInput) }])
    assert.equal(repo.getProductionRunExecution(freshInputQuote.quote.runIds[0]).jobs.length, 0)
    await generator.startGenerator(inputId, { ...freshInputQuote.quote, confirmed: true })
    assert.equal(submissions.length, 2); assert.equal(uploads.length, 1); assert.ok(uploads[0].equals(replacementInput))
    assert.ok(!uploads[0].equals(originalInput))
    const live = generator.generatorWorkspace(inputId).scenes[0]
    assert.equal(live.details.run.jobs.length, 1); assert.ok(live.details.run.spec_frozen_at)
    assert.equal(live.details.run.specSnapshot.planning.generationPlan.videoClips[0].start_frame, '/media/product-reference.png')
    assert.equal(submissions[1].endpoint, fal.FAL_SEEDANCE_ENDPOINTS.i2v)
    assert.equal(submissions[1].input.image_url, 'https://fal.media/recovery/input-1.png')
    assert.equal(submissions[1].input.generate_audio, false)
    assert.equal(repo.getProductionRunExecution(oldInputQuote.quote.runIds[0]).jobs.length, 0)
  })
  await check('Unknown prices, conflicting model identity and incompatible image controls fail closed', () => {
    const before = counts()
    const image = { id: 'image', capability: 'generate_image', provider: 'fal', model: 'flux-schnell', modelId: 'fal-flux-schnell', prompt: 'A ceramic object', params: { image_size: 'square', output_format: 'png', num_images: 1 } }
    assert.equal(rates.estimateImageJobCost('unpriced-image-model', image.params).unknown, true)
    assert.equal(steps.priceProductionStep({ ...image, model: 'unpriced-image-model' }).unknown, true)
    assert.throws(() => steps.validateProductionSteps([{ ...image, modelId: 'unpriced-image-model', model: 'unpriced-image-model' }]), /MISMATCH/)
    for (const identity of [{ provider: 'mock' }, { model: 'mock-image' }, { modelId: 'mock-image' }, { capability: 'generate_video' }]) {
      assert.throws(() => steps.validateProductionSteps([{ ...image, ...identity }]), /Conflicting|MISMATCH/)
    }
    for (const incompatible of [{ quality: 'high' }, { duration: 5 }, { seconds: 5 }, { generate_audio: false }, { image_size: 'unsupported' }, { output_format: 'webp' }, { num_images: 2 }, { start_frame: '/media/product-reference.png' }, { referenceAssetIds: [inputAsset.id] }]) {
      assert.throws(() => steps.validateProductionSteps([{ ...image, params: { ...image.params, ...incompatible } }]), /does not accept|supported image size|PNG or JPEG|One image per Job|text-only/)
    }
    const credential = process.env.FAL_API_KEY
    try {
      process.env.FAL_API_KEY = ''
      assert.equal(rates.estimateImageJobCost('flux-schnell', image.params).unknown, true)
      assert.throws(() => steps.validateProductionSteps([image]), /NOT_CONFIGURED/)
    } finally { process.env.FAL_API_KEY = credential }
    assert.deepEqual(counts(), before)
  })
  await check('Actual shared ModelSettings renders only capability-supported controls and preserves numeric/audio values', async () => {
    // Transform the real JSX in memory using Vite's already-installed esbuild.
    const { transformSync } = await import('esbuild'), React = await import('react'), { renderToStaticMarkup } = await import('react-dom/server')
    const source = fs.readFileSync(new URL('../src/components/ModelSettings.jsx', import.meta.url), 'utf8')
    const compiled = transformSync(source, { loader: 'jsx', format: 'cjs', jsx: 'automatic' }).code
    const module = { exports: {} }
    new Function('require', 'module', 'exports', compiled)(createRequire(import.meta.url), module, module.exports)
    const ModelSettings = module.exports.default, allModels = models.modelCapabilities()
    const imageModel = allModels.find(m => m.id === 'mock-image'), videoModel = allModels.find(m => m.id === 'mock-video'), changes = []
    const imageProps = { model: imageModel, value: { imageSize: 'square', outputFormat: 'png', quantity: 2 }, onChange: (...args) => changes.push(args), image: true, prefix: 'Image' }
    const markup = renderToStaticMarkup(React.createElement(ModelSettings, imageProps))
    assert.equal((markup.match(/<select /g) || []).length, 3)
    assert.match(markup, /Image size/); assert.match(markup, /Image format/); assert.match(markup, /Image output quantity/)
    assert.doesNotMatch(markup, /Duration|Resolution|Generate audio|[Qq]uality/)
    const nodes = node => !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(nodes) : [node, ...nodes(node.props?.children)]
    const quantity = nodes(ModelSettings(imageProps)).find(n => n.type === 'select' && n.props['aria-label'] === 'Image output quantity')
    quantity.props.onChange({ target: { value: '4' } }); assert.deepEqual(changes.pop(), ['quantity', 4])
    const videoProps = { model: videoModel, value: { seconds: 5, resolution: '480p', aspectRatio: '9:16', quantity: 1, generateAudio: false }, reference: true, onChange: (...args) => changes.push(args) }
    const videoNodes = nodes(ModelSettings(videoProps)), aspect = videoNodes.find(n => n.type === 'select' && n.props['aria-label'] === 'aspect ratio')
    assert.deepEqual(nodes(aspect).filter(n => n.type === 'option').map(n => n.props.value), ['9:16', 'auto'])
    const audio = videoNodes.find(n => n.type === 'input' && n.props.type === 'checkbox')
    assert.equal(audio.props.checked, false); audio.props.onChange({ target: { checked: true } }); assert.deepEqual(changes.pop(), ['generateAudio', true])
    const missing = nodes(ModelSettings({ ...imageProps, model: null }))
    assert.ok(missing.filter(n => n.type === 'select').every(n => n.props.disabled))
    assert.match(renderToStaticMarkup(React.createElement(ModelSettings, { ...imageProps, value: { ...imageProps.value, imageSize: 'unknown' } })), /Choose a supported setting/)
  })
  await check('Parallel local Mock image polls resolve one complete atomic file without duplicate failures', async () => {
    const before = counts(), request = mockImage.createMockImageJob({ prompt: 'A local fixture', image_size: 'square', output_format: 'png' })
    const results = await Promise.allSettled(Array.from({ length: 12 }, () => mockImage.getMockImageJob(request.jobId, process.env.FACTORY_MEDIA_ROOT)))
    assert.ok(results.every(r => r.status === 'fulfilled'), results.filter(r => r.status === 'rejected').map(r => String(r.reason)).join('\n'))
    const first = results[0].value
    assert.equal(first.status, 'COMPLETED'); assert.ok(results.every(r => JSON.stringify(r.value) === JSON.stringify(first)))
    const file = m6.localAssetPath(first.result.local_url.slice('/media/'.length)), bytes = fs.readFileSync(file)
    assert.deepEqual(bytes.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    assert.equal(bytes.readUInt32BE(16), 512); assert.equal(bytes.readUInt32BE(20), 512); assert.equal(bytes.length, first.result.file_size)
    const decode = await m6.runVideoTool(await m6.videoTool(), ['-hide_banner', '-nostdin', '-v', 'error', '-i', file, '-f', 'null', '-'])
    assert.equal(decode.code, 0, decode.stderr)
    assert.deepEqual(fs.readdirSync(path.dirname(file)), [path.basename(file)], 'No duplicate outputs or unfinished scratch images remain')
    const repeated = await Promise.all(Array.from({ length: 4 }, () => mockImage.getMockImageJob(request.jobId, process.env.FACTORY_MEDIA_ROOT)))
    assert.ok(repeated.every(r => JSON.stringify(r) === JSON.stringify(first))); assert.equal(hash(fs.readFileSync(file)), hash(bytes))
    assert.deepEqual(counts(), before)
  })
  await check('Recovery checks leave single attempts, no Costs, valid SQLite and zero network calls', () => {
    assert.equal(db.prepare('SELECT count(*) n FROM job_execution_attempt WHERE dispatch_attempt>1').get().n, 0)
    assert.equal(db.prepare('SELECT count(*) n FROM cost').get().n, 0)
    assert.equal(db.prepare('SELECT count(*) n FROM job').get().n, 2)
    assert.equal(db.prepare("SELECT count(*) n FROM budget_reservation WHERE status='active'").get().n, 2)
    assert.equal(db.pragma('integrity_check', { simple: true }), 'ok'); assert.equal(networkAttempts, 0)
  })
  console.log(`\nWorkstation recovery: ${passed}/${passed + failures.length} passed; ${failures.length} failed. Paid provider calls: 0. Network calls: ${networkAttempts}.`)
  if (failures.length) process.exitCode = 1
} finally {
  globalThis.fetch = originalFetch; fal?.setFalClientForTests(null); repo?.closeDb()
  const resolved = path.resolve(temp), prefix = path.resolve(os.tmpdir()) + path.sep
  if (resolved.startsWith(prefix) && path.basename(resolved).startsWith('aaf-workstation-recovery-')) fs.rmSync(resolved, { recursive: true, force: true })
}
