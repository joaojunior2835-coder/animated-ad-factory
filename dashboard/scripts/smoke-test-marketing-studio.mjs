// Smoke test for the Marketing Studio pure model (no browser, no API, no keys).
// Run: npm run test:studio
//
// Verifies the omni-v51 non-negotiables on every format:
// - prompt text NEVER contains a duration (duration lives in the setup header)
// - prompt text NEVER describes the person's appearance
// - podcast prompts use the gaze rule (toward the other speaker, not camera)
// - every dialogue prompt ends with the natural-pace tail
// - scene 1 = hook, last scene = CTA, scene count = format.clipCount
// - podcast alternates speakers; talking head keeps one speaker
// - French formats produce French dialogue
// - extractBriefFromText fills fields from pasted text without any API

import {
  FORMATS,
  CHARACTERS,
  emptyStudio,
  normalizeStudio,
  generateSceneOutline,
  generateOmniPrompts,
  extractBriefFromText,
  durationForLine,
  buildCopyAllText,
  buildStudioMarkdown,
  modelsNeeded,
  totalPromptDuration,
  isTwoCharacterFormat,
  characterById,
  CLIP_DURATIONS
} from '../src/lib/marketingStudioModel.js'

let passed = 0
let failed = 0
function check(name, ok, detail) {
  if (ok) {
    passed++
    console.log(`PASS  ${name}`)
  } else {
    failed++
    console.log(`FAIL  ${name}${detail ? ' — ' + detail : ''}`)
  }
}

function sampleStudio(formatId, characters, language) {
  const s = emptyStudio()
  s.product.name = 'NuitCalme'
  s.product.description = 'An evening ritual drink that helps control late-night cravings.'
  s.product.benefits = ['calmer evenings without snacking']
  s.product.targetAudience = language === 'fr' ? 'des femmes de 30 à 45 ans' : 'women aged 30-45'
  s.product.keyIngredient = 'le safran'
  s.product.claimBoundary = 'No medical or weight-loss claims.'
  s.format = formatId
  s.characters = characters
  s.brief.language = language
  return s
}

// ---- Structure checks per format ----
const APPEARANCE_WORDS = /\b(hair|blonde|brunette|beautiful|pretty|wearing|outfit|dress|shirt|skin tone|cheveux|blonde?|joli|belle|vêtements?)\b/i
// Duration tokens: "6s", "6 s", "6 sec", "6 seconds", "6 secondes" — word-boundary so "30-45" ages don't trip it.
const DURATION_IN_TEXT = /\b\d+\s*(?:s|sec|secs|second|seconds|seconde|secondes)\b/i

