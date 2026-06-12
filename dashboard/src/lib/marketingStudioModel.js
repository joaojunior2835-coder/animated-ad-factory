// Marketing Studio model: one structured brief → a complete scene-by-scene ad
// package of paste-ready prompts (Gemini Omni Flash / Seedance 2.0 style).
// Pure data + pure functions — no React, no DOM, no API calls, no randomness.
//
// Prompt rules baked in (omni-v51-method — non-negotiable):
// - Duration NEVER appears in the prompt text; it lives in the setup header only.
// - The person's appearance is NEVER described in a prompt — the attached frame
//   carries identity. Prompts describe speech, delivery, gaze, and motion only.
// - Podcast gaze rule: each speaker looks toward the other person, not the camera.
// - Every dialogue prompt ends with the natural-pace tail.
// - Product/visual clips describe motion only (camera, product behavior,
//   atmosphere) — never the person.

// ---- Formats ----
// clipCount is the exact scene count generateSceneOutline produces;
// clipRange is the display badge ("8-12 clips").
export const FORMATS = [
  {
    id: 'ugc_talking_head',
    name: 'UGC Talking Head',
    description: '1 person speaking to camera',
    icon: '🎤',
    clipCount: 7,
    clipRange: '6-8',
    aspectRatio: '9:16',
    style: 'authentic/raw'
  },
  {
    id: 'ugc_podcast',
    name: 'UGC Podcast',
    description: '2-person podcast format',
    icon: '🎙️',
    clipCount: 10,
    clipRange: '8-12',
    aspectRatio: '9:16',
    style: 'conversational'
  },
  {
    id: 'cinematic_product',
    name: 'Cinematic Product',
    description: 'Product hero shots + voiceover',
    icon: '🎥',
    clipCount: 7,
    clipRange: '6-8',
    aspectRatio: '16:9',
    style: 'cinematic'
  },
  {
    id: 'ugc_testimonial',
    name: 'UGC Testimonial',
    description: 'Problem→solution story arc',
    icon: '💬',
    clipCount: 7,
    clipRange: '6-8',
    aspectRatio: '9:16',
    style: 'authentic/raw'
  },
  {
    id: 'french_podcast',
    name: 'French Podcast (Omni)',
    description: '2-person French language podcast',
    icon: '🇫🇷',
    clipCount: 10,
    clipRange: '8-12',
    aspectRatio: '9:16',
    style: 'conversational/french',
    note: 'Use Gemini Omni Flash in Google Flow. Never Seedance for French.'
  }
]

export const TWO_CHARACTER_FORMATS = ['ugc_podcast', 'french_podcast']

export function isTwoCharacterFormat(formatId) {
  return TWO_CHARACTER_FORMATS.includes(formatId)
}

export function formatById(id) {
  return FORMATS.find((f) => f.id === id) || null
}

// ---- Characters ----
export const CHARACTERS = [
  {
    id: 'confident_woman_fr',
    name: 'Confident Woman (FR)',
    description: 'French-speaking confident woman, 28-35, speaks directly to camera with assured energy',
    gender: 'female',
    style: 'direct/confident',
    language: 'fr',
    tags: ['ugc', 'talking-head', 'direct-camera']
  },
  {
    id: 'friendly_man_fr',
    name: 'Friendly Man (FR)',
    description: 'French-speaking friendly man, 30-40, warm approachable energy',
    gender: 'male',
    style: 'warm/friendly',
    language: 'fr',
    tags: ['ugc', 'talking-head', 'warm']
  },
  {
    id: 'expert_woman_en',
    name: 'Expert Woman (EN)',
    description: 'English-speaking expert woman, calm authority tone, explains clearly',
    gender: 'female',
    style: 'expert/authority',
    language: 'en',
    tags: ['expert', 'authority', 'explainer']
  },
  {
    id: 'young_woman_ugc',
    name: 'Young Woman (UGC)',
    description: 'Gen-Z UGC style woman, casual spontaneous energy, feels like a friend talking',
    gender: 'female',
    style: 'casual/gen-z',
    language: 'en',
    tags: ['ugc', 'gen-z', 'casual']
  },
  {
    id: 'podcast_host_fr',
    name: 'Podcast Host (FR)',
    description: 'French podcast host, professional but warm, guides the conversation',
    gender: 'male',
    style: 'professional/warm',
    language: 'fr',
    tags: ['podcast', 'host', 'interviewer']
  },
  {
    id: 'podcast_guest_fr',
    name: 'Podcast Guest (FR)',
    description: 'French podcast guest, curious and engaged, shares a personal discovery',
    gender: 'female',
    style: 'curious/engaged',
    language: 'fr',
    tags: ['podcast', 'guest', 'storyteller']
  },
  {
    id: 'testimonial_woman',
    name: 'Testimonial Woman',
    description: 'Relatable testimonial woman, problem-aware, tells her before/after story',
    gender: 'female',
    style: 'relatable/honest',
    language: 'fr',
    tags: ['testimonial', 'story', 'relatable']
  },
  {
    id: 'testimonial_man',
    name: 'Testimonial Man',
    description: 'Relatable testimonial man, solution-focused, practical tone',
    gender: 'male',
    style: 'practical/positive',
    language: 'fr',
    tags: ['testimonial', 'story', 'practical']
  }
]

