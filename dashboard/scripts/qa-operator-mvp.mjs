// Browser → normal APIs → isolated SQLite → local assembly → review/publication/metrics.
// Requires the existing Vite frontend on 5173. No provider credentials or remote calls.
import { chromium } from 'playwright'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'aaf-operator-browser-'))
const api = 'http://127.0.0.1:8791', mcpUrl = 'http://127.0.0.1:8793'
const env = { ...process.env, PORT: '8791', MCP_PORT: '8793', FACTORY_DB_PATH: path.join(temp, 'factory.db'), FACTORY_MEDIA_ROOT: path.join(temp, 'media'), MOCK_VIDEO_DELAY_MS: '0', PRODUCTION_POLL_INTERVAL_MS: '100', OPENAI_API_KEY: '', OPENROUTER_API_KEY: '', GROQ_API_KEY: '', POLLINATIONS_API_KEY: '', REPLICATE_API_TOKEN: '', ANTHROPIC_API_KEY: '', GEMINI_API_KEY: '', FAL_API_KEY: '' }
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
async function healthy(url) { for (let i = 0; i < 50; i++) { try { const r = await fetch(url + '/health'); if (r.ok) return r.json() } catch {} await wait(200) } throw new Error(`No health: ${url}`) }
for (const url of [api, mcpUrl]) { let live = false; try { live = (await fetch(url + '/health')).ok } catch {} if (live) throw new Error(`QA port occupied: ${url}`) }
let backend, mcp, browser, client, page, passed = 0
async function check(name, fn) { await fn(); passed++; console.log(`PASS ${name}`) }
async function read(route) { const res = await fetch(api + route); const data = await res.json(); assert.equal(res.ok, true, JSON.stringify(data)); return data }
async function post(route, body) { return fetch(api + route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) }
async function stop(proc) { if (!proc || proc.exitCode !== null) return; const exited = new Promise((resolve) => proc.once('exit', resolve)); proc.kill(); await exited }
try {
  backend = spawn(process.execPath, ['server/index.mjs'], { env, windowsHide: true, stdio: 'ignore' })
  const health = await healthy(api)
  assert.ok(Object.values(health.providers_configured).every((value) => value === false))
  mcp = spawn(process.execPath, ['server/mcp.mjs'], { env, windowsHide: true, stdio: 'ignore' })
  await healthy(mcpUrl)
  browser = await chromium.launch()
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  await context.addInitScript((url) => localStorage.setItem('API_BASE_URL', url), api)
  page = await context.newPage()
  const errors = []
  const writes = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('request', (request) => { if (request.method() === 'POST' && /\/(publications|metrics)$/.test(new URL(request.url()).pathname)) writes.push({ path: new URL(request.url()).pathname, body: request.postDataJSON() }) })
  page.on('dialog', (dialog) => dialog.accept())
  page.setDefaultTimeout(20000)
  const openSupporting = async (targetPage = page) => {
    await targetPage.evaluate(() => {
      const group = Array.from(document.querySelectorAll('details')).find((item) => item.querySelector('summary')?.textContent?.trim() === 'Projects / Advanced')
      if (group) group.open = true
    })
  }
  await check('UI loads with no error overlay and healthy keyless backend/MCP', async () => {
    await page.goto('http://localhost:5173')
    await openSupporting()
    await page.locator('.sidebar-left button.nav[data-workspace="product_tests"]').click()
    await page.getByTestId('new-product-test').waitFor()
    assert.equal(await page.locator('vite-error-overlay').count(), 0)
  })
  await check('Create ProductTest, define strategy and Creative from dashboard', async () => {
    await page.getByTestId('new-product-test').click()
    await page.getByTestId('pt-name').fill('Operator browser fixture')
    await page.getByTestId('pt-selling').fill('30')
    await page.getByTestId('pt-cost').fill('5')
    await page.getByTestId('pt-shipping').fill('3')
    await page.getByTestId('pt-submit').click()
    await page.getByTestId('add-iteration').click()
    await page.getByTestId('row-angle-0').fill('Simple product demonstration')
    await page.getByTestId('row-format-0').fill('Vertical ad')
    await page.getByTestId('row-hook-0').fill('See it in action')
    await page.getByTestId('iteration-submit').click()
    await page.getByTestId('add-creative').click()
    await page.getByTestId('creative-angle').fill('Simple product demonstration')
    await page.getByTestId('creative-format').fill('Vertical ad')
    await page.getByTestId('creative-method').selectOption('factory_generated')
    await page.getByTestId('creative-submit').click()
    await page.getByTestId('open-creative-1').click()
  })
  await check('Approve two-scene mock plan without spending; REST confirmation enforced', async () => {
    await page.getByRole('button', { name: 'Configure video production' }).click()
    await page.getByLabel('Scene 1 prompt').fill('A red apple on a white table')
    await page.getByRole('button', { name: 'Add scene', exact: true }).click()
    await page.getByLabel('Scene 2 prompt').fill('Close-up of the apple')
    for (const box of await page.getByLabel('Generate audio', { exact: true }).all()) await box.uncheck()
    await page.getByRole('button', { name: 'Approve scene plan (no spend)' }).click()
    await page.getByTestId('operator-run-1').waitFor()
    const r = await read('/api/operator/runs/1')
    assert.equal(r.run.jobs.length, 0); assert.equal(r.reservations.length, 0)
    for (const confirmed of [undefined, false, 'true']) {
      const response = await fetch(api + '/api/iterations/1/production/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ productionRunIds: [1], confirmed }) })
      assert.equal(response.status, 400)
      for (const route of ['/api/llm', '/api/product-tests/1/research/generate', '/api/product-tests/1/strategy/generate', '/api/iterations/1/production-plan/generate']) assert.equal((await post(route, { confirmed })).status, 400)
    }
    assert.equal((await post('/api/video/generate', { provider: 'replicate', confirmed: true })).status, 400)
    assert.equal((await post('/api/llm', { provider_id: 'openai', action_type: 'generate_image', confirmed: true })).status, 400)
    assert.equal((await post('/api/iterations/999/production-plan/approve', { plans: [{ creativeId: 1 }] })).status, 400)
  })
  await check('Normal confirmed mock generation completes exactly two jobs', async () => {
    await page.getByRole('button', { name: 'Preflight & start generation' }).click()
    await page.getByRole('button', { name: 'Assemble Final Video (local / free)' }).waitFor()
    const r = await read('/api/operator/runs/1')
    assert.equal(r.run.jobs.length, 2); assert.ok(r.run.jobs.every((job) => job.status === 'complete' && job.provider === 'mock' && job.inputParams.generate_audio === false))
    assert.equal(r.reservations.length, 0); assert.equal(r.costs.length, 0)
  })
  await check('Assembly button produces playable downloadable local MP4', async () => {
    const assemblyRequest = page.waitForRequest((r) => r.url().endsWith('/runs/1/assemble') && r.method() === 'POST')
    await page.getByRole('button', { name: 'Assemble Final Video (local / free)' }).click()
    await assemblyRequest
    await page.reload()
    await page.getByTestId('creative-detail').waitFor()
    const run = page.getByTestId('operator-run-1')
    await run.getByRole('button', { name: 'Approve / Ready to publish' }).waitFor({ timeout: 90000 })
    const video = run.locator(':scope > div > video').last()
    await video.evaluate(async (element) => { element.muted = true; await element.play() })
    await page.waitForFunction(() => [...document.querySelectorAll('video')].some((v) => v.currentTime > 0.1 && v.videoWidth === 720 && !v.paused))
    const r = await read('/api/operator/runs/1')
    assert.equal(r.finalAsset.width, 720); assert.equal(r.finalAsset.height, 1280)
    assert.equal((await fetch(api + '/media/' + r.finalAsset.relative_path)).status, 200)
    const popup = context.waitForEvent('page')
    await run.getByRole('link', { name: 'Open / download video' }).last().click()
    const opened = await popup
    await opened.waitForLoadState('domcontentloaded')
    assert.equal(opened.url(), api + '/media/' + r.finalAsset.relative_path)
    await opened.close()
    await page.screenshot({ path: 'qa-artifacts/operator-assembly.png', fullPage: true })
  })
  await check('Restart backend and repeat assembly preserves final Asset', async () => {
    const before = await read('/api/operator/runs/1')
    await stop(backend)
    backend = spawn(process.execPath, ['server/index.mjs'], { env, windowsHide: true, stdio: 'ignore' })
    await healthy(api)
    const repeated = await (await post('/api/operator/runs/1/assemble', {})).json()
    assert.equal(repeated.reused, true); assert.equal(repeated.asset.id, before.finalAsset.id)
    await page.reload()
    await page.getByRole('button', { name: 'Approve / Ready to publish' }).waitFor()
  })
  await check('Repeated review decisions persist across browser refresh without dispatch', async () => {
    for (const [label, state] of [['Reject', 'rejected'], ['Needs revision', 'regenerating'], ['Approve / Ready to publish', 'approved']]) {
      await page.getByRole('button', { name: label, exact: true }).click()
      await page.getByRole('button', { name: label, exact: true }).isEnabled()
      await page.getByTestId('creative-detail').locator('.ms-badge').getByText(state, { exact: true }).waitFor()
      await page.getByRole('button', { name: label, exact: true }).click()
      await page.reload()
      await page.getByTestId('creative-detail').locator('.ms-badge').getByText(state, { exact: true }).waitFor()
    }
    const r = await read('/api/operator/runs/1')
    assert.equal(r.attempts.length, 2); assert.equal(r.reservations.length, 0); assert.equal(r.costs.length, 0)
    assert.equal((await read('/api/creatives/1/review-events')).items.length, 3)
  })
  await check('Approve final, record manual publication and metric snapshot', async () => {
    await page.getByRole('button', { name: 'Approve / Ready to publish' }).click()
    await page.getByTestId('add-publication').click()
    await page.getByTestId('pub-new-handle').fill('@operator-fixture')
    await page.getByTestId('pub-post-id').fill('local-fixture-post')
    await page.getByTestId('pub-submit').click()
    await page.getByTestId('add-metric-1').click()
    for (const [key, value] of Object.entries({ views: 2000, impressions: 2000, link_clicks: 40, purchases: 2, spend_minor: 1000, revenue_minor: 3000, likes: 20, comments: 10, shares: 5, saves: 5 })) await page.getByTestId(`metric-${key}`).fill(String(value))
    await page.getByTestId('metric-submit').click()
    await page.getByTestId('pub-1-metric-count').getByText('1', { exact: false }).waitFor()
    await page.getByTestId('analysis-panel').getByText(/promising/).first().waitFor()
    await page.screenshot({ path: 'qa-artifacts/operator-analysis.png', fullPage: true })
  })
  await check('Repeated publication and metric POSTs are idempotent; malformed media stays safe', async () => {
    assert.equal(writes.length, 2)
    for (const { path: route, body } of writes) for (let repeat = 0; repeat < 2; repeat++) assert.equal((await post(route, body)).status, 200)
    assert.equal((await read('/api/creatives/1/publications')).items.length, 1)
    assert.equal((await read('/api/publications/1/metrics')).items.length, 1)
    assert.equal((await fetch(api + '/media/%')).status, 400)
    assert.equal((await fetch(api + '/media/missing-video.mp4')).status, 404)
    await healthy(api)
    const file = path.join(env.FACTORY_MEDIA_ROOT, (await read('/api/operator/runs/1')).finalAsset.relative_path)
    fs.renameSync(file, file + '.missing')
    try {
      await page.reload()
      await page.getByRole('alert').filter({ hasText: 'Local video is missing' }).waitFor()
      assert.equal((await post(writes[0].path, writes[0].body)).status, 400)
    } finally { fs.renameSync(file + '.missing', file) }
    await page.reload()
    await page.getByTestId('analysis-panel').getByText(/promising/).first().waitFor()
  })
  await check('Mobile operator controls fit and the video plays', async () => {
    await page.setViewportSize({ width: 390, height: 844 })
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
    const video = page.getByTestId('operator-run-1').locator(':scope > div > video').last()
    await video.scrollIntoViewIfNeeded()
    await video.evaluate(async (element) => { element.muted = true; await element.play() })
    await page.waitForFunction(() => [...document.querySelectorAll('video')].some((v) => v.currentTime > 0.1 && !v.paused))
    await page.screenshot({ path: 'qa-artifacts/operator-mobile.png' })
    await page.setViewportSize({ width: 1440, height: 1000 })
  })
  await check('Review Queue shows approved final and preserves navigation', async () => {
    await page.getByRole('button', { name: /Back to iteration/ }).click()
    await page.getByRole('button', { name: /All Product Tests/ }).click()
    await page.getByRole('button', { name: 'Review Queue', exact: true }).click()
    await page.getByLabel('Review filter').selectOption('approved')
    await page.getByRole('button', { name: 'Review / publication / metrics' }).waitFor()
    await page.screenshot({ path: 'qa-artifacts/operator-review.png', fullPage: true })
  })
  await check('MCP shared operator tools and persisted SQLite lineage', async () => {
    client = new Client({ name: 'operator-local-qa', version: '1' })
    await client.connect(new SSEClientTransport(new URL(mcpUrl + '/sse')))
    const names = (await client.listTools()).tools.map((tool) => tool.name)
    for (const name of ['assemble_production_run', 'get_review_queue', 'review_creative', 'get_analysis_summary']) assert.ok(names.includes(name))
    const result = await client.callTool({ name: 'get_review_queue', arguments: {} })
    for (const name of ['generate_image', 'generate_video']) {
      const denied = await client.callTool({ name, arguments: { prompt: 'never generate', imageUrl: 'https://example.invalid/frame', confirmed: false } })
      assert.equal(denied.isError, true); assert.match(denied.content[0].text, /confirmation_required/)
    }
    assert.equal((await client.callTool({ name: 'start_production', arguments: { iterationId: 1, productionRunIds: [1], confirmed: false } })).isError, true)
    assert.equal(JSON.parse(result.content[0].text)[0].approval_status, 'approved')
    const db = new Database(env.FACTORY_DB_PATH, { readonly: true })
    assert.equal(db.pragma('integrity_check', { simple: true }), 'ok')
    assert.equal(db.prepare('SELECT count(*) n FROM publication').get().n, 1)
    assert.equal(db.prepare('SELECT count(*) n FROM metric_snapshot').get().n, 1)
    assert.equal(db.prepare('SELECT count(*) n FROM cost').get().n, 0)
    db.close()
    assert.deepEqual(errors, [])
  })
  await check('Manual finished-video upload needs no terminal and is reviewable', async () => {
    await page.getByRole('button', { name: 'Review / publication / metrics' }).click()
    await page.getByRole('button', { name: /Back to iteration/ }).click()
    await page.getByTestId('add-creative').click()
    await page.getByTestId('creative-angle').fill('External finished creative')
    await page.getByTestId('creative-format').fill('Vertical ad')
    await page.getByTestId('creative-submit').click()
    await page.getByTestId('open-creative-2').click()
    await page.getByTestId('add-run').click()
    await page.getByLabel('Import finished video (local / free)').setInputFiles('public/mock-video-output.mp4')
    await page.getByRole('button', { name: 'Approve / Ready to publish' }).waitFor()
    await page.getByRole('button', { name: 'Approve / Ready to publish' }).click()
    const r = await read('/api/operator/runs/2')
    assert.equal(r.run.status, 'complete'); assert.equal(r.run.jobs.length, 0)
    assert.ok(r.run.spec_frozen_at); assert.ok(r.finalAsset)
    assert.deepEqual(errors, [])
  })
  await check('Tunnel-origin browser ignores localhost override and uses relative API/media', async () => {
    const remote = await browser.newContext()
    const tunnel = 'http://operator-tunnel.test'
    await remote.addInitScript(() => localStorage.setItem('API_BASE_URL', 'http://127.0.0.1:8787'))
    await remote.route(tunnel + '/**', async (route) => {
      const url = new URL(route.request().url())
      const target = /^\/(api|health|media|mock-video-output)/.test(url.pathname) ? api : 'http://localhost:5173'
      const response = await route.fetch({ url: target + url.pathname + url.search })
      await route.fulfill({ response })
    })
    const tab = await remote.newPage(), remoteErrors = [], loopback = []
    tab.on('pageerror', (error) => remoteErrors.push(error.message))
    tab.on('request', (request) => { if (new URL(request.url()).hostname === '127.0.0.1') loopback.push(request.url()) })
    await tab.goto(tunnel)
    await openSupporting(tab)
    await tab.locator('.sidebar-left button.nav[data-workspace="product_tests"]').click()
    await tab.getByRole('button', { name: 'Review Queue', exact: true }).click()
    await tab.getByLabel('Review filter').selectOption('approved')
    const video = tab.locator('video').first()
    await video.evaluate(async (v) => { v.muted = true; await v.play() })
    await tab.waitForFunction(() => [...document.querySelectorAll('video')].some(v => v.currentTime > 0.1 && !v.paused))
    assert.deepEqual(loopback, []); assert.deepEqual(remoteErrors, [])
    assert.equal(await tab.evaluate(async () => (await import('/src/lib/ai/apiClient.js')).apiBase()), '')
    // Also exercise the actual Vite proxy read-only, without exposing a port.
    assert.equal((await fetch('http://localhost:5173/health')).status, 200)
    assert.equal((await fetch('http://localhost:5173/mock-video-output.mp4')).status, 200)
    await remote.close()
  })
  console.log(`Operator browser QA: ${passed}/${passed} PASS; zero paid calls`)
} catch (error) {
  if (page) { console.error((await page.locator('body').innerText()).slice(-14000)); await page.screenshot({ path: 'qa-artifacts/operator-failure.png', fullPage: true }) }
  throw error
} finally {
  await client?.close()
  await browser?.close()
  for (const proc of [mcp, backend]) if (proc) { proc.kill(); await Promise.race([new Promise((resolve) => proc.once('exit', resolve)), wait(3000)]) }
  fs.rmSync(temp, { recursive: true, force: true })
}
