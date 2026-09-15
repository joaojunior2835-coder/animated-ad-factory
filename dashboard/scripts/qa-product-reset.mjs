// Browser acceptance for P0 Creative Product Reset. Requires Vite on localhost:5173.
// Starts an isolated backend; no provider keys, no external network.
import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'aaf-product-reset-browser-'))
const api = 'http://127.0.0.1:8798'
const artifacts = path.resolve('qa-artifacts/product-reset')
const env = {
  ...process.env,
  PORT: '8798',
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

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
async function healthy(url) {
  for (let i = 0; i < 70; i++) {
    try { const response = await fetch(url + '/health'); if (response.ok) return }
    catch {}
    await wait(200)
  }
  throw new Error(`No backend health at ${url}`)
}
async function clickNav(page, label) {
  await page.getByRole('button', { name: label, exact: true }).click()
}
async function confirmGeneration(page) {
  await page.getByRole('button', { name: /Confirm generation/ }).click()
}
async function checkNoExternal(context) {
  const external = []
  await context.route('**/*', (route) => {
    const host = new URL(route.request().url()).hostname
    if (!['127.0.0.1', 'localhost'].includes(host)) {
      external.push(route.request().url())
      return route.abort()
    }
    return route.continue()
  })
  return external
}

let backend, browser
let passed = 0
async function check(name, fn) { await fn(); passed++; console.log(`PASS ${name}`) }

try {
  fs.mkdirSync(artifacts, { recursive: true })
  let occupied = false
  try { occupied = (await fetch(api + '/health')).ok } catch {}
  if (occupied) throw new Error('QA port 8798 is occupied.')
  backend = spawn(process.execPath, ['server/index.mjs'], { cwd: path.resolve('.'), env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
  await healthy(api)
  browser = await chromium.launch()
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  await context.addInitScript((url) => localStorage.setItem('API_BASE_URL', url), api)
  const external = await checkNoExternal(context)
  const page = await context.newPage()
  await page.goto('http://localhost:5173')

  await check('Primary nav opens Image by default and hides legacy planning from primary shell', async () => {
    await page.getByTestId('image-workspace').waitFor()
    const primary = page.locator('.workspace-primary-nav')
    for (const label of ['Image', 'Video', 'Remix', 'Marketing Studio', 'Canvas', 'Assets']) await primary.getByRole('button', { name: label, exact: true }).waitFor()
    for (const hidden of ['Product Tests', 'Audience / Avatar', 'Frame Prompts', 'Script Import']) assert.equal(await primary.getByRole('button', { name: hidden, exact: true }).count(), 0)
    assert.equal(await primary.getByRole('button', { name: 'Canvas', exact: true }).count(), 1)
    await page.screenshot({ path: path.join(artifacts, 'nav-image-desktop.png'), fullPage: true })
  })

  await check('Image quick workflow needs no Product Test and keeps six outputs visible after 1 + 1 + 4 generations', async () => {
    await page.getByLabel('Image model').selectOption('mock-image')
    for (const [prompt, quantity] of [['First clean product image.', 'Outputs: 1'], ['Second clean product image.', 'Outputs: 1'], ['Third clean product image.', 'Outputs: 4']]) {
      await page.getByLabel('Image prompt').fill(prompt)
      await page.getByLabel('Image output quantity').selectOption({ label: quantity })
      await page.locator('.iw-generate').click()
      await confirmGeneration(page)
      await page.locator('.iw-output').first().waitFor({ timeout: 20000 })
    }
    await page.waitForFunction(() => document.querySelectorAll('.iw-output').length >= 6, null, { timeout: 20000 })
    await page.locator('.iw-output').nth(1).click()
    assert.ok(await page.getByRole('button', { name: 'Use as Start Frame', exact: true }).isVisible())
    assert.ok(await page.getByRole('button', { name: 'Add to Canvas', exact: true }).isVisible())
    await page.reload()
    await page.waitForFunction(() => document.querySelectorAll('.iw-output').length >= 6, null, { timeout: 20000 })
    await page.screenshot({ path: path.join(artifacts, 'image-history-desktop.png'), fullPage: true })
  })

  await check('Video single mode starts clean with no Product or smoke-test Creative required', async () => {
    await clickNav(page, 'Video')
    await page.getByTestId('creative-generator').waitFor()
    await page.getByRole('button', { name: /Single Video/ }).waitFor()
    await page.getByLabel('Scene 1 model').selectOption('mock')
    await page.getByLabel('Scene 1 prompt').fill('Handheld UGC shot of a woman holding a skincare product in a bright bedroom.')
    assert.equal(await page.getByText(/Red apple smoke validation|DISPOSABLE final Seedance/i).filter({ visible: true }).count(), 0)
    await page.getByRole('button', { name: 'Generate scene', exact: true }).click()
    await confirmGeneration(page)
    await page.locator('.cg-preview video').first().waitFor({ timeout: 20000 })
    await page.screenshot({ path: path.join(artifacts, 'video-single-desktop.png'), fullPage: true })
  })

  await check('Video ignores a stale project-linked quick pointer and opens a clean draft', async () => {
    const productResponse = await fetch(api + '/api/product-tests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ newProduct: { name: 'Red apple smoke validation' }, market: 'FR', language: 'en', currency: 'EUR' }),
    })
    const product = await productResponse.json()
    assert.equal(productResponse.ok, true, JSON.stringify(product))
    const creativeResponse = await fetch(api + '/api/operator/generator/creatives', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ productTestId: product.item.id, angle: 'DISPOSABLE final Seedance audio-off validation' }),
    })
    const creative = await creativeResponse.json()
    assert.equal(creativeResponse.ok, true, JSON.stringify(creative))
    await page.evaluate(({ apiUrl, productTestId, creativeId }) => {
      sessionStorage.setItem(`workspace-active:${apiUrl}`, 'video')
      sessionStorage.setItem(`quick-generator:video:${apiUrl}`, JSON.stringify({ productTestId, creativeId, linked: true }))
    }, { apiUrl: api, productTestId: product.item.id, creativeId: creative.creativeId })
    await page.reload()
    await page.getByTestId('creative-generator').waitFor()
    await page.getByRole('heading', { name: 'Quick video', exact: true }).waitFor()
    await page.getByRole('button', { name: 'New video draft', exact: true }).waitFor()
    await page.getByLabel('Scene 1 prompt', { exact: true }).waitFor()
    assert.equal(await page.getByLabel('Scene 1 prompt', { exact: true }).inputValue(), '')
    assert.equal(await page.getByText(/Red apple smoke validation|DISPOSABLE final Seedance/i).filter({ visible: true }).count(), 0)
    assert.equal(await page.locator('.cg-quick-panel details[open]').count(), 0)
    await page.screenshot({ path: path.join(artifacts, 'video-stale-pointer-after.png'), fullPage: true })
  })

  await check('Video auto scenes creates editable scene cards from one brief', async () => {
    await page.evaluate(() => sessionStorage.removeItem(`quick-generator:video:${localStorage.getItem('API_BASE_URL')}`))
    await page.reload()
    await clickNav(page, 'Video')
    await page.getByRole('button', { name: /Ad \/ Auto Scenes/ }).click()
    await page.getByLabel('Ad brief / script').fill('Create a 20-second UGC ad. Start with a strong hook, demonstrate the product, and finish with a natural CTA.')
    await page.getByRole('button', { name: 'Auto-plan scenes', exact: true }).click()
    await page.waitForFunction(() => document.querySelectorAll('[data-testid^="generator-scene-"]').length >= 3)
    await page.getByLabel('Scene 2 prompt').fill('Scene 2 edited: demonstrate the product close to camera with natural handheld movement.')
    await page.screenshot({ path: path.join(artifacts, 'video-auto-scenes-desktop.png'), fullPage: true })
  })

  await check('Remix primary surface is reference-first with no mandatory Product Test', async () => {
    await clickNav(page, 'Remix')
    await page.getByTestId('creative-generator').waitFor()
    await page.getByRole('button', { name: 'Motion Transfer', exact: true }).waitFor()
    await page.getByRole('button', { name: 'Object Swap', exact: true }).waitFor()
    await page.getByRole('heading', { name: 'Reference video', exact: true }).waitFor()
    await page.getByLabel('What should change?').waitFor()
    assert.equal(await page.getByTestId('creative-generator').getByText(/Choose a Product Test/i).count(), 0)
    await page.screenshot({ path: path.join(artifacts, 'remix-desktop.png'), fullPage: true })
  })

  await check('Studio and Canvas are discoverable primary workspaces', async () => {
    await clickNav(page, 'Marketing Studio')
    await page.getByTestId('studio-workbench').waitFor()
    await page.getByText('Marketing Studio', { exact: true }).first().waitFor()
    await page.screenshot({ path: path.join(artifacts, 'studio-desktop.png'), fullPage: true })
    await clickNav(page, 'Canvas')
    await page.getByRole('application', { name: 'Production node canvas' }).waitFor()
    await page.screenshot({ path: path.join(artifacts, 'canvas-desktop.png'), fullPage: true })
  })

  await check('Mobile creative surfaces remain reachable', async () => {
    await page.setViewportSize({ width: 390, height: 844 })
    for (const [label, file] of [['Image', 'image-mobile.png'], ['Video', 'video-mobile.png'], ['Remix', 'remix-mobile.png'], ['Marketing Studio', 'studio-mobile.png'], ['Canvas', 'canvas-mobile.png']]) {
      await clickNav(page, label)
      await page.screenshot({ path: path.join(artifacts, file), fullPage: true })
    }
  })

  assert.deepEqual(external, [])
  console.log(`Product reset browser QA: ${passed}/${passed} PASS; screenshots in ${artifacts}; 0 real provider calls`)
} finally {
  await browser?.close().catch(() => {})
  if (backend) {
    await new Promise((resolve) => {
      backend.once('exit', resolve)
      backend.kill()
      setTimeout(resolve, 1000)
    })
  }
  if (path.resolve(temp).startsWith(path.resolve(os.tmpdir()) + path.sep)) fs.rmSync(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
}