// ---- Hook library (proven openers; pick one into brief.hook) ----
// language: 'fr' | 'en' | 'any'. Text ends open ("...") on purpose — the user
// finishes the line for their product.
export const HOOK_LIBRARY = [
  // French
  { id: 'stop_scroll_fr', name: 'Stop Scroll', text: 'Ce produit a changé ma routine complètement...', category: 'story', language: 'fr' },
  { id: 'problem_first_fr', name: 'Problème d’abord', text: 'J’avais ce problème depuis des années...', category: 'problem', language: 'fr' },
  { id: 'reveal_fr', name: 'Révélation', text: 'Je vais vous montrer quelque chose d’incroyable...', category: 'reveal', language: 'fr' },
  { id: 'question_fr', name: 'Question', text: 'Vous connaissez cette sensation quand...', category: 'question', language: 'fr' },
  { id: 'testimonial_fr', name: 'Témoignage', text: 'Je ne pensais pas que ça marcherait mais...', category: 'testimonial', language: 'fr' },
  { id: 'before_after_fr', name: 'Avant / Après', text: 'Avant j’avais honte, maintenant...', category: 'before_after', language: 'fr' },
  { id: 'secret_fr', name: 'Le Secret', text: 'Ce que les grandes marques ne veulent pas que vous sachiez...', category: 'secret', language: 'fr' },
  { id: 'urgency_fr', name: 'Urgence', text: 'J’aurais voulu découvrir ça bien plus tôt...', category: 'urgency', language: 'fr' },
  // English
  { id: 'stop_scroll_en', name: 'Stop Scroll', text: 'This product completely changed my routine...', category: 'story', language: 'en' },
  { id: 'problem_first_en', name: 'Problem First', text: 'I had this problem for years...', category: 'problem', language: 'en' },
  { id: 'reveal_en', name: 'Reveal', text: 'I’m about to show you something incredible...', category: 'reveal', language: 'en' },
  { id: 'question_en', name: 'Question', text: 'You know that feeling when...', category: 'question', language: 'en' },
  { id: 'testimonial_en', name: 'Testimonial', text: 'I didn’t think it would work but...', category: 'testimonial', language: 'en' },
  { id: 'before_after_en', name: 'Before / After', text: 'Before I was embarrassed, now...', category: 'before_after', language: 'en' },
  { id: 'urgency_en', name: 'Urgency', text: 'I wish I’d found this so much sooner...', category: 'urgency', language: 'en' },
  // Universal
  { id: 'stat_hook', name: 'Statistic', text: 'Studies show that [X]% of people struggle with...', category: 'stat', language: 'any' },
  { id: 'comparison', name: 'Comparison', text: 'Every other product I tried failed until...', category: 'comparison', language: 'any' }
]

// Hooks usable for a brief language ('fr'/'en'): that language + universal ones.
export function hooksForLanguage(lang) {
  const l = lang === 'en' ? 'en' : 'fr'
  return HOOK_LIBRARY.filter((h) => h.language === l || h.language === 'any')
}

export const CUSTOM_CHARACTER_PREFIX = 'custom:'

// Resolve a character id (or a "custom:<description>" entry) to a character
// object. Custom characters have no fixed gender → neutral pronouns.
export function characterById(id) {
  const s = String(id || '')
  if (s.startsWith(CUSTOM_CHARACTER_PREFIX)) {
    const description = s.slice(CUSTOM_CHARACTER_PREFIX.length).trim()
    return {
      id: s,
      name: 'Custom character',
      description,
      gender: '',
      style: 'custom',
      language: '',
      tags: ['custom']
    }
  }
  return CHARACTERS.find((c) => c.id === s) || null
}

// ---- Studio state ----

export const STUDIO_STATUSES = ['draft', 'brief_ready', 'generating', 'complete']
export const STUDIO_DURATIONS = [15, 30, 45, 60]
export const CLIP_DURATIONS = [4, 6, 8, 10]
export const PRODUCT_CATEGORIES = ['supplement', 'skincare', 'food & drink', 'fitness', 'wellness', 'other']

