// Browser -> keyless isolated backend -> real local analysis -> Mock M5 -> remix primary UX.
import { chromium } from 'playwright'
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'aaf-remix-browser-'))
const api = 'http://127.0.0.1:8796'
const env = { ...process.env, PORT: '8796', FACTORY_DB_PATH: path.join(temp, 'factory.db'), FACTORY_MEDIA_ROOT: path.join(temp, 'media'), MOCK_VIDEO_DELAY_MS: '900', PRODUCTION_POLL_INTERVAL_MS: '100', FAL_API_KEY: '', REPLICATE_API_TOKEN: '', POLLINATIONS_API_KEY: '', OPENAI_API_KEY: '', ANTHROPIC_API_KEY: '', GROQ_API_KEY: '', GEMINI_API_KEY: '', OPENROUTER_API_KEY: '' }
const dbPath = env.FACTORY_DB_PATH
const wait = ms => new Promise(r => setTimeout(r, ms))
const video = path.join(temp, 'reference.mp4')
const image = path.join(temp, 'product.png')
const tool = process.env.FFMPEG_PATH || path.join(process.env.ProgramFiles, 'DICloak', 'vendor', 'ffmpeg', 'bin', 'ffmpeg.exe')
const fixture = args => { const result = spawnSync(tool, args, { windowsHide: true }); assert.equal(result.status, 0, result.stderr?.toString()) }

let server, browser, page, passed = 0
const check = async (name, fn) => { await fn(); passed++; console.log('PASS ' + name) }
const read = async id => (await (await fetch(api + '/api/operator/generator/' + id)).json()).workspace
async function saved() { await page.getByText('Saved locally', { exact: true }).waitFor() }
async function healthy() {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(api + '/health'); if (r.ok) return }
    catch {}
    await wait(200)
  }
  throw new Error('QA backend did not become healthy.')
}
async function createRemixDraft(title = 'Primary remix') {
  await page.goto('http://localhost:5173')
  await page.getByText('Projects / Advanced', { exact: true }).click()
  await page.getByRole('button', { name: 'Legacy Create Ad', exact: true }).click()
  await page.getByTestId('creative-generator').waitFor()
  await page.getByRole('button', { name: /Remix Reference Ad/ }).click()
  await page.getByText('New product', { exact: true }).click()
  await page.getByLabel('Product name', { exact: true }).fill('Our travel suitcase')
  await page.getByRole('button', { name: 'Create product', exact: true }).click()
  await page.getByLabel('Product Test', { exact: true }).getByRole('option', { name: 'Our travel suitcase' }).waitFor({ state: 'attached' })
  await page.getByLabel('New Creative title').fill(title)
  await page.getByRole('button', { name: 'Create ad', exact: true }).click()
  await page.getByTestId('generator-scene-1').waitFor()
  await saved()
}

