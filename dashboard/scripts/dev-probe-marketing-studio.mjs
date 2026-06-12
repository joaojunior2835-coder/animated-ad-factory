// Dev probe: drives the Marketing Studio wizard end-to-end in a real browser.
// No APIs, no keys, no network beyond the local dev server.
//
// Run:  node scripts/dev-probe-marketing-studio.mjs   (dev server must be running)
//   env QA_BASE   override URL (default http://localhost:5173/)
//   env QA_HEADED=1   watch the browser

import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const BASE = process.env.QA_BASE || 'http://localhost:5173/'
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ARTIFACTS = path.resolve(__dirname, '..', 'qa-artifacts')
fs.mkdirSync(ARTIFACTS, { recursive: true })

let passed = 0
let failed = 0
const fails = []
function check(name, ok, detail) {
  if (ok) {
    passed++
    console.log(`PASS  ${name}`)
  } else {
    failed++
    fails.push(name)
    console.log(`FAIL  ${name}${detail ? ' — ' + detail : ''}`)
  }
}

const browser = await chromium.launch({ headless: process.env.QA_HEADED !== '1' })
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } })
page.setDefaultTimeout(8000)
page.on('dialog', (d) => d.accept())

try {
  await page.goto(BASE)
  // Fresh start: clear saved studio sessions (new list key + legacy slot).
  await page.evaluate(() => {
    localStorage.removeItem('aaf_marketing_studio_sessions')
    localStorage.removeItem('aaf_marketing_studio_session')
  })
  await page.reload()

  // ---- Nav + session home ----
  const navBtn = page.locator('nav.sidebar-left button', { hasText: 'Marketing Studio' })
  check('nav: 🎬 Marketing Studio appears in the left nav', (await navBtn.count()) === 1)
  await navBtn.click()
  await page.locator('.ms-hero-eyebrow', { hasText: 'Marketing Studio' }).waitFor()
  check('session home shows empty state first', (await page.locator('.ms-empty-state').count()) === 1)
  await page.locator('button', { hasText: 'New Studio Session' }).click()
  await page.locator('.ms-step').first().waitFor()
  check('new session opens the wizard (5 steps)', (await page.locator('.ms-step').count()) === 5)
  check('back link to All Sessions present', (await page.locator('button', { hasText: 'All Sessions' }).count()) === 1)
  check('step 1 (Brief) is active', await page.locator('.ms-step.active .ms-step-label').textContent() === 'Brief')

  // ---- Step 1: brief ----
  const nextToFormat = page.locator('button', { hasText: 'Next: Choose Format' })
  check('Next disabled until name+description', await nextToFormat.isDisabled())

  // Competitor-paste extraction (no API)
  await page.locator('.ms-paste-box textarea').fill([
    'Product: NuitCalme',
    'Description: An evening ritual drink that helps control late-night cravings.',
    'Hook: Vos envies de sucre du soir ne sont pas un manque de volonté.',
    'Target audience: femmes de 30 à 45 ans',
    'Ingredient: le safran',
    'Claims: no medical or weight-loss claims',
    'CTA: Essayez NuitCalme pendant 30 soirs',
    'This is a supplement product.'
  ].join('\n'))
  await page.locator('button', { hasText: 'Extract Brief' }).click()
  check('extraction fills product name', await page.locator('.ms-input.ms-autofilled').first().inputValue() === 'NuitCalme')
  check('auto-filled fields get the green border', (await page.locator('.ms-input.ms-autofilled').count()) >= 4)
  check('Next enabled after extraction', !(await nextToFormat.isDisabled()))
  await nextToFormat.click()

  // ---- Step 2: format ----
  await page.locator('.ms-format-grid').first().waitFor()
  check('format grid shows 8 cards in 3 category groups', (await page.locator('.ms-format-card').count()) === 8 && (await page.locator('.ms-format-group').count()) === 3)
  check('category filter narrows to French', await (async () => {
    await page.locator('.ms-cat-filter button', { hasText: 'French' }).click()
    const n = await page.locator('.ms-format-card').count()
    await page.locator('.ms-cat-filter button', { hasText: 'All' }).click()
    return n === 1
  })())
  check('french format note is shown', (await page.locator('.ms-format-note').count()) >= 1)
  const frCard = page.locator('.ms-format-card', { hasText: 'French Podcast' })
  await frCard.locator('button', { hasText: 'Select' }).click()
  check('selected card highlighted', await frCard.evaluate((el) => el.classList.contains('selected')))
  await page.locator('button', { hasText: 'Next: Choose Characters' }).click()

  // ---- Step 3: characters (two pickers for podcast; defaults pre-selected) ----
  await page.locator('.ms-char-pair').waitFor()
  check('two pickers (Host + Guest) for podcast format', (await page.locator('.ms-char-picker').count()) === 2)
  // FIX 2: picking French Podcast pre-selects the podcast host + guest.
  check('podcast defaults pre-selected (Host)', await page.locator('.ms-char-picker').nth(0).locator('.ms-char-card.selected', { hasText: 'Podcast Host (FR)' }).count() === 1)
  check('podcast defaults pre-selected (Guest)', await page.locator('.ms-char-picker').nth(1).locator('.ms-char-card.selected', { hasText: 'Podcast Guest (FR)' }).count() === 1)
  const nextToScript = page.locator('button', { hasText: 'Next: Review Script' })
  check('Next enabled with defaults', !(await nextToScript.isDisabled()))
  // Manual picks still work and override defaults.
  await page.locator('.ms-char-picker').nth(0).locator('.ms-char-card', { hasText: 'Podcast Host (FR)' }).click()
  await page.locator('.ms-char-picker').nth(1).locator('.ms-char-card', { hasText: 'Podcast Guest (FR)' }).click()
  await nextToScript.click()

  // ---- Step 4: script & scenes ----
  await page.locator('.ms-scene-card').first().waitFor()
  const sceneCount = await page.locator('.ms-scene-card').count()
  check('10 scene cards for french podcast', sceneCount === 10, `got ${sceneCount}`)
  const firstDialogue = await page.locator('.ms-scene-card').first().locator('textarea').first().inputValue()
  check('scene 1 dialogue uses the extracted hook', firstDialogue.includes('volonté'), firstDialogue)
  check('full script view present + copyable', (await page.locator('.ms-script-pre').count()) === 1 && (await page.locator('button', { hasText: 'Copy Script' }).count()) === 1)

  // Edit a line, confirm it survives
  const edited = 'Bonjour, ceci est une ligne modifiée pour le test.'
  await page.locator('.ms-scene-card').nth(1).locator('textarea').first().fill(edited)
  check('edited dialogue appears in full script', (await page.locator('.ms-script-pre').textContent()).includes(edited))

  // Per-scene regenerate restores the template line
  await page.locator('.ms-scene-card').nth(1).locator('button', { hasText: 'Regenerate' }).click()
  const restored = await page.locator('.ms-scene-card').nth(1).locator('textarea').first().inputValue()
  check('Regenerate Scene restores the derived line', restored !== edited && restored.length > 0, restored)

  await page.locator('button', { hasText: 'Generate Prompts' }).click()

  // ---- Step 5: prompts & export ----
  await page.locator('.ms-prompt-card').first().waitFor()
  check('one prompt card per scene', (await page.locator('.ms-prompt-card').count()) === 10)
  check('summary bar shows totals + models + language', (await page.locator('.ms-summary-bar').textContent()).includes('Total clips: 10'))

  const headers = await page.locator('.ms-setup-header').allTextContents()
  check('every setup header has select [Xs] + attach Frame', headers.every((h) => /select \[\d+s\]/.test(h) && /attach Frame \[\d+\]/.test(h)))
  const promptTexts = await page.locator('.ms-prompt-text').allTextContents()
  check('NO duration in any rendered prompt text', promptTexts.every((t) => !/\b\d+\s*(s|sec|seconds|secondes)\b/i.test(t)))
  check('podcast gaze rule in rendered prompts', promptTexts.every((t) => t.includes('looks toward the other speaker, not at the camera')))
  check('natural-pace tail in rendered prompts', promptTexts.every((t) => /natural pace — do not slow it down to fill time/.test(t)))

  // Copy button flips to Copied ✓
  await page.locator('.ms-prompt-card').first().locator('button', { hasText: 'Copy' }).click()
  check('copy button shows Copied ✓', (await page.locator('.ms-prompt-card').first().locator('button', { hasText: 'Copied' }).count()) === 1)

  // Export markdown triggers a download
  const dlPromise = page.waitForEvent('download')
  await page.locator('button', { hasText: 'Export as Markdown' }).click()
  const dl = await dlPromise
  check('markdown download triggered', dl.suggestedFilename().endsWith('-marketing-studio.md'), dl.suggestedFilename())
  const dlPath = path.join(ARTIFACTS, 'studio-export.md')
  await dl.saveAs(dlPath)
  const md = fs.readFileSync(dlPath, 'utf8')
  check('markdown has brief + outline + prompts sections', md.includes('## Product Brief Summary') && md.includes('## Scene Outline') && md.includes('## Prompts'))

  // Send to Node Canvas → rows appear on the Node Canvas
  await page.locator('button', { hasText: 'Send to Node Canvas' }).click()
  check('send confirms with row count', (await page.locator('.ms-export-row', { hasText: 'Sent 10 scene rows' }).count()) === 1)
  await page.locator('nav.sidebar-left button', { hasText: 'Node Canvas' }).click()
  await page.locator('.nc-toolbar').waitFor()
  const nodeCount = await page.evaluate(() => {
    const p = JSON.parse(localStorage.getItem('animated-ad-factory:project:v2') || '{}')
    return ((p.node_canvas && p.node_canvas.nodes) || []).length
  })
  check('node canvas gained 30 nodes (10 rows × prompt/gen/output)', nodeCount >= 30, `got ${nodeCount}`)

  // Session persistence: sessions auto-save; reload → session home lists the
  // named session; Open + step indicator jump straight back to Export.
  await page.reload()
  await page.locator('nav.sidebar-left button', { hasText: 'Marketing Studio' }).click()
  await page.locator('.ms-session-row-item').first().waitFor()
  const sessions = await page.evaluate(() => JSON.parse(localStorage.getItem('aaf_marketing_studio_sessions') || '[]'))
  check('session auto-persisted with prompts', sessions.length === 1 && sessions[0].studio.prompts.length === 10 && sessions[0].studio.product.name === 'NuitCalme')
  check('session auto-named from product + format', (await page.locator('.ms-session-name').first().textContent()).includes('NuitCalme'))
  await page.locator('.ms-session-row-item').first().locator('button', { hasText: 'Open' }).click()
  await page.locator('.ms-step', { hasText: 'Export' }).click()
  await page.locator('.ms-prompt-card').first().waitFor()
  check('reopened session restores prompts on Export step', (await page.locator('.ms-prompt-card').count()) === 10)

  // Clear session resets the active session's studio
  await page.locator('button', { hasText: 'Clear Session' }).click()
  await page.locator('.ms-step.active', { hasText: 'Brief' }).waitFor()
  const clearedSessions = await page.evaluate(() => JSON.parse(localStorage.getItem('aaf_marketing_studio_sessions') || '[]'))
  check('clear session resets state + returns to Brief', clearedSessions.length === 1 && clearedSessions[0].studio.product.name === '' && clearedSessions[0].studio.scenes.length === 0)

  // FIX 1 regression: product description round-trips with accents intact.
  await page.locator('.ms-step', { hasText: 'Brief' }).click()
  const DESC = 'Goût agréable, rituel après-dîner pour réduire le stress.'
  await page.locator('input.ms-input').first().fill('Calme')
  await page.locator('textarea.ms-input').first().fill(DESC)
  await page.locator('button', { hasText: 'Save to My Products' }).click()
  await page.locator('textarea.ms-input').first().fill('overwritten')
  await page.locator('.ms-lib-toggle').click()
  await page.locator('.ms-lib-row button', { hasText: 'Load' }).first().click()
  const roundTrip = await page.locator('textarea.ms-input').first().inputValue()
  check('fix1: accented description round-trips exactly', roundTrip === DESC, roundTrip)

  // FIX 6: hook search finds Après with unaccented query.
  await page.locator('.ms-hook-search-input').fill('apres')
  check('fix6: "apres" finds the Avant / Après hook', (await page.locator('.ms-hook-chip', { hasText: 'Avant / Après' }).count()) === 1)
  await page.locator('.ms-hook-search-input').fill('')

  // Back to home + delete
  await page.locator('button', { hasText: 'All Sessions' }).click()
  await page.locator('.ms-session-row-item').first().waitFor()
  await page.locator('.ms-session-row-item').first().locator('button', { hasText: 'Delete' }).click()
  await page.locator('.ms-empty-state').waitFor()
  check('delete session returns to empty state', (await page.evaluate(() => JSON.parse(localStorage.getItem('aaf_marketing_studio_sessions') || '[]'))).length === 0)
} catch (e) {
  failed++
  fails.push('unhandled: ' + e.message)
  console.log('FAIL  unhandled error — ' + e.message)
  await page.screenshot({ path: path.join(ARTIFACTS, 'studio-probe-failure.png'), fullPage: true }).catch(() => {})
} finally {
  await browser.close()
}

console.log('')
console.log(`${passed} passed, ${failed} failed`)
if (fails.length) console.log('Failed: ' + fails.join(' | '))
process.exit(failed ? 1 : 0)
