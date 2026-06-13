import assert from 'node:assert/strict'
import { emptyStudio, generateFramePrompts, generateOmniPrompts, inferStudioFromQuickPrompt } from '../src/lib/marketingStudioModel.js'

let passed = 0

function validStudio(studio) {
  assert.ok(studio && typeof studio === 'object')
  assert.ok(studio.product && typeof studio.product.name === 'string')
  assert.ok(studio.brief && ['fr', 'en'].includes(studio.brief.language))
  assert.ok(typeof studio.brief.duration === 'number')
  assert.ok(typeof studio.format === 'string')
  assert.ok(Array.isArray(studio.characters))
  assert.ok(Array.isArray(studio.scenes))
  assert.ok(Array.isArray(studio.prompts))
}

function test(name, fn) {
  fn()
  passed += 1
  console.log(`PASS  ${name}`)
}

test('French podcast inference', () => {
  const studio = inferStudioFromQuickPrompt('Podcast français 30s pour Calme, boisson anti-stress, cible femmes 25-45, ingrédient ashwagandha, ton authentique', 'fr')
  validStudio(studio)
  assert.equal(studio.format, 'french_podcast')
  assert.equal(studio.brief.language, 'fr')
  assert.equal(studio.brief.duration, 30)
  assert.match(studio.product.name, /Calme/i)
})

test('English UGC inference', () => {
  const studio = inferStudioFromQuickPrompt('English UGC 45s for GlowSerum, skincare serum, target women 20-35, ingredient hyaluronic acid, tone casual', 'en')
  validStudio(studio)
  assert.equal(studio.format, 'ugc_talking_head')
  assert.equal(studio.brief.language, 'en')
  assert.equal(studio.brief.duration, 45)
  assert.match(studio.product.name, /GlowSerum/i)
})

test('Empty input returns valid defaults', () => {
  validStudio(inferStudioFromQuickPrompt('', 'fr'))
})

test('Gibberish returns valid defaults', () => {
  const studio = inferStudioFromQuickPrompt('random gibberish text with no keywords', 'en')
  validStudio(studio)
  assert.equal(studio.format, 'ugc_talking_head')
})

const calmeStudio = inferStudioFromQuickPrompt('Podcast français 30s pour Calme, boisson anti-stress, cible femmes 25-45, ingrédient ashwagandha, ton authentique', 'fr')
const calmePrompts = generateOmniPrompts(calmeStudio, calmeStudio.scenes)
const calmeFrames = generateFramePrompts(calmeStudio, calmeStudio.scenes, calmePrompts)

test('Frame prompts match scene count and shape', () => {
  assert.equal(calmeStudio.scenes.length, 10)
  assert.equal(calmeFrames.length, calmeStudio.scenes.length)
  for (const frame of calmeFrames) {
    assert.ok(frame.sceneNumber)
    assert.ok(frame.purpose)
    assert.ok(typeof frame.framePrompt === 'string' && frame.framePrompt.trim())
    assert.ok(typeof frame.setupHeader === 'string' && frame.setupHeader.trim())
  }
})

test('Frame prompts obey static-frame rules', () => {
  for (const frame of calmeFrames) {
    assert.doesNotMatch(frame.framePrompt, /\b(?:4|6|8|10)s\b/i)
    assert.doesNotMatch(frame.framePrompt, /\b(?:says|speaks|tells)\b/i)
    assert.match(frame.setupHeader, /Attach Frame/)
  }
})

test('Frame prompt generation never throws on empty input', () => {
  assert.deepEqual(generateFramePrompts(emptyStudio(), [], []), [])
})

console.log(`\n${passed} passed, 0 failed`)
