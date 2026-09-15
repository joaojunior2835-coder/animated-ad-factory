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
  const button = page.locator('.workspace-primary-nav').getByRole('button').filter({ hasText: label }).first()
  await button.scrollIntoViewIfNeeded()
  await button.click()
}
async function assertBox(page, locator, predicate, message) {
  const box = await locator.boundingBox()
  assert.ok(box, `${message}: missing box`)
  assert.ok(predicate(box), `${message}: ${JSON.stringify(box)}`)
  return box
}
async function confirmGeneration(page) {
  await page.getByRole('button', { name: /Confirm generation|Confirmer/ }).click()
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

  await check('Image quick workflow needs no Product Test and preserves 1:1, 9:16, 16:9, and multi-output sizing', async () => {
    await page.getByLabel('Image model').selectOption('mock-image')
    for (const [prompt, size, quantity] of [
      ['First clean product image.', 'square_hd', 'Outputs: 1'],
      ['Second clean portrait product image.', 'portrait_16_9', 'Outputs: 1'],
      ['Third clean landscape product image.', 'landscape_16_9', 'Outputs: 4'],
    ]) {
      await page.getByLabel('Image prompt').fill(prompt)
      await page.getByLabel('Image size').selectOption(size)
      await page.getByLabel('Image output quantity').selectOption({ label: quantity })
      await page.locator('.iw-generate').click()
      await confirmGeneration(page)
      await page.locator('.iw-output').first().waitFor({ timeout: 20000 })
    }
    await page.waitForFunction(() => document.querySelectorAll('.iw-output').length >= 6, null, { timeout: 20000 })
    const squareCard = page.locator('.iw-output', { hasText: '1024 × 1024' }).first()
    const portraitCard = page.locator('.iw-output', { hasText: '768 × 1344' }).first()
    const landscapeCard = page.locator('.iw-output', { hasText: '1344 × 768' }).first()
    const first = await assertBox(page, squareCard.locator('.asset-preview'), box => box.width <= 320 && Math.abs(box.width - box.height) < 24, '1:1 image output stays compact and square')
    const second = await assertBox(page, portraitCard.locator('.asset-preview'), box => box.width <= 260 && box.height > box.width * 1.35, '9:16 image output stays compact and portrait')
    await assertBox(page, landscapeCard.locator('.asset-preview'), box => box.width <= 320 && box.width > box.height * 1.35, '16:9 image output stays compact and landscape')
    assert.ok(Math.abs(second.x - first.x) > 80 || Math.abs(second.y - first.y) > 80, 'multiple image outputs use a gallery grid')
    await portraitCard.click()
    await assertBox(page, portraitCard.locator('.asset-preview'), box => box.width <= 260 && box.height > box.width * 1.35, 'selected portrait output does not expand into a full-width inspector')
    assert.ok(await page.getByRole('button', { name: 'Use as Start Frame', exact: true }).isVisible())
    assert.ok(await page.getByRole('button', { name: 'Add to Canvas', exact: true }).isVisible())
    await page.reload()
    await page.waitForFunction(() => document.querySelectorAll('.iw-output').length >= 6, null, { timeout: 20000 })
    await page.screenshot({ path: path.join(artifacts, 'image-history-desktop.png'), fullPage: true })
  })

  await check('Video prompt-first screen has no mandatory mode or testing context', async () => {
    await clickNav(page, 'Video')
    await page.getByTestId('creative-generator').waitFor()
    await page.getByLabel('Video prompt', { exact: true }).waitFor()
    assert.equal(await page.getByRole('button', { name: /Single Video/ }).count(), 0)
    assert.equal(await page.getByRole('button', { name: /Ad \/ Auto Scenes/ }).count(), 0)
    assert.equal(await page.getByText(/Quick draft|Link to project \/ testing context/i).filter({ visible: true }).count(), 0)
    await page.getByLabel('Video structure').selectOption('single')
    await page.getByLabel('Video model').selectOption('mock')
    await page.getByLabel('Video prompt').fill('Handheld UGC shot of a woman holding a skincare product in a bright bedroom.')
    assert.equal(await page.getByText(/Red apple smoke validation|DISPOSABLE final Seedance/i).filter({ visible: true }).count(), 0)
    await page.locator('.cg-video-generate').click()
    await confirmGeneration(page)
    await page.locator('.cg-preview video').first().waitFor({ timeout: 20000 })
    await page.waitForFunction(() => {
      const video = document.querySelector('.cg-preview video')
      return video && video.videoWidth > 0 && video.videoHeight > 0
    }, null, { timeout: 10000 })
    const videoAspect = await page.locator('.cg-preview video').first().evaluate(video => ({ rendered: video.getBoundingClientRect().width / video.getBoundingClientRect().height, natural: video.videoWidth / video.videoHeight }))
    assert.ok(Math.abs(videoAspect.rendered - videoAspect.natural) < 0.08, `video player preserves actual media aspect: ${JSON.stringify(videoAspect)}`)
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
    await page.getByRole('button', { name: 'New', exact: true }).waitFor()
    await page.getByLabel('Video prompt', { exact: true }).waitFor()
    assert.equal(await page.getByLabel('Video prompt', { exact: true }).inputValue(), '')
    assert.equal(await page.getByText(/Red apple smoke validation|DISPOSABLE final Seedance/i).filter({ visible: true }).count(), 0)
    assert.equal(await page.getByText(/Quick draft|Link to project \/ testing context/i).filter({ visible: true }).count(), 0)
    await page.screenshot({ path: path.join(artifacts, 'video-stale-pointer-after.png'), fullPage: true })
  })

  await check('Video Auto creates editable scene cards from one prompt', async () => {
    await page.evaluate(() => sessionStorage.removeItem(`quick-generator:video:${localStorage.getItem('API_BASE_URL')}`))
    await page.reload()
    await clickNav(page, 'Video')
    await page.getByLabel('Video prompt').fill('Create a 20-second UGC ad. Start with a strong hook, demonstrate the product, and finish with a natural CTA.')
    await page.locator('.cg-video-generate').click()
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

  await check('Studio is prompt-first and templates are secondary shortcuts', async () => {
    await clickNav(page, 'Marketing Studio')
    await page.getByTestId('studio-workbench').waitFor()
    await page.getByText('Marketing Studio', { exact: true }).first().waitFor()
    await page.getByLabel('Brief créatif Studio').fill('Create a premium product hero image on a clean bathroom counter.')
    await page.getByLabel('Studio media type').selectOption('image')
    await page.getByLabel('Modèle Studio').selectOption('mock-image')
    assert.equal(await page.getByText('Choisir une direction', { exact: true }).filter({ visible: true }).count(), 0)
    await page.locator('.sw-generate').click()
    await page.waitForTimeout(1000)
    const studioAlert = await page.locator('.studio-workbench [role="alert"]').textContent().catch(() => '')
    assert.equal(studioAlert || '', '', `Studio generate failed before confirmation: ${studioAlert}`)
    await confirmGeneration(page)
    await page.locator('.sw-preview img').first().waitFor({ timeout: 20000 })
    await assertBox(page, page.locator('.sw-preview img').first(), box => box.width <= 560 && Math.abs(box.width - box.height) < 140, 'Studio image result stays aspect-correct')
    await page.getByText('Templates', { exact: true }).click()
    await page.locator('.sw-template-drawer .sw-preset', { hasText: 'Portrait produit' }).waitFor()
    await page.screenshot({ path: path.join(artifacts, 'studio-desktop.png'), fullPage: true })
  })

  await check('Canvas remains discoverable primary workspace', async () => {
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
