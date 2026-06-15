// Automated browser smoke test for the Canvas Speed Batch (Competitor Video
// Recreation). Drives the local dashboard with Playwright. No APIs, no network
// beyond the local dev server.
//
// Run:  npm run qa:canvas        (dev server must be running: npm run dev)
//   env QA_BASE   override URL (default http://localhost:5173/)
//   env QA_HEADED=1   watch the browser
//
// Failure screenshots + the exported markdown are written to dashboard/qa-artifacts/.

import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { newVariation, reorderVariations, reorderScenes, removeVariation, replaceVariationMedia, normalizeCanvas, emptyCanvas, sumSceneDurations, parseDeclaredSeconds, durationStatus, findSceneGaps, assessExportReadiness, applyGeneratedScenePrompts, applyAdBriefScenes, normalizeAdBrief } from '../src/lib/canvasModel.js'

const BASE = process.env.QA_BASE || 'http://localhost:5173/'
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ARTIFACTS = path.resolve(__dirname, '..', 'qa-artifacts')
fs.mkdirSync(ARTIFACTS, { recursive: true })

// Tiny sample file for upload tests (PNG signature bytes; content not important).
const SAMPLE_FILE = path.join(ARTIFACTS, 'upload-sample.png')
fs.writeFileSync(SAMPLE_FILE, Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex'))

// Valid 1x1 PNG named to the scene<NN>_v<NN> convention for the Flow import test
// (real bytes so the browser can read its dimensions).
const FLOW_SCENE_FILE = path.join(ARTIFACTS, 'scene01_v02.png')
const TINY_PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
fs.writeFileSync(FLOW_SCENE_FILE, Buffer.from(TINY_PNG_B64, 'base64'))
// Two more scene-named fixtures for the "Save & Attach all matched" batch test.
const FLOW_BATCH_A = path.join(ARTIFACTS, 'scene03_v01.png')
const FLOW_BATCH_B = path.join(ARTIFACTS, 'scene04_v01.png')
fs.writeFileSync(FLOW_BATCH_A, Buffer.from(TINY_PNG_B64, 'base64'))
fs.writeFileSync(FLOW_BATCH_B, Buffer.from(TINY_PNG_B64, 'base64'))

const SAMPLE_OUTLINE = [
  '0:00-0:03 Hook: creator opens fridge and sees snack temptation',
  '0:03-0:07 Problem: she looks frustrated after training',
  '0:07-0:12 Product reveal: ritual drink appears on counter',
  '0:12-0:20 Demo: she mixes the drink',
  '0:20-0:27 Shift: kitchen becomes calm',
  '0:27-0:30 CTA: final product hero shot'
].join('\n')

let passed = 0
let failed = 0
let page = null
let qaBackend = null

// --- Isolated keyless QA backend ---------------------------------------------
// qa:canvas runs its OWN backend on a dedicated port with all provider keys
// cleared, and points the browser at it via a localStorage override. This makes
// the run deterministic and key-free even if a real keyed backend is already
// running on 8787 — qa never reuses it and never makes paid LLM calls.
const QA_PORT = Number(process.env.QA_API_PORT) || 8788
const QA_API = `http://127.0.0.1:${QA_PORT}`
const SERVER_ENTRY = path.resolve(__dirname, '..', 'server', 'index.mjs')
// 1x1 transparent PNG as a valid data URL for save tests.
const TINY_PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

async function qaHealth() {
  try {
    const r = await fetch(QA_API + '/health')
    if (!r.ok) return null
    return await r.json()
  } catch {
    return null
  }
}

// Spawn the keyless QA backend on QA_PORT. Fails if the port is already taken
// (we must control it to guarantee keyless isolation — never reuse a stranger).
async function startQaBackend() {
  if (await qaHealth()) {
    throw new Error(`Port ${QA_PORT} is already in use. qa:canvas needs an exclusive keyless backend on ${QA_PORT}. Stop whatever is using it and retry.`)
  }
  const proc = spawn(process.execPath, [SERVER_ENTRY], {
    env: { ...process.env, PORT: String(QA_PORT), OPENAI_API_KEY: '', OPENROUTER_API_KEY: '', GROQ_API_KEY: '', POLLINATIONS_API_KEY: '', ANTHROPIC_API_KEY: '', GEMINI_API_KEY: '' },
    stdio: 'ignore'
  })
  let health = null
  for (let i = 0; i < 30; i++) {
    health = await qaHealth()
    if (health) break
    await new Promise((r) => setTimeout(r, 300))
  }
  if (!health) {
    try {
      proc.kill()
    } catch {
      /* ignore */
    }
    throw new Error(`QA backend did not become healthy on ${QA_PORT}.`)
  }
  // Guard: this backend MUST be keyless so qa never triggers paid provider calls.
  const cfg = health.providers_configured || {}
  if (cfg.openai || cfg.openrouter || cfg.groq || cfg.pollinations || cfg.anthropic || cfg.gemini) {
    try {
      proc.kill()
    } catch {
      /* ignore */
    }
    throw new Error('QA backend is NOT keyless (a provider key leaked into its env). Aborting to avoid paid API calls.')
  }
  return proc
}

function stopQaBackend(proc) {
  if (proc) {
    try {
      proc.kill()
    } catch {
      /* ignore */
    }
  }
}

async function step(name, fn) {
  try {
    await fn()
    passed++
    console.log('PASS  ' + name)
  } catch (e) {
    failed++
    const msg = e && e.message ? e.message.split('\n')[0] : String(e)
    console.log('FAIL  ' + name + '  ::  ' + msg)
    try {
      if (page) await page.screenshot({ path: path.join(ARTIFACTS, name.replace(/[^a-z0-9]+/gi, '-').toLowerCase() + '.png'), fullPage: true })
    } catch {
      /* ignore screenshot errors */
    }
  }
}

async function main() {
  // Start the isolated keyless backend first; abort clearly if it can't.
  try {
    qaBackend = await startQaBackend()
    console.log(`QA keyless backend on ${QA_API} (no provider keys; no paid calls).`)
  } catch (e) {
    console.error('QA backend isolation failed: ' + (e && e.message ? e.message : e))
    process.exit(2)
  }

  let browser
  try {
    browser = await chromium.launch({ headless: !process.env.QA_HEADED })
  } catch (e) {
    console.error('Could not launch Chromium. Run: npx playwright install chromium')
    console.error(String(e && e.message ? e.message : e))
    stopQaBackend(qaBackend)
    process.exit(2)
  }

  const context = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'], acceptDownloads: true })
  page = await context.newPage()
  page.on('dialog', (d) => d.accept().catch(() => {}))
  page.setDefaultTimeout(15000)

  // Reachability
  try {
    await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  } catch {
    console.error(`Cannot reach ${BASE}. Start the dev server first:  npm run dev`)
    stopQaBackend(qaBackend)
    await browser.close()
    process.exit(2)
  }

  // Clean, deterministic state AND point the app at the isolated keyless backend
  // (localStorage override read by apiClient). Never touches your real backend.
  await page.evaluate((apiUrl) => {
    try {
      localStorage.clear()
      localStorage.setItem('API_BASE_URL', apiUrl)
    } catch {
      /* ignore */
    }
  }, QA_API)
  await page.reload({ waitUntil: 'domcontentloaded' })

  // Sidebar-scoped nav avoids ambiguous matches (e.g. /Canvas/ also matches
  // content buttons like "Sync Canvas To Export Data").
  const nav = (re) => page.locator('.sidebar-left button.nav', { hasText: re })
  const fieldInput = (label) => page.locator('label.field', { hasText: label }).locator('input, textarea').first()

  await step('RV. Variation reorder: within-scene move, selection preserved, survives round-trip', async () => {
    const vars = [
      newVariation('A', { id: 'a', status: 'generated' }),
      newVariation('B', { id: 'b', status: 'selected' }),
      newVariation('C', { id: 'c', status: 'generated' })
    ]
    // Move index 2 (C) to index 0 — the same helper the UI's reorder calls.
    const reordered = reorderVariations(vars, 'c', 'a')
    const order = reordered.map((v) => v.id).join(',')
    if (order !== 'c,a,b') throw new Error(`reorder failed: expected c,a,b got ${order}`)
    // Selection is unchanged (still B, status selected).
    const sel = reordered.find((v) => v.status === 'selected')
    if (!sel || sel.id !== 'b') throw new Error(`selection changed after reorder: ${sel && sel.id}`)
    // Save/reload round-trip (serialize → normalize) preserves order + selection.
    const canvas = normalizeCanvas({ ...emptyCanvas(), scenes: [{ id: 's1', scene_number: 1, variations: reordered }] })
    const loaded = normalizeCanvas(JSON.parse(JSON.stringify(canvas)))
    const loadedOrder = loaded.scenes[0].variations.map((v) => v.id).join(',')
    if (loadedOrder !== 'c,a,b') throw new Error(`order not persisted: ${loadedOrder}`)
    const loadedSel = loaded.scenes[0].variations.find((v) => v.status === 'selected')
    if (!loadedSel || loadedSel.id !== 'b') throw new Error(`selection not persisted: ${loadedSel && loadedSel.id}`)
  })

  await step('RS. Scene reorder: timeline order changes, scene_number stable, selections kept, survives round-trip', async () => {
    const mk = (id, num, selId) => ({ id, scene_number: num, variations: [newVariation('A', { id: selId, status: 'selected' })] })
    const scenes = [mk('s1', 1, 'v1'), mk('s2', 2, 'v2'), mk('s3', 3, 'v3')]
    // Move index 2 (s3) to index 0 — the same helper the timeline drag calls.
    const reordered = reorderScenes(scenes, 's3', 's1')
    const order = reordered.map((s) => s.id).join(',')
    if (order !== 's3,s1,s2') throw new Error(`scene reorder failed: expected s3,s1,s2 got ${order}`)
    // scene_number is STABLE (identity/label, not renumbered).
    const nums = reordered.map((s) => s.scene_number).join(',')
    if (nums !== '3,1,2') throw new Error(`scene_number changed (should be stable): ${nums}`)
    // Each scene keeps its selected variation.
    const sel = reordered.map((s) => (s.variations.find((v) => v.status === 'selected') || {}).id).join(',')
    if (sel !== 'v3,v1,v2') throw new Error(`selected variations changed: ${sel}`)
    // Save/reload round-trip (serialize → normalize) preserves order + numbers + selection.
    const canvas = normalizeCanvas({ ...emptyCanvas(), scenes: reordered })
    const loaded = normalizeCanvas(JSON.parse(JSON.stringify(canvas)))
    if (loaded.scenes.map((s) => s.id).join(',') !== 's3,s1,s2') throw new Error('scene order not persisted')
    if (loaded.scenes.map((s) => s.scene_number).join(',') !== '3,1,2') throw new Error('scene_number not stable across reload')
    if (loaded.scenes.map((s) => (s.variations.find((v) => v.status === 'selected') || {}).id).join(',') !== 'v3,v1,v2') throw new Error('selections not persisted')
  })

  await step('DV. Delete variation: selection rule + persistence', async () => {
    const mk = () => [
      newVariation('A', { id: 'a', status: 'generated' }),
      newVariation('B', { id: 'b', status: 'selected' }),
      newVariation('C', { id: 'c', status: 'generated' })
    ]
    // Remove the SELECTED one (B) → [A, C], NO selection (no auto-promote).
    const afterB = removeVariation(mk(), 'b')
    if (afterB.map((v) => v.id).join(',') !== 'a,c') throw new Error(`delete selected: bad order ${afterB.map((v) => v.id)}`)
    if (afterB.some((v) => v.status === 'selected')) throw new Error('delete selected: a variation is still selected (should be none)')
    // Round-trip persists the removal + no-selection.
    const canvas = normalizeCanvas({ ...emptyCanvas(), scenes: [{ id: 's1', scene_number: 1, variations: afterB }] })
    const loaded = normalizeCanvas(JSON.parse(JSON.stringify(canvas)))
    if (loaded.scenes[0].variations.map((v) => v.id).join(',') !== 'a,c') throw new Error('delete not persisted')
    if (loaded.scenes[0].variations.some((v) => v.status === 'selected')) throw new Error('no-selection not persisted')
    // Remove a NON-selected one (C) → [A, B], B still selected.
    const afterC = removeVariation(mk(), 'c')
    if (afterC.map((v) => v.id).join(',') !== 'a,b') throw new Error(`delete non-selected: bad order ${afterC.map((v) => v.id)}`)
    const sel = afterC.find((v) => v.status === 'selected')
    if (!sel || sel.id !== 'b') throw new Error('delete non-selected: B should stay selected')
  })

  await step('RP. Replace variation media in place: same id/index/selection, only media changes', async () => {
    const arr = [
      newVariation('A', { id: 'a', status: 'generated', local_url: 'http://x/a.png' }),
      newVariation('B', { id: 'b', status: 'selected', local_url: 'http://x/b.png', file_name: 'b.png' }),
      newVariation('C', { id: 'c', status: 'generated' })
    ]
    const patch = { local_url: 'http://x/new.png', external_url: '', storage: 'local_disk', file_name: 'new.png', file_size: 123, mime_type: 'image/png', source_type: 'flow_import' }
    const out = replaceVariationMedia(arr, 'b', patch)
    const b = out[1]
    if (out.length !== 3 || out.map((v) => v.id).join(',') !== 'a,b,c') throw new Error('replace changed array length/order')
    if (b.id !== 'b') throw new Error('replace changed id')
    if (b.status !== 'selected') throw new Error('replace changed selection status')
    if (b.local_url !== 'http://x/new.png' || b.file_name !== 'new.png' || b.file_size !== 123 || b.source_type !== 'flow_import') throw new Error('replace did not update media fields')
    // Other variations untouched.
    if (out[0].local_url !== 'http://x/a.png' || out[2].id !== 'c') throw new Error('replace touched other variations')
  })

  await step('DU. Duration: sum, persistence, declared-vs-summed status', async () => {
    // sumSceneDurations
    if (sumSceneDurations([{ duration_seconds: 5 }, { duration_seconds: 8 }, { duration_seconds: 7 }]) !== 20) throw new Error('sum [5,8,7] should be 20')
    if (sumSceneDurations([]) !== 0) throw new Error('sum [] should be 0')
    if (sumSceneDurations([{ duration_seconds: '' }, { foo: 1 }, { duration_seconds: 4 }]) !== 4) throw new Error('blank/missing should count as 0')
    // Edit persists through serialize → normalize round-trip.
    const canvas = normalizeCanvas({
      ...emptyCanvas(),
      scenes: [
        { id: 's1', scene_number: 1, duration_seconds: 5, variations: [] },
        { id: 's2', scene_number: 2, duration_seconds: 0, variations: [] }
      ]
    })
    // Simulate the UI setter: set scene 2 duration to 12.
    const edited = { ...canvas, scenes: canvas.scenes.map((s) => (s.id === 's2' ? { ...s, duration_seconds: 12 } : s)) }
    const loaded = normalizeCanvas(JSON.parse(JSON.stringify(edited)))
    const s2 = loaded.scenes.find((s) => s.id === 's2')
    if (!s2 || s2.duration_seconds !== 12) throw new Error(`scene duration not persisted: ${s2 && s2.duration_seconds}`)
    if (sumSceneDurations(loaded.scenes) !== 17) throw new Error('summed after edit should be 17')
    // Declared parsing + status.
    if (parseDeclaredSeconds('30 seconds') !== 30) throw new Error('parseDeclaredSeconds("30 seconds") should be 30')
    if (parseDeclaredSeconds('') !== null) throw new Error('parseDeclaredSeconds("") should be null')
    const ok = durationStatus(20, 20)
    if (ok.status !== 'valid' || ok.difference !== 0) throw new Error('20 vs 20 should be valid, diff 0')
    const bad = durationStatus(30, 20)
    if (bad.status !== 'mismatch' || bad.difference !== -10) throw new Error(`30 declared vs 20 summed should be mismatch, diff -10 (got ${bad.status},${bad.difference})`)
  })

  await step('GP. Gap detection + m:ss duration parsing (pure)', async () => {
    // findSceneGaps: A ready, B has variations but none selected, C empty.
    const sel = newVariation('a', { id: 'va', status: 'selected' })
    const unsel = newVariation('b', { id: 'vb', status: 'generated' })
    const scenes = [
      { id: 'A', scene_number: 1, variations: [sel] },
      { id: 'B', scene_number: 2, variations: [unsel] },
      { id: 'C', scene_number: 3, variations: [] }
    ]
    const gaps = findSceneGaps(scenes)
    if (gaps.length !== 2) throw new Error(`expected 2 gaps, got ${gaps.length}`)
    const byId = Object.fromEntries(gaps.map((g) => [g.scene_id, g.reason]))
    if (byId.A) throw new Error('scene A (ready) should not be a gap')
    if (byId.B !== 'no_selection') throw new Error(`B should be no_selection, got ${byId.B}`)
    if (byId.C !== 'no_variations') throw new Error(`C should be no_variations, got ${byId.C}`)
    if (findSceneGaps([{ id: 'X', scene_number: 1, variations: [sel] }]).length !== 0) throw new Error('all-ready canvas should have no gaps')
    // parseDeclaredSeconds cases.
    const cases = [['30', 30], ['30 seconds', 30], ['1:30', 90], ['0:45', 45], ['1:02:03', 3723], ['', null], ['abc', null]]
    for (const [input, expected] of cases) {
      const got = parseDeclaredSeconds(input)
      if (got !== expected) throw new Error(`parseDeclaredSeconds(${JSON.stringify(input)}) = ${got}, expected ${expected}`)
    }
  })

  await step('RE. assessExportReadiness: blockers vs warnings', async () => {
    const selScene = (num, dur) => ({ id: 's' + num, scene_number: num, duration_seconds: dur, variations: [newVariation('A', { id: 'v' + num, status: 'selected' })] })
    // Empty canvas → not ready, no_scenes.
    const empty = assessExportReadiness({ canvas: { scenes: [] } })
    if (empty.ready || !empty.blockers.some((b) => b.code === 'no_scenes')) throw new Error('empty canvas should block with no_scenes')
    // Scene with variations but no selection → not ready, scene_gaps.
    const gapped = assessExportReadiness({ canvas: { scenes: [{ id: 's1', scene_number: 1, variations: [newVariation('A', { id: 'v1', status: 'generated' })] }] } })
    if (gapped.ready || !gapped.blockers.some((b) => b.code === 'scene_gaps')) throw new Error('unselected scene should block with scene_gaps')
    // Fully ready, declared === summed → ready, no blockers/warnings.
    const ok = assessExportReadiness({ product_intake: { ad_duration: '30' }, canvas: { scenes: [selScene(1, 30)] } })
    if (!ok.ready || ok.blockers.length || ok.warnings.length) throw new Error(`matching durations should be clean ready (got ${JSON.stringify(ok)})`)
    // Ready but declared 30 vs summed 20 → duration_mismatch warning.
    const mm = assessExportReadiness({ product_intake: { ad_duration: '30' }, canvas: { scenes: [selScene(1, 20)] } })
    if (!mm.ready || !mm.warnings.some((w) => w.code === 'duration_mismatch')) throw new Error('30 vs 20 should warn duration_mismatch')
    // Ready but a timeline scene has zero duration → zero_duration_scenes warning.
    const zd = assessExportReadiness({ canvas: { scenes: [selScene(1, 0)] } })
    if (!zd.ready || !zd.warnings.some((w) => w.code === 'zero_duration_scenes')) throw new Error('zero-duration scene should warn zero_duration_scenes')
  })

  await step('GA. Generate-all-scene-prompts writeback: fill-only vs overwrite, matching, malformed-safe (no paid call)', async () => {
    const mk = () => [
      { id: 'a', scene_number: 1, output_prompt: '', variations: [] },
      { id: 'b', scene_number: 2, output_prompt: 'KEEP-ME', variations: [] },
      { id: 'c', scene_number: 3, output_prompt: '', variations: [] }
    ]
    // Stubbed API JSON (scene_number → output_prompt) — no real OpenAI call.
    const parsed = { prompts: [{ scene_number: 1, output_prompt: 'P1' }, { scene_number: 2, output_prompt: 'P2' }, { scene_number: 3, output_prompt: 'P3' }] }
    // Fill-only: scene 1 & 3 get prompts, scene 2 (already filled) is untouched.
    const fillOnly = applyGeneratedScenePrompts(mk(), parsed, false)
    if (!fillOnly.ok || fillOnly.filled !== 2) throw new Error(`fill-only should fill 2, got ${fillOnly.filled}`)
    const fo = Object.fromEntries(fillOnly.scenes.map((s) => [s.id, s.output_prompt]))
    if (fo.a !== 'P1' || fo.c !== 'P3') throw new Error('fill-only did not fill empty scenes')
    if (fo.b !== 'KEEP-ME') throw new Error('fill-only overwrote an already-filled prompt')
    // Overwrite-all: scene 2 is replaced too.
    const over = applyGeneratedScenePrompts(mk(), parsed, true)
    if (!over.ok || over.filled !== 3) throw new Error(`overwrite should fill 3, got ${over.filled}`)
    if (over.scenes.find((s) => s.id === 'b').output_prompt !== 'P2') throw new Error('overwrite did not replace existing prompt')
    // Scene matching: a proposal for a non-existent scene is ignored; a scene with no proposal stays empty.
    const partial = applyGeneratedScenePrompts(mk(), { prompts: [{ scene_number: 3, output_prompt: 'ONLY3' }, { scene_number: 99, output_prompt: 'X' }] }, false)
    if (partial.filled !== 1) throw new Error('matching should fill only scene 3')
    const pm = Object.fromEntries(partial.scenes.map((s) => [s.id, s.output_prompt]))
    if (pm.c !== 'ONLY3' || pm.a !== '') throw new Error('scene matching wrong')
    // Malformed/unparseable → ok:false and NOTHING changes.
    for (const bad of [null, {}, { prompts: 'nope' }, { foo: 1 }]) {
      const r = applyGeneratedScenePrompts(mk(), bad, false)
      if (r.ok || r.filled !== 0) throw new Error('malformed response must change no scene')
      if (r.scenes.find((s) => s.id === 'a').output_prompt !== '' || r.scenes.find((s) => s.id === 'b').output_prompt !== 'KEEP-ME') throw new Error('malformed response corrupted scenes')
    }
  })

  await step('AB. Ad Brief writeback + persistence: multi-field fill-only vs overwrite, scene creation, malformed-safe, migrate (no paid call)', async () => {
    const mk = () => [
      { id: 'a', scene_number: 1, output_prompt: '', what_happens: '', adaptation_instruction_for_our_product: '', variations: [] },
      { id: 'b', scene_number: 2, output_prompt: 'KEEP-ME', what_happens: 'orig', adaptation_instruction_for_our_product: 'orig-adapt', variations: [] }
    ]
    // Realistic stubbed brief JSON — NO real OpenAI call.
    const parsed = {
      decoded_structure: [{ beat_name: 'hook', timestamp_range: '0:00-0:03', what_competitor_does: 'pattern interrupt', why_it_works: 'stops the scroll' }],
      adapted_script: '[0:00] Our hook line\n[0:03] Our problem line',
      scenes: [
        { scene_number: 1, what_happens: 'creator opens fridge', adaptation_instruction_for_our_product: 'use our drink', output_prompt: 'Handheld 9:16 close-up, fast push-in, natural window light, 1s.' },
        { scene_number: 2, what_happens: 'NEW-WHAT', adaptation_instruction_for_our_product: 'NEW-ADAPT', output_prompt: 'NEW-PROMPT' },
        { scene_number: 3, what_happens: 'cta', adaptation_instruction_for_our_product: 'our cta', output_prompt: 'Static vertical hero shot, soft key light, 2s.' }
      ],
      dont_copy: ['CompetitorBrand', 'their actor'],
      preserve: ['structure', 'pacing']
    }
    // Fill-only: scene 1 filled (3 fields), scene 2 (already has output_prompt) untouched, scene 3 created.
    const fo = applyAdBriefScenes(mk(), parsed, false)
    if (!fo.ok) throw new Error('valid brief should parse (ok:true)')
    const s1 = fo.scenes.find((s) => Number(s.scene_number) === 1)
    if (s1.output_prompt !== parsed.scenes[0].output_prompt || s1.what_happens !== 'creator opens fridge' || s1.adaptation_instruction_for_our_product !== 'use our drink') throw new Error('fill-only did not fill scene 1 output_prompt/what_happens/adaptation')
    const s2 = fo.scenes.find((s) => Number(s.scene_number) === 2)
    if (s2.output_prompt !== 'KEEP-ME' || s2.what_happens !== 'orig' || s2.adaptation_instruction_for_our_product !== 'orig-adapt') throw new Error('fill-only overwrote an already-filled scene')
    const s3 = fo.scenes.find((s) => Number(s.scene_number) === 3)
    if (!s3 || s3.output_prompt !== parsed.scenes[2].output_prompt || s3.what_happens !== 'cta' || fo.created !== 1) throw new Error('ad brief did not create the missing scene 3')
    if (fo.filled !== 1) throw new Error(`fill-only should fill exactly 1 existing scene, got ${fo.filled}`)
    // Overwrite: scene 2 is replaced too (all three fields).
    const ov = applyAdBriefScenes(mk(), parsed, true)
    const o2 = ov.scenes.find((s) => Number(s.scene_number) === 2)
    if (o2.output_prompt !== 'NEW-PROMPT' || o2.what_happens !== 'NEW-WHAT' || o2.adaptation_instruction_for_our_product !== 'NEW-ADAPT') throw new Error('overwrite did not replace the existing scene')
    if (ov.scenes.map((s) => Number(s.scene_number)).join(',') !== '1,2,3') throw new Error('scenes not aligned/sorted by scene_number')
    // Brief meta + scenes persist through serialize → normalizeCanvas round-trip.
    const brief = normalizeAdBrief({ ...parsed, generated_at: '2026-06-07T00:00:00.000Z', request_id: 'req-1', model: 'gpt-5.5' })
    const canvas = normalizeCanvas(JSON.parse(JSON.stringify({ ...emptyCanvas(), scenes: ov.scenes, ad_brief: brief })))
    if (canvas.ad_brief.decoded_structure.length !== 1 || canvas.ad_brief.decoded_structure[0].beat_name !== 'hook') throw new Error('decoded_structure lost in round-trip')
    if (!canvas.ad_brief.adapted_script.includes('Our hook line')) throw new Error('adapted_script lost in round-trip')
    if (canvas.ad_brief.dont_copy.length !== 2 || canvas.ad_brief.preserve.length !== 2) throw new Error('dont_copy/preserve lost in round-trip')
    if (canvas.scenes.length !== 3 || canvas.scenes[2].output_prompt !== parsed.scenes[2].output_prompt) throw new Error('scenes lost in round-trip')
    // Malformed/unparseable/empty brief → ok:false and NOTHING changes.
    for (const bad of [null, {}, { scenes: 'nope' }, { foo: 1 }, { scenes: [] }, { scenes: [{ output_prompt: 'x' }] }]) {
      const r = applyAdBriefScenes(mk(), bad, false)
      if (r.ok || r.filled !== 0 || r.created !== 0) throw new Error('malformed brief must change nothing')
      if (r.scenes.length !== 2 || r.scenes.find((s) => s.id === 'b').output_prompt !== 'KEEP-ME') throw new Error('malformed brief corrupted scenes')
    }
    // Migration: a canvas with NO ad_brief field normalizes to an empty brief without error.
    const migrated = normalizeCanvas({ scenes: [], competitor_reference: {}, model_defaults: {} })
    if (!migrated.ad_brief || !Array.isArray(migrated.ad_brief.decoded_structure) || migrated.ad_brief.decoded_structure.length !== 0 || migrated.ad_brief.adapted_script !== '') throw new Error('migration of canvas without ad_brief failed')
  })

  await step('NC. Node Canvas model: nodes, typed wiring, removal cascade, normalize/migrate', async () => {
    const m = await import('../src/lib/nodeCanvasModel.js')
    // newNode
    const a = m.newNode('video_generator', 10, 20)
    if (a.type !== 'video_generator' || a.x !== 10 || a.y !== 20) throw new Error('newNode position/type wrong')
    if (!a.data || a.data.model !== m.VIDEO_MODELS[0] || a.data.resolution !== '1080p') throw new Error('newNode default data wrong')
    const b = m.newNode('video_generator', 400, 20)
    let nc = m.addNode(m.addNode(m.emptyNodeCanvas(), a), b)
    if (nc.nodes.length !== 2) throw new Error('addNode failed')
    // addConnection: compatible video->video output→input is accepted.
    nc = m.addConnection(nc, { from_node: a.id, from_socket: 'video', to_node: b.id, to_socket: 'reference_video' })
    if (nc.connections.length !== 1) throw new Error('compatible connection should be accepted')
    // incompatible types rejected (video output → image input).
    let r = m.addConnection(nc, { from_node: a.id, from_socket: 'video', to_node: b.id, to_socket: 'reference_image' })
    if (r.connections.length !== 1) throw new Error('incompatible-type connection should be rejected')
    // self-connection rejected.
    r = m.addConnection(nc, { from_node: a.id, from_socket: 'video', to_node: a.id, to_socket: 'reference_video' })
    if (r.connections.length !== 1) throw new Error('self-connection should be rejected')
    // duplicate rejected.
    r = m.addConnection(nc, { from_node: a.id, from_socket: 'video', to_node: b.id, to_socket: 'reference_video' })
    if (r.connections.length !== 1) throw new Error('duplicate connection should be rejected')
    // removeNode deletes the node AND connections touching it.
    const afterRemove = m.removeNode(nc, b.id)
    if (afterRemove.nodes.length !== 1 || afterRemove.connections.length !== 0) throw new Error('removeNode should drop node + its connections')
    // normalize round-trip preserves nodes, positions, data, connections, pan/zoom.
    const withView = { ...nc, pan_x: 120, pan_y: -40, zoom: 1.5 }
    withView.nodes[0].data.user_prompt = 'hello'
    const round = m.normalizeNodeCanvas(JSON.parse(JSON.stringify(withView)))
    if (round.nodes.length !== 2 || round.connections.length !== 1) throw new Error('round-trip lost nodes/connections')
    if (round.pan_x !== 120 || round.pan_y !== -40 || round.zoom !== 1.5) throw new Error('round-trip lost pan/zoom')
    const ra = round.nodes.find((n) => n.id === a.id)
    if (!ra || ra.x !== 10 || ra.data.user_prompt !== 'hello') throw new Error('round-trip lost position/data')
    // A wired Reference/Image node supplies the backend-addressable start frame.
    const ref = m.newNode('reference', -300, 20)
    ref.data.local_url = 'http://127.0.0.1:8788/media/start-frame.png'
    let withFrame = m.addNode(nc, ref)
    withFrame = m.addConnection(withFrame, { from_node: ref.id, from_socket: 'image', to_node: b.id, to_socket: 'start_frame' })
    if (m.effectiveStartFrameUrl(withFrame, b.id) !== ref.data.local_url) throw new Error('wired image local URL did not resolve as start frame')
    if (m.effectiveStartFrameUrl(nc, b.id) !== '') throw new Error('unwired video node should have no start frame')
    const generating = m.updateNodeData(nc, a.id, { status: 'generating' })
    if (m.normalizeNodeCanvas(generating, { preserveRuntimeStatus: true }).nodes.find((n) => n.id === a.id).data.status !== 'generating') throw new Error('live normalization should preserve generating status')
    if (m.normalizeNodeCanvas(generating).nodes.find((n) => n.id === a.id).data.status !== 'idle') throw new Error('persisted normalization should reset generating status')
    // migration: no node_canvas → empty canvas, no error.
    const empty = m.normalizeNodeCanvas(undefined)
    if (empty.nodes.length !== 0 || empty.connections.length !== 0 || empty.zoom !== 1) throw new Error('migration of absent node_canvas failed')
    // normalize drops connections that reference a missing node.
    const dangling = m.normalizeNodeCanvas({ nodes: [{ id: 'x', type: 'video_generator', x: 0, y: 0 }], connections: [{ id: 'c1', from_node: 'x', from_socket: 'video', to_node: 'gone', to_socket: 'reference_video' }] })
    if (dangling.connections.length !== 0) throw new Error('normalize should drop connections to missing nodes')
  })

  await step('NC2. Prompt + Image nodes, Prompt→Image→Video chain wiring, persistence, migration', async () => {
    const m = await import('../src/lib/nodeCanvasModel.js')
    // newNode for the two new types with correct sockets + default data.
    const pr = m.newNode('prompt', 0, 0)
    if (pr.type !== 'prompt' || typeof pr.data.text !== 'string') throw new Error('prompt node default data wrong')
    if (m.socketType('prompt', 'input', 'reference') !== 'image' || m.socketType('prompt', 'output', 'prompt') !== 'text') throw new Error('prompt node sockets wrong')
    const img = m.newNode('image_generator', 300, 0)
    if (img.type !== 'image_generator' || img.data.model !== m.IMAGE_MODELS[0] || img.data.count !== 1) throw new Error('image node default data wrong')
    const imgInputs = m.NODE_DEFS.image_generator.inputs.map((s) => s.name)
    if (!['prompt', 'reference_image_1', 'reference_image_2', 'reference_image_3'].every((n) => imgInputs.includes(n))) throw new Error('image node missing multi-reference inputs')
    if (m.socketType('image_generator', 'output', 'image') !== 'image') throw new Error('image node output type wrong')
    const vid = m.newNode('video_generator', 600, 0)

    let nc = m.addNode(m.addNode(m.addNode(m.emptyNodeCanvas(), pr), img), vid)

    // text→text: Prompt → Image "Prompt" accepted; text→image: Prompt → Image "Reference Image 1" rejected.
    nc = m.addConnection(nc, { from_node: pr.id, from_socket: 'prompt', to_node: img.id, to_socket: 'prompt' })
    if (nc.connections.length !== 1) throw new Error('Prompt→Image prompt (text→text) should be accepted')
    let r = m.addConnection(nc, { from_node: pr.id, from_socket: 'prompt', to_node: img.id, to_socket: 'reference_image_1' })
    if (r.connections.length !== 1) throw new Error('Prompt→Image reference (text→image) should be rejected')
    // image→image: Image → Video "Start Frame" accepted; image→text: Image → Video "Prompt" rejected.
    nc = m.addConnection(nc, { from_node: img.id, from_socket: 'image', to_node: vid.id, to_socket: 'start_frame' })
    if (nc.connections.length !== 2) throw new Error('Image→Video start_frame (image→image) should be accepted')
    r = m.addConnection(nc, { from_node: img.id, from_socket: 'image', to_node: vid.id, to_socket: 'prompt' })
    if (r.connections.length !== 2) throw new Error('Image→Video prompt (image→text) should be rejected')

    // Full chain persists through serialize → normalize round-trip.
    nc.nodes.find((n) => n.id === pr.id).data.text = 'a kitten'
    const round = m.normalizeNodeCanvas(JSON.parse(JSON.stringify(nc)))
    if (round.nodes.length !== 3 || round.connections.length !== 2) throw new Error('round-trip lost nodes/connections')
    const types = round.nodes.map((n) => n.type).sort().join(',')
    if (types !== 'image_generator,prompt,video_generator') throw new Error('round-trip lost a node type')
    if (round.nodes.find((n) => n.id === pr.id).data.text !== 'a kitten') throw new Error('round-trip lost prompt data')

    // Migration: a canvas with only an old Video node normalizes and keeps it.
    const oldOnly = m.normalizeNodeCanvas({ nodes: [{ id: 'v', type: 'video_generator', x: 5, y: 5, data: { user_prompt: 'keep' } }], connections: [] })
    if (oldOnly.nodes.length !== 1 || oldOnly.nodes[0].type !== 'video_generator' || oldOnly.nodes[0].data.user_prompt !== 'keep') throw new Error('migration of video-only canvas failed')
  })

  await step('NC3. Upload + Asset nodes: image output, wiring, no-data_url persistence, five-type round-trip', async () => {
    const m = await import('../src/lib/nodeCanvasModel.js')
    // newNode for Upload/Asset: image output + empty default data (no data_url).
    const up = m.newNode('upload', 0, 0)
    const as = m.newNode('asset', 0, 200)
    if (up.type !== 'upload' || m.socketType('upload', 'output', 'image') !== 'image') throw new Error('upload output socket wrong')
    if (as.type !== 'asset' || m.socketType('asset', 'output', 'image') !== 'image') throw new Error('asset output socket wrong')
    if (m.NODE_DEFS.upload.inputs.length !== 0 || m.NODE_DEFS.asset.inputs.length !== 0) throw new Error('upload/asset should have no inputs')
    if ('data_url' in up.data || 'data_url' in as.data) throw new Error('default data must not contain data_url')

    const img = m.newNode('image_generator', 300, 0)
    const vid = m.newNode('video_generator', 600, 0)
    let nc = m.addNode(m.addNode(m.addNode(m.emptyNodeCanvas(), up), img), vid)
    // Upload Image → Image Generator Reference Image 1 (image→image) accepted.
    nc = m.addConnection(nc, { from_node: up.id, from_socket: 'image', to_node: img.id, to_socket: 'reference_image_1' })
    if (nc.connections.length !== 1) throw new Error('Upload→Image reference (image→image) should be accepted')
    // Upload Image → Video Prompt (image→text) rejected.
    const rej = m.addConnection(nc, { from_node: up.id, from_socket: 'image', to_node: vid.id, to_socket: 'prompt' })
    if (rej.connections.length !== 1) throw new Error('Upload→Video prompt (image→text) should be rejected')
    // Upload Image → Video Start Frame (image→image) accepted.
    nc = m.addConnection(nc, { from_node: up.id, from_socket: 'image', to_node: vid.id, to_socket: 'start_frame' })
    if (nc.connections.length !== 2) throw new Error('Upload→Video start_frame (image→image) should be accepted')

    // Persistence: local_url/file_name/dimensions persist; a stray data_url is stripped.
    nc = m.updateNodeData(nc, up.id, { local_url: 'http://127.0.0.1:8788/media/projects/default/assets/x.png', file_name: 'x.png', width: 64, height: 48, data_url: 'data:image/png;base64,AAAA' })
    // All five types present in one canvas.
    nc = m.addNode(m.addNode(nc, m.newNode('prompt', 0, 400)), as)
    const round = m.normalizeNodeCanvas(JSON.parse(JSON.stringify(nc)))
    const types = round.nodes.map((n) => n.type).sort().join(',')
    if (types !== 'asset,image_generator,prompt,upload,video_generator') throw new Error('five-type round-trip lost a node: ' + types)
    if (round.connections.length !== 2) throw new Error('round-trip lost connections')
    const upN = round.nodes.find((n) => n.id === up.id)
    if (upN.data.local_url !== 'http://127.0.0.1:8788/media/projects/default/assets/x.png' || upN.data.file_name !== 'x.png' || upN.data.width !== 64) throw new Error('upload local_url/file_name/dimensions not persisted')
    if ('data_url' in upN.data) throw new Error('data_url must NOT be persisted on upload node')
  })

  await step('1. Select Competitor Video Recreation', async () => {
    await nav(/Ad Methods/).click()
    const card = page.locator('.method-card', { hasText: 'Competitor Video Recreation' })
    await card.waitFor()
    const select = card.getByRole('button', { name: 'Select this method' })
    if (await select.count()) await select.click()
    await card.getByText('Selected', { exact: false }).first().waitFor()
  })

  await step('2. Open Canvas', async () => {
    await page.locator('.sidebar-left button.nav', { has: page.getByText('Canvas', { exact: true }) }).click()
    await page.getByRole('heading', { name: /Canvas — Competitor Recreation/ }).waitFor()
  })

  await step('3. Fill competitor reference', async () => {
    await fieldInput('Competitor ad name').fill('QA Competitor Ad')
    await fieldInput('Competitor brand').fill('QA Brand')
    await fieldInput('Platform').fill('Instagram Reels')
    await fieldInput('Ad duration').fill('30 seconds')
  })

  await step('4. Create scenes from outline', async () => {
    const ta = page.locator('.subpanel', { hasText: 'Quick Add From Outline' }).locator('textarea')
    await ta.fill(SAMPLE_OUTLINE)
    await page.getByRole('button', { name: 'Create Scenes From Outline' }).click()
    await page.locator('.scene-card').nth(5).waitFor()
    const count = await page.locator('.scene-card').count()
    if (count !== 6) throw new Error(`expected 6 scene cards, found ${count}`)
  })

  await step('4b. Hollow export warning shows for scenes without prompts/adaptation', async () => {
    const prep = page.locator('.subpanel', { hasText: 'Prepare Export' })
    await prep.getByText('Some scenes have no prompt/adaptation content', { exact: false }).waitFor()
  })

  await step('5. Collapse all / Expand all', async () => {
    await page.getByRole('button', { name: 'Collapse all' }).click()
    await page.locator('.scene-summary').first().waitFor()
    await page.getByRole('button', { name: 'Expand all' }).click()
    await page.locator('.scene-fields').first().waitFor()
  })

  await step('5a. Generate Scene Prompt Skeletons fills empty output prompts', async () => {
    await page.getByRole('button', { name: 'Generate Scene Prompt Skeletons' }).click()
    const op = page.locator('.scene-card').first().locator('label.field', { hasText: 'Output prompt' }).locator('textarea')
    await op.waitFor()
    const val = await op.inputValue()
    if (!val.trim()) throw new Error('output prompt skeleton was not generated')
  })

  await step('5b. Sync Canvas To Export Data does not crash', async () => {
    await page.getByRole('button', { name: 'Sync Canvas To Export Data' }).click()
    await page.getByRole('heading', { name: /Canvas — Competitor Recreation/ }).waitFor()
  })

  await step('6. Provider defaults + Apply Defaults To All Scenes', async () => {
    const md = page.locator('.subpanel', { hasText: 'Model Defaults' })
    const sel = (label) => md.locator('label.field', { hasText: label }).locator('select')
    await sel('Default LLM').selectOption('anthropic')
    await sel('Default image').selectOption('fal')
    await sel('Default video').selectOption('kling')
    await page.getByRole('button', { name: 'Apply Defaults To All Scenes' }).click() // confirm auto-accepted
  })

  await step('7. Clear Scene Provider Overrides', async () => {
    await page.getByRole('button', { name: 'Clear Scene Provider Overrides' }).click() // confirm auto-accepted
  })

  await step('8. Canvas readiness checklist renders', async () => {
    const panel = page.locator('.subpanel', { hasText: 'Canvas Readiness' })
    await panel.locator('.readiness-list li').first().waitFor()
    const items = await panel.locator('.readiness-list li').count()
    if (items < 7) throw new Error(`expected 7 readiness checks, found ${items}`)
  })

  await step('9. Generate Adaptation Prompt opens modal with competitor reference + scenes', async () => {
    await page.getByRole('button', { name: 'Generate Adaptation Prompt' }).click()
    const modal = page.locator('.modal', { hasText: 'Adaptation Prompt' })
    await modal.waitFor()
    await modal.locator('.prompt-preview', { hasText: 'COMPETITOR REFERENCE' }).waitFor()
    const text = await modal.locator('.prompt-preview').innerText()
    if (!/SCENE BOARD/i.test(text)) throw new Error('prompt modal missing scene board')
    await modal.getByRole('button', { name: 'Close' }).first().click()
  })

  await step('9a. Failed Canvas import shows Copy Repair Prompt', async () => {
    const ta = page.locator('.subpanel', { hasText: 'Import Adapted Canvas JSON' }).locator('textarea')
    await ta.fill('{"scenes":[{"what_happens":"x"}]}')
    await page.getByRole('button', { name: 'Import Adapted Canvas JSON' }).click()
    await page.getByRole('button', { name: 'Copy Repair Prompt' }).waitFor()
  })

  await step('B1. Board View toggle + Build Board From Scenes creates nodes', async () => {
    await page.getByRole('button', { name: 'Board View' }).click()
    await page.getByRole('button', { name: 'Build Board From Scenes', exact: true }).click()
    await page.locator('.board-node').first().waitFor()
    const n = await page.locator('.board-node').count()
    if (n < 5) throw new Error(`expected board nodes, found ${n}`)
  })

  await step('B2. Prompt node has copyable text', async () => {
    await page.getByRole('button', { name: 'Copy prompt' }).first().waitFor()
  })

  await step('B3. Output placeholder nodes exist', async () => {
    await page.getByText('Generated Output', { exact: false }).first().waitFor()
    await page.getByRole('button', { name: 'Regenerate Video' }).first().waitFor()
  })

  await step('G1. Provider Mode selector exists', async () => {
    const sel = page.locator('.subpanel', { hasText: 'Production Board' }).locator('label.field', { hasText: 'Provider Mode' }).locator('select')
    await sel.waitFor()
  })

  await step('G2. Manual generation: normalized result + paste Result URL + Add As Scene Variation', async () => {
    await page.getByRole('button', { name: 'Regenerate Image' }).first().click()
    const modal = page.locator('.modal', { hasText: 'Generation Result' })
    await modal.waitFor()
    await modal.getByRole('button', { name: 'Copy Prompt' }).waitFor()
    await modal.locator('input[placeholder="Result URL"]').fill('https://example.com/out.png')
    await modal.getByRole('button', { name: 'Add As Scene Variation' }).click()
    await modal.getByRole('button', { name: /Cancel|Close/ }).first().click()
    await page.locator('.variation-card img.media-preview').first().waitFor()
  })

  await step('G3. Mock mode: Regenerate Video → normalized mock video result → Add As Scene Variation', async () => {
    const sel = page.locator('.subpanel', { hasText: 'Production Board' }).locator('label.field', { hasText: 'Provider Mode' }).locator('select')
    await sel.selectOption('mock')
    await page.getByRole('button', { name: 'Regenerate Video' }).first().click()
    const modal = page.locator('.modal', { hasText: 'Generation Result' })
    await modal.waitFor()
    await modal.getByText('Media: video', { exact: false }).waitFor()
    await modal.getByRole('button', { name: 'Add As Scene Variation' }).click()
    await modal.getByRole('button', { name: /Cancel|Close/ }).first().click()
    await page.locator('.variation-card.status-generated').first().waitFor()
    await page.locator('.media-mock').first().waitFor()
  })

  await step('G3b. Mock mode: Regenerate Image → normalized mock image result → Add As Scene Variation', async () => {
    await page.getByRole('button', { name: 'Regenerate Image' }).first().click()
    const modal = page.locator('.modal', { hasText: 'Generation Result' })
    await modal.waitFor()
    await modal.getByText('Media: image', { exact: false }).waitFor()
    await modal.getByText('Status: success', { exact: false }).waitFor()
    await modal.getByRole('button', { name: 'Add As Scene Variation' }).click()
    await modal.getByRole('button', { name: /Cancel|Close/ }).first().click()
  })

  await step('G4. Generated variation selected → Final Timeline shows a preview/link', async () => {
    const genVar = page.locator('.variation-card.status-generated').first()
    await genVar.getByRole('button', { name: 'Mark selected' }).click()
    await page.locator('.final-timeline .timeline-item').first().waitFor()
    await page.locator('.final-timeline .media-mock, .final-timeline .media-preview, .final-timeline .media-link').first().waitFor()
  })

  await step('G5. Add Existing Result creates a variation with image preview', async () => {
    await page.getByRole('button', { name: 'Add Existing Result' }).first().click()
    const modal = page.locator('.modal', { hasText: 'Add Existing Result' })
    await modal.waitFor()
    await modal.locator('input[placeholder="External URL"]').fill('https://example.com/existing.png')
    await modal.getByRole('button', { name: 'Save Result' }).click()
    await page.locator('.variation-card img.media-preview').first().waitFor()
  })

  await step('P1. Variation media-health labels render (URL saved + Mock result)', async () => {
    await page.getByText('URL saved', { exact: false }).first().waitFor()
    await page.getByText('Mock result', { exact: false }).first().waitFor()
  })

  await step('P2. Add Existing Result upload (without saving) shows session-only warning', async () => {
    await page.getByRole('button', { name: 'Add Existing Result' }).first().click()
    const modal = page.locator('.modal', { hasText: 'Add Existing Result' })
    await modal.waitFor()
    await modal.locator('input[type="file"]').setInputFiles(SAMPLE_FILE)
    const cb = modal.locator('input[type="checkbox"]')
    await cb.waitFor()
    if (await cb.isChecked()) await cb.uncheck() // keep it session-only for this check
    await modal.getByRole('button', { name: 'Save Result' }).click()
    await page.getByText('Preview is session-only', { exact: false }).first().waitFor()
  })

  await step('P3. Save Project Snapshot downloads a timestamped file', async () => {
    const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Save Project Snapshot' }).click()])
    const fn = dl.suggestedFilename()
    if (!/^animated-ad-factory-project-\d{4}-\d{2}-\d{2}-\d{4}\.json$/.test(fn)) throw new Error(`bad snapshot filename: ${fn}`)
  })

  // --- API mode safety (placeholder; must pass whether or not the local backend is running, with no real keys) ---
  await step('A1. Provider Mode includes API; selecting it renders the health panel without crashing', async () => {
    const sel = page.locator('.subpanel', { hasText: 'Production Board' }).locator('label.field', { hasText: 'Provider Mode' }).locator('select')
    const optionValues = await sel.locator('option').evaluateAll((opts) => opts.map((o) => o.value))
    if (!optionValues.includes('api')) throw new Error('Provider Mode is missing the API option')
    await sel.selectOption('api')
    // Panel renders regardless of backend state. If backend is down we show the
    // "not connected" guidance; if up, providers booleans render. Either is fine.
    await page.locator('.api-health').waitFor()
    await page.getByText('Local API Server', { exact: false }).first().waitFor()
    const guidance = page.getByText('the local backend is not connected', { exact: false })
    const providersLine = page.locator('.api-health .bn-meta', { hasText: 'OpenAI:' })
    await Promise.race([guidance.first().waitFor(), providersLine.first().waitFor()])
  })

  await step('A1a. Text/Image provider selectors have connected options and safe defaults', async () => {
    const board = page.locator('.subpanel', { hasText: 'Production Board' })
    const textSel = board.locator('label.field', { hasText: 'Text Provider' }).locator('select')
    const imageSel = board.locator('label.field', { hasText: 'Image Provider' }).locator('select')
    await textSel.waitFor()
    await imageSel.waitFor()
    if ((await textSel.inputValue()) !== 'groq') throw new Error('Text Provider default should be groq')
    if ((await imageSel.inputValue()) !== 'pollinations') throw new Error('Image Provider default should be pollinations')
    const textOpts = await textSel.locator('option').evaluateAll((o) => o.map((x) => x.value))
    const imageOpts = await imageSel.locator('option').evaluateAll((o) => o.map((x) => x.value))
    if (!['openai', 'openrouter', 'groq'].every((x) => textOpts.includes(x))) throw new Error('Text Provider options incomplete')
    if (!['openai', 'pollinations'].every((x) => imageOpts.includes(x))) throw new Error('Image Provider options incomplete')
  })

  await step('A1b. Test Selected API Provider asks for confirmation, then shows a friendly result/error (no key needed)', async () => {
    const panel = page.locator('.api-health')
    const btn = panel.getByRole('button', { name: 'Test Selected API Provider' })
    await btn.waitFor()
    await btn.click()
    // Paid-call confirmation must appear first.
    const confirm = page.locator('.modal', { hasText: 'This will use Groq API credits' })
    await confirm.waitFor()
    await confirm.getByRole('button', { name: 'Continue' }).click()
    // Without a backend/key in QA we expect a friendly error; with a key, the
    // success line. Any of these is a pass (and proves it does not crash).
    await Promise.race([
      panel.getByText('Local API not reachable', { exact: false }).first().waitFor(),
      panel.getByText('not configured', { exact: false }).first().waitFor(),
      panel.getByText('Local backend connected', { exact: false }).first().waitFor()
    ])
  })

  await step('A1c. The Test call was recorded in the API Action Log', async () => {
    const logPanel = page.locator('.subpanel', { hasText: 'API Action Log' })
    await logPanel.waitFor()
    // Expand the log and confirm at least one entry exists.
    await logPanel.locator('button.caret').first().click()
    await logPanel.locator('.log-item').first().waitFor()
  })

  await step('A1d. Selecting OpenRouter routes the test to OpenRouter with a friendly result/error (no key needed)', async () => {
    const board = page.locator('.subpanel', { hasText: 'Production Board' })
    const sel = board.locator('label.field', { hasText: 'Text Provider' }).locator('select')
    await sel.selectOption('openrouter')
    const panel = page.locator('.api-health')
    await panel.getByText('text: OpenRouter', { exact: false }).first().waitFor()
    await panel.getByRole('button', { name: 'Test Selected API Provider' }).click()
    const confirm = page.locator('.modal', { hasText: 'This will use OpenRouter API credits' })
    await confirm.waitFor()
    await confirm.getByRole('button', { name: 'Continue' }).click()
    // Backend off in QA → friendly "not reachable"; if up without key → "not
    // configured"; if up with key → success. Any is a pass (no crash).
    await Promise.race([
      panel.getByText('Local API not reachable', { exact: false }).first().waitFor(),
      panel.getByText('not configured', { exact: false }).first().waitFor(),
      panel.getByText('Local backend connected', { exact: false }).first().waitFor()
    ])
    // Reset to Groq so later text actions exercise the default path.
    await sel.selectOption('groq')
  })

  await step('A2. API video is normalized as unsupported (no crash, no API call)', async () => {
    await page.getByRole('button', { name: 'Regenerate Video' }).first().click()
    const modal = page.locator('.modal', { hasText: 'Generation Result' })
    await modal.waitFor()
    await modal.getByText('Status: unsupported', { exact: false }).waitFor()
    await modal.getByText('API video generation is not connected yet', { exact: false }).waitFor()
    // Must NOT offer to attach an unsupported result.
    if (await modal.getByRole('button', { name: 'Add As Scene Variation' }).count()) throw new Error('unsupported result should not be attachable')
    await modal.getByRole('button', { name: /Cancel|Close/ }).first().click()
  })

  await step('A2b. API Pollinations generate_image asks for confirmation, then returns a friendly keyless error', async () => {
    await page.getByRole('button', { name: 'Regenerate Image' }).first().click()
    // Image-specific credit confirmation must appear first.
    const confirm = page.locator('.modal', { hasText: 'Pollinations image API credits' })
    await confirm.waitFor()
    await confirm.getByRole('button', { name: 'Continue' }).click()
    const modal = page.locator('.modal', { hasText: 'Generation Result' })
    await modal.waitFor()
    await modal.getByText('Media: image', { exact: false }).waitFor()
    await modal.getByText('Status: error', { exact: false }).waitFor()
    // Keyless QA backend → "not configured" (key or image model). No paid call.
    await Promise.race([
      modal.getByText('not configured', { exact: false }).first().waitFor(),
      modal.getByText('not reachable', { exact: false }).first().waitFor()
    ])
    if (await modal.getByRole('button', { name: 'Add As Scene Variation' }).count()) throw new Error('errored image result should not be attachable')
    await modal.getByRole('button', { name: /Cancel|Close/ }).first().click()
    // The image action must be recorded in the API Action Log (no key, no base64).
    const logPanel = page.locator('.subpanel', { hasText: 'API Action Log' })
    const visible = await logPanel.locator('.log-item').first().isVisible().catch(() => false)
    if (!visible) await logPanel.locator('button.caret').first().click()
    await logPanel.locator('.log-item', { hasText: 'generate_image' }).first().waitFor()
  })

  await step('A3. Switching back to Mock still works after using API mode', async () => {
    const sel = page.locator('.subpanel', { hasText: 'Production Board' }).locator('label.field', { hasText: 'Provider Mode' }).locator('select')
    await sel.selectOption('mock')
    await page.getByRole('button', { name: 'Regenerate Video' }).first().click()
    const modal = page.locator('.modal', { hasText: 'Generation Result' })
    await modal.waitFor()
    await modal.getByRole('button', { name: /Cancel|Close/ }).first().click()
  })

  await step('B3a. Asset Tray: Add Asset creates an asset', async () => {
    const tray = page.locator('.subpanel', { hasText: 'Asset Tray' })
    await tray.waitFor()
    await tray.locator('input[placeholder="Asset title"]').fill('QA Reference Asset')
    await tray.getByRole('button', { name: 'Add Asset' }).click()
    await page.locator('.asset-card').first().waitFor()
  })

  await step('B3b. Add Variation + Mark selected + Final Timeline shows it', async () => {
    await page.getByRole('button', { name: 'Add Variation' }).first().click()
    const firstVar = page.locator('.variation-card').first()
    await firstVar.waitFor()
    await firstVar.getByRole('button', { name: 'Mark selected' }).click()
    await page.locator('.final-timeline .timeline-item').first().waitFor()
  })

  await step('B4. List View still works', async () => {
    await page.getByRole('button', { name: 'List View' }).click()
    await page.locator('.scene-card').first().waitFor()
  })

  // --- API Canvas Brain actions (no real key needed; must show friendly errors) ---
  await step('C1. API brain buttons exist in List View when Provider Mode = API', async () => {
    await page.getByRole('button', { name: 'Board View' }).click()
    const sel = page.locator('.subpanel', { hasText: 'Production Board' }).locator('label.field', { hasText: 'Provider Mode' }).locator('select')
    await sel.selectOption('api')
    await page.getByRole('button', { name: 'List View' }).click()
    await page.getByRole('button', { name: 'Expand all' }).click()
    await page.getByRole('button', { name: 'Generate Adapted Canvas JSON with API' }).waitFor()
    await page.getByRole('button', { name: 'Improve Empty Prompts with API' }).waitFor()
    await page.getByRole('button', { name: 'Improve Output Prompt with API' }).first().waitFor()
  })

  // Every paid call shows a confirmation modal first. Click Continue to proceed.
  const confirmApiCall = async () => {
    const confirm = page.locator('.modal', { hasText: 'Use API credits?' })
    await confirm.waitFor()
    await confirm.getByRole('button', { name: 'Continue' }).click()
  }

  // Without a backend/key in QA we expect the friendly error; with a key, the
  // apply/import action button. Either is a pass and proves no crash.
  const expectApiResult = async (modal, successButton) =>
    Promise.race([
      modal.getByText('not reachable', { exact: false }).first().waitFor(),
      modal.getByText('not configured', { exact: false }).first().waitFor(),
      modal.getByRole('button', { name: successButton }).waitFor()
    ])

  await step('C2. API call shows the credits confirmation modal; Cancel aborts it', async () => {
    await page.getByRole('button', { name: 'Generate Adapted Canvas JSON with API' }).click()
    const confirm = page.locator('.modal', { hasText: 'Use API credits?' })
    await confirm.waitFor()
    await confirm.getByRole('button', { name: 'Cancel' }).click()
    await confirm.waitFor({ state: 'detached' })
  })

  await step('C3. Generate Adapted Canvas JSON with API: confirm → preview modal (friendly error without key)', async () => {
    await page.getByRole('button', { name: 'Generate Adapted Canvas JSON with API' }).click()
    await confirmApiCall()
    const modal = page.locator('.modal', { hasText: 'API Result Preview' })
    await modal.waitFor()
    await expectApiResult(modal, 'Import JSON')
    // Debug UI must render without crashing.
    await modal.getByRole('button', { name: 'Copy Debug Info' }).waitFor()
    await modal.getByRole('button', { name: /Cancel|Close/ }).first().click()
  })

  await step('C4. Improve Output Prompt with API: confirm → preview modal (friendly error without key)', async () => {
    await page.getByRole('button', { name: 'Improve Output Prompt with API' }).first().click()
    await confirmApiCall()
    const modal = page.locator('.modal', { hasText: 'API Result Preview' })
    await modal.waitFor()
    await expectApiResult(modal, 'Apply to scene')
    await modal.getByRole('button', { name: /Cancel|Close/ }).first().click()
  })

  await step('C5. Repair JSON with API appears on invalid import: confirm → preview modal', async () => {
    const importPanel = page.locator('.subpanel', { hasText: 'Import Adapted Canvas JSON' })
    await importPanel.locator('textarea').fill('{ not valid json')
    await importPanel.getByRole('button', { name: 'Import Adapted Canvas JSON' }).click()
    await importPanel.locator('.note.bad').first().waitFor()
    await importPanel.getByRole('button', { name: 'Repair JSON with API' }).click()
    await confirmApiCall()
    const modal = page.locator('.modal', { hasText: 'API Result Preview' })
    await modal.waitFor()
    await expectApiResult(modal, 'Import JSON')
    await modal.getByRole('button', { name: /Cancel|Close/ }).first().click()
    // Clear the invalid paste so later steps are unaffected.
    await importPanel.locator('textarea').fill('')
  })

  await step('C6. Failed API calls were recorded in the API Action Log', async () => {
    await page.getByRole('button', { name: 'Board View' }).click()
    const logPanel = page.locator('.subpanel', { hasText: 'API Action Log' })
    await logPanel.waitFor()
    const caret = logPanel.locator('button.caret').first()
    // Ensure it is expanded (it may be collapsed depending on prior toggles).
    const visible = await logPanel.locator('.log-item').first().isVisible().catch(() => false)
    if (!visible) await caret.click()
    await logPanel.locator('.log-item.bad').first().waitFor()
    await page.getByRole('button', { name: 'List View' }).click()
  })

  await step('D1. Global runtime status banner renders in the header', async () => {
    const badge = page.getByTestId('runtime-status')
    await badge.waitFor()
    const txt = await badge.textContent()
    // QA points at an isolated keyless backend, so it should be online with both
    // providers unconfigured. Accept the offline/checking wording too (robust).
    if (!/(Backend online|Local backend offline|checking)/.test(txt || '')) throw new Error(`runtime status text unexpected: ${txt}`)
  })

  await step('D2. Edit a scene AFTER sync without clicking Sync (to prove export auto-sync)', async () => {
    // We are in List View. Change scene 1 "What happens" to a unique marker.
    const what = page.locator('.scene-card').first().locator('label.field', { hasText: 'What happens' }).locator('textarea')
    await what.waitFor()
    await what.fill('AUTOSYNCMARK late canvas edit')
  })

  await step('10. Fill brief fields (needed for export hard-stop)', async () => {
    await nav(/Product \/ Offer Brief/).click()
    await fieldInput('Product name').fill('QA Product')
    await fieldInput('Market / language').fill('US / English')
  })

  await step('11. Final Export auto-syncs Canvas + includes Canvas sections', async () => {
    await nav(/Final Export/).click()
    await page.getByText('Selected method:', { exact: false }).first().waitFor()
    // Auto-sync note must appear (no manual Sync was clicked for the late edit).
    await page.getByText('Canvas data synced to export.', { exact: false }).first().waitFor()
    await page.locator('.bundle-checklist').first().waitFor()
    const exportBtn = page.getByRole('button', { name: 'Export Flow Package Markdown' })
    const [download] = await Promise.all([page.waitForEvent('download'), exportBtn.click()])
    const outPath = path.join(ARTIFACTS, 'canvas-export.md')
    await download.saveAs(outPath)
    const text = fs.readFileSync(outPath, 'utf8')
    for (const sec of ['Competitor Video Recreation Package', '## Readiness Summary', '## Competitor Reference', '## Scene Board', '## Scene-by-Scene Prompts', '## Board Nodes Summary', '## Board Edges Summary', '## Final Selections', '## Asset Tray Summary', '## Scene Variations', '## Final Timeline', '## Timeline Duration', '## Timeline Gaps']) {
      if (!text.includes(sec)) throw new Error(`export missing: ${sec}`)
    }
    // The method_data-derived "Competitor structure" line must reflect the LATE
    // edit, proving export auto-synced the Canvas without a manual Sync click.
    const compLine = text.split('\n').find((l) => l.includes('**Competitor structure:**'))
    if (!compLine || !compLine.includes('AUTOSYNCMARK')) throw new Error('export did not auto-sync late Canvas edit into competitor_structure')
    // Most outline scenes have no selected variation, so the gap section must warn.
    if (!text.includes('not export-ready')) throw new Error('export Timeline Gaps section missing the gap warning marker')
  })

  // --- Local Media Library (served by the isolated keyless QA backend) ---
  await step('LM1. Media save endpoint stores a file on local disk (no API keys)', async () => {
    const r = await fetch(QA_API + '/api/media/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file_name: 'qa.png', mime_type: 'image/png', data_url: TINY_PNG_DATA_URL, category: 'variation' })
    })
    const data = await r.json()
    if (!data.success || data.storage !== 'local_disk' || !data.local_url) throw new Error('media save failed: ' + JSON.stringify(data))
    const got = await fetch(data.local_url.startsWith('http') ? data.local_url : QA_API + data.local_url)
    if (!got.ok) throw new Error('serving saved media failed: HTTP ' + got.status)
  })

  await step('LM2. Media save sanitizes malicious file names', async () => {
    const r = await fetch(QA_API + '/api/media/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file_name: '../../evil.png', mime_type: 'image/png', data_url: TINY_PNG_DATA_URL, category: 'asset' })
    })
    const data = await r.json()
    if (!data.success) throw new Error('save failed')
    if (/[\\/]/.test(data.file_name) || data.file_name.includes('..')) throw new Error('filename not sanitized: ' + data.file_name)
  })

  await step('LM3. Media GET rejects path traversal outside the library', async () => {
    const r = await fetch(QA_API + '/media/..%2f..%2f..%2fpackage.json')
    if (r.ok) {
      const txt = await r.text()
      if (txt.includes('"name"') || txt.includes('dependencies')) throw new Error('path traversal served a file outside local-media')
    }
  })

  await step('LM4. Add Existing Result upload saved to Local Media Library renders a local preview + label', async () => {
    await page.locator('.sidebar-left button.nav', { has: page.getByText('Canvas', { exact: true }) }).click()
    await page.getByRole('heading', { name: /Canvas — Competitor Recreation/ }).waitFor()
    await page.getByRole('button', { name: 'Board View' }).click()
    await page.getByRole('button', { name: 'Add Existing Result' }).first().click()
    const modal = page.locator('.modal', { hasText: 'Add Existing Result' })
    await modal.waitFor()
    await modal.locator('input[type="file"]').setInputFiles(SAMPLE_FILE)
    const cb = modal.locator('input[type="checkbox"]')
    await cb.waitFor()
    if (!(await cb.isChecked())) await cb.check()
    await modal.getByRole('button', { name: 'Save Result' }).click()
    // The saved variation shows the local-disk health label.
    await page.getByText('Local file saved', { exact: false }).first().waitFor()
  })

  await step('LM5. Final Timeline shows the local saved media', async () => {
    const card = page.locator('.variation-card', { hasText: 'Local file saved' }).first()
    await card.getByRole('button', { name: 'Mark selected' }).click()
    await page.locator('.final-timeline .timeline-item', { hasText: 'local disk' }).first().waitFor()
  })

  await step('LM6. Import from Flow: scene<NN>_v<NN> maps to a scene, reads dimensions, saves + attaches (no API call)', async () => {
    const panel = page.locator('.subpanel', { has: page.getByRole('heading', { name: 'Import from Flow' }) })
    await panel.waitFor()
    await panel.locator('input[type="file"]').setInputFiles(FLOW_SCENE_FILE)
    const item = panel.locator('.flow-item').first()
    await item.waitFor()
    // Filename scene01_v02 → suggested Scene 1.
    await item.getByText('filename → scene 1', { exact: false }).waitFor()
    // Real dimensions read client-side (1x1 PNG) — not the "unknown" fallback.
    if (await item.getByText('dimensions unknown', { exact: false }).count()) throw new Error('Flow import did not read image dimensions')
    await item.getByRole('button', { name: /Save & Attach/ }).click()
    await panel.getByText('Saved & attached', { exact: false }).waitFor()
  })

  await step('LM7. Import from Flow: "Save & Attach all matched" batches multiple imports to their scenes (no API call)', async () => {
    const panel = page.locator('.subpanel', { has: page.getByRole('heading', { name: 'Import from Flow' }) })
    await panel.waitFor()
    const beforeGen = await page.locator('.variation-card.status-generated').count()
    await panel.locator('input[type="file"]').setInputFiles([FLOW_BATCH_A, FLOW_BATCH_B])
    // Both arrive as matched items (scene 3 and scene 4) with targets pre-filled.
    await panel.getByText('filename → scene 3', { exact: false }).waitFor()
    await panel.getByText('filename → scene 4', { exact: false }).waitFor()
    const batchBtn = panel.getByRole('button', { name: /Save & Attach all matched/ })
    await batchBtn.waitFor()
    await batchBtn.click()
    // Sequential batch completes with a summary; both attach as variations.
    await panel.getByText('Saved & attached 2', { exact: false }).waitFor()
    const afterGen = await page.locator('.variation-card.status-generated').count()
    if (afterGen !== beforeGen + 2) throw new Error(`expected +2 generated variations from batch, got ${beforeGen} -> ${afterGen}`)
  })

  await step('LM8. Media orphan scan lists only unreferenced variation files', async () => {
    const save = async (name) => {
      const r = await fetch(QA_API + '/api/media/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ file_name: name, mime_type: 'image/png', data_url: TINY_PNG_DATA_URL, category: 'variation' }) })
      return r.json()
    }
    const a = await save('orphan-keep.png')
    const b = await save('orphan-drop.png')
    const res = await (await fetch(QA_API + '/api/media/orphans', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project: 'default', referenced: [a.file_name] }) })).json()
    const names = (res.orphans || []).map((o) => o.file_name)
    if (!names.includes(b.file_name)) throw new Error('unreferenced file should be listed as orphan')
    if (names.includes(a.file_name)) throw new Error('referenced file must NOT be listed as orphan')
    // stash for the next steps
    global.__orphanA = a
    global.__orphanB = b
  })

  await step('LM9. Cleanup deletes the orphan and leaves the referenced file', async () => {
    const a = global.__orphanA
    const b = global.__orphanB
    const res = await (await fetch(QA_API + '/api/media/cleanup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project: 'default', file_names: [b.file_name], referenced: [a.file_name] }) })).json()
    if (!(res.deleted || []).includes(b.file_name)) throw new Error('orphan should be deleted')
    const aGet = await fetch(QA_API + a.local_url)
    if (!aGet.ok) throw new Error('referenced file must still exist after cleanup')
    const bGet = await fetch(QA_API + b.local_url)
    if (bGet.ok) throw new Error('orphan file should be gone (404 expected)')
  })

  await step('LM10. Cleanup never deletes a referenced file or anything outside the variations dir', async () => {
    const a = global.__orphanA
    // Ask to delete the REFERENCED file → server must skip it.
    const safe = await (await fetch(QA_API + '/api/media/cleanup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project: 'default', file_names: [a.file_name], referenced: [a.file_name] }) })).json()
    if ((safe.deleted || []).includes(a.file_name)) throw new Error('referenced file must NOT be deleted')
    if (!(safe.skipped || []).includes(a.file_name)) throw new Error('referenced file should be reported as skipped')
    if (!(await fetch(QA_API + a.local_url)).ok) throw new Error('referenced file must still exist')
    // Traversal attempt must not touch files outside the variations dir.
    const pkgPath = path.resolve(__dirname, '..', 'package.json')
    const before = fs.existsSync(pkgPath)
    await fetch(QA_API + '/api/media/cleanup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project: 'default', file_names: ['../../../package.json'], referenced: [] }) })
    if (!before || !fs.existsSync(pkgPath)) throw new Error('traversal cleanup must not delete files outside the variations dir')
  })

  await browser.close()
  stopQaBackend(qaBackend)
  console.log(`\n${passed} passed, ${failed} failed`)
  console.log(`Artifacts (on failure): ${ARTIFACTS}`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((e) => {
  stopQaBackend(qaBackend)
  console.error('Fatal: ' + (e && e.message ? e.message : e))
  process.exit(1)
})