for (const f of FORMATS) {
  const lang = f.id === 'french_podcast' ? 'fr' : f.id === 'cinematic_product' ? 'en' : 'fr'
  const chars = isTwoCharacterFormat(f.id) ? ['podcast_host_fr', 'podcast_guest_fr'] : ['confident_woman_fr']
  const studio = sampleStudio(f.id, chars, lang)
  const scenes = generateSceneOutline(studio)

  check(`${f.id}: scene count = clipCount (${f.clipCount})`, scenes.length === f.clipCount, `got ${scenes.length}`)
  check(`${f.id}: scene 1 is the hook`, scenes[0] && /hook/.test(scenes[0].purpose), scenes[0] && scenes[0].purpose)
  check(`${f.id}: last scene is the CTA`, scenes.length > 0 && /cta|end_card/.test(scenes[scenes.length - 1].purpose), scenes.length ? scenes[scenes.length - 1].purpose : 'no scenes')

  const sceneKeys = ['sceneNumber', 'duration', 'purpose', 'shotType', 'character', 'dialogueLine', 'visualDescription', 'emotionalBeat', 'clipDuration']
  check(`${f.id}: scene shape complete`, scenes.every((sc) => sceneKeys.every((k) => k in sc)))
  check(`${f.id}: clip durations in {4,6,8,10}`, scenes.every((sc) => CLIP_DURATIONS.includes(sc.clipDuration)))

  if (isTwoCharacterFormat(f.id)) {
    const alternates = scenes.every((sc, i) => sc.character === (i % 2 === 0 ? 'podcast_host_fr' : 'podcast_guest_fr'))
    check(`${f.id}: speakers alternate host/guest`, alternates)
  } else if (f.id !== 'cinematic_product') {
    check(`${f.id}: single speaker throughout`, scenes.every((sc) => sc.character === 'confident_woman_fr'))
  }

  if (lang === 'fr' && f.id !== 'cinematic_product') {
    const frenchish = scenes.some((sc) => /[àâéèêëîïôùûç]|vous|c['’]est|qu['’]/i.test(sc.dialogueLine))
    check(`${f.id}: dialogue is French`, frenchish, scenes.map((sc) => sc.dialogueLine).join(' | ').slice(0, 120))
  }

  const prompts = generateOmniPrompts(studio, scenes)
  check(`${f.id}: one prompt per scene`, prompts.length === scenes.length, `got ${prompts.length}`)

  const promptKeys = ['sceneNumber', 'model', 'promptText', 'setupHeader', 'attachFrame', 'duration', 'aspectRatio', 'notes']
  check(`${f.id}: prompt shape complete`, prompts.every((p) => promptKeys.every((k) => k in p)))

  check(`${f.id}: NO duration in any prompt text`, prompts.every((p) => !DURATION_IN_TEXT.test(p.promptText)),
    prompts.filter((p) => DURATION_IN_TEXT.test(p.promptText)).map((p) => p.promptText).join(' || ').slice(0, 200))
  check(`${f.id}: NO appearance words in any prompt text`, prompts.every((p) => !APPEARANCE_WORDS.test(p.promptText)),
    prompts.filter((p) => APPEARANCE_WORDS.test(p.promptText)).map((p) => p.promptText).join(' || ').slice(0, 200))
  check(`${f.id}: setup header carries duration + frame`, prompts.every((p) => p.setupHeader.includes(`select [${p.duration}s]`) && p.setupHeader.includes(`attach Frame [${p.sceneNumber}]`)))
  check(`${f.id}: aspect ratio matches format`, prompts.every((p) => p.aspectRatio === f.aspectRatio))

  if (f.id === 'cinematic_product') {
    check(`${f.id}: visual clips use Seedance 2.0`, prompts.every((p) => p.model === 'Seedance 2.0'))
    check(`${f.id}: visual prompts never mention a person speaking on camera`, prompts.every((p) => !/says:/.test(p.promptText)))
    check(`${f.id}: VO line moved to notes`, prompts.every((p) => p.notes.includes('Voiceover')))
  } else {
    check(`${f.id}: dialogue clips use Omni Flash`, prompts.every((p) => p.model === 'Gemini Omni Flash (Google Flow)'))
    check(`${f.id}: every dialogue prompt ends with the natural-pace tail`, prompts.every((p) => /natural pace — do not slow it down to fill time; after the line (she|he|they) stays? silent with a natural expression\.$/.test(p.promptText)),
      prompts.map((p) => p.promptText.slice(-80)).join(' || ').slice(0, 240))
    if (isTwoCharacterFormat(f.id)) {
      check(`${f.id}: podcast gaze rule (toward the other speaker, not camera)`, prompts.every((p) => p.promptText.includes('looks toward the other speaker, not at the camera')))
    } else {
      check(`${f.id}: talking head speaks to camera`, prompts.every((p) => p.promptText.includes('speaks directly to the camera')))
    }
  }
}

// ---- Determinism ----
{
  const studio = sampleStudio('ugc_talking_head', ['confident_woman_fr'], 'fr')
  const a = JSON.stringify(generateSceneOutline(studio))
  const b = JSON.stringify(generateSceneOutline(studio))
  check('determinism: same studio → identical outline', a === b)
  const scenes = generateSceneOutline(studio)
  check('determinism: same scenes → identical prompts', JSON.stringify(generateOmniPrompts(studio, scenes)) === JSON.stringify(generateOmniPrompts(studio, scenes)))
}

// ---- Word count → duration guide ----
check('duration: 8 words → 4s', durationForLine('one two three four five six seven eight') === 4)
check('duration: 13 words → 6s', durationForLine('w w w w w w w w w w w w w') === 6)
check('duration: 18 words → 8s', durationForLine('w w w w w w w w w w w w w w w w w w') === 8)
check('duration: 25 words → 10s', durationForLine(Array(25).fill('w').join(' ')) === 10)
check('duration: empty (visual clip) → 6s', durationForLine('') === 6)

// ---- normalizeStudio robustness ----
check('normalizeStudio: null → empty studio', JSON.stringify(normalizeStudio(null)) === JSON.stringify(emptyStudio()))
check('normalizeStudio: bad format dropped', normalizeStudio({ format: 'nope' }).format === null)
check('normalizeStudio: >2 characters trimmed', normalizeStudio({ characters: ['a', 'b', 'c'] }).characters.length === 2)
check('normalizeStudio: bad duration → 30', normalizeStudio({ brief: { duration: 99 } }).brief.duration === 30)
check('normalizeStudio: bad language → fr', normalizeStudio({ brief: { language: 'de' } }).brief.language === 'fr')

