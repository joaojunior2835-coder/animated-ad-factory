// Throwaway dev probe for the Node Canvas v2 (NOT part of the QA suite).
// Drives the running dev server, spawns nodes via context menu, checks selection,
// minimap, fit button, wire-draw and per-type bodies. Screenshots to qa-artifacts/dev-probe-*.
import { chromium } from 'playwright'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const BASE = process.env.QA_BASE || 'http://localhost:5173/'
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ART = path.resolve(__dirname, '..', 'qa-artifacts')

let passed = 0
let failed = 0
let page

async function step(name, fn) {
  try {
    await fn()
    passed++
    console.log('PASS  ' + name)
  } catch (e) {
    failed++
    console.log('FAIL  ' + name + ' :: ' + (e && e.message ? e.message.split('\n')[0] : e))
    try { await page.screenshot({ path: path.join(ART, 'dev-probe-' + name.replace(/[^a-z0-9]+/gi, '-').toLowerCase() + '.png') }) } catch {}
  }
}

const browser = await chromium.launch({ headless: true })
const ctx = await browser.newContext({ viewport: { width: 1720, height: 950 } })
page = await ctx.newPage()
let lastDialog = ''
page.on('dialog', (d) => {
  lastDialog = d.message()
  d.accept().catch(() => {})
})
page.on('pageerror', (e) => console.log('PAGE ERROR: ' + e.message))
page.setDefaultTimeout(8000)
await page.goto(BASE, { waitUntil: 'domcontentloaded' })
await page.evaluate(() => localStorage.clear())
await page.reload({ waitUntil: 'domcontentloaded' })

await step('open node canvas', async () => {
  await page.locator('.sidebar-left button.nav', { hasText: 'Node Canvas' }).click()
  await page.locator('.node-canvas').waitFor()
})

await step('context menu lists all 10 types', async () => {
  await page.locator('.node-canvas').click({ button: 'right', position: { x: 300, y: 150 } })
  const items = await page.locator('.node-menu button').count()
  if (items !== 10) throw new Error(`expected 10 menu items, got ${items}`)
})

await step('spawn prompt node via menu', async () => {
  await page.locator('.node-menu button', { hasText: 'Prompt' }).first().click()
  await page.locator('.gnode').first().waitFor()
  const n = await page.locator('.gnode').count()
  if (n !== 1) throw new Error(`expected 1 node, got ${n}`)
})

await step('spawn image generator + character', async () => {
  await page.locator('.node-canvas').click({ button: 'right', position: { x: 620, y: 150 } })
  await page.locator('.node-menu button', { hasText: 'Image Generator' }).click()
  await page.locator('.node-canvas').click({ button: 'right', position: { x: 300, y: 420 } })
  await page.locator('.node-menu button', { hasText: 'Character' }).click()
  const n = await page.locator('.gnode').count()
  if (n !== 3) throw new Error(`expected 3 nodes, got ${n}`)
})

await step('image gen has model select, status badge, generate, credit label', async () => {
  const ig = page.locator('.gnode').filter({ has: page.locator('.gnode-head strong', { hasText: 'Image Generator' }) })
  await ig.locator('select[aria-label="Generation model"]').waitFor()
  await ig.locator('.badge.gen-status').waitFor()
  await ig.locator('button', { hasText: 'Generate' }).waitFor()
  await ig.locator('.gnode-credit', { hasText: 'Free (mock)' }).waitFor()
})

await step('generate disabled without prompt; enabled with prompt text', async () => {
  const ig = page.locator('.gnode').filter({ has: page.locator('.gnode-head strong', { hasText: 'Image Generator' }) })
  const btn = ig.locator('button', { hasText: 'Generate' })
  if (!(await btn.isDisabled())) throw new Error('Generate should be disabled with empty prompt')
  await ig.locator('textarea[aria-label="Image prompt"]').fill('a test image')
  if (await btn.isDisabled()) throw new Error('Generate should be enabled with prompt text')
})

await step('generate button routes to App stub (error status appears)', async () => {
  // Fit first — at the spawn position the node footer can sit under the minimap overlay.
  await page.locator('.nc-fit').click()
  const ig = page.locator('.gnode').filter({ has: page.locator('.gnode-head strong', { hasText: 'Image Generator' }) })
  await ig.locator('button', { hasText: 'Generate' }).click()
  await ig.locator('.badge.gen-status.status-error').waitFor()
  await ig.locator('.gnode-error', { hasText: 'not connected yet' }).waitFor()
})