export function emptyStudio() {
  return {
    product: {
      name: '',
      description: '',
      benefits: [],
      targetAudience: '',
      keyIngredient: '',
      claimBoundary: '',
      imageUrls: [],
      landingPageUrl: '',
      category: ''
    },
    format: null,
    characters: [],
    brief: {
      hook: '',
      problem: '',
      solution: '',
      cta: '',
      tone: '',
      language: 'fr',
      duration: 30
    },
    scenes: [],
    prompts: [],
    status: 'draft'
  }
}

function str(v) {
  return String(v == null ? '' : v)
}

function strList(v) {
  if (Array.isArray(v)) return v.map((x) => str(x).trim()).filter(Boolean)
  if (typeof v === 'string') return v.split(/\r?\n/).map((s) => s.replace(/^[-*]\s*/, '').trim()).filter(Boolean)
  return []
}

// Normalize a stored/loaded studio into the canonical shape. Migration-safe:
// missing or malformed input yields an empty studio (never throws).
export function normalizeStudio(data) {
  const base = emptyStudio()
  const d = data && typeof data === 'object' && !Array.isArray(data) ? data : {}
  const p = d.product && typeof d.product === 'object' ? d.product : {}
  const b = d.brief && typeof d.brief === 'object' ? d.brief : {}
  const duration = Number(b.duration)
  return {
    product: {
      name: str(p.name),
      description: str(p.description),
      benefits: strList(p.benefits),
      targetAudience: str(p.targetAudience),
      keyIngredient: str(p.keyIngredient),
      claimBoundary: str(p.claimBoundary),
      imageUrls: strList(p.imageUrls),
      landingPageUrl: str(p.landingPageUrl),
      category: str(p.category)
    },
    format: formatById(d.format) ? d.format : null,
    characters: Array.isArray(d.characters) ? d.characters.map(str).filter(Boolean).slice(0, 2) : [],
    brief: {
      hook: str(b.hook),
      problem: str(b.problem),
      solution: str(b.solution),
      cta: str(b.cta),
      tone: str(b.tone),
      language: b.language === 'en' ? 'en' : 'fr',
      duration: STUDIO_DURATIONS.includes(duration) ? duration : 30
    },
    scenes: Array.isArray(d.scenes) ? d.scenes : [],
    prompts: Array.isArray(d.prompts) ? d.prompts : [],
    status: STUDIO_STATUSES.includes(d.status) ? d.status : 'draft'
  }
}

// ---- Word count → clip duration (omni-v51 guide) ----
// ≤8 words = 4s, 9-13 = 6s, 14-18 = 8s, 19-25 = 10s (longer lines clamp to 10s
// — the prompt notes flag them for trimming).
export function wordCount(line) {
  return str(line).trim().split(/\s+/).filter(Boolean).length
}

export function durationForLine(line) {
  const n = wordCount(line)
  if (n === 0) return 6 // visual-only clip default
  if (n <= 8) return 4
  if (n <= 13) return 6
  if (n <= 18) return 8
  return 10
}

// ---- Scene outline generation (pure, deterministic) ----

// Language helper: pick the French or English variant.
function t(lang, fr, en) {
  return lang === 'fr' ? fr : en
}

// Effective language: french_podcast always speaks French.
export function studioLanguage(studio) {
  if (studio && studio.format === 'french_podcast') return 'fr'
  return studio && studio.brief && studio.brief.language === 'en' ? 'en' : 'fr'
}

