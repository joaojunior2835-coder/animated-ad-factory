// Screenshot helper: walks the studio to a given step and saves PNGs.
// Usage: node scripts/shot-studio.mjs [home|brief|format|chars|script|export]
import { chromium } from 'playwright'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const what = process.argv[2] || 'export'
const BASE = process.env.QA_BASE || 'http://localhost:5173/'
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.resolve(__dirname, '..', 'qa-artifacts')

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
page.setDefaultTimeout(10000)
page.on('dialog', (d) => d.accept())

await page.goto(BASE)
await page.evaluate(() => {
  localStorage.removeItem('aaf_marketing_studio_sessions')
  localStorage.removeItem('aaf_product_library')
})
await page.reload()
await page.locator('nav.sidebar-left button', { hasText: 'Marketing Studio' }).click()
await page.locator('.ms-hero-eyebrow').first().waitFor()

const shot = async (name) => {
  await page.screenshot({ path: path.join(OUT, `studio-${name}.png`), fullPage: false })
  console.log(`saved qa-artifacts/studio-${name}.png`)
}

if (what === 'home') { await shot('home'); await browser.close(); process.exit(0) }

await page.locator('button', { hasText: 'New Studio Session' }).click()
await page.locator('.ms-step').first().waitFor()
await page.locator('input.ms-input').first().fill('Calme')
await page.locator('textarea.ms-input').first().fill('Une boisson du soir à l’ashwagandha qui aide à réduire le stress et les envies de sucre.')
await page.locator('textarea.ms-input').nth(1).fill('Vos envies de sucre du soir ne sont pas un manque de volonté.')
await page.locator('textarea.ms-input').nth(2).fill('femmes 25-45 stressées le soir')
await page.locator('input.ms-input').nth(1).fill('ashwagandha')
if (what === 'brief') { await shot('brief'); await browser.close(); process.exit(0) }

await page.locator('button', { hasText: 'Next: Choose Format' }).click()
await page.locator('.ms-format-grid').first().waitFor()
if (what === 'format') { await shot('format'); await browser.close(); process.exit(0) }

await page.locator('.ms-format-card', { hasText: 'French Podcast' }).locator('button', { hasText: 'Select' }).click()
await page.locator('button', { hasText: 'Next: Choose Characters' }).click()
await page.locator('.ms-char-pair').waitFor()
if (what === 'chars') { await shot('chars'); await browser.close(); process.exit(0) }

await page.locator('button', { hasText: 'Next: Review Script' }).click()
await page.locator('.ms-scene-card').first().waitFor()
if (what === 'script') { await shot('script'); await browser.close(); process.exit(0) }

if (what === 'compare') {
  await page.locator('button', { hasText: 'Generate Hook Variants' }).click()
  await page.locator('.ms-variant-card').first().waitFor()
  if (process.argv[3] === 'variants') { await shot('variants'); await browser.close(); process.exit(0) }
  await page.locator('button', { hasText: 'Generate Prompts for All 3' }).click()
  await page.locator('.ms-compare-grid').waitFor()
  await page.waitForTimeout(400)
  await shot('compare')
  await browser.close()
  process.exit(0)
}

await page.locator('button', { hasText: 'Generate Prompts' }).first().click()
await page.locator('.ms-prompt-card').first().waitFor()
await page.waitForTimeout(800)
await shot('export')
await browser.close()