// ---- Custom character ----
{
  const c = characterById('custom:a tired nurse who works night shifts')
  check('custom character: resolves with description', !!c && c.description === 'a tired nurse who works night shifts')
  const studio = sampleStudio('ugc_talking_head', ['custom:a tired nurse'], 'fr')
  const prompts = generateOmniPrompts(studio, generateSceneOutline(studio))
  check('custom character: neutral pronoun tail (They say)', prompts.every((p) => /They say:/.test(p.promptText)))
}

// ---- extractBriefFromText ----
{
  const pasted = [
    'Competitor breakdown — /watch output',
    'Product: GlowSerum Night Repair',
    'Description: A retinol-free overnight serum for sensitive skin.',
    'Key benefit: wake up with visibly calmer skin',
    'Target audience: women 25-40 with reactive skin',
    'Ingredient: bakuchiol',
    'Claims: cannot claim to treat eczema or any medical condition',
    'Hook: Your skin repairs itself at night — if you let it.',
    'Problem: harsh actives wreck sensitive skin barriers',
    'CTA: Try it for 30 nights, risk free',
    'Tone: calm, expert, reassuring',
    'Landing page: https://example.com/glowserum',
    'Category context: this is a skincare product'
  ].join('\n')
  const r = extractBriefFromText(pasted)
  check('extract: product name', r.product.name === 'GlowSerum Night Repair')
  check('extract: description', (r.product.description || '').includes('retinol-free'))
  check('extract: benefit captured', Array.isArray(r.product.benefits) && r.product.benefits[0].includes('calmer skin'))
  check('extract: audience', (r.product.targetAudience || '').includes('reactive skin'))
  check('extract: ingredient', r.product.keyIngredient === 'bakuchiol')
  check('extract: claim boundary', (r.product.claimBoundary || '').includes('eczema'))
  check('extract: hook', (r.brief.hook || '').includes('repairs itself'))
  check('extract: problem', (r.brief.problem || '').includes('harsh actives'))
  check('extract: cta', (r.brief.cta || '').includes('30 nights'))
  check('extract: tone', (r.brief.tone || '').includes('calm'))
  check('extract: landing url', r.product.landingPageUrl === 'https://example.com/glowserum')
  check('extract: category detected', r.product.category === 'skincare')
  check('extract: filledKeys lists fills', r.filledKeys.includes('product.name') && r.filledKeys.includes('brief.hook'))
  check('extract: empty text → nothing filled', extractBriefFromText('').filledKeys.length === 0)
}

// ---- Export helpers ----
{
  const studio = sampleStudio('french_podcast', ['podcast_host_fr', 'podcast_guest_fr'], 'fr')
  const scenes = generateSceneOutline(studio)
  const prompts = generateOmniPrompts(studio, scenes)
  const copyAll = buildCopyAllText(prompts)
  check('copy-all: contains every setup header', prompts.every((p) => copyAll.includes(p.setupHeader)))
  check('copy-all: ---- separated', copyAll.split('\n----\n').length === prompts.length)
  const md = buildStudioMarkdown(studio, scenes, prompts)
  check('markdown: has brief summary + outline + prompts', md.includes('## Product Brief Summary') && md.includes('## Scene Outline') && md.includes('## Prompts'))
  check('markdown: includes french-never-seedance checklist line', md.includes('never Seedance'))
  check('models needed: omni only for french podcast', JSON.stringify(modelsNeeded(prompts)) === JSON.stringify(['Gemini Omni Flash']))
  check('total duration: sums clip durations', totalPromptDuration(prompts) === prompts.reduce((a, p) => a + p.duration, 0))
}

check('characters: 8 starter characters', CHARACTERS.length === 8)
check('formats: 5 formats', FORMATS.length === 5)

// ---- Hook library (Tier 1) ----
{
  const { HOOK_LIBRARY, hooksForLanguage } = await import('../src/lib/marketingStudioModel.js')
  check('hooks: at least 15 hooks', HOOK_LIBRARY.length >= 15, `got ${HOOK_LIBRARY.length}`)
  check('hooks: shape complete', HOOK_LIBRARY.every((h) => h.id && h.name && h.text && h.category && ['fr', 'en', 'any'].includes(h.language)))
  const fr = hooksForLanguage('fr')
  const en = hooksForLanguage('en')
  check('hooks: fr filter = fr + universal only', fr.every((h) => h.language === 'fr' || h.language === 'any') && fr.some((h) => h.language === 'any'))
  check('hooks: en filter = en + universal only', en.every((h) => h.language === 'en' || h.language === 'any'))
  check('hooks: fr list has 8 french hooks', fr.filter((h) => h.language === 'fr').length === 8)
  check('hooks: unique ids', new Set(HOOK_LIBRARY.map((h) => h.id)).size === HOOK_LIBRARY.length)
}

console.log('')
console.log(`${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