await step('wire prompt -> image gen prompt input', async () => {
  // Earlier clicks on clipped elements make Playwright wheel-scroll (which the
  // canvas reads as zoom). Normalize the view first so both sockets are visible.
  await page.locator('.nc-fit').click()
  const out = page.locator('.gnode').filter({ has: page.locator('.gnode-head strong', { hasText: 'Prompt' }) }).first().locator('.gsock-row.out .gsock').first()
  const inp = page.locator('.gnode').filter({ has: page.locator('.gnode-head strong', { hasText: 'Image Generator' }) }).locator('.gsock-row.in', { hasText: 'Prompt' }).locator('.gsock')
  const a = await out.boundingBox()
  const b = await inp.boundingBox()
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2)
  await page.mouse.down()
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 8 })
  await page.mouse.up()
  const wires = await page.locator('.node-wires .wire').count()
  if (wires !== 1) throw new Error(`expected 1 wire, got ${wires}`)
})

await step('click wire selects it (orange), delete removes it', async () => {
  // Click a point that is actually ON the curve (the bbox center can sit under a node).
  const pt = await page.evaluate(() => {
    const p = document.querySelector('.node-wires .wire .wire-line')
    const mid = p.getPointAtLength(p.getTotalLength() / 2)
    const m = p.getScreenCTM()
    const x = m.a * mid.x + m.c * mid.y + m.e
    const y = m.b * mid.x + m.d * mid.y + m.f
    const el = document.elementFromPoint(x, y)
    return { x, y, under: el ? el.getAttribute('class') || el.tagName : 'none' }
  })
  await page.mouse.click(pt.x, pt.y)
  // NOTE: waitFor() visibility on an SVG <g> inside the 1x1 overflow-visible svg is
  // unreliable in Playwright — assert via count() instead.
  await page.waitForTimeout(150)
  if ((await page.locator('.wire.wire-selected').count()) !== 1) throw new Error('wire not selected after click')
  await page.keyboard.press('Delete')
  const wires = await page.locator('.node-wires .wire').count()
  if (wires !== 0) throw new Error(`expected 0 wires after delete, got ${wires}`)
})

await step('shift+click multi-select two nodes', async () => {
  await page.locator('.gnode').filter({ has: page.locator('.gnode-head strong', { hasText: 'Prompt' }) }).first().locator('.gnode-head').click()
  await page.locator('.gnode').filter({ has: page.locator('.gnode-head strong', { hasText: 'Character' }) }).locator('.gnode-head').click({ modifiers: ['Shift'] })
  const sel = await page.locator('.gnode.selected').count()
  if (sel !== 2) throw new Error(`expected 2 selected, got ${sel}`)
})

await step('escape deselects', async () => {
  await page.keyboard.press('Escape')
  const sel = await page.locator('.gnode.selected').count()
  if (sel !== 0) throw new Error(`expected 0 selected, got ${sel}`)
})

await step('minimap + fit button render', async () => {
  await page.locator('.nc-minimap').waitFor()
  await page.locator('.nc-fit').click()
  await page.locator('.nc-minimap svg rect').first().waitFor()
})

await step('double-click header renames node', async () => {
  const head = page.locator('.gnode').filter({ has: page.locator('.gnode-head strong', { hasText: 'Character' }) }).locator('.gnode-head')
  await head.dblclick()
  const input = page.locator('.gnode-label-input')
  await input.fill('Hero Persona')
  await input.press('Enter')
  await page.locator('.gnode').filter({ has: page.locator('.gnode-head strong', { hasText: 'Hero Persona' }) }).waitFor()
})

await step('output node body: scene number + export button', async () => {
  await page.locator('.node-canvas').click({ button: 'right', position: { x: 80, y: 320 } })
  await page.locator('.node-menu button', { hasText: 'Output' }).click()
  const out = page.locator('.gnode').filter({ has: page.locator('.gnode-head strong', { hasText: 'Output' }) })
  await out.locator('input[aria-label="Scene number"]').waitFor()
  await out.locator('button', { hasText: 'Export to Final Timeline' }).click()
  await out.locator('.note', { hasText: 'No result to export yet.' }).waitFor()
})

await step('delete selected node via keyboard', async () => {
  const before = await page.locator('.gnode').count()
  await page.locator('.gnode').filter({ has: page.locator('.gnode-head strong', { hasText: 'Hero Persona' }) }).locator('.gnode-head').click()
  await page.keyboard.press('Delete')
  const after = await page.locator('.gnode').count()
  if (after !== before - 1) throw new Error(`expected ${before - 1} nodes, got ${after}`)
})