// Deterministic dialogue line per purpose. User-provided brief fields win;
// templates fill the gaps. All templates stay within the 25-word clip budget.
function lineFor(purpose, studio, lang) {
  const p = studio.product || {}
  const b = studio.brief || {}
  const name = str(p.name).trim() || t(lang, 'ce produit', 'this product')
  const audience = str(p.targetAudience).trim()
  const ingredient = str(p.keyIngredient).trim()
  const benefit = (p.benefits && p.benefits[0]) || ''

  switch (purpose) {
    case 'hook':
      return str(b.hook).trim() || t(lang, `Personne ne vous a dit la vérité sur ${name}.`, `Nobody told you the truth about ${name}.`)
    case 'problem':
      return str(b.problem).trim() || t(lang, audience ? `Si vous êtes ${audience}, vous connaissez ce problème par cœur.` : 'Vous connaissez ce problème par cœur, et rien ne marche vraiment.', audience ? `If you're ${audience}, you know this problem by heart.` : 'You know this problem by heart, and nothing really works.')
    case 'agitation':
      return t(lang, 'Et le pire, c’est que plus on attend, plus ça s’installe.', 'And the worst part is, the longer you wait, the worse it gets.')
    case 'discovery':
      return t(lang, `Puis je suis tombée sur ${name}, et j’étais sceptique au début.`, `Then I found ${name}, and honestly I was skeptical at first.`)
    case 'product_entry':
      return str(b.solution).trim() || t(lang, `C’est là que ${name} change tout.`, `That’s where ${name} changes everything.`)
    case 'mechanism':
      return ingredient
        ? t(lang, `Le secret, c’est ${ingredient} — c’est ça qui fait la différence.`, `The secret is ${ingredient} — that’s what makes the difference.`)
        : t(lang, 'Ce qui change, c’est la façon dont ça agit jour après jour.', 'What changes is how it works, day after day.')
    case 'benefit':
      return benefit
        ? t(lang, `Concrètement : ${benefit}.`, `Concretely: ${benefit}.`)
        : t(lang, 'Concrètement, on sent la différence dès les premiers jours.', 'Concretely, you feel the difference within the first days.')
    case 'proof':
      return t(lang, 'Après quelques semaines, je ne reviendrais en arrière pour rien au monde.', 'After a few weeks, I would never go back.')
    case 'objection':
      return t(lang, 'Je pensais que c’était trop beau pour être vrai. J’avais tort.', 'I thought it was too good to be true. I was wrong.')
    case 'cta':
      return str(b.cta).trim() || t(lang, `Essayez ${name} — le lien est juste en dessous.`, `Try ${name} — the link is right below.`)
    // Podcast-specific conversational beats
    case 'podcast_hook':
      return str(b.hook).trim() || t(lang, `Aujourd’hui on parle d’un sujet que tout le monde évite.`, 'Today we’re talking about a topic everyone avoids.')
    case 'podcast_problem':
      return str(b.problem).trim() || t(lang, 'Franchement, j’ai tout essayé pendant des années, sans résultat.', 'Honestly, I tried everything for years, with no results.')
    case 'podcast_question':
      return t(lang, 'Attends, explique-moi — qu’est-ce qui ne marchait pas exactement ?', 'Wait, explain that to me — what exactly wasn’t working?')
    case 'podcast_story':
      return t(lang, 'Chaque soir c’était pareil, et je commençais à perdre espoir.', 'Every evening it was the same, and I was starting to lose hope.')
    case 'podcast_transition':
      return t(lang, 'Et donc, qu’est-ce qui a changé pour toi ?', 'So what changed for you?')
    case 'podcast_reveal':
      return str(b.solution).trim() || t(lang, `J’ai découvert ${name}, et là tout a basculé.`, `I discovered ${name}, and that’s when everything shifted.`)
    case 'podcast_mechanism_q':
      return t(lang, 'OK mais concrètement, comment ça marche ?', 'OK but concretely, how does it work?')
    case 'podcast_reaction':
      return t(lang, 'C’est impressionnant. Et tu le recommanderais à qui ?', 'That’s impressive. And who would you recommend it to?')
    default:
      return ''
  }
}

// Voiceover lines for cinematic scenes (recorded separately, never lip-synced).
function voLineFor(purpose, studio, lang) {
  return lineFor(purpose, studio, lang)
}

// Per-purpose emotional beat label.
const EMOTIONAL_BEATS = {
  hook: 'curiosity',
  problem: 'frustration',
  agitation: 'tension',
  discovery: 'hope',
  product_entry: 'relief',
  mechanism: 'confidence',
  benefit: 'satisfaction',
  proof: 'trust',
  objection: 'reassurance',
  cta: 'action',
  podcast_hook: 'curiosity',
  podcast_problem: 'frustration',
  podcast_question: 'curiosity',
  podcast_story: 'tension',
  podcast_transition: 'anticipation',
  podcast_reveal: 'relief',
  podcast_mechanism_q: 'curiosity',
  podcast_reaction: 'trust'
}

// Human label for a purpose key.
export function purposeLabel(purpose) {
  const map = {
    hook: 'Hook',
    problem: 'Problem',
    agitation: 'Agitation',
    discovery: 'Discovery',
    product_entry: 'Product Entry',
    mechanism: 'Mechanism',
    benefit: 'Benefit',
    proof: 'Proof',
    objection: 'Objection Flip',
    cta: 'CTA',
    podcast_hook: 'Hook',
    podcast_problem: 'Problem',
    podcast_question: 'Follow-up Question',
    podcast_story: 'Story',
    podcast_transition: 'Transition',
    podcast_reveal: 'Product Reveal',
    podcast_mechanism_q: 'Mechanism Question',
    podcast_reaction: 'Reaction',
    product_hero: 'Product Hero',
    lifestyle: 'Lifestyle',
    macro_detail: 'Macro Detail',
    product_reveal: 'Product Reveal',
    product_in_use: 'Product In Use',
    end_card: 'End Card / CTA'
  }
  return map[purpose] || purpose
}

