// Human operating-mode acceptance: MCP -> dashboard -> visual editing -> Mock generation -> M6 assembly -> MCP parity.
// Isolated temp DB/media, no provider credentials and browser network locked to localhost.
import { chromium } from 'playwright'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'aaf-mcp-parity-'))
const api = 'http://127.0.0.1:8801'
const mcpUrl = 'http://127.0.0.1:8802'
const web = 'http://localhost:5173'
const artifacts = path.resolve('qa-artifacts/mcp-parity')
const env = {
  ...process.env,
  PORT: '8801',
  MCP_PORT: '8802',
  FACTORY_DB_PATH: path.join(temp, 'factory.db'),
  FACTORY_MEDIA_ROOT: path.join(temp, 'media'),
  MOCK_VIDEO_DELAY_MS: '0',
  PRODUCTION_POLL_INTERVAL_MS: '50',
  FAL_API_KEY: '',
  OPENAI_API_KEY: '',
  ANTHROPIC_API_KEY: '',
  GEMINI_API_KEY: '',
  OPENROUTER_API_KEY: '',
  GROQ_API_KEY: '',
  POLLINATIONS_API_KEY: '',
  REPLICATE_API_TOKEN: '',
}

const TINY_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lR0AAAAASUVORK5CYII='
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
async function healthy(url) { for (let i = 0; i < 80; i++) { try { const r = await fetch(url + '/health'); if (r.ok) return r.json() } catch {} await wait(200) } throw new Error(`No health: ${url}`) }
async function stop(proc) { if (!proc || proc.exitCode !== null) return; const done = new Promise(resolve => proc.once('exit', resolve)); proc.kill(); await Promise.race([done, wait(3000)]) }
async function read(route) { const res = await fetch(api + route); const data = await res.json(); assert.equal(res.ok, true, JSON.stringify(data)); return data }
async function post(route, body) { const res = await fetch(api + route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); const data = await res.json(); assert.equal(res.ok, true, JSON.stringify(data)); return data }
async function tool(client, name, args = {}) {
  const result = await client.callTool({ name, arguments: args })
  assert.equal(result.isError || false, false, `${name}: ${result.content?.[0]?.text}`)
  return JSON.parse(result.content[0].text)
}
async function confirmGeneration(page) {
  await page.getByRole('dialog', { name: 'Confirm scene generation' }).waitFor()
  await page.getByRole('button', { name: 'Confirm generation', exact: true }).click()
}

let backend, mcp, browser, client, page, db
const external = []
let passed = 0
const summary = {
  createdThroughMcp: null,
  dashboardScenes: [],
  generatedScenes: [],
  imageAssetId: null,
  finalAssetId: null,
  mcpPromptEdit: '',
  contextLeakage: false,
}
async function check(name, fn) { await fn(); passed++; console.log(`PASS ${name}`) }