await step('graph persists across reload', async () => {
  const before = await page.locator('.gnode').count()
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.locator('.sidebar-left button.nav', { hasText: 'Node Canvas' }).click()
  await page.locator('.gnode').first().waitFor()
  const after = await page.locator('.gnode').count()
  if (after !== before) throw new Error(`expected ${before} nodes after reload, got ${after}`)
})

// ---- Phase 3: sidebar (palette + model gallery) ----
await step('sidebar renders with Nodes/Models tabs; palette has 10 cards', async () => {
  await page.locator('.ncsb').waitFor()
  const cards = await page.locator('.ncsb-node-card').count()
  if (cards !== 10) throw new Error(`expected 10 palette cards, got ${cards}`)
})

await step('click palette card spawns node at center', async () => {
  const before = await page.locator('.gnode').count()
  await page.locator('.ncsb-node-card', { hasText: 'Style' }).click()
  const after = await page.locator('.gnode').count()
  if (after !== before + 1) throw new Error(`expected ${before + 1} nodes, got ${after}`)
})

await step('model gallery lists 4 builtin models sorted Test→Manual→Premium', async () => {
  await page.locator('.ncsb-tabs .tab', { hasText: 'Models' }).click()
  const names = await page.locator('.ncsb-model-name').allInnerTexts()
  if (names.length !== 4) throw new Error(`expected 4 models, got ${names.length}: ${names}`)
  if (!/Mock/.test(names[0])) throw new Error(`Test category should sort first, got ${names[0]}`)
  if (!/OpenAI/.test(names[3])) throw new Error(`Premium should sort last, got ${names[3]}`)
})

await step('search filters models live', async () => {
  await page.locator('.ncsb-search').fill('video')
  const names = await page.locator('.ncsb-model-name').allInnerTexts()
  if (names.length !== 1 || !/Mock Video/.test(names[0])) throw new Error(`expected only Mock Video, got ${names}`)
  await page.locator('.ncsb-search').fill('')
})

await step('Use on video model with nothing selected creates video gen node with model set', async () => {
  await page.keyboard.press('Escape')
  const before = await page.locator('.gnode').count()
  await page.locator('.ncsb-model-card', { hasText: 'Mock Video' }).getByRole('button', { name: 'Use' }).click()
  const after = await page.locator('.gnode').count()
  if (after !== before + 1) throw new Error('Use should create a node when none selected')
  const sel = page.locator('.gnode.selected select[aria-label="Generation model"]')
  const val = await sel.inputValue()
  if (val !== 'mock-video') throw new Error(`new node model should be mock-video, got ${val}`)
})

await step('Use on image model applies to selected image gen node', async () => {
  await page.locator('.gnode').filter({ has: page.locator('.gnode-head strong', { hasText: 'Image Generator' }) }).first().locator('.gnode-head').click()
  await page.locator('.ncsb-model-card', { hasText: 'OpenAI Image' }).getByRole('button', { name: 'Use' }).click()
  const val = await page.locator('.gnode').filter({ has: page.locator('.gnode-head strong', { hasText: 'Image Generator' }) }).first().locator('select[aria-label="Generation model"]').inputValue()
  if (val !== 'openai-image') throw new Error(`selected node model should be openai-image, got ${val}`)
  await page.locator('.gnode').filter({ has: page.locator('.gnode-head strong', { hasText: 'Image Generator' }) }).first().locator('.gnode-credit', { hasText: 'Uses API credits' }).waitFor()
})

await step('Add Custom Model persists to localStorage and appears in gallery', async () => {
  await page.locator('button', { hasText: '+ Add Custom Model' }).click()
  await page.locator('.ncsb-addmodel input[aria-label="Model id"]').fill('probe-model')
  await page.locator('.ncsb-addmodel input[aria-label="Model name"]').fill('Probe Model')
  await page.locator('.ncsb-addmodel select[aria-label="Model output type"]').selectOption('image')
  await page.locator('.ncsb-addmodel textarea[aria-label="Model description"]').fill('Added by probe')
  await page.locator('.ncsb-addmodel button', { hasText: 'Add Model' }).click()
  await page.locator('.ncsb-model-card', { hasText: 'Probe Model' }).waitFor()
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('aaf_custom_models') || '[]'))
  if (!stored.some((m) => m.id === 'probe-model')) throw new Error('custom model not in localStorage')
})