// Build a single scene for talking-head-style formats (one speaker on camera).
function speakerScene(num, purpose, characterId, studio, lang, settingDesc) {
  const dialogueLine = lineFor(purpose, studio, lang)
  const clipDuration = durationForLine(dialogueLine)
  return {
    sceneNumber: num,
    duration: clipDuration,
    purpose,
    shotType: 'talking head — static camera, mid-shot',
    character: characterId,
    dialogueLine,
    visualDescription: settingDesc,
    emotionalBeat: EMOTIONAL_BEATS[purpose] || '',
    clipDuration
  }
}

// Build a cinematic product scene (visual clip; the line is a separate VO).
function cinematicScene(num, purpose, characterId, studio, lang, shotType, visualDescription, voPurpose) {
  const dialogueLine = voLineFor(voPurpose, studio, lang)
  const clipDuration = durationForLine(dialogueLine)
  return {
    sceneNumber: num,
    duration: clipDuration,
    purpose,
    shotType,
    character: characterId,
    dialogueLine, // voiceover line — recorded separately, never lip-synced
    visualDescription,
    emotionalBeat: EMOTIONAL_BEATS[voPurpose] || '',
    clipDuration
  }
}

// Generate the full scene outline for a studio. Pure and deterministic:
// the same studio always yields the same outline.
// Rules: scene count = format.clipCount; scene 1 = hook; last scene = CTA;
// podcast alternates speakers; talking head keeps one speaker; cinematic
// mixes product shots and voiceover scenes; French formats speak French.
export function generateSceneOutline(studio) {
  const s = normalizeStudio(studio)
  const format = formatById(s.format)
  if (!format) return []
  const lang = studioLanguage(s)
  const chars = s.characters
  const c1 = chars[0] || ''
  const c2 = chars[1] || c1

  if (format.id === 'ugc_talking_head') {
    const setting = 'Casual indoor setting, natural daylight, phone-camera framing'
    const arc = ['hook', 'problem', 'agitation', 'product_entry', 'mechanism', 'proof', 'cta']
    return arc.slice(0, format.clipCount).map((purpose, i) => speakerScene(i + 1, purpose, c1, s, lang, setting))
  }

  if (format.id === 'ugc_testimonial') {
    const setting = 'Lived-in home setting, soft window light, handheld UGC framing'
    const arc = ['hook', 'problem', 'agitation', 'discovery', 'benefit', 'proof', 'cta']
    return arc.slice(0, format.clipCount).map((purpose, i) => speakerScene(i + 1, purpose, c1, s, lang, setting))
  }

  if (format.id === 'ugc_podcast' || format.id === 'french_podcast') {
    const setting = 'Podcast studio, two speakers facing each other, warm lamp light, static camera'
    // Strict alternation: odd scenes = character 1 (host), even = character 2 (guest).
    const arc = [
      'podcast_hook', // 1 host
      'podcast_problem', // 2 guest
      'podcast_question', // 3 host
      'podcast_story', // 4 guest
      'podcast_transition', // 5 host
      'podcast_reveal', // 6 guest
      'podcast_mechanism_q', // 7 host
      'mechanism', // 8 guest
      'podcast_reaction', // 9 host
      'cta' // 10 guest
    ]
    return arc.slice(0, format.clipCount).map((purpose, i) => {
      const speaker = i % 2 === 0 ? c1 : c2
      const sc = speakerScene(i + 1, purpose, speaker, s, lang, setting)
      sc.shotType = 'podcast two-shot — static camera, speaker framed at desk'
      return sc
    })
  }

  if (format.id === 'cinematic_product') {
    const name = str(s.product.name).trim() || 'the product'
    const slots = [
      ['hook', 'macro product hero shot', `${name} centered on a dark reflective surface, dramatic rim light`, 'hook'],
      ['lifestyle', 'lifestyle wide shot', 'Daily-life environment where the problem shows up, cinematic depth of field', 'problem'],
      ['product_reveal', 'product reveal shot', `${name} emerging into a beam of light, slow and deliberate`, 'product_entry'],
      ['macro_detail', 'macro ingredient/texture detail', 'Extreme close-up of texture and key ingredient detail', 'mechanism'],
      ['lifestyle', 'lifestyle moment with character', 'A calm, resolved daily moment — the after-state, golden hour light', 'benefit'],
      ['product_in_use', 'product-in-use shot', `${name} being used naturally in its real context, top-down view`, 'proof'],
      ['cta', 'product hero end card', `${name} on a clean branded backdrop with space for the CTA overlay`, 'cta']
    ]
    return slots.slice(0, format.clipCount).map(([purpose, shotType, visual, voPurpose], i) =>
      cinematicScene(i + 1, purpose, c1, s, lang, shotType, visual, voPurpose)
    )
  }

  return []
}