try {
  fs.mkdirSync(artifacts, { recursive: true })
  for (const url of [api, mcpUrl]) {
    let occupied = false
    try { occupied = (await fetch(url + '/health')).ok } catch {}
    if (occupied) throw new Error(`QA port occupied: ${url}`)
  }

  backend = spawn(process.execPath, ['server/index.mjs'], { env, windowsHide: true, stdio: 'ignore' })
  await healthy(api)
  mcp = spawn(process.execPath, ['server/mcp.mjs'], { env, windowsHide: true, stdio: 'ignore' })
  await healthy(mcpUrl)
  db = new Database(env.FACTORY_DB_PATH, { readonly: true })

  client = new Client({ name: 'mcp-dashboard-parity-qa', version: '1' })
  await client.connect(new SSEClientTransport(new URL(mcpUrl + '/sse')))

  browser = await chromium.launch()
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true })
  await context.addInitScript(url => {
    localStorage.setItem('API_BASE_URL', url)
  }, api)
  await context.route('**/*', route => {
    const url = new URL(route.request().url())
    if (!['localhost', '127.0.0.1'].includes(url.hostname)) { external.push(route.request().url()); return route.abort() }
    return route.continue()
  })
  page = await context.newPage()
  page.setDefaultTimeout(30000)

  await check('MCP creates a clean four-scene Quick Video draft', async () => {
    const planned = await tool(client, 'creative_plan_scenes', {
      brief: 'Create a 20-second French UGC ad. Start with a strong problem hook, demonstrate the product, show the benefit, finish with a natural CTA.',
      targetDuration: 20,
      provider: 'mock',
    })
    summary.createdThroughMcp = planned.creativeId
    assert.equal(planned.sceneCount, 4)
    assert.ok(planned.workspace.creative.concept_summary.includes('Quick Create draft'))
    assert.equal(planned.workspace.scenes.every(scene => scene.provider === 'mock'), true)
  })

  await check('MCP lists and attaches one existing local image Asset identity', async () => {
    const saved = await post('/api/media/save', { data_url: `data:image/png;base64,${TINY_PNG}`, file_name: 'mcp-product-reference.png', mime_type: 'image/png', category: 'asset' })
    const registered = await post('/api/assets/register-external', { relativePath: saved.local_url.replace(/^\/media\//, ''), mimeType: 'image/png', source: 'uploaded' })
    summary.imageAssetId = registered.item.id
    const listed = await tool(client, 'creative_list_assets', { mimePrefix: 'image/', limit: 20 })
    assert.ok(listed.assets.some(asset => asset.id === summary.imageAssetId))
    const attached = await tool(client, 'creative_attach_asset_to_video', { creativeId: summary.createdThroughMcp, assetId: summary.imageAssetId })
    assert.equal(attached.workspace.scenes.length, 4)
    assert.equal(attached.workspace.scenes.every(scene => scene.mode === 'image-to-video' && scene.startAssetId === summary.imageAssetId), true)
  })

  await check('Dashboard opens MCP-created Quick Video with no copy/paste or Product Test requirement', async () => {
    await page.goto(web)
    await page.getByRole('button', { name: 'Video', exact: true }).click()
    await page.getByTestId('creative-generator').waitFor()
    await page.getByRole('heading', { name: 'Quick video', exact: true }).waitFor()
    assert.equal(await page.locator('.cg-scene').count(), 4)
    assert.equal(await page.getByText('Quick draft · no project context in prompts', { exact: true }).count(), 0)
    assert.equal(await page.getByText(/Choose a Product Test|Link to project \/ testing context/i).filter({ visible: true }).count(), 0)
    assert.equal(await page.getByText(/Red apple smoke validation|DISPOSABLE final Seedance/i).filter({ visible: true }).count(), 0)
    assert.equal(await page.locator('.cg-start-frame').count(), 4)
    summary.dashboardScenes = await Promise.all([1, 2, 3, 4].map(async n => ({
      name: await page.getByLabel(`Scene ${n} name`, { exact: true }).inputValue(),
      prompt: await page.getByLabel(`Scene ${n} prompt`, { exact: true }).inputValue(),
      duration: await page.getByLabel(`Scene ${n} duration`, { exact: true }).inputValue(),
      model: await page.getByLabel(`Scene ${n} model`, { exact: true }).inputValue(),
    })))
    await page.screenshot({ path: path.join(artifacts, 'mcp-created-video-draft.png'), fullPage: true })
  })

  await check('Browser edits, reorders, duplicates, deletes and refresh persists final four-scene order', async () => {
    await page.getByLabel('Scene 3 name', { exact: true }).fill('Product demonstration / benefit')
    await page.getByLabel('Move scene 3 up', { exact: true }).click()
    await page.getByRole('button', { name: 'Save scenes', exact: true }).click()
    await page.getByText('Saved locally', { exact: true }).waitFor()
    const firstOrder = await Promise.all([1, 2, 3, 4].map(n => page.getByLabel(`Scene ${n} name`, { exact: true }).inputValue()))
    assert.match(firstOrder[1], /Product demonstration|benefit/i)
    await page.getByTestId('generator-scene-2').getByRole('button', { name: 'Duplicate', exact: true }).click()
    assert.equal(await page.locator('.cg-scene').count(), 5)
    await page.getByTestId('generator-scene-5').getByRole('button', { name: 'Delete', exact: true }).click()
    await page.getByRole('button', { name: 'Save scenes', exact: true }).click()
    await page.getByText('Saved locally', { exact: true }).waitFor()
    await page.reload()
    await page.getByTestId('creative-generator').waitFor()
    await page.getByRole('heading', { name: 'Quick video', exact: true }).waitFor()
    assert.equal(await page.locator('.cg-scene').count(), 4)
    const after = await Promise.all([1, 2, 3, 4].map(n => page.getByLabel(`Scene ${n} name`, { exact: true }).inputValue()))
    assert.deepEqual(after, firstOrder)
  })

  await check('Dashboard generates all four scenes with Mock and assembles final MP4', async () => {
    await page.getByRole('button', { name: 'Generate all ready scenes', exact: true }).click()
    await confirmGeneration(page)
    await page.waitForFunction(() => document.querySelectorAll('.cg-preview video').length >= 4, null, { timeout: 60000 })
    for (const button of await page.getByRole('button', { name: 'Approve scene', exact: true }).all()) await button.click()
    await page.getByText('4 / 4 approved', { exact: true }).waitFor()
    await page.getByRole('button', { name: 'Assemble final ad', exact: true }).click()
    await page.getByRole('button', { name: 'Download final MP4', exact: true }).waitFor({ timeout: 90000 })
    const receipt = await page.locator('.cg-final video').evaluate(async video => {
      video.muted = true
      await video.play()
      await new Promise(resolve => setTimeout(resolve, 700))
      video.pause()
      return { currentTime: video.currentTime, duration: video.duration, width: video.videoWidth, height: video.videoHeight }
    })
    assert.ok(receipt.currentTime > 0 && receipt.width > 0 && receipt.height > 0)
    const workspace = (await read(`/api/operator/generator/${summary.createdThroughMcp}`)).workspace
    summary.generatedScenes = workspace.scenes.map(scene => ({ id: scene.id, status: scene.status, assetId: scene.media?.id || null }))
    summary.finalAssetId = workspace.final?.finalAsset?.id || null
    assert.equal(summary.generatedScenes.every(scene => scene.status === 'Complete' && scene.assetId), true)
    assert.ok(summary.finalAssetId)
    await page.screenshot({ path: path.join(artifacts, 'mock-final-assembled.png'), fullPage: true })
  })

  await check('MCP sees UI reorder, generated scene outputs and assembled final', async () => {
    const status = await tool(client, 'creative_get_generation', { creativeId: summary.createdThroughMcp })
    assert.equal(status.scenes.length, 4)
    assert.equal(status.scenes.every(scene => scene.startAssetId === summary.imageAssetId && scene.media?.id), true)
    assert.ok(status.final?.finalAsset?.id)
    const sceneTwo = status.scenes[1]
    assert.match(sceneTwo.name, /Product demonstration|benefit/i)
  })

  await check('MCP prompt edit appears back in dashboard without rebuilding/importing', async () => {
    const status = await tool(client, 'creative_get_generation', { creativeId: summary.createdThroughMcp })
    const scene = status.scenes[0]
    summary.mcpPromptEdit = `${scene.prompt}\nMCP parity edit: emphasize the pain point in natural French.`
    await tool(client, 'creative_update_scene', { creativeId: summary.createdThroughMcp, sceneId: scene.id, patch: { prompt: summary.mcpPromptEdit } })
    await page.reload()
    await page.getByTestId('creative-generator').waitFor()
    await page.getByLabel('Scene 1 prompt', { exact: true }).waitFor()
    assert.equal(await page.getByLabel('Scene 1 prompt', { exact: true }).inputValue(), summary.mcpPromptEdit)
    await page.screenshot({ path: path.join(artifacts, 'mcp-edit-visible-in-dashboard.png'), fullPage: true })
  })

  await check('Context isolation: next frozen provider spec contains only current quick draft inputs', async () => {
    const workspace = (await read(`/api/operator/generator/${summary.createdThroughMcp}`)).workspace
    const changed = workspace.scenes.find(scene => scene.prompt === summary.mcpPromptEdit)
    const quoted = await post(`/api/operator/generator/${summary.createdThroughMcp}/quote`, { revision: workspace.revision, sceneIds: [changed.id] })
    const runIds = quoted.quote.runIds
    assert.equal(runIds.length, 1)
    const run = db.prepare('SELECT * FROM production_run WHERE id=?').get(runIds[0])
    const jobs = db.prepare('SELECT * FROM job WHERE production_run_id=?').all(runIds[0])
    assert.equal(jobs.length, 0)
    const spec = JSON.stringify(JSON.parse(run.spec_snapshot))
    const banned = ['Red apple smoke validation', 'DISPOSABLE final Seedance', 'Brand Library', 'old Audience', 'previous Script Import']
    summary.contextLeakage = banned.some(text => spec.includes(text))
    assert.equal(summary.contextLeakage, false, spec)
    assert.ok(spec.includes('MCP parity edit: emphasize the pain point in natural French.'))
    assert.ok(spec.includes(`/media/`))
  })

  assert.deepEqual(external, [])
  assert.equal(db.prepare('SELECT COUNT(*) n FROM cost').get().n, 0)
  console.log(`MCP dashboard parity QA: ${passed}/8 PASS; paid provider calls: 0`)
  console.log(JSON.stringify(summary, null, 2))
} catch (error) {
  if (page) {
    try { console.error((await page.locator('body').innerText()).slice(-8000)); await page.screenshot({ path: path.join(artifacts, 'error.png'), fullPage: true }) } catch {}
  }
  throw error
} finally {
  if (client) await client.close().catch(() => {})
  if (browser) await browser.close().catch(() => {})
  if (db) db.close()
  await stop(mcp)
  await stop(backend)
}