await step('custom model offered in node model dropdown', async () => {
  const sel = page.locator('.gnode').filter({ has: page.locator('.gnode-head strong', { hasText: 'Image Generator' }) }).first().locator('select[aria-label="Generation model"]')
  const opts = await sel.locator('option').allInnerTexts()
  if (!opts.some((o) => /Probe Model/.test(o))) throw new Error(`custom model missing from dropdown: ${opts}`)
})

await step('sidebar collapses to edge toggle and reopens', async () => {
  await page.locator('.ncsb-head .ncsb-toggle').click()
  if (await page.locator('.ncsb').count()) throw new Error('sidebar should be hidden when collapsed')
  await page.locator('.ncsb-toggle.collapsed').click()
  await page.locator('.ncsb').waitFor()
})

// ---- Phase 4: top toolbar ----
await step('toolbar renders: name, node count, mode badge, buttons', async () => {
  await page.locator('.nc-toolbar').waitFor()
  await page.locator('.nc-toolbar-name', { hasText: 'Untitled Canvas' }).waitFor()
  await page.locator('.nc-toolbar .api-badge', { hasText: 'Mode: Manual' }).waitFor()
  for (const label of ['Fit to screen', 'Save snapshot', 'Load snapshot', 'Clear canvas', 'Run All']) {
    await page.locator('.nc-toolbar button', { hasText: label }).waitFor()
  }
  const countTxt = await page.locator('.nc-toolbar .badge').first().innerText()
  const onBoard = await page.locator('.gnode').count()
  if (!countTxt.includes(String(onBoard))) throw new Error(`node count badge "${countTxt}" should reflect ${onBoard} nodes`)
})

await step('canvas rename persists into node_canvas.name', async () => {
  await page.locator('.nc-toolbar-name').click()
  const input = page.locator('.nc-toolbar-name-input')
  await input.fill('Probe Production Board')
  await input.press('Enter')
  await page.locator('.nc-toolbar-name', { hasText: 'Probe Production Board' }).waitFor()
})

await step('save snapshot downloads a named JSON with nodes', async () => {
  const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('.nc-toolbar button', { hasText: 'Save snapshot' }).click()])
  const fn = dl.suggestedFilename()
  if (!/^probe-production-board-canvas-.*\.json$/.test(fn)) throw new Error(`bad snapshot filename: ${fn}`)
  const tmp = path.join(ART, 'dev-probe-snapshot.json')
  await dl.saveAs(tmp)
  const snap = JSON.parse((await import('node:fs')).readFileSync(tmp, 'utf8'))
  if (!Array.isArray(snap.nodes) || !snap.nodes.length) throw new Error('snapshot has no nodes')
  if (snap.name !== 'Probe Production Board') throw new Error('snapshot missing canvas name')
})

await step('Run All confirms with node count and runs idle generators (stub errors)', async () => {
  // Current board has mock-model generators (idle) → confirm fires, stub marks them error.
  lastDialog = ''
  await page.locator('.nc-toolbar button', { hasText: 'Run All' }).click()
  await page.waitForTimeout(300)
  if (!/This will generate \d+ node/.test(lastDialog)) throw new Error(`expected Run All confirm, got: ${lastDialog}`)
  await page.locator('.gnode .badge.gen-status.status-error').first().waitFor()
})

await step('clear canvas confirms and empties the board', async () => {
  lastDialog = ''
  await page.locator('.nc-toolbar button', { hasText: 'Clear canvas' }).click()
  await page.waitForTimeout(200)
  if (!/Clear the canvas/.test(lastDialog)) throw new Error('expected clear confirm dialog')
  const n = await page.locator('.gnode').count()
  if (n !== 0) throw new Error(`expected empty board, got ${n} nodes`)
})

await step('load snapshot restores nodes and warns-free for known types', async () => {
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.locator('.nc-toolbar button', { hasText: 'Load snapshot' }).click()])
  await chooser.setFiles(path.join(ART, 'dev-probe-snapshot.json'))
  await page.waitForTimeout(300)
  const n = await page.locator('.gnode').count()
  if (n < 1) throw new Error('snapshot did not restore nodes')
  await page.locator('.nc-toolbar-name', { hasText: 'Probe Production Board' }).waitFor()
})

await page.screenshot({ path: path.join(ART, 'dev-probe-final.png'), fullPage: true })
await browser.close()
console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
