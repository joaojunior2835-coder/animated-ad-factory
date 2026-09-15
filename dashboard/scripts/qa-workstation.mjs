// Browser -> isolated SQLite/media -> Mock image/video M5 -> local M6.
// All paid credentials are blank and both backend/browser remote requests fail.
// Requires the operator's existing Vite server on 5173; owns backend 8797 only.
import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import net from 'node:net'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'

const api = 'http://127.0.0.1:8797'
const web = 'http://localhost:5173'
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'aaf-workstation-browser-'))
const databasePath = path.join(temp, 'factory.db')
const artifacts = path.resolve('qa-artifacts/workstation')
fs.mkdirSync(artifacts, { recursive: true })
const environment = { ...process.env, PORT: '8797', FACTORY_DB_PATH: databasePath, FACTORY_MEDIA_ROOT: path.join(temp, 'media'), MOCK_VIDEO_DELAY_MS: '3000', PRODUCTION_POLL_INTERVAL_MS: '100' }
for (const key of new Set([...Object.keys(environment).filter(key => /(_API_KEY|_API_TOKEN|^FAL_KEY)$/.test(key)), 'FAL_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'OPENROUTER_API_KEY', 'GROQ_API_KEY', 'POLLINATIONS_API_KEY', 'REPLICATE_API_TOKEN'])) environment[key] = ''

const networkGuard = `
import http from 'node:http';
import https from 'node:https';
import { syncBuiltinESMExports } from 'node:module';
const allow = value => {
  const host = typeof value === 'string' || value instanceof URL ? new URL(value).hostname : value?.hostname || value?.host || '';
  if (!['127.0.0.1','localhost','::1','[::1]'].includes(host)) {
    process.stderr.write('AAF_QA_BLOCKED_NETWORK ' + String(host).replace(/[^a-zA-Z0-9.:-]/g,'') + '\\n');
    throw new Error('QA forbids external network requests.');
  }
};
const originalFetch = globalThis.fetch;
globalThis.fetch = (input, options) => { allow(input instanceof Request ? input.url : input); return originalFetch(input, options); };
for (const module of [http, https]) for (const method of ['request','get']) {
  const original = module[method]; module[method] = function(input, ...rest) { allow(input); return original.call(this, input, ...rest); };
}
syncBuiltinESMExports();
`
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
const checks = [], screenshots = [], playbackReceipts = [], pageErrors = [], remoteAttempts = [], unsafeRequests = [], writes = []
let backend, browser, page, db, backendLog = '', productTestId, creativeId, imageCreativeId, videoCreativeId, imageAssetId, videoSceneId, studioSceneId, canvasVideoNodeId, canvasVideoAssetId

async function read(route) {
  const response = await fetch(api + route)
  const result = await response.json()
  assert.equal(response.ok, true, `GET ${route}: ${JSON.stringify(result)}`)
  return result
}
const workspace = id => read(`/api/operator/generator/${id}`).then(result => result.workspace)
const options = () => read('/api/operator/generator/options')
const canvas = async () => {
  const response = await fetch(api + '/api/canvas/projects/default')
  if (response.status === 404) return { nodes: [], connections: [] } // First debounced save has not created the board yet.
  const result = await response.json()
  assert.equal(response.ok, true, JSON.stringify(result))
  return result.item.canvasJson
}
const canvasStatus = () => read('/api/operator/canvas/default/status')
async function until(fn, message, timeout = 30000) {
  const end = Date.now() + timeout
  let last
  while (Date.now() < end) { last = await fn(); if (last) return last; await delay(150) }
  throw new Error(`${message}; last observed ${JSON.stringify(last)}`)
}
async function check(name, fn) {
  const start = Date.now()
  try { await fn(); checks.push({ name, status: 'PASS', milliseconds: Date.now() - start }); console.log(`PASS ${name}`) }
  catch (error) { checks.push({ name, status: 'FAIL', milliseconds: Date.now() - start, error: error.message }); throw error }
}
function counts() {
  return Object.fromEntries(['product', 'product_test', 'creative', 'job', 'asset', 'cost', 'budget_reservation'].map(table => [table, db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n]))
}
const nav = key => page.locator(`nav.sidebar-left button.nav[data-workspace="${key}"]`)
const generator = () => page.getByTestId('creative-generator')
const image = () => page.getByTestId('image-workspace')
const studio = () => page.getByTestId('studio-workbench')
const scene = number => page.getByTestId(`generator-scene-${number}`)
async function navigate(key) {
  if (await nav(key).count() && !(await nav(key).first().isVisible())) await page.getByText('Projects / Advanced', { exact: true }).click()
  await nav(key).click()
  await page.locator(`.workstation-shell[data-workspace="${key}"]`).waitFor()
}
async function imageSaved() {
  const prompt = await image().getByLabel('Image prompt', { exact: true }).inputValue()
  await image().getByText('Saved locally', { exact: true }).waitFor()
  await until(async () => {
    const rows = db.prepare("SELECT key, value FROM app_settings WHERE key LIKE 'creative_generator_%'").all()
    for (const row of rows) {
      const state = JSON.parse(row.value)
      if (state.scenes?.some(scene => scene.kind === 'image' && scene.prompt === prompt)) {
        imageCreativeId = Number(row.key.replace('creative_generator_', ''))
        return true
      }
    }
    return false
  }, 'Exact image prompt was not persisted')
}
async function currentImageCreativeId() {
  if (imageCreativeId) return imageCreativeId
  await until(async () => {
    const catalog = await options()
    const match = catalog.creatives.filter(row => row.angle === 'Quick image draft').sort((a, b) => b.id - a.id)[0]
    if (match) imageCreativeId = match.id
    return imageCreativeId
  }, 'Quick image Creative was not created')
  return imageCreativeId
}
async function generatorSaved() { await generator().getByText('Saved locally', { exact: true }).waitFor() }
async function shot(name, locator) {
  if (locator) await locator.scrollIntoViewIfNeeded()
  if (locator) for (const video of await locator.locator('video').all()) {
    if (await video.isVisible()) await play(video, `screenshot:${name}`)
  }
  const file = path.join(artifacts, `${name}.png`)
  await page.screenshot({ path: file })
  screenshots.push(file)
}
async function assertNoHorizontalOverflow(label) {
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${label} overflows the viewport`)
}
async function play(locator, label = 'journey playback') {
  await locator.waitFor()
  await locator.scrollIntoViewIfNeeded()
  const receipt = await locator.evaluate(async video => {
    video.muted = true
    if (video.ended || Number.isFinite(video.duration) && video.duration - video.currentTime < .5) video.currentTime = 0
    await video.play()
    const frameTime = await new Promise((resolve, reject) => {
      let callback
      const timeout = setTimeout(() => { if (callback) video.cancelVideoFrameCallback(callback); reject(new Error(`No decoded video frame: readyState=${video.readyState}, time=${video.currentTime}, width=${video.videoWidth}, error=${video.error?.message || 'none'}`)) }, 12000)
      const nextFrame = (_now, metadata) => {
        if (video.readyState >= 2 && video.videoWidth > 0 && video.currentTime > .2 && metadata.mediaTime > .2) {
          clearTimeout(timeout); resolve(metadata.mediaTime)
        } else callback = video.requestVideoFrameCallback(nextFrame)
      }
      callback = video.requestVideoFrameCallback(nextFrame)
    })
    video.pause()
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    return { src: video.currentSrc, duration: video.duration, currentTime: video.currentTime, renderedFrameTime: frameTime, readyState: video.readyState, width: video.videoWidth, height: video.videoHeight, playsInline: video.playsInline }
  })
  assert.ok(receipt.readyState >= 2 && receipt.width > 0 && receipt.currentTime > .2 && receipt.renderedFrameTime > .2, 'Local video did not decode and render a frame')
  playbackReceipts.push({ label, ...receipt })
  return receipt
}

try {
  await new Promise((resolve, reject) => {
    const probe = net.createServer()
    probe.once('error', reject)
    probe.listen(8797, '127.0.0.1', () => probe.close(resolve))
  })
  backend = spawn(process.execPath, ['--import', `data:text/javascript,${encodeURIComponent(networkGuard)}`, 'server/index.mjs'], { env: environment, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  for (const stream of [backend.stdout, backend.stderr]) stream.on('data', chunk => { backendLog = (backendLog + chunk.toString()).slice(-40000) })
  await until(async () => { try { const response = await fetch(api + '/health'); if (!response.ok) return false; const health = await response.json(); assert.ok(Object.values(health.providers_configured).every(value => value === false)); return true } catch { return false } }, 'Isolated backend failed to start', 15000)
  db = new Database(databasePath, { readonly: true })
  assert.equal(counts().product_test, 0)
  browser = await chromium.launch()
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true })
  await context.addInitScript(url => localStorage.setItem('API_BASE_URL', url), api)
  await context.route('**/*', route => {
    const request = route.request(), url = new URL(request.url())
    if (!['localhost', '127.0.0.1'].includes(url.hostname)) { remoteAttempts.push(url.hostname); return route.abort() }
    if (!['5173', '8797'].includes(url.port)) { unsafeRequests.push(`${url.origin}${url.pathname}`); return route.abort() }
    if (url.port === '5173' && url.pathname.startsWith('/media/')) { unsafeRequests.push('Media bypassed the isolated API base: ' + url.pathname); return route.abort() }
    return route.continue()
  })
  page = await context.newPage()
  page.setDefaultTimeout(25000)
  page.on('pageerror', error => pageErrors.push(error.message))
  page.on('dialog', dialog => dialog.accept())
  page.on('request', request => {
    const url = new URL(request.url())
    if (url.origin === api && request.method() === 'POST') writes.push({ path: url.pathname, body: request.headers()['content-type']?.includes('application/json') ? request.postDataJSON() : null })
  })

  await check('Shared navigation exposes all creative workspaces and preserves legacy Canvas selectors', async () => {
    await page.goto(web)
    await image().waitFor()
    for (const key of ['image', 'video', 'remix', 'node_canvas', 'marketing_studio', 'assets']) assert.equal(await nav(key).count(), 1)
    assert.equal(await page.locator('.workspace-primary-nav button.nav', { has: page.getByText('Canvas', { exact: true }) }).count(), 1)
    assert.equal(await page.locator('.workspace-primary-nav button.nav', { has: page.getByText('Product Tests', { exact: true }) }).count(), 0)
    assert.equal(await page.locator('vite-error-overlay').count(), 0)
    await assertNoHorizontalOverflow('Desktop shell')
    await shot('shell-desktop')
  })
  const scratchPrompt = 'A clean still life of an unbranded bottle, soft side light and a neutral background.'
  await check('Image prompt survives immediate navigation before financial context; no hidden records or Jobs', async () => {
    await navigate('image')
    await image().getByLabel('Image prompt', { exact: true }).fill(scratchPrompt)
    await navigate('assets')
    await page.getByTestId('assets-workspace').waitFor()
    await navigate('image')
    assert.equal(await image().getByLabel('Image prompt', { exact: true }).inputValue(), scratchPrompt)
    const c = counts()
    assert.equal(c.job, 0)
    assert.equal(c.asset, 0)
    assert.equal(c.cost, 0)
    assert.equal(c.budget_reservation, 0)
    await shot('image-empty-desktop', image().getByTestId('image-composer'))
  })
  await check('Operator explicitly creates Product Test and Creative through the dashboard', async () => {
    await navigate('create_ad')
    await generator().getByText('New product', { exact: true }).click()
    await generator().getByLabel('Product name', { exact: true }).fill('Workstation fixture bottle')
    await generator().getByRole('button', { name: 'Create product', exact: true }).click()
    await generator().getByLabel('Product Test', { exact: true }).getByRole('option', { name: 'Workstation fixture bottle' }).waitFor({ state: 'attached' })
    await generator().getByLabel('New Creative title', { exact: true }).fill('Image to video acceptance')
    await generator().getByRole('button', { name: 'Create ad', exact: true }).click()
    await generator().getByRole('heading', { name: 'Image to video acceptance', exact: true }).waitFor()
    const catalog = await options()
    productTestId = catalog.productTests.find(row => row.name === 'Workstation fixture bottle').id
    creativeId = catalog.creatives.find(row => row.angle === 'Image to video acceptance').id
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM creative WHERE angle = 'Image to video acceptance'").get().n, 1)
    assert.equal(counts().job, 0)
  })
  await check('Image capability controls and immediate navigation persist exact size, quantity and prompt server-side', async () => {
    await navigate('image')
    await image().getByLabel('Image model', { exact: true }).selectOption('mock-image')
    assert.equal(await image().getByLabel('Image prompt', { exact: true }).inputValue(), scratchPrompt)
    await image().getByLabel('Image size', { exact: true }).selectOption('portrait_4_3')
    await image().getByLabel('Image output quantity', { exact: true }).selectOption('2')
    await image().getByLabel('Image format', { exact: true }).selectOption('png')
    await navigate('assets')
    await navigate('image')
    await imageSaved()
    const saved = (await workspace(imageCreativeId)).scenes.find(scene => scene.kind === 'image')
    assert.equal(saved.imageSize, 'portrait_4_3')
    assert.equal(saved.quantity, 2)
    assert.equal(saved.outputFormat, 'png')
    assert.equal(saved.prompt, scratchPrompt)
    assert.equal(await image().getByRole('combobox', { name: /duration|quality/i }).count(), 0)
    assert.equal(counts().job, 0)
  })
  await check('Image quote lists exact Jobs and attempt cap; Cancel and setting edits never dispatch', async () => {
    await image().locator('.iw-generate').click()
    const dialog = page.getByRole('dialog', { name: 'Generate 2 images?' })
    await dialog.waitFor()
    assert.match(await dialog.innerText(), /2 images · 2 Jobs/)
    assert.match(await dialog.innerText(), /1 per Job/)
    assert.match(await dialog.innerText(), /768 × 1024/)
    assert.match(await dialog.innerText(), /€0\.00/)
    const firstQuote = (await workspace(imageCreativeId)).quote
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    assert.equal(counts().job, 0)
    await image().getByLabel('Image prompt', { exact: true }).fill(scratchPrompt + ' A subtle shadow falls to the right.')
    await imageSaved()
    assert.equal((await workspace(imageCreativeId)).quote, null)
    await image().locator('.iw-generate').click()
    await dialog.waitFor()
    assert.notEqual((await workspace(imageCreativeId)).quote.token, firstQuote.token)
    await shot('image-confirm-desktop')
  })
  await check('Explicit image confirmation produces exactly two local outputs and two one-attempt Jobs', async () => {
    const beforeStarts = writes.filter(write => write.path.endsWith('/start')).length
    await page.getByRole('dialog').getByRole('button', { name: /Confirm generation/ }).click({ clickCount: 2 })
    await until(async () => (await workspace(imageCreativeId)).scenes.find(scene => scene.kind === 'image')?.outputs?.length === 2, 'Image quantity=2 did not produce two output records', 60000)
    await image().locator('.iw-output').nth(1).waitFor()
    const generated = (await workspace(imageCreativeId)).scenes.find(scene => scene.kind === 'image')
    assert.equal(generated.status, 'Complete')
    assert.equal(generated.details.run.jobs.length, 2)
    assert.equal(generated.details.attempts.length, 2)
    assert.equal(new Set(generated.outputs.map(asset => asset.id)).size, 2)
    assert.ok(generated.outputs.every(asset => asset.mime_type === 'image/png' && asset.width === 768 && asset.height === 1024))
    assert.ok(generated.details.run.jobs.every(job => job.provider === 'mock' && job.retry_count === 0))
    assert.equal(writes.filter(write => write.path.endsWith('/start')).length, beforeStarts + 1)
    await image().locator('.iw-output').nth(1).click()
    await until(async () => (await workspace(imageCreativeId)).scenes.find(scene => scene.kind === 'image')?.selectedAssetId === generated.outputs[1].id, 'Selected output was not saved')
    imageAssetId = generated.outputs[1].id
    await page.reload()
    await image().locator(`.iw-output[data-testid="image-output-${imageAssetId}"][aria-pressed="true"]`).waitFor()
    await until(() => image().locator('.iw-output img').evaluateAll(images => images.length === 2 && images.every(image => image.complete && image.naturalWidth > 0)), 'Image previews did not load')
    await shot('image-results-desktop', image().locator('.iw-output-grid'))
    await shot('image-composer-desktop', image().getByTestId('image-composer'))
  })
  await check('A second two-image run retains history and settles concurrent Mock outputs once each', async () => {
    const previous = (await workspace(imageCreativeId)).scenes.find(scene => scene.kind === 'image'), before = counts()
    await image().locator('.iw-generate').click()
    await page.getByRole('dialog').getByRole('button', { name: /Confirm generation/ }).click()
    const regenerated = await until(async () => {
      const current = (await workspace(imageCreativeId)).scenes.find(scene => scene.kind === 'image')
      if (current.runId !== previous.runId && current.status === 'Failed') throw new Error('Concurrent image regeneration failed: ' + JSON.stringify(current.details.run.jobs.map(job => job.error_message)))
      return current.runId !== previous.runId && current.status === 'Complete' && current.outputs.length === 2 ? current : false
    }, 'Second image batch did not finish', 60000)
    assert.equal(regenerated.history.length, 1)
    assert.equal(regenerated.details.attempts.length, 2)
    assert.equal(counts().job, before.job + 2)
    assert.equal(counts().asset, before.asset + 2)
    for (const asset of previous.outputs) assert.ok(db.prepare('SELECT id FROM asset WHERE id=?').get(asset.id))
    imageAssetId = regenerated.outputs[1].id
    await image().getByTestId(`image-output-${imageAssetId}`).click()
    await until(async () => (await workspace(imageCreativeId)).scenes.find(scene => scene.kind === 'image').selectedAssetId === imageAssetId, 'Regenerated output selection was not saved')
    await shot('image-regenerated-desktop', image().locator('.iw-output-grid'))
  })
  await check('Image → Video links the existing Asset, preserves image history, and never uploads or duplicates it', async () => {
    const before = counts(), uploads = writes.filter(write => /upload|media\/save|register-external/.test(write.path)).length
    await image().getByRole('button', { name: 'Use as Start Frame', exact: true }).click()
    await page.locator('.workstation-shell[data-workspace="video"]').waitFor()
    await scene(1).getByAltText('Scene 1 start frame').waitFor()
    await until(async () => {
      const rows = db.prepare("SELECT key, value FROM app_settings WHERE key LIKE 'creative_generator_%'").all()
      for (const row of rows) {
        const state = JSON.parse(row.value)
        if (state.scenes?.some(scene => scene.kind !== 'image' && Number(scene.startAssetId) === Number(imageAssetId))) {
          videoCreativeId = Number(row.key.replace('creative_generator_', ''))
          return true
        }
      }
      return false
    }, 'Quick Video start-frame scene was not persisted')
    const transferred = (await workspace(videoCreativeId)).scenes.find(scene => scene.kind !== 'image')
    videoSceneId = transferred.id
    assert.equal(transferred.startAssetId, imageAssetId)
    assert.equal(transferred.mode, 'image-to-video')
    assert.equal(counts().asset, before.asset)
    assert.equal(counts().job, before.job)
    assert.equal(writes.filter(write => /upload|media\/save|register-external/.test(write.path)).length, uploads)
    await scene(1).getByLabel('Scene 1 prompt', { exact: true }).fill('A slow camera movement around the same bottle. Preserve its visible shape and packaging.')
    await generator().getByRole('button', { name: 'Save scenes', exact: true }).click()
    await generatorSaved()
    const mixed = await workspace(videoCreativeId)
    assert.equal(mixed.scenes.filter(scene => scene.kind === 'image').length, 0)
    assert.ok(db.prepare('SELECT id FROM asset WHERE id=?').get(imageAssetId))
    assert.equal(mixed.scenes.find(scene => scene.id === videoSceneId).generateAudio, false)
  })
  await check('Video confirms Mock generation, survives refresh, plays, approves and assembles via M6', async () => {
    await scene(1).getByRole('button', { name: 'Generate scene', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Confirm scene generation' })
    await dialog.waitFor()
    await dialog.getByRole('button', { name: 'Confirm generation', exact: true }).click()
    await until(async () => {
      const generated = (await workspace(videoCreativeId)).scenes.find(scene => scene.kind !== 'image' && scene.runId)
      if (generated) videoSceneId = generated.id
      return Boolean(generated)
    }, 'Video did not start')
    await page.reload()
    await scene(1).locator('video').waitFor({ timeout: 60000 })
    const fixture = await play(scene(1).locator('video'), 'Video Mock actual metadata')
    assert.ok(Math.abs(fixture.duration - 2) < .05, `Expected the 2-second local fixture, got ${fixture.duration}`)
    assert.equal(fixture.playsInline, true)
    assert.match(await scene(1).locator('.cg-preview').innerText(), new RegExp(`${fixture.duration.toFixed(2).replace('.', '\\.')} s`))
    assert.match(await scene(1).locator('.cg-preview').innerText(), /Local test fixture \(not an AI result\)/)
    await scene(1).getByRole('button', { name: 'Approve scene', exact: true }).click()
    await until(async () => (await workspace(videoCreativeId)).scenes.find(scene => scene.id === videoSceneId)?.approved, 'Video approval was not saved')
    await shot('video-desktop', scene(1).locator('.cg-preview'))
    await shot('video-composer-desktop', scene(1).locator('.cg-controls'))
    await generator().getByRole('button', { name: 'Assemble final ad', exact: true }).click()
    await generator().getByRole('button', { name: 'Download final MP4', exact: true }).waitFor({ timeout: 90000 })
    const final = (await workspace(videoCreativeId)).final
    assert.deepEqual(final.sources.map(source => source.sceneId), [videoSceneId])
    assert.equal(final.run.jobs.length, 0)
    await play(generator().locator('.cg-final video'))
    const download = page.waitForEvent('download')
    await generator().getByRole('button', { name: 'Download final MP4', exact: true }).click()
    assert.equal((await download).suggestedFilename(), 'final-ad.mp4')
    await shot('final-ad-desktop', generator().locator('.cg-final'))
  })
  await check('Shared Assets filters, metadata and selected previews use the same canonical media records', async () => {
    await navigate('assets')
    const assets = page.getByTestId('assets-workspace')
    await assets.getByTestId(`asset-card-${imageAssetId}`).waitFor()
    const imageCount = (await options()).media.filter(asset => asset.mime_type.startsWith('image/')).length
    await assets.getByRole('button', { name: /^Images/ }).click()
    assert.equal(await assets.locator('.asset-card').count(), imageCount)
    await assets.getByTestId(`asset-card-${imageAssetId}`).click()
    await assets.getByRole('complementary', { name: 'Selected Asset' }).getByText(`#${imageAssetId}`, { exact: true }).waitFor()
    await assets.getByLabel('Search Assets').fill('does-not-exist')
    assert.equal(await assets.locator('.asset-card').count(), 0)
    await assets.getByRole('button', { name: 'Clear filters', exact: true }).click()
    assert.equal(await assets.locator('.asset-card').count(), (await options()).media.length)
    await shot('assets-desktop', assets)
  })
  await check('Studio creates a factual French draft, uses an existing product image, and proposes one editable scene', async () => {
    await navigate('marketing_studio')
    await studio().getByLabel('Brief créatif Studio').waitFor()
    await studio().getByLabel('Nom du produit Studio').fill('Flacon de démonstration')
    await studio().getByLabel('Faits produit Studio').fill('Flacon cylindrique vert avec bouchon. Fixture locale sans marque ni promesse produit.')
    await studio().getByRole('complementary').getByLabel('Photo produit Studio').selectOption(String(imageAssetId))
    assert.equal(await studio().locator('label').filter({ hasText: 'Langue du script' }).locator('select').inputValue(), 'fr')
    await studio().getByText('Templates', { exact: true }).click()
    await studio().locator('.sw-template-drawer .sw-preset', { hasText: 'Un plan, une idée' }).click()
    await studio().getByLabel('Instruction visuelle Studio').waitFor()
    await studio().getByLabel('Brief créatif Studio').fill('Une lumière douce, une prise de vue calme et aucun texte ajouté.')
    await studio().getByLabel('Script exact Studio').fill('Voici notre flacon. Regardez sa forme et sa couleur.')
    await studio().getByLabel('Verrouiller ce script', { exact: true }).check()
    assert.equal(await studio().locator('.sw-scene-strip > button').count(), 1)
    assert.equal(await studio().getByLabel('Modèle Studio').inputValue(), 'mock-video')
    assert.equal(await studio().getByLabel('Audio', { exact: true }).isChecked(), false)
    await studio().locator('.sw-header').evaluate(element => element.scrollIntoView({ block: 'start' }))
    await shot('studio-gallery-desktop', studio().locator('.sw-header'))
    await shot('studio-draft-desktop', studio().locator('.sw-preview'))
  })
  await check('Studio explicitly confirms its finite batch, renders playable output, and keeps the locked script', async () => {
    const jobsBefore = counts().job
    await studio().locator('.sw-generate').click()
    const dialog = page.getByRole('dialog', { name: 'Confirmer la production Studio' })
    await dialog.waitFor()
    assert.match(await dialog.innerText(), /Générer 1 clip/)
    assert.match(await dialog.innerText(), /1 sortie/)
    assert.equal(counts().job, jobsBefore)
    await shot('studio-confirm-desktop')
    await dialog.getByRole('button', { name: 'Confirmer la génération', exact: true }).click()
    await studio().locator('.sw-preview video').waitFor({ timeout: 60000 })
    await play(studio().locator('.sw-preview video'))
    assert.equal(await studio().getByLabel('Script exact Studio').inputValue(), 'Voici notre flacon. Regardez sa forme et sa couleur.')
    assert.equal(counts().job, jobsBefore + 1)
    await until(async () => {
      const saved = await page.evaluate(api => JSON.parse(localStorage.getItem(`generator-selection:${api}`) || '{}'), api)
      if (saved.creativeId) creativeId = Number(saved.creativeId)
      return Boolean(creativeId && (await workspace(creativeId)).scenes.some(scene => scene.kind !== 'image' && scene.id !== videoSceneId))
    }, 'Studio Creative selection was not persisted')
    const state = await workspace(creativeId)
    const studioScene = state.scenes.find(scene => scene.kind !== 'image' && scene.id !== videoSceneId)
    studioSceneId = studioScene.id
    assert.equal(studioScene.startAssetId, imageAssetId)
    assert.equal(studioScene.mode, 'image-to-video')
    assert.equal(studioScene.details.run.jobs.length, 1)
    assert.equal(studioScene.details.attempts.length, 1)
    assert.match(studioScene.prompt, /Flacon cylindrique vert/)
    await studio().getByRole('button', { name: 'Approuver la scène', exact: true }).click()
    await until(async () => (await workspace(creativeId)).scenes.find(scene => scene.id === studioSceneId)?.approved, 'Studio approval was not saved')
    await studio().getByRole('button', { name: 'Ouvrir dans Canvas', exact: true }).waitFor()
    await shot('studio-results-desktop', studio().locator('.sw-preview'))
  })
  await check('Studio → Create Ad preserves the current clips and image lineage without duplicate Jobs or Assets', async () => {
    const before = counts()
    await studio().getByRole('button', { name: 'Ouvrir dans Create Ad', exact: true }).click()
    await page.locator('.workstation-shell[data-workspace="create_ad"]').waitFor()
    await scene(1).locator('video').waitFor()
    const state = await workspace(creativeId)
    assert.equal(state.scenes.filter(scene => scene.kind === 'image').length, 0)
    assert.equal(state.scenes.filter(scene => scene.kind !== 'image').length, 1)
    assert.ok(state.scenes.find(scene => scene.id === studioSceneId).media)
    assert.equal(counts().job, before.job)
    assert.equal(counts().asset, before.asset)
    await navigate('marketing_studio')
    assert.equal(await studio().getByLabel('Script exact Studio').inputValue(), 'Voici notre flacon. Regardez sa forme et sa couleur.')
  })
  await check('Studio → Canvas links the saved product and output onto a persisted populated board without generation', async () => {
    const before = counts()
    await studio().getByLabel('Modèle Studio').getByRole('option', { name: /Mock Video/ }).waitFor({ state: 'attached' })
    await studio().getByRole('button', { name: 'Ouvrir dans Canvas', exact: true }).click()
    await page.getByRole('application', { name: 'Production node canvas' }).waitFor()
    await until(async () => (await canvas()).nodes.length >= 4, 'Studio nodes were not saved')
    const graph = await canvas(), reference = graph.nodes.find(node => node.type === 'reference')
    assert.equal(reference.data.asset_id, imageAssetId)
    assert.ok(graph.connections.length >= 3)
    assert.equal(counts().job, before.job)
    assert.equal(counts().asset, before.asset)
    await page.getByRole('button', { name: 'Fit all nodes to screen', exact: true }).click()
    for (const video of await page.getByRole('application', { name: 'Production node canvas' }).locator('video').all()) await play(video)
    await shot('canvas-studio-desktop', page.getByRole('application', { name: 'Production node canvas' }))
    await page.reload()
    await page.getByRole('application', { name: 'Production node canvas' }).waitFor()
    assert.equal((await canvas()).nodes.length, graph.nodes.length)
  })
  await check('Canvas reviews and confirms only the selected image → video dependency path through M5', async () => {
    const before = counts(), original = await canvas()
    await page.getByLabel('Add starter graph').selectOption('image-video')
    await until(async () => (await canvas()).nodes.length === original.nodes.length + 4, 'Starter graph did not persist')
    const graph = await canvas(), originalIds = new Set(original.nodes.map(node => node.id))
    const added = graph.nodes.filter(node => !originalIds.has(node.id))
    const imageNode = added.find(node => node.type === 'image_generator'), videoNode = added.find(node => node.type === 'video_generator')
    canvasVideoNodeId = videoNode.id
    assert.equal(imageNode.data.model_id, 'mock-image')
    assert.equal(videoNode.data.model_id, 'mock-video')
    await page.locator(`.gnode[data-node-id="${imageNode.id}"]`).getByLabel('Image size', { exact: true }).selectOption('square_hd')
    await page.locator(`.gnode[data-node-id="${videoNode.id}"]`).getByLabel('Resolution', { exact: true }).selectOption('480p')
    await page.getByRole('button', { name: 'Run selection', exact: true }).click()
    const review = page.getByRole('dialog', { name: 'Review Canvas execution' })
    await review.waitFor()
    assert.match(await review.innerText(), /2 generation steps · 2 requested outputs/)
    await review.getByRole('button', { name: 'Review total cost', exact: true }).click()
    const quote = page.getByRole('dialog', { name: 'Confirm Canvas production' })
    await quote.waitFor()
    assert.match(await quote.innerText(), /Uses output 1 of its upstream image Job/)
    assert.match(await quote.innerText(), /€0\.00/)
    assert.equal(counts().job, before.job)
    await shot('canvas-confirm-desktop')
    await quote.getByRole('button', { name: 'Confirm Canvas generation', exact: true }).click()
    const completed = await until(async () => {
      const result = await canvasStatus(), run = result.runs.at(-1)
      if (run?.details.run.status === 'failed') throw new Error('Canvas M5 run failed: ' + JSON.stringify(run.details.run.jobs.map(job => job.error_message)))
      return run?.details.run.status === 'complete' ? result : false
    }, 'Canvas M5 path did not finish', 60000)
    const run = completed.runs.at(-1), jobs = run.details.run.jobs
    assert.equal(jobs.length, 2)
    assert.equal(run.details.attempts.length, 2)
    assert.equal(counts().job, before.job + 2)
    const imageJob = jobs.find(job => job.capability === 'generate_image'), videoJob = jobs.find(job => job.capability === 'generate_video')
    const dependency = db.prepare('SELECT * FROM job_dependency WHERE job_id=?').get(videoJob.id)
    assert.equal(dependency.depends_on_job_id, imageJob.id)
    assert.equal(dependency.dependency_type, 'start_frame')
    assert.ok(videoJob.started_at >= imageJob.completed_at)
    assert.ok(completed.nodes.filter(node => [imageNode.id, videoNode.id].includes(node.nodeId)).every(node => node.status === 'done' && node.assets.length === 1))
    await until(async () => (await canvas()).nodes.find(node => node.id === videoNode.id)?.data.result_asset_id, 'Canvas output was not bound to its saved Asset')
    canvasVideoAssetId = (await canvas()).nodes.find(node => node.id === videoNode.id).data.result_asset_id
    await page.getByRole('button', { name: 'Fit all nodes to screen', exact: true }).click()
    await play(page.locator(`.gnode[data-node-id="${videoNode.id}"] video`).first())
    await shot('canvas-results-desktop', page.getByRole('application', { name: 'Production node canvas' }))
    const finishedCounts = counts()
    await page.reload()
    await page.getByRole('application', { name: 'Production node canvas' }).waitFor()
    assert.equal(counts().job, finishedCounts.job)
    assert.equal(counts().asset, finishedCounts.asset)
  })
  await check('Canvas → Creative reuses the selected local video with no duplicate Asset, upload or Job', async () => {
    const before = counts(), previous = await workspace(creativeId), previousIds = new Set(previous.scenes.map(scene => scene.id))
    const uploadCount = writes.filter(write => /upload|media\/save|register-external/.test(write.path)).length
    await page.locator(`.gnode[data-node-id="${canvasVideoNodeId}"]`).getByRole('button', { name: 'Use in Creative', exact: true }).click()
    await page.locator('.workstation-shell[data-workspace="create_ad"]').waitFor()
    const linked = await until(async () => (await workspace(creativeId)).scenes.find(scene => !previousIds.has(scene.id) && scene.media?.id === canvasVideoAssetId), 'Canvas video Asset was not linked to a Creative scene')
    const linkedIndex = (await workspace(creativeId)).scenes.filter(scene => scene.kind !== 'image').findIndex(scene => scene.id === linked.id) + 1
    assert.equal(linked.media.id, canvasVideoAssetId)
    assert.equal(counts().asset, before.asset)
    assert.equal(counts().job, before.job)
    assert.equal(writes.filter(write => /upload|media\/save|register-external/.test(write.path)).length, uploadCount)
    await play(scene(linkedIndex).locator('video'))
    await shot('canvas-linked-creative-desktop', scene(linkedIndex).locator('.cg-preview'))
  })
  await check('Remix reuses existing local references and saves a simple instruction without opening Advanced', async () => {
    await navigate('remix')
    const remix = scene(1).getByTestId('reference-remix-editor')
    await remix.waitFor()
    const source = (await options()).media.find(asset => asset.mime_type === 'video/mp4' && asset.duration_seconds >= 2)
    assert.ok(source, 'Mock fixture library needs a video of at least two seconds for Remix preparation')
    const jobsBefore = counts().job
    await remix.getByLabel('Reference video from Media Library', { exact: true }).selectOption(String(source.id))
    await remix.locator('p[role="status"]').filter({ hasText: /Reference analyzed|Ready/ }).waitFor()
    await generatorSaved()
    await remix.getByLabel('Reference image from Media Library', { exact: true }).selectOption(String(imageAssetId))
    await remix.getByRole('button', { name: 'Add selected reference', exact: true }).click()
    await remix.getByLabel('What should change?', { exact: true }).fill('Replace the product with @Product. Keep the calm camera movement and lighting.')
    await generatorSaved()
    assert.equal(await remix.locator('.remix-advanced').getAttribute('open'), null)
    assert.equal(counts().job, jobsBefore)
    await shot('remix-desktop', remix.getByLabel('What should change?', { exact: true }))
    await shot('remix-references-desktop', remix.locator('.remix-input-grid').first())
  })
  await check('Mobile navigation, image composer, playable media, Studio and Assets fit at 390 × 844', async () => {
    await page.setViewportSize({ width: 390, height: 844 })
    await navigate('image')
    await image().locator('.iw-output').first().waitFor()
    await until(() => image().locator('.iw-generate').innerText().then(text => text.includes('€0.00')), 'Image estimate did not hydrate')
    await assertNoHorizontalOverflow('Mobile Image')
    await shot('image-results-mobile', image().locator('.iw-output-grid'))
    await shot('image-composer-mobile', image().getByTestId('image-composer'))
    assert.ok(await image().locator('.iw-generate').isVisible())
    await navigate('video')
    await scene(1).locator('video').waitFor()
    await assertNoHorizontalOverflow('Mobile Video')
    await shot('video-mobile', scene(1).locator('.cg-preview'))
    await shot('video-composer-mobile', scene(1).locator('.cg-controls'))
    await navigate('marketing_studio')
    await studio().getByLabel('Modèle Studio').getByRole('option', { name: /Mock Video/ }).waitFor({ state: 'attached' })
    await until(() => studio().getByLabel('Script exact Studio').count().then(count => count > 0), 'Studio did not restore the saved selected draft after reload')
    assert.equal(await studio().getByLabel('Script exact Studio').inputValue(), 'Voici notre flacon. Regardez sa forme et sa couleur.')
    await play(studio().locator('.sw-preview video'))
    await assertNoHorizontalOverflow('Mobile Studio')
    await studio().locator('.sw-header').evaluate(element => element.scrollIntoView({ block: 'start' }))
    await shot('studio-gallery-mobile', studio().locator('.sw-header'))
    await shot('studio-mobile', studio().locator('.sw-preview'))
    await shot('studio-composer-mobile', studio().locator('.sw-composer'))
    await navigate('assets')
    await page.getByTestId(`asset-card-${imageAssetId}`).click()
    await assertNoHorizontalOverflow('Mobile Assets')
    await page.locator('.asset-detail .asset-preview').scrollIntoViewIfNeeded()
    await until(() => page.locator('.asset-detail img').evaluateAll(images => images.length === 1 && images.every(image => image.complete && image.naturalWidth > 0)), 'Mobile Asset detail image did not load')
    await shot('assets-preview-mobile', page.locator('.asset-detail .asset-preview'))
    await shot('assets-mobile', page.locator('.asset-detail'))
    await navigate('node_canvas')
    await page.getByRole('application', { name: 'Production node canvas' }).waitFor()
    await page.getByRole('button', { name: 'Fit all nodes to screen', exact: true }).click()
    await assertNoHorizontalOverflow('Mobile Canvas')
    await shot('canvas-mobile', page.getByRole('application', { name: 'Production node canvas' }))
    await navigate('remix')
    await generator().getByTestId('reference-remix-editor').waitFor()
    await assertNoHorizontalOverflow('Mobile Remix')
    await shot('remix-mobile', generator().getByTestId('reference-remix-editor').getByLabel('What should change?', { exact: true }))
    await page.setViewportSize({ width: 1440, height: 900 })
  })
  await check('Navigation and refresh never submit work; all production is Mock, attempts are unique, zero external calls', async () => {
    const before = counts()
    for (const key of ['image', 'video', 'assets', 'marketing_studio', 'create_ad']) await navigate(key)
    await page.reload()
    await generator().waitFor()
    assert.equal(counts().job, before.job)
    assert.equal(counts().asset, before.asset)
    assert.equal(counts().cost, 0)
    assert.equal(counts().job, 8) // 2 image batches × 2 + Video + Studio + Canvas image/video.
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM job_execution_attempt').get().n, 8)
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM job_execution_attempt WHERE reconciliation_status != 'reconciled'").get().n, 0)
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM job WHERE provider != 'mock'").get().n, 0)
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM (SELECT external_request_id FROM job_execution_attempt WHERE external_request_id IS NOT NULL GROUP BY external_request_id HAVING COUNT(*) > 1)').get().n, 0)
    assert.deepEqual(remoteAttempts, [])
    assert.deepEqual(unsafeRequests, [])
    assert.ok(!backendLog.includes('AAF_QA_BLOCKED_NETWORK'), backendLog)
    assert.deepEqual(pageErrors, [])
  })
  console.log(`Workstation browser QA: ${checks.length}/${checks.length} PASS; 0 real provider calls`)
} catch (error) {
  if (creativeId) {
    const failedWorkspace = await workspace(creativeId).catch(() => null)
    fs.writeFileSync(path.join(artifacts, 'failure-workspace.json'), JSON.stringify(failedWorkspace, null, 2))
    if (failedWorkspace) console.error(JSON.stringify(failedWorkspace.scenes.map(scene => ({ id: scene.id, kind: scene.kind, status: scene.status, jobs: scene.details?.run?.jobs?.map(job => ({ id: job.id, status: job.status, error: job.error_message })), attempts: scene.details?.attempts?.map(attempt => ({ status: attempt.provider_status, error: attempt.error_message, failure: attempt.failure_classification })) })), null, 2))
  }
  if (page) {
    console.error((await page.locator('body').innerText()).slice(-12000))
    await shot('failure').catch(() => {})
  }
  console.error(backendLog.slice(-5000))
  throw error
} finally {
  fs.writeFileSync(path.join(artifacts, 'report.json'), JSON.stringify({ checks, screenshots, playbackReceipts, pageErrors, remoteAttempts, unsafeRequests, paidProviderCalls: 0, finalCounts: db ? counts() : null }, null, 2))
  await browser?.close()
  db?.close()
  if (backend && backend.exitCode === null) {
    const exited = new Promise(resolve => backend.once('exit', resolve))
    backend.kill()
    await Promise.race([exited, delay(3000)])
  }
  const resolved = path.resolve(temp)
  assert.ok(resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(resolved).startsWith('aaf-workstation-browser-'))
  fs.rmSync(resolved, { recursive: true, force: true })
}
