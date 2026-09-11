// Real-browser E2E for the INTERACTIVE layer the headless qa:canvas can't exercise:
// HTML5 drag-and-drop gestures (file drop + element reorder) and native confirm()
// dialogs. Self-contained and KEY-FREE: spawns its own keyless backend on 8788 and
// its own Vite dev server on a dedicated port, points the app at 8788 via a
// localStorage override, runs Playwright headless, then tears everything down.
//
// ZERO API providers, ZERO paid calls — the backend has all provider keys cleared.
//
// Run:  npm run qa:e2e   (from dashboard/)

import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const ARTIFACTS = path.resolve(ROOT, 'qa-artifacts')
fs.mkdirSync(ARTIFACTS, { recursive: true })

const QA_PORT = Number(process.env.QA_API_PORT) || 8788
const QA_API = `http://127.0.0.1:${QA_PORT}`
// A throwaway database for the QA backend. The Node Canvas is persisted in the
// database now, so sharing the real file would let each run's leftover nodes
// accumulate and break the next run's assertions.
const QA_DB_PATH = path.resolve(__dirname, '..', 'server', 'data', `qa-${QA_PORT}.db`)
for (const suffix of ['', '-wal', '-shm']) {
  try {
    fs.rmSync(QA_DB_PATH + suffix, { force: true })
  } catch {
    /* best effort */
  }
}
const FE_PORT = Number(process.env.QA_E2E_FE_PORT) || 5273
const FE_URL = `http://127.0.0.1:${FE_PORT}/`
const SERVER_ENTRY = path.resolve(ROOT, 'server', 'index.mjs')
const VITE_BIN = path.resolve(ROOT, 'node_modules', 'vite', 'bin', 'vite.js')

// Valid 1x1 PNG so the browser reads real dimensions on file-drop.
const TINY_PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

let passed = 0
let failed = 0
let page = null

async function step(name, fn) {
  try {
    await fn()
    passed++
    console.log('PASS  ' + name)
  } catch (e) {
    failed++
    console.log('FAIL  ' + name + '  ::  ' + (e && e.message ? e.message.split('\n')[0] : String(e)))
    try {
      if (page) await page.screenshot({ path: path.join(ARTIFACTS, 'e2e-' + name.replace(/[^a-z0-9]+/gi, '-').toLowerCase() + '.png'), fullPage: true })
    } catch {
      /* ignore */
    }
  }
}

// ---- Process lifecycle -------------------------------------------------------
async function probe(url) {
  try {
    const r = await fetch(url)
    return r.ok
  } catch {
    return false
  }
}

// Wait briefly for a port to free (handles back-to-back runs, e.g. qa:canvas → qa:e2e).
async function waitPortFree(url) {
  for (let i = 0; i < 16; i++) {
    if (!(await probe(url))) return true
    await new Promise((r) => setTimeout(r, 400))
  }
  return !(await probe(url))
}

async function startKeylessBackend() {
  if (!(await waitPortFree(QA_API + '/health'))) throw new Error(`Port ${QA_PORT} already in use — qa:e2e needs an exclusive keyless backend there.`)
  const proc = spawn(process.execPath, [SERVER_ENTRY], {
    env: { ...process.env, PORT: String(QA_PORT), FACTORY_DB_PATH: QA_DB_PATH, OPENAI_API_KEY: '', OPENROUTER_API_KEY: '', GROQ_API_KEY: '', POLLINATIONS_API_KEY: '', REPLICATE_API_TOKEN: '', ANTHROPIC_API_KEY: '', GEMINI_API_KEY: '' },
    stdio: 'ignore'
  })
  let health = null
  for (let i = 0; i < 30; i++) {
    try {
      const r = await fetch(QA_API + '/health')
      if (r.ok) {
        health = await r.json()
        break
      }
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 300))
  }
  if (!health) {
    try { proc.kill() } catch { /* ignore */ }
    throw new Error('Keyless backend did not become healthy.')
  }
  const cfg = health.providers_configured || {}
  if (cfg.openai || cfg.openrouter || cfg.groq || cfg.pollinations || cfg.replicate || cfg.anthropic || cfg.gemini) {
    try { proc.kill() } catch { /* ignore */ }
    throw new Error('Backend is NOT keyless — aborting to avoid paid calls.')
  }
  return proc
}