try {
  try { if ((await fetch(api + '/health')).ok) throw new Error('QA port is occupied') } catch (e) { if (e.message.includes('occupied')) throw e }
  fixture(['-y', '-f', 'lavfi', '-i', 'testsrc2=size=640x640:rate=24', '-t', '3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', video])
  fixture(['-y', '-f', 'lavfi', '-i', 'color=red:s=512x512', '-frames:v', '1', image])
  server = spawn(process.execPath, ['server/index.mjs'], { env, windowsHide: true, stdio: 'ignore' })
  await healthy()
  browser = await chromium.launch()
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  await context.addInitScript(url => { localStorage.setItem('API_BASE_URL', url); sessionStorage.setItem(`workspace-active:${url}`, 'create_ad') }, api)
  const external = [], errors = []
  await context.route('**/*', route => { const u = new URL(route.request().url()); if (!['localhost', '127.0.0.1'].includes(u.hostname)) { external.push(u.hostname); return route.abort() } return route.continue() })
  page = await context.newPage()
  page.setDefaultTimeout(30000)
  page.on('pageerror', e => errors.push(e.message))
  page.on('dialog', d => d.accept())

  await check('Remix primary UI hides Scene architecture and exposes one mode system', async () => {
    await createRemixDraft()
    const remix = page.getByTestId('generator-scene-1')
    await remix.getByRole('button', { name: 'Motion Transfer', exact: true }).waitFor()
    await remix.getByRole('button', { name: 'Object Swap', exact: true }).waitFor()
    await remix.getByText('More modes', { exact: true }).waitFor()
    for (const text of ['Scene name / purpose', 'Generate all ready scenes', 'Add remix scene', 'Save scenes', 'Generation type']) assert.equal(await page.getByText(text, { exact: true }).filter({ visible: true }).count(), 0)
    assert.equal(await page.getByLabel('Remix mode', { exact: true }).filter({ visible: true }).count(), 0)
    await page.screenshot({ path: 'qa-artifacts/remix-empty.png', fullPage: true })
  })

  await check('Reference video, references and instruction are the only required primary inputs', async () => {
    const remix = page.getByTestId('generator-scene-1')
    await remix.getByLabel('Upload reference video', { exact: true }).setInputFiles(video)
    await remix.locator('p[role="status"]').filter({ hasText: /Ready/ }).waitFor()
    await saved()
    await remix.getByLabel('Upload reference image', { exact: true }).setInputFiles(image)
    await remix.getByAltText('@Product reference').waitFor()
    await remix.getByLabel('Reference 1 role', { exact: true }).selectOption('PRODUCT')
    await remix.getByLabel('What should change?', { exact: true }).fill('Replace the original object with my product. Keep the same person, movement, camera, environment and timing.')
    await saved()
    await page.screenshot({ path: 'qa-artifacts/remix-with-references.png', fullPage: true })
    const w = await read(1)
    assert.equal(w.scenes.length, 1)
    assert.ok(w.scenes[0].remix.sourceAssetId)
    assert.equal(w.scenes[0].remix.images.length, 1)
    assert.equal(w.scenes[0].runId, undefined)
  })

  await check('More modes are secondary and Motion Transfer persists without duplicate dropdown', async () => {
    const remix = page.getByTestId('generator-scene-1')
    await remix.getByText('More modes', { exact: true }).click()
    await remix.getByRole('button', { name: 'Background / Location Swap', exact: true }).click()
    await saved()
    assert.equal((await read(1)).scenes[0].remix.editMode, 'background_swap')
    await remix.getByRole('button', { name: 'Motion Transfer', exact: true }).click()
    await saved()
    assert.equal((await read(1)).scenes[0].remix.editMode, 'motion_transfer')
  })

  await check('Advanced remains optional and internal Scene persistence still works', async () => {
    const remix = page.getByTestId('generator-scene-1')
    assert.equal(await remix.locator('.remix-advanced').getAttribute('open'), null)
    const w = await read(1)
    assert.ok(w.scenes[0].remix.promptContext)
    assert.equal(w.scenes[0].remix.scriptApproved, true)
    assert.ok(w.scenes[0].prompt.includes('person') || w.scenes[0].prompt.includes('movement'))
  })

  await check('Generate uses normal quote/confirmation and Mock M5 without hidden provider calls', async () => {
    const remix = page.getByTestId('generator-scene-1')
    await remix.getByRole('button', { name: 'Generate remix', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Confirm scene generation' })
    await dialog.waitFor()
    assert.match(await dialog.innerText(), /1 reference video/)
    assert.match(await dialog.innerText(), /€0.00/)
    assert.equal((await read(1)).scenes[0].runId, undefined)
    await dialog.getByRole('button', { name: 'Confirm generation', exact: true }).click()
    await remix.getByRole('button', { name: 'Use as Scene', exact: true }).waitFor({ timeout: 60000 })
    const w = await read(1)
    assert.equal(w.scenes[0].details.run.jobs.length, 1)
    assert.equal(w.scenes[0].details.attempts.length, 1)
    assert.equal(w.scenes[0].details.run.jobs[0].inputParams.generation_mode, 'reference_to_video')
  })

  await check('Result is Reference vs Remix with append-only history controls', async () => {
    const remix = page.getByTestId('generator-scene-1')
    assert.equal(await remix.locator('.remix-video-pair video').count(), 2)
    await remix.getByRole('button', { name: 'Restart / play both', exact: true }).click()
    await page.waitForFunction(() => [...document.querySelectorAll('.remix-video-pair video')].every(v => v.currentTime > .1 && !v.paused))
    await remix.getByText('History', { exact: true }).waitFor()
    await page.screenshot({ path: 'qa-artifacts/remix-result.png', fullPage: true })
  })

  await check('Real provider persisted shape renders with partial analysis metadata', async () => {
    const db = new Database(dbPath)
    const row = db.prepare("SELECT value FROM app_settings WHERE key='creative_generator_1'").get()
    const state = JSON.parse(row.value)
    state.scenes[0].remix.analysis = {
      beats: [{ start: 0, end: 3, label: 'Continuous shot', description: '' }],
    }
    db.prepare("UPDATE app_settings SET value=?, updated_at=datetime('now') WHERE key='creative_generator_1'").run(JSON.stringify(state))
    db.close()
    await page.reload({ waitUntil: 'networkidle' })
    const remix = page.getByTestId('generator-scene-1')
    await remix.locator('.remix-video-pair video').first().waitFor()
    assert.equal(await remix.locator('.remix-video-pair video').count(), 2)
    await remix.getByRole('button', { name: 'Use as Scene', exact: true }).waitFor()
    await remix.getByRole('button', { name: 'Use in Creative', exact: true }).waitFor()
    const realShapeText = await remix.innerText()
    assert.match(realShapeText, /Ready · (?:\d+\.\d{2}s|duration unknown)/)
    assert.ok(!realShapeText.includes('Ready · 0.00s'))
  })

  await check('Use in Creative action stays visible without exposing final assembly controls', async () => {
    const remix = page.getByTestId('generator-scene-1')
    await remix.getByRole('button', { name: 'Use in Creative', exact: true }).waitFor()
    assert.equal(await page.getByRole('button', { name: 'Download final MP4', exact: true }).filter({ visible: true }).count(), 0)
    assert.ok((await read(1)).scenes[0].media.id)
  })

  await check('Mobile primary Remix fits and no external calls occurred', async () => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.getByTestId('generator-scene-1').scrollIntoViewIfNeeded()
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
    await page.screenshot({ path: 'qa-artifacts/remix-mobile.png', fullPage: true })
    assert.deepEqual(errors, [])
    assert.deepEqual(external, [])
  })

  console.log(`Reference Remix browser QA: ${passed}/${passed} PASS; 0 real paid calls`)
} catch (error) {
  if (page) {
    console.error((await page.locator('body').innerText()).slice(-14000))
    await page.screenshot({ path: 'qa-artifacts/remix-error.png', fullPage: true })
  }
  throw error
} finally {
  await browser?.close()
  if (server) { server.kill(); await Promise.race([new Promise(resolve => server.once('exit', resolve)), wait(3000)]) }
  fs.rmSync(temp, { recursive: true, force: true })
}