// Regenerate a single scene by index (used by per-card "Regenerate Scene").
// Pure: re-runs the outline and returns that one scene.
export function regenerateScene(studio, sceneNumber) {
  const all = generateSceneOutline(studio)
  return all.find((sc) => sc.sceneNumber === Number(sceneNumber)) || null
}

// ---- Prompt generation (pure, deterministic) ----

const NO_DIALOGUE_FORMATS = ['cinematic_product']

function pronouns(gender) {
  if (gender === 'female') return { subj: 'She', subjLow: 'she' }
  if (gender === 'male') return { subj: 'He', subjLow: 'he' }
  return { subj: 'They', subjLow: 'they' }
}

// The non-negotiable natural-pace tail, gender-adapted.
function naturalPaceTail(gender) {
  const pr = pronouns(gender)
  const verb = pr.subj === 'They' ? 'say' : 'says'
  const stay = pr.subj === 'They' ? 'stay' : 'stays'
  return `${pr.subj} ${verb} the line once at a natural pace — do not slow it down to fill time; after the line ${pr.subjLow} ${stay} silent with a natural expression.`
}

// Delivery cue per emotional beat. Delivery/gesture only — never appearance.
const DELIVERY_CUES = {
  curiosity: 'with a slight lean-in and an intrigued tone',
  frustration: 'with a tired, honest tone and a small head shake',
  tension: 'with a serious tone, slowing slightly on the key words',
  hope: 'with a softening tone, as if remembering the moment',
  relief: 'with an easing tone and relaxed shoulders',
  confidence: 'with a steady, assured tone and a small nod',
  satisfaction: 'with a warm, content tone',
  trust: 'with a calm, sincere tone, holding still after',
  reassurance: 'with a knowing half-smile in the voice',
  action: 'with a direct, energized tone',
  anticipation: 'with a curious, inviting tone'
}

function shortModelName(model) {
  if (model.indexOf('Omni') !== -1) return 'Gemini Omni Flash'
  return 'Seedance 2.0'
}

// Generate paste-ready prompts from a studio + its (possibly user-edited)
// scenes. Pure — same inputs, same outputs.
export function generateOmniPrompts(studio, scenes) {
  const s = normalizeStudio(studio)
  const format = formatById(s.format)
  if (!format || !Array.isArray(scenes)) return []
  const lang = studioLanguage(s)
  const isPodcast = isTwoCharacterFormat(format.id)
  const isVisualFormat = NO_DIALOGUE_FORMATS.includes(format.id)

  return scenes.map((scene) => {
    const num = Number(scene.sceneNumber) || 0
    const clipDuration = CLIP_DURATIONS.includes(Number(scene.clipDuration)) ? Number(scene.clipDuration) : durationForLine(scene.dialogueLine)
    const line = str(scene.dialogueLine).trim()
    const ch = characterById(scene.character)
    const gender = (ch && ch.gender) || ''
    const pr = pronouns(gender)
    const notes = []
    let model
    let promptText

    if (isVisualFormat) {
      // Product/visual clip: motion only — camera movement, product behavior,
      // atmosphere. Never the person. VO is recorded separately.
      model = 'Seedance 2.0'
      const motion = [
        str(scene.visualDescription).trim() || 'The product holds center frame',
        motionFor(scene.purpose)
      ].filter(Boolean).join('. ')
      promptText = `${motion}. No on-screen text, no people speaking.`
      if (line) {
        notes.push(`Voiceover (record separately, do not lip-sync): "${line}"`)
        notes.push(`${wordCount(line)} words — VO fits the selected clip length.`)
      }
      if (lang === 'fr') {
        notes.push('French VO: keep the voiceover French; the visual clip itself is language-neutral.')
      }
    } else {
      // Dialogue clip: Omni Flash. French dialogue is NEVER routed to Seedance.
      model = 'Gemini Omni Flash (Google Flow)'
      const verb = pr.subj === 'They' ? 'say' : 'says'
      const cue = DELIVERY_CUES[str(scene.emotionalBeat)] || 'with a natural conversational tone'
      const gaze = isPodcast
        ? `${pr.subj} looks toward the other speaker, not at the camera.`
        : `${pr.subj} speaks directly to the camera.`
      promptText = `${pr.subj} ${verb}: "${line}" — ${cue}. ${gaze} ${naturalPaceTail(gender)}`
      const n = wordCount(line)
      notes.push(`${n} words → ${clipDuration}s clip.`)
      if (n > 25) notes.push('Line exceeds 25 words — trim it or the clip will feel rushed.')
      if (format.id === 'french_podcast') notes.push('Use Gemini Omni Flash in Google Flow. Never Seedance for French.')
    }

    const setupHeader = `${shortModelName(model)} · ${format.aspectRatio} · select [${clipDuration}s] · attach Frame [${num}]`

    return {
      sceneNumber: num,
      model,
      promptText,
      setupHeader,
      attachFrame: `Frame ${num}`,
      duration: clipDuration,
      aspectRatio: format.aspectRatio,
      notes: notes.join(' ')
    }
  })
}