async function startVite() {
  // Refuse a pre-existing server on our port — otherwise a stale/zombie Vite could
  // serve old source while our --strictPort spawn silently fails to bind.
  if (!(await waitPortFree(FE_URL))) throw new Error(`Port ${FE_PORT} already in use — qa:e2e needs an exclusive Vite there. Stop whatever is using it and retry.`)
  const proc = spawn(process.execPath, [VITE_BIN, '--port', String(FE_PORT), '--strictPort', '--host', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' })
  for (let i = 0; i < 60; i++) {
    if (await probe(FE_URL)) return proc
    await new Promise((r) => setTimeout(r, 500))
  }
  try { proc.kill() } catch { /* ignore */ }
  throw new Error('Vite dev server did not start on ' + FE_URL)
}

function kill(proc) {
  if (proc) {
    try { proc.kill() } catch { /* ignore */ }
  }
}

// ---- Gesture helpers ---------------------------------------------------------
// Real HTML5 file drop: build a DataTransfer with File(s) and dispatch drop events.
async function dropFiles(dropzone, files) {
  const dt = await page.evaluateHandle((items) => {
    const d = new DataTransfer()
    for (const it of items) {
      const bin = Uint8Array.from(atob(it.b64), (c) => c.charCodeAt(0))
      d.items.add(new File([bin], it.name, { type: it.type }))
    }
    return d
  }, files)
  await dropzone.dispatchEvent('dragenter', { dataTransfer: dt })
  await dropzone.dispatchEvent('dragover', { dataTransfer: dt })
  await dropzone.dispatchEvent('drop', { dataTransfer: dt })
}

// Real HTML5 element drag: dragstart on a handle, drop on a target element.
async function html5Drag(sourceHandle, targetEl) {
  const dt = await page.evaluateHandle(() => new DataTransfer())
  await sourceHandle.dispatchEvent('dragstart', { dataTransfer: dt })
  await targetEl.dispatchEvent('dragover', { dataTransfer: dt })
  await targetEl.dispatchEvent('drop', { dataTransfer: dt })
  await sourceHandle.dispatchEvent('dragend', { dataTransfer: dt }).catch(() => {})
}

async function main() {
  let backend
  let vite
  try {
    backend = await startKeylessBackend()
    console.log(`Keyless backend on ${QA_API} (no provider keys; no paid calls).`)
    vite = await startVite()
    console.log(`Vite dev server on ${FE_URL}.`)
  } catch (e) {
    console.error('E2E setup failed: ' + (e && e.message ? e.message : e))
    kill(vite)
    kill(backend)
    process.exit(2)
  }

  let browser
  try {
    browser = await chromium.launch({ headless: !process.env.QA_HEADED })
  } catch (e) {
    console.error('Could not launch Chromium. Run: npx playwright install chromium')
    console.error(String(e && e.message ? e.message : e))
    kill(vite)
    kill(backend)
    process.exit(2)
  }

  const context = await browser.newContext({ acceptDownloads: true })
  page = await context.newPage()

  // Configurable native-dialog handling (for confirm() coverage).
  let dialogAction = 'accept'
  let lastDialogMessage = ''
  page.on('dialog', async (d) => {
    lastDialogMessage = d.message()
    try {
      if (dialogAction === 'dismiss') await d.dismiss()
      else await d.accept()
    } catch {
      /* ignore */
    }
  })
  page.setDefaultTimeout(15000)

  try {
    await page.goto(FE_URL, { waitUntil: 'domcontentloaded' })
  } catch {
    console.error('Cannot reach the app at ' + FE_URL)
    await browser.close()
    kill(vite)
    kill(backend)
    process.exit(2)
  }

  // Clean state + point the app at the isolated keyless backend.
  await page.evaluate((apiUrl) => {
    try {
      localStorage.clear()
      localStorage.setItem('API_BASE_URL', apiUrl)
    } catch {
      /* ignore */
    }
  }, QA_API)
  await page.reload({ waitUntil: 'domcontentloaded' })

  const nav = (re) => page.locator('.sidebar-left button.nav', { hasText: re })
  const fieldInput = (label) => page.locator('label.field', { hasText: label }).locator('input, textarea').first()
  const flowPanel = () => page.locator('.subpanel', { has: page.getByRole('heading', { name: 'Import from Flow' }) })

  // ---- Setup: competitor canvas with scenes + a built board -----------------
  await step('SETUP. Competitor canvas → scenes from outline → Board View', async () => {
    await nav(/Ad Methods/).click()
    const card = page.locator('.method-card', { hasText: 'Competitor Video Recreation' })
    await card.waitFor()
    const select = card.getByRole('button', { name: 'Select this method' })
    if (await select.count()) await select.click()
    await page.locator('.sidebar-left button.nav', { has: page.getByText('Canvas', { exact: true }) }).click()
    await page.getByRole('heading', { name: /Canvas — Competitor Recreation/ }).waitFor()
    const ta = page.locator('.subpanel', { hasText: 'Quick Add From Outline' }).locator('textarea')
    await ta.fill(['0:00-0:03 Hook: a', '0:03-0:07 Problem: b', '0:07-0:12 Reveal: c'].join('\n'))
    await page.getByRole('button', { name: 'Create Scenes From Outline' }).click()
    await page.locator('.scene-card').nth(2).waitFor()
    await page.getByRole('button', { name: 'Board View' }).click()
    await page.getByRole('button', { name: 'Build Board From Scenes', exact: true }).click()
    await page.locator('.board-node').first().waitFor()
  })

  // ---- a. Flow import via REAL drag-drop ------------------------------------
  await step('E1. Drag-drop ONE image onto the dropzone → previews with real 1×1 dims, matched to its scene', async () => {
    const dz = flowPanel().locator('[data-testid="flow-dropzone"]')
    await dz.waitFor()
    await dropFiles(dz, [{ name: 'scene01_v02.png', type: 'image/png', b64: TINY_PNG_B64 }])
    const item = flowPanel().locator('.flow-item').first()
    await item.waitFor()
    await item.getByText('filename → scene 1', { exact: false }).waitFor()
    await item.getByText('1×1', { exact: false }).waitFor()
  })

  await step('E2. Drag-drop MULTIPLE images at once → matched + unsorted grouping is correct', async () => {
    const dz = flowPanel().locator('[data-testid="flow-dropzone"]')
    await dropFiles(dz, [
      { name: 'scene03_v01.png', type: 'image/png', b64: TINY_PNG_B64 },
      { name: 'random-name.png', type: 'image/png', b64: TINY_PNG_B64 }
    ])
    await flowPanel().getByText('filename → scene 3', { exact: false }).waitFor()
    await flowPanel().getByText('Unsorted', { exact: false }).first().waitFor()
    // Nothing has auto-attached: items still show their Save & Attach control.
    await flowPanel().getByRole('button', { name: /Save & Attach/ }).first().waitFor()
  })

  // ---- b. Batch "Save & Attach all matched" --------------------------------
  await step('E3. "Save & Attach all matched" attaches matched imports to their scenes (success path)', async () => {
    // Matched so far: scene01_v02 (scene 1) + scene03_v01 (scene 3). Unsorted: random-name.
    const beforeGen = await page.locator('.variation-card.status-generated').count()
    const batchBtn = flowPanel().getByRole('button', { name: /Save & Attach all matched/ })
    await batchBtn.waitFor()
    await batchBtn.click()
    // Assert the DURABLE outcome (the transient "Saved & attached N" summary lives
    // inside the Matched block, which empties as items save — so we check results):
    // both matched imports attach as generated variations to their target scenes.
    let afterGen = beforeGen
    for (let i = 0; i < 40; i++) {
      afterGen = await page.locator('.variation-card.status-generated').count()
      if (afterGen === beforeGen + 2) break
      await page.waitForTimeout(250)
    }
    if (afterGen !== beforeGen + 2) throw new Error(`expected +2 generated variations from batch, got ${beforeGen} -> ${afterGen}`)
    // Saved matched items are removed from the pending list; the unsorted item remains.
    if (await flowPanel().getByText('filename → scene 1', { exact: false }).count()) throw new Error('saved matched item should be removed from the pending list')
    await flowPanel().getByText('Unsorted', { exact: false }).first().waitFor()
    // NOTE: a clean save-FAILURE injection isn't possible key-free without breaking
    // the local backend mid-run; the failure-continues logic is covered by the pure
    // qa:canvas path. Here we assert the real-gesture success path + pending cleanup.
  })

  // ---- c. Variation reorder within a scene via REAL drag -------------------
  await step('E4. Variation reorder within a scene (drag handle) keeps selection; cross-scene drag is rejected', async () => {
    const row1 = page.locator('.variation-list').first()
    // Scene 1 already has 1 attached variation (A from batch). Add a second.
    const addBtns = page.getByRole('button', { name: 'Add Variation' })
    await addBtns.first().click()
    await page.waitForTimeout(150)
    let cards = row1.locator('.variation-card')
    if ((await cards.count()) < 2) throw new Error('scene 1 should have 2 variations to reorder')
    // Mark the FIRST variation selected, then drag the SECOND before it.
    await cards.nth(0).getByRole('button', { name: 'Mark selected' }).click()
    const firstLabelBefore = (await cards.nth(0).locator('strong').first().innerText()).trim()
    const secondLabelBefore = (await cards.nth(1).locator('strong').first().innerText()).trim()
    await html5Drag(cards.nth(1).locator('.drag-handle'), cards.nth(0))
    await page.waitForTimeout(150)
    cards = row1.locator('.variation-card')
    const firstLabelAfter = (await cards.nth(0).locator('strong').first().innerText()).trim()
    if (firstLabelAfter !== secondLabelBefore) throw new Error(`reorder did not move the dragged variation to front (got ${firstLabelAfter})`)
    // The previously-selected variation is still selected (now at index 1).
    const selectedText = await row1.locator('.variation-card .badge.status-selected').first().innerText().catch(() => '')
    if (!selectedText) throw new Error('selection lost after reorder')
    const selectedCardLabel = (await row1.locator('.variation-card', { has: page.locator('.badge.status-selected') }).first().locator('strong').first().innerText()).trim()
    if (selectedCardLabel !== firstLabelBefore) throw new Error('a different variation became selected after reorder')

    // Cross-scene: add a variation to scene 2, drag scene-1 card onto it → no move.
    await addBtns.nth(1).click()
    await page.waitForTimeout(150)
    const row2 = page.locator('.variation-list').nth(1)
    const s1count = await row1.locator('.variation-card').count()
    const s2count = await row2.locator('.variation-card').count()
    await html5Drag(row1.locator('.variation-card').first().locator('.drag-handle'), row2.locator('.variation-card').first())
    await page.waitForTimeout(150)
    if ((await row1.locator('.variation-card').count()) !== s1count || (await row2.locator('.variation-card').count()) !== s2count) {
      throw new Error('cross-scene drag changed variation membership (should be rejected)')
    }
  })

  // ---- d. Scene reorder in the Final Timeline via REAL drag ----------------
  await step('E5. Scene reorder in the Final Timeline (drag handle) swaps order, scene_number stays stable', async () => {
    // Ensure scene 2 has a selected variation so the timeline lists 2 scenes.
    const row2 = page.locator('.variation-list').nth(1)
    await row2.locator('.variation-card').first().getByRole('button', { name: 'Mark selected' }).click()
    const timeline = page.locator('.final-timeline')
    await timeline.locator('.timeline-item').nth(1).waitFor()
    const items = timeline.locator('.timeline-item')
    const firstBefore = (await items.nth(0).locator('strong').first().innerText()).trim()
    const secondBefore = (await items.nth(1).locator('strong').first().innerText()).trim()
    if (firstBefore === secondBefore) throw new Error('timeline needs two distinct scenes')
    await html5Drag(items.nth(1).locator('.drag-handle'), items.nth(0))
    await page.waitForTimeout(150)
    const firstAfter = (await timeline.locator('.timeline-item').nth(0).locator('strong').first().innerText()).trim()
    if (firstAfter !== secondBefore) throw new Error(`scene reorder did not swap order (got ${firstAfter}, expected ${secondBefore})`)
    // scene_number labels are stable identities (e.g. still "Scene 2"), just repositioned.
    if (!/Scene \d+/.test(firstAfter)) throw new Error('scene label malformed after reorder')
  })

  // ---- e. Native confirm() dialogs -----------------------------------------
  await step('E6. Delete-variation confirm: DISMISS keeps it, ACCEPT removes it', async () => {
    const row1 = page.locator('.variation-list').first()
    const before = await row1.locator('.variation-card').count()
    // Dismiss → no deletion.
    dialogAction = 'dismiss'
    await row1.locator('.variation-card').first().getByRole('button', { name: '🗑' }).click()
    await page.waitForTimeout(150)
    if ((await row1.locator('.variation-card').count()) !== before) throw new Error('dismiss should not delete the variation')
    // Accept → deletion.
    dialogAction = 'accept'
    await row1.locator('.variation-card').first().getByRole('button', { name: '🗑' }).click()
    await page.waitForTimeout(150)
    if ((await row1.locator('.variation-card').count()) !== before - 1) throw new Error('accept should delete exactly one variation')
    if (!/Delete variation/i.test(lastDialogMessage)) throw new Error('expected a delete confirm dialog message')
    dialogAction = 'accept'
  })

  await step('E7. Export readiness confirm fires on blockers and "Export anyway" proceeds', async () => {
    await nav(/Product \/ Offer Brief/).click()
    await fieldInput('Product name').fill('E2E Product')
    await fieldInput('Market / language').fill('US / English')
    await nav(/Final Export/).click()
    // Readiness badge is present (some scenes lack a selection → blockers).
    await page.getByTestId('export-readiness').waitFor()
    lastDialogMessage = ''
    dialogAction = 'accept' // "Export anyway"
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export Flow Package Markdown' }).click()])
    if (!/readiness|blocker|anyway|warning/i.test(lastDialogMessage)) throw new Error(`expected a readiness confirm dialog, got: ${JSON.stringify(lastDialogMessage)}`)
    const outPath = path.join(ARTIFACTS, 'e2e-export.md')
    await download.saveAs(outPath)
    const text = fs.readFileSync(outPath, 'utf8')
    if (!text.includes('## Readiness Summary')) throw new Error('forced export must still emit the Readiness Summary')
  })

  await browser.close()
  kill(vite)
  kill(backend)
  console.log(`\n${passed} passed, ${failed} failed`)
  console.log(`Artifacts (on failure): ${ARTIFACTS}`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error('Fatal: ' + (e && e.message ? e.message : e))
  process.exit(1)
})
