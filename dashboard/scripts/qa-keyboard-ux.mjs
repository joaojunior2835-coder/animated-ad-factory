import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import net from 'node:net'
import assert from 'node:assert/strict'

const api = 'http://127.0.0.1:8796'
const web = 'http://localhost:5173'
const phrase = 'This is a real UGC video with natural lighting and camera movement.'
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'aaf-keyboard-ux-'))
const artifacts = path.resolve('qa-artifacts/keyboard-ux')
fs.mkdirSync(artifacts, { recursive: true })
const environment = { ...process.env, PORT: '8796', FACTORY_DB_PATH: path.join(temp, 'factory.db'), FACTORY_MEDIA_ROOT: path.join(temp, 'media'), MOCK_VIDEO_DELAY_MS: '500', PRODUCTION_POLL_INTERVAL_MS: '75' }
for (const key of ['FAL_API_KEY','OPENAI_API_KEY','ANTHROPIC_API_KEY','GEMINI_API_KEY','OPENROUTER_API_KEY','GROQ_API_KEY','POLLINATIONS_API_KEY','REPLICATE_API_TOKEN']) environment[key] = ''

const networkGuard = `
import http from 'node:http';
import https from 'node:https';
import { syncBuiltinESMExports } from 'node:module';
const allow = value => {
  const host = typeof value === 'string' || value instanceof URL ? new URL(value).hostname : value?.hostname || value?.host || '';
  if (!['127.0.0.1','localhost','::1','[::1]'].includes(host)) throw new Error('QA forbids external network requests: ' + host);
};
const originalFetch = globalThis.fetch;
globalThis.fetch = (input, options) => { allow(input instanceof Request ? input.url : input); return originalFetch(input, options); };
for (const module of [http, https]) for (const method of ['request','get']) {
  const original = module[method]; module[method] = function(input, ...rest) { allow(input); return original.call(this, input, ...rest); };
}
syncBuiltinESMExports();
`
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
async function until(fn, message, timeout = 20000) {
  const end = Date.now() + timeout
  let last
  while (Date.now() < end) { last = await fn(); if (last) return last; await delay(150) }
  throw new Error(`${message}; last observed ${JSON.stringify(last)}`)
}

let backend, browser
try {
  await new Promise((resolve, reject) => {
    const probe = net.createServer()
    probe.once('error', reject)
    probe.listen(8796, '127.0.0.1', () => probe.close(resolve))
  })
  backend = spawn(process.execPath, ['--import', `data:text/javascript,${encodeURIComponent(networkGuard)}`, 'server/index.mjs'], { cwd: process.cwd(), env: environment, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  await until(async () => { try { const r = await fetch(api + '/health'); return r.ok } catch { return false } }, 'Keyless backend failed to start')

  browser = await chromium.launch()
  const context = await browser.newContext({ viewport: { width: 1366, height: 768 } })
  await context.addInitScript(url => localStorage.setItem('API_BASE_URL', url), api)
  const page = await context.newPage()
  const pageErrors = []
  page.on('pageerror', error => pageErrors.push(error.message))
  await page.goto(web, { waitUntil: 'networkidle' })

  async function nav(key) {
    await page.locator(`nav.sidebar-left button.nav[data-workspace="${key}"]`).click()
    await page.locator(`.workstation-shell[data-workspace="${key}"]`).waitFor()
    await page.waitForTimeout(300)
  }

  async function typeNaturally(label, locator) {
    await locator.scrollIntoViewIfNeeded()
    const before = await page.evaluate(() => ({ x: scrollX, y: scrollY, main: document.querySelector('.workspace-main')?.scrollTop || 0 }))
    await locator.click()
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A')
    await page.keyboard.press('Backspace')
    for (const char of phrase) await page.keyboard.press(char === ' ' ? 'Space' : char)
    await page.keyboard.press('Space')
    await page.keyboard.press('Space')
    await page.keyboard.press('ArrowLeft')
    await page.keyboard.press('Backspace')
    const value = await locator.inputValue().catch(async () => await locator.textContent())
    assert.equal(value, `${phrase} `, `${label}: editable text did not receive spaces/backspace/arrow keys`)
    const after = await page.evaluate(() => ({ x: scrollX, y: scrollY, main: document.querySelector('.workspace-main')?.scrollTop || 0 }))
    assert.equal(after.x, before.x, `${label}: horizontal page scroll changed while typing`)
    assert.equal(after.y, before.y, `${label}: page scroll changed while typing`)
    return { label, valueLength: value.length, scroll: after }
  }

  const proofs = []
  await nav('video')
  await page.getByLabel('Scene 1 prompt', { exact: true }).waitFor()
  proofs.push(await typeNaturally('Video prompt', page.getByLabel('Scene 1 prompt', { exact: true })))

  await nav('remix')
  await page.getByLabel('What should change?', { exact: true }).waitFor()
  proofs.push(await typeNaturally('Remix instruction', page.getByLabel('What should change?', { exact: true })))

  await nav('image')
  proofs.push(await typeNaturally('Image prompt', page.getByLabel('Image prompt', { exact: true })))

  await nav('marketing_studio')
  const startStudio = page.getByRole('button', { name: /Créer un brouillon Studio|\+ New Studio Session/ })
  if (await startStudio.count()) await startStudio.first().click()
  const studioField = await page.locator('textarea:visible:enabled').count()
    ? page.locator('textarea:visible:enabled').first()
    : page.locator('input:visible:enabled:not([type="file"]):not([type="checkbox"])').last()
  await studioField.waitFor({ state: 'visible' })
  proofs.push(await typeNaturally('Studio field', studioField))

  await nav('node_canvas')
  await page.getByLabel('Add starter graph').selectOption('image-video')
  const canvasText = page.locator('.gnode textarea').first()
  await canvasText.waitFor()
  proofs.push(await typeNaturally('Canvas prompt', canvasText))
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A')
  assert.equal(await canvasText.inputValue(), `${phrase} `, 'Canvas Ctrl+A must select text, not the graph')
  await page.keyboard.press('Delete')
  assert.equal(await canvasText.inputValue(), '', 'Canvas Delete must edit text, not delete the node')
  assert.ok(await page.locator('.gnode').count() >= 4, 'Canvas node was deleted while text field was focused')

  await page.screenshot({ path: path.join(artifacts, 'keyboard-ux-final.png'), fullPage: true })
  assert.deepEqual(pageErrors, [])
  console.log(`Keyboard UX browser QA: ${proofs.length}/5 editable surfaces PASS; provider calls: 0`)
  console.log(JSON.stringify(proofs, null, 2))
} finally {
  await browser?.close()
  if (backend && backend.exitCode === null) {
    const exited = new Promise(resolve => backend.once('exit', resolve))
    backend.kill()
    await Promise.race([exited, delay(3000)])
  }
  const resolved = path.resolve(temp)
  assert.ok(resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(resolved).startsWith('aaf-keyboard-ux-'))
  fs.rmSync(resolved, { recursive: true, force: true })
}