// Camera/product motion per cinematic purpose (atmosphere included, no people).
function motionFor(purpose) {
  const map = {
    hook: 'Slow push-in toward the product as the rim light brightens, fine dust particles drifting through the beam',
    cta: 'The product settles into final position as the backdrop light evens out, gentle camera drift to stillness',
    product_hero: 'Slow push-in toward the product as the rim light brightens, fine dust particles drifting through the beam',
    lifestyle: 'Slow lateral dolly across the scene, shallow focus breathing between foreground and the environment',
    product_reveal: 'The product rotates slowly into the light as the camera tilts up, shadows receding',
    macro_detail: 'Macro slider move across the surface texture, light catching each detail in turn',
    product_in_use: 'Locked-off top-down frame, hands enter to use the product naturally, steam or motion settling',
    end_card: 'The product settles into final position as the backdrop light evens out, gentle camera drift to stillness'
  }
  return map[purpose] || 'Slow, deliberate camera move with soft atmospheric light shifts'
}

// ---- Competitor analysis extraction (pure string parsing, no API) ----

// Pull labeled fields out of pasted competitor-breakdown text. Recognizes
// "Label: value" lines (EN + FR labels). Returns a patch + the studio field
// keys that were filled, so the UI can highlight them.
export function extractBriefFromText(text) {
  const raw = str(text)
  const lines = raw.split(/\r?\n/)
  const product = {}
  const brief = {}
  const filledKeys = []

  const grab = (re) => {
    for (const l of lines) {
      const m = re.exec(l)
      if (m && str(m[1]).trim()) return str(m[1]).trim().replace(/^[*_"']+|[*_"']+$/g, '')
    }
    return ''
  }

  const set = (obj, key, val, fullKey) => {
    if (!val) return
    obj[key] = val
    filledKeys.push(fullKey)
  }

  set(product, 'name', grab(/(?:product(?:\s*name)?|produit)\s*[:：]\s*(.+)/i), 'product.name')
  set(product, 'description', grab(/(?:description|what\s+it\s+is)\s*[:：]\s*(.+)/i), 'product.description')
  set(product, 'targetAudience', grab(/(?:target\s*audience|audience|cible|target)\s*[:：]\s*(.+)/i), 'product.targetAudience')
  set(product, 'keyIngredient', grab(/(?:key\s*)?(?:ingredient|ingr[ée]dient|mechanism|m[ée]canisme)\s*[:：]\s*(.+)/i), 'product.keyIngredient')
  set(product, 'claimBoundary', grab(/(?:claim(?:\s*boundar(?:y|ies))?|claims|compliance)\s*[:：]\s*(.+)/i), 'product.claimBoundary')
  set(product, 'landingPageUrl', grab(/(?:landing\s*page|url|link|lien)\s*[:：]\s*(https?:\/\/\S+)/i), 'product.landingPageUrl')

  const benefit = grab(/(?:key\s*benefit|benefit|b[ée]n[ée]fice)s?\s*[:：]\s*(.+)/i)
  if (benefit) {
    product.benefits = [benefit]
    filledKeys.push('product.benefits')
  }

  set(brief, 'hook', grab(/(?:hook|accroche)\s*[:：]\s*(.+)/i), 'brief.hook')
  set(brief, 'problem', grab(/(?:problem|probl[èe]me|pain(?:\s*point)?)\s*[:：]\s*(.+)/i), 'brief.problem')
  set(brief, 'solution', grab(/(?:solution|promise|promesse)\s*[:：]\s*(.+)/i), 'brief.solution')
  set(brief, 'cta', grab(/(?:cta|call\s*to\s*action|appel\s*[àa]\s*l[’']action)\s*[:：]\s*(.+)/i), 'brief.cta')
  set(brief, 'tone', grab(/(?:tone|ton)\s*[:：]\s*(.+)/i), 'brief.tone')

  // Category: match a known category word anywhere in the text.
  const lower = raw.toLowerCase()
  for (const cat of PRODUCT_CATEGORIES) {
    if (cat !== 'other' && lower.indexOf(cat.split(' ')[0]) !== -1) {
      product.category = cat
      filledKeys.push('product.category')
      break
    }
  }

  return { product, brief, filledKeys }
}

// ---- Export helpers (pure string builders) ----

export function modelsNeeded(prompts) {
  const seen = []
  for (const p of Array.isArray(prompts) ? prompts : []) {
    const m = shortModelName(str(p.model))
    if (seen.indexOf(m) === -1) seen.push(m)
  }
  return seen
}

export function totalPromptDuration(prompts) {
  return (Array.isArray(prompts) ? prompts : []).reduce((acc, p) => acc + (Number(p.duration) || 0), 0)
}

// Paste-ready clipboard text: setup header + prompt per clip, ---- separated.
export function buildCopyAllText(prompts) {
  return (Array.isArray(prompts) ? prompts : [])
    .map((p) => `${p.setupHeader}\n${p.promptText}${p.notes ? `\n(Notes: ${p.notes})` : ''}`)
    .join('\n----\n')
}

// Full production package markdown (omni-v51 style): brief summary, scene
// outline table, then one block per prompt.
export function buildStudioMarkdown(studio, scenes, prompts) {
  const s = normalizeStudio(studio)
  const format = formatById(s.format)
  const lang = studioLanguage(s)
  const out = []
  const title = str(s.product.name).trim() || 'Untitled Product'

  out.push(`# ${title} — Marketing Studio Package`, '')
  out.push('> Generated locally by the Animated Ad Factory Marketing Studio. Paste-ready prompts — no API was called.', '')

  out.push('## Product Brief Summary', '')
  out.push(`- **Product:** ${title}`)
  if (s.product.description) out.push(`- **Description:** ${s.product.description}`)
  if (s.product.benefits.length) out.push(`- **Benefits:** ${s.product.benefits.join('; ')}`)
  if (s.product.targetAudience) out.push(`- **Target audience:** ${s.product.targetAudience}`)
  if (s.product.keyIngredient) out.push(`- **Key ingredient / mechanism:** ${s.product.keyIngredient}`)
  if (s.product.claimBoundary) out.push(`- **Claim boundary:** ${s.product.claimBoundary}`)
  if (s.product.category) out.push(`- **Category:** ${s.product.category}`)
  if (s.product.landingPageUrl) out.push(`- **Landing page:** ${s.product.landingPageUrl}`)
  out.push(`- **Language:** ${lang.toUpperCase()}`)
  out.push(`- **Target ad duration:** ${s.brief.duration}s`)
  if (format) out.push(`- **Format:** ${format.name} (${format.aspectRatio}, ${format.style})`)
  const cast = s.characters.map((id) => { const c = characterById(id); return c ? c.name : id }).filter(Boolean)
  if (cast.length) out.push(`- **Characters:** ${cast.join(' + ')}`)
  out.push('')

  const sceneList = Array.isArray(scenes) ? scenes : []
  out.push('## Scene Outline', '')
  if (sceneList.length) {
    const cell = (v) => str(v).replace(/\|/g, '\\|').replace(/\n+/g, ' ')
    out.push('| # | Clip | Purpose | Shot | Beat | Line |', '| --- | --- | --- | --- | --- | --- |')
    for (const sc of sceneList) {
      out.push(`| ${sc.sceneNumber} | ${sc.clipDuration}s | ${cell(purposeLabel(sc.purpose))} | ${cell(sc.shotType)} | ${cell(sc.emotionalBeat)} | ${cell(sc.dialogueLine)} |`)
    }
    out.push('')
    out.push(`**Total estimated duration:** ${sceneList.reduce((a, sc) => a + (Number(sc.clipDuration) || 0), 0)}s (target ${s.brief.duration}s)`, '')
  } else {
    out.push('_(no scenes)_', '')
  }

  const promptList = Array.isArray(prompts) ? prompts : []
  out.push('## Prompts', '')
  if (promptList.length) {
    out.push(`Models needed: ${modelsNeeded(promptList).join(', ') || '—'}`, '')
    for (const p of promptList) {
      out.push(`### Clip ${p.sceneNumber}`, '')
      out.push('```text')
      out.push(p.setupHeader)
      out.push('')
      out.push(p.promptText)
      out.push('```')
      if (p.notes) out.push('', `_Notes: ${p.notes}_`)
      out.push('')
    }
  } else {
    out.push('_(no prompts generated)_', '')
  }

  out.push('## Production Checklist', '')
  out.push('- [ ] One frame per scene attached before generating (the frame carries identity and appearance).')
  out.push('- [ ] Duration selected in the tool UI — never written into the prompt text.')
  out.push('- [ ] Dialogue clips: line said once at a natural pace; silence after.')
  if (isTwoCharacterFormat(s.format)) out.push('- [ ] Podcast gaze: each speaker looks toward the other person, not the camera.')
  if (lang === 'fr') out.push('- [ ] French dialogue stays on Gemini Omni Flash (Google Flow) — never Seedance.')
  out.push('- [ ] Finish with the CapCut realism layer before publishing.')
  out.push('')

  return out.join('\n')
}
