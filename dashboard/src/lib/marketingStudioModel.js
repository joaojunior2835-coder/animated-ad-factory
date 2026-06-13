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
export const FORMAT_CATEGORIES = ['UGC', 'French', 'Cinematic']

export const FORMATS = [
  {
    id: 'ugc_talking_head',
    name: 'UGC Talking Head',
    description: '1 person speaking to camera',
    icon: '🎤',
    category: 'UGC',
    clipCount: 6,
    clipRange: '6-8',
    aspectRatio: '9:16',
    style: 'authentic/raw',
    examples: [
      'Scene 1: Creator holds product, speaks directly to camera',
      'Scene 3: Close-up of product texture/application',
      'Scene 6: Creator shares final result with big smile'
    ]
  },
  {
    id: 'ugc_podcast',
    name: 'UGC Podcast',
    description: '2-person podcast format',
    icon: '🎙️',
    category: 'UGC',
    clipCount: 10,
    clipRange: '8-12',
    aspectRatio: '9:16',
    style: 'conversational',
    examples: [
      'Scene 1: Host introduces guest and product topic',
      'Scene 5: Guest shares personal experience with the product',
      'Scene 10: Both agree on final recommendation'
    ]
  },
  {
    id: 'cinematic_product',
    name: 'Cinematic Product',
    description: 'Product hero shots + voiceover',
    icon: '🎥',
    category: 'Cinematic',
    clipCount: 7,
    clipRange: '6-8',
    aspectRatio: '16:9',
    style: 'cinematic',
    examples: [
      'Scene 1: Product hero shot — macro texture detail',
      'Scene 3: Ingredient origin story — nature footage',
      'Scene 6: Lifestyle shot — person in aspirational setting'
    ]
  },
  {
    id: 'ugc_testimonial',
    name: 'UGC Testimonial',
    description: 'Problem→solution story arc',
    icon: '💬',
    category: 'UGC',
    clipCount: 7,
    clipRange: '6-8',
    aspectRatio: '9:16',
    style: 'authentic/raw',
    examples: [
      'Scene 1: Person admits the problem they had',
      'Scene 3: Discovery moment — finding the product',
      'Scene 7: Life after using the product for 30 days'
    ]
  },
  {
    id: 'french_podcast',
    name: 'French Podcast (Omni)',
    description: '2-person French language podcast',
    icon: '🇫🇷',
    category: 'French',
    clipCount: 10,
    clipRange: '8-12',
    aspectRatio: '9:16',
    style: 'conversational/french',
    note: 'Use Gemini Omni Flash in Google Flow. Never Seedance for French.',
    examples: [
      'Scene 1: Host asks guest about their experience with the product',
      'Scene 4: Guest reveals the result after 2 weeks of use',
      'Scene 8: Both hosts give their final verdict to camera'
    ]
  },
  {
    id: 'unboxing',
    name: 'Unboxing / First Reaction',
    description: 'Person opens the product on camera',
    icon: '📦',
    category: 'UGC',
    clipCount: 7,
    clipRange: '6-8',
    aspectRatio: '9:16',
    style: 'authentic/raw',
    note: 'Scene 1: closed box. Scene 2: open reveal. Scene 3-N: reactions.',
    examples: [
      'Scene 1: Closed box on clean surface, hands visible',
      'Scene 2: Box opening, tissue paper reveal',
      'Scene 5: First application reaction'
    ]
  },
  {
    id: 'tutorial',
    name: 'Tutorial / How To',
    description: 'Step-by-step product use demonstration',
    icon: '🧭',
    category: 'UGC',
    clipCount: 9,
    clipRange: '8-10',
    aspectRatio: '9:16',
    style: 'educational',
    note: 'Each scene = one step. Keep instructions simple and visual.',
    examples: [
      'Scene 1: Quick result reveal (hook)',
      'Scene 3: Step 2 — apply to affected area',
      'Scene 7: Before/after comparison'
    ]
  },
  {
    id: 'product_review',
    name: 'Product Review',
    description: 'Honest review format with pros/cons',
    icon: '⭐',
    category: 'UGC',
    clipCount: 7,
    clipRange: '6-8',
    aspectRatio: '9:16',
    style: 'authentic/raw',
    note: 'Scene 1: hook/verdict. Scenes 2-N: reasons. Last: CTA.',
    examples: [
      'Scene 1: Verdict first — "Here’s my honest take after 30 days"',
      'Scene 3: The one thing I wish was different',
      'Scene 6: Who I\'d recommend this to'
    ]
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
    tags: ['ugc', 'talking-head', 'direct-camera'],
    avatar: '👩‍💼',
    personality: 'Direct, confident, results-focused',
    exampleLine: 'Ce produit a littéralement changé ma peau en deux semaines.',
    bestFormats: ['ugc_talking_head', 'ugc_testimonial', 'french_podcast']
  },
  {
    id: 'friendly_man_fr',
    name: 'Friendly Man (FR)',
    description: 'French-speaking friendly man, 30-40, warm approachable energy',
    gender: 'male',
    style: 'warm/friendly',
    language: 'fr',
    tags: ['ugc', 'talking-head', 'warm'],
    avatar: '👨‍🦱',
    personality: 'Warm, relatable, conversational',
    exampleLine: "Je suis quelqu'un de sceptique, mais là j'ai été bluffé.",
    bestFormats: ['french_podcast', 'ugc_talking_head', 'product_review']
  },
  {
    id: 'expert_woman_en',
    name: 'Expert Woman (EN)',
    description: 'English-speaking expert woman, calm authority tone, explains clearly',
    gender: 'female',
    style: 'expert/authority',
    language: 'en',
    tags: ['expert', 'authority', 'explainer'],
    avatar: '👩‍🔬',
    personality: 'Authoritative, clear, trustworthy',
    exampleLine: 'The clinical evidence behind this ingredient is compelling.',
    bestFormats: ['tutorial', 'cinematic_product', 'product_review']
  },
  {
    id: 'young_woman_ugc',
    name: 'Young Woman (UGC)',
    description: 'Gen-Z UGC style woman, casual spontaneous energy, feels like a friend talking',
    gender: 'female',
    style: 'casual/gen-z',
    language: 'en',
    tags: ['ugc', 'gen-z', 'casual'],
    avatar: '🤳',
    personality: 'Casual, energetic, Gen-Z authentic',
    exampleLine: 'okay so I was NOT expecting this to actually work but...',
    bestFormats: ['ugc_talking_head', 'unboxing', 'ugc_testimonial']
  },
  {
    id: 'podcast_host_fr',
    name: 'Podcast Host (FR)',
    description: 'French podcast host, professional but warm, guides the conversation',
    gender: 'male',
    style: 'professional/warm',
    language: 'fr',
    tags: ['podcast', 'host', 'interviewer'],
    avatar: '🎙️',
    personality: 'Professional, curious, warm host energy',
    exampleLine: "Alors dis-moi, comment tu as découvert ce produit ?",
    bestFormats: ['french_podcast', 'ugc_podcast']
  },
  {
    id: 'podcast_guest_fr',
    name: 'Podcast Guest (FR)',
    description: 'French podcast guest, curious and engaged, shares a personal discovery',
    gender: 'female',
    style: 'curious/engaged',
    language: 'fr',
    tags: ['podcast', 'guest', 'storyteller'],
    avatar: '🗣️',
    personality: 'Genuine, slightly nervous, real reactions',
    exampleLine: "Franchement au début j'étais pas convaincu du tout...",
    bestFormats: ['french_podcast', 'ugc_podcast']
  },
  {
    id: 'testimonial_woman',
    name: 'Testimonial Woman',
    description: 'Relatable testimonial woman, problem-aware, tells her before/after story',
    gender: 'female',
    style: 'relatable/honest',
    language: 'fr',
    tags: ['testimonial', 'story', 'relatable'],
    avatar: '🙋‍♀️',
    personality: 'Relatable, honest, problem-aware',
    exampleLine: 'I tried everything and nothing worked until I found this.',
    bestFormats: ['ugc_testimonial', 'product_review', 'ugc_talking_head']
  },
  {
    id: 'testimonial_man',
    name: 'Testimonial Man',
    description: 'Relatable testimonial man, solution-focused, practical tone',
    gender: 'male',
    style: 'practical/positive',
    language: 'fr',
    tags: ['testimonial', 'story', 'practical'],
    avatar: '🙋‍♂️',
    personality: 'Skeptic turned believer, down to earth',
    exampleLine: 'My wife convinced me to try it. Best decision I made.',
    bestFormats: ['ugc_testimonial', 'product_review', 'ugc_talking_head']
  }
]

// localStorage key for custom characters (Tier 2)
// Accent-insensitive search normalization: "apres" matches "Après".
export function searchNorm(s) {
  return str(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
}

// Best default characters per format (FIX 2). Applied on format selection
// unless the user has manually picked characters.
export function getDefaultCharactersForFormat(formatId) {
  const map = {
    french_podcast: ['podcast_host_fr', 'podcast_guest_fr'],
    ugc_podcast: ['podcast_host_fr', 'podcast_guest_fr'],
    ugc_talking_head: ['confident_woman_fr'],
    ugc_testimonial: ['testimonial_woman'],
    cinematic_product: ['expert_woman_en'],
    unboxing: ['young_woman_ugc'],
    tutorial: ['expert_woman_en'],
    product_review: ['friendly_man_fr']
  }
  return map[formatId] || []
}

export function inferStudioFromQuickPrompt(text, language) {
  try {
    const raw = str(text).trim()
    const lower = searchNorm(raw)
    const inferredLanguage = /\b(francais|french|fr)\b/.test(lower) ? 'fr' : (language === 'fr' ? 'fr' : 'en')
    const formatId =
      lower.includes('podcast') ? (inferredLanguage === 'fr' ? 'french_podcast' : 'ugc_podcast') :
      /\b(temoignage|testimonial)\b/.test(lower) ? 'ugc_testimonial' :
      /\b(tutoriel|tutorial)\b/.test(lower) ? 'tutorial' :
      lower.includes('unboxing') ? 'unboxing' :
      /\b(cinematique|cinematic)\b/.test(lower) ? 'cinematic_product' :
      'ugc_talking_head'
    const segments = raw.split(',').map((part) => part.trim()).filter(Boolean)
    const first = segments[0] || ''
    const quoted = raw.match(/["'“”]([^"'“”]+)["'“”]/)
    const afterFor = first.match(/\b(?:pour|for)\s+([A-ZÀ-ÖØ-Ý][\wÀ-ÿ-]*)/)
    const proper = raw.match(/\b[A-ZÀ-ÖØ-Ý][\wÀ-ÿ-]{2,}\b/g)
    const ignored = /^(Podcast|English|French|UGC|Témoignage|Temoignage|Tutoriel|Tutorial|Unboxing)$/i
    const name = (quoted && quoted[1]) || (afterFor && afterFor[1]) || ((proper || []).find((word) => !ignored.test(word))) || 'Untitled Product'
    const labeled = (labels) => {
      const re = new RegExp(`^(?:${labels})\\s+(.+)$`, 'i')
      const segment = segments.find((part) => re.test(searchNorm(part)))
      return segment ? searchNorm(segment).match(re)[1].trim() : ''
    }
    const targetAudience = labeled('cible|target(?: audience)?')
    const keyIngredient = labeled('ingredient|ingredient cle|key ingredient')
    const tone = labeled('ton|tone') || 'authentic'
    const durationMatch = lower.match(/\b(\d+)\s*(?:s|sec|seconds?|secondes?)\b/)
    const durationRaw = durationMatch ? Number(durationMatch[1]) : 30
    const duration = STUDIO_DURATIONS.includes(durationRaw) ? durationRaw : 30
    const descriptionParts = segments.filter((part) =>
      !new RegExp(`^(?:cible|target(?: audience)?|ingredient|ingrédient|ton|tone)\\b`, 'i').test(part)
    )
    const description = descriptionParts.join(', ').replace(name, '').replace(/\s{2,}/g, ' ').replace(/^[\s,;-]+|[\s,;-]+$/g, '') || `${name} product ad`
    const studio = normalizeStudio({
      product: { name, description, targetAudience, keyIngredient },
      brief: { language: inferredLanguage, duration, tone },
      format: formatId,
      characters: getDefaultCharactersForFormat(formatId)
    })
    return { ...studio, scenes: generateSceneOutline(studio), status: 'brief_ready' }
  } catch {
    const studio = normalizeStudio({
      product: { name: 'Untitled Product', description: 'Product advertisement' },
      brief: { language: language === 'fr' ? 'fr' : 'en', duration: 30, tone: 'authentic' },
      format: 'ugc_talking_head',
      characters: getDefaultCharactersForFormat('ugc_talking_head')
    })
    return { ...studio, scenes: generateSceneOutline(studio), status: 'brief_ready' }
  }
}

export const CUSTOM_CHARACTERS_KEY = 'aaf_custom_characters'

export function loadCustomCharacters() {
  try {
    const raw = localStorage.getItem(CUSTOM_CHARACTERS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function saveCustomCharacters(chars) {
  try {
    localStorage.setItem(CUSTOM_CHARACTERS_KEY, JSON.stringify(Array.isArray(chars) ? chars : []))
  } catch {
    // Non-fatal.
  }
}

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

// ---- Settings / scene library (where the story unfolds) ----
export const SETTINGS_LIBRARY = [
  // Indoor
  { id: 'bedroom_morning', name: 'Bedroom Morning', description: 'Bedroom, morning light, warm and intimate', visualMood: 'warm and intimate morning mood', lightingNote: 'soft morning window light', tags: ['indoor', 'ugc', 'cozy'] },
  { id: 'minimalist_kitchen', name: 'Minimalist Kitchen', description: 'Clean kitchen, natural light, fresh/healthy mood', visualMood: 'fresh, healthy, uncluttered mood', lightingNote: 'bright natural daylight on clean surfaces', tags: ['indoor', 'food', 'wellness'] },
  { id: 'bathroom_mirror', name: 'Bathroom Mirror', description: 'Bathroom mirror, soft light, personal/vulnerable', visualMood: 'personal, vulnerable, honest mood', lightingNote: 'soft vanity light around the mirror', tags: ['indoor', 'skincare', 'personal'] },
  { id: 'home_office', name: 'Home Office', description: 'Home office, focused energy, productive mood', visualMood: 'focused, productive energy', lightingNote: 'desk lamp glow with soft daylight fill', tags: ['indoor', 'work'] },
  { id: 'cozy_sofa', name: 'Cozy Sofa', description: 'Living room sofa, warm evening light, relaxed', visualMood: 'relaxed, end-of-day comfort', lightingNote: 'warm evening lamp light', tags: ['indoor', 'ugc', 'cozy'] },
  // Outdoor
  { id: 'golden_hour_park', name: 'Golden Hour Park', description: 'Park at golden hour, warm backlight, aspirational', visualMood: 'aspirational, glowing, optimistic mood', lightingNote: 'warm golden-hour backlight', tags: ['outdoor', 'lifestyle'] },
  { id: 'urban_street', name: 'Urban Street', description: 'City street, dynamic energy, modern lifestyle', visualMood: 'dynamic, modern street energy', lightingNote: 'open daylight with storefront bounce', tags: ['outdoor', 'city'] },
  { id: 'rooftop_city', name: 'Rooftop City View', description: 'Rooftop with city view, ambitious/elevated mood', visualMood: 'ambitious, elevated mood above the skyline', lightingNote: 'clear sky light, city haze in the background', tags: ['outdoor', 'city', 'premium'] },
  { id: 'beach_morning', name: 'Beach Morning', description: 'Beach at sunrise, fresh start energy', visualMood: 'fresh-start, clean-slate energy', lightingNote: 'pale sunrise light off the water', tags: ['outdoor', 'wellness'] },
  { id: 'cafe_terrace', name: 'Café Terrace', description: 'Outdoor café terrace, European lifestyle feel', visualMood: 'unhurried European lifestyle feel', lightingNote: 'dappled daylight under an awning', tags: ['outdoor', 'lifestyle', 'french'] },
  // Studio / neutral
  { id: 'clean_white_studio', name: 'Clean White Studio', description: 'White background, product-focused, clinical trust', visualMood: 'product-focused, clinical trust', lightingNote: 'even shadowless studio light on white', tags: ['studio', 'product'] },
  { id: 'dark_moody_studio', name: 'Dark Moody Studio', description: 'Dark background, luxury/premium feel', visualMood: 'luxury, premium restraint', lightingNote: 'hard rim light against deep shadow', tags: ['studio', 'premium'] },
  { id: 'gradient_studio', name: 'Gradient Studio', description: 'Soft gradient background, modern/tech feel', visualMood: 'modern, techy calm', lightingNote: 'soft diffused light over a gradient backdrop', tags: ['studio', 'tech'] },
  // Special
  { id: 'podcast_setup', name: 'Podcast Setup', description: 'Two chairs facing slightly inward, mic visible, professional but warm', visualMood: 'professional but warm conversation mood', lightingNote: 'warm key light per speaker, soft background falloff', tags: ['special', 'podcast'] },
  { id: 'gym_locker', name: 'Gym Locker Room', description: 'Gym locker room, fitness/transformation context', visualMood: 'fitness, transformation context', lightingNote: 'bright overhead gym lighting', tags: ['special', 'fitness'] }
]

export function settingById(id) {
  return SETTINGS_LIBRARY.find((s) => s.id === id) || null
}

// Default scene setting per format (auto-selected when the outline generates).
export function defaultSettingForFormat(formatId) {
  const map = {
    ugc_talking_head: 'cozy_sofa',
    ugc_testimonial: 'bedroom_morning',
    ugc_podcast: 'podcast_setup',
    french_podcast: 'podcast_setup',
    cinematic_product: 'clean_white_studio',
    unboxing: 'cozy_sofa',
    tutorial: 'minimalist_kitchen',
    product_review: 'cozy_sofa'
  }
  return map[formatId] || 'clean_white_studio'
}

// Append a setting's mood + lighting to a scene's visual description (idempotent
// enough for UI use: strips a previously applied setting suffix first).
const SETTING_SUFFIX_RE = / \[Setting: [^\]]*\]$/
export function applySettingToDescription(description, settingId) {
  const setting = settingById(settingId)
  const base = str(description).replace(SETTING_SUFFIX_RE, '').trim()
  if (!setting) return base
  return `${base} [Setting: ${setting.name} — ${setting.visualMood}; ${setting.lightingNote}]`
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

// ---- Output settings (Tier 1) ----
export const ASPECT_OPTIONS = ['9:16', '16:9', '1:1', '4:3']
export const QUALITY_HINTS = ['Standard', 'High', 'Maximum']
export const PLATFORMS = [
  { id: 'tiktok', name: 'TikTok', aspectRatio: '9:16' },
  { id: 'instagram_reels', name: 'Instagram Reels', aspectRatio: '9:16' },
  { id: 'instagram_feed', name: 'Instagram Feed', aspectRatio: '1:1' },
  { id: 'youtube_shorts', name: 'YouTube Shorts', aspectRatio: '9:16' },
  { id: 'youtube', name: 'YouTube', aspectRatio: '16:9' },
  { id: 'facebook', name: 'Facebook', aspectRatio: '16:9' }
]

export function platformById(id) {
  return PLATFORMS.find((p) => p.id === id) || null
}

// The aspect ratio every prompt uses: studio override wins, else format default.
export function effectiveAspectRatio(studio) {
  const s = normalizeStudio(studio)
  if (s.output.aspectRatio) return s.output.aspectRatio
  const format = formatById(s.format)
  return format ? format.aspectRatio : '9:16'
}

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
    charactersManual: false,
    brief: {
      hook: '',
      problem: '',
      solution: '',
      cta: '',
      tone: '',
      language: 'fr',
      duration: 30
    },
    output: {
      aspectRatio: '',
      qualityHint: 'Standard',
      platform: ''
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
    charactersManual: !!d.charactersManual,
    brief: {
      hook: str(b.hook),
      problem: str(b.problem),
      solution: str(b.solution),
      cta: str(b.cta),
      tone: str(b.tone),
      language: b.language === 'en' ? 'en' : 'fr',
      duration: STUDIO_DURATIONS.includes(duration) ? duration : 30
    },
    output: (() => {
      const o = d.output && typeof d.output === 'object' ? d.output : {}
      return {
        aspectRatio: ASPECT_OPTIONS.includes(o.aspectRatio) ? o.aspectRatio : '',
        qualityHint: QUALITY_HINTS.includes(o.qualityHint) ? o.qualityHint : 'Standard',
        platform: PLATFORMS.some((p) => p.id === o.platform) ? o.platform : ''
      }
    })(),
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

// A hook must be ONE punchy line (FIX 3): first sentence only, max 15 words.
export function clampHookLine(line) {
  const first = str(line).trim().split(/(?<=[.!?…])\s+/)[0] || ''
  const words = first.split(/\s+/).filter(Boolean)
  if (words.length <= 15) return first
  return words.slice(0, 15).join(' ').replace(/[,;:]?$/, '') + '…'
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
    case 'hook': {
      const h = clampHookLine(b.hook)
      return h || t(lang, `Personne ne vous a dit la vérité sur ${name}.`, `Nobody told you the truth about ${name}.`)
    }
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
    // Unboxing beats
    case 'unbox_open':
      return t(lang, `Ça vient d’arriver — on ouvre ${name} ensemble.`, `It just arrived — let’s open ${name} together.`)
    case 'unbox_reaction':
      return t(lang, 'Honnêtement ? C’est encore mieux que sur les photos.', 'Honestly? It’s even better than the photos.')
    // Review beats
    case 'review_verdict': {
      const h = clampHookLine(b.hook)
      return h || t(lang, `Mon avis honnête sur ${name}, après un mois complet.`, `My honest review of ${name}, after a full month.`)
    }
    case 'review_con':
      return t(lang, 'Le seul vrai bémol : il faut être régulier pour voir l’effet.', 'The one real downside: you have to be consistent to see results.')
    // Podcast-specific conversational beats
    case 'podcast_hook': {
      const h = clampHookLine(b.hook)
      return h || t(lang, `Aujourd’hui on parle d’un sujet que tout le monde évite.`, 'Today we’re talking about a topic everyone avoids.')
    }
    // New podcast arc beats (reverse-chronology hook → endorsement)
    case 'podcast_result_hook': {
      const h = clampHookLine(b.hook)
      return h || t(lang, `Trois semaines avec ${name}, et mes soirées ont complètement changé.`, `Three weeks with ${name}, and my evenings completely changed.`)
    }
    case 'podcast_intro':
      return t(lang, `Bienvenue ! Aujourd’hui on parle de ${name}, avec quelqu’un qui l’utilise vraiment.`, `Welcome back! Today we’re talking about ${name}, with someone who actually uses it.`)
    case 'podcast_empathy':
      return t(lang, 'Attends — je ne savais pas que c’était à ce point. Vraiment tous les soirs ?', 'Wait — I had no idea it was that bad. Really, every single night?')
    case 'podcast_discovery_q':
      return t(lang, `Et comment tu as découvert ${name}, alors ?`, `So how did you even find ${name}?`)
    case 'podcast_skeptic':
      return t(lang, 'Honnêtement, j’étais sceptique. J’ai essayé un soir, sans y croire du tout.', 'Honestly, I was skeptical. I tried it one evening without believing in it at all.')
    case 'podcast_turn':
      return t(lang, 'Au bout d’une dizaine de jours, quelque chose avait changé dans mes soirées.', 'After about ten days, something had changed about my evenings.')
    case 'podcast_result':
      return benefit
        ? t(lang, `Concrètement : ${benefit}. Et ça, ça change tout.`, `Concretely: ${benefit}. And that changes everything.`)
        : ingredient
          ? t(lang, `Le soir je décroche enfin — ${ingredient} m’aide vraiment à lâcher prise.`, `In the evening I finally switch off — ${ingredient} really helps me let go.`)
          : t(lang, 'Le soir, je suis enfin tranquille. Plus cette bataille permanente.', 'In the evening, I’m finally at peace. No more constant battle.')
    case 'podcast_host_endorse':
      return t(lang, 'Du coup j’ai testé aussi — et franchement, je comprends pourquoi tu en parles.', 'So I tried it too — and honestly, now I get why you talk about it.')
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
    // Testimonial arc beats
    case 'testimonial_before':
      return str(b.problem).trim() || t(lang, audience ? `Si vous êtes ${audience}, vous savez à quel point c’était dur.` : 'Avant, chaque soirée finissait pareil — et j’avais honte d’en parler.', audience ? `If you're ${audience}, you know how hard it was.` : 'Before, every evening ended the same way — and I was ashamed to talk about it.')
    case 'testimonial_search':
      return t(lang, 'J’ai tout essayé : les tisanes, les applis, la volonté. Rien ne tenait.', 'I tried everything: teas, apps, willpower. Nothing stuck.')
    case 'testimonial_experience':
      return ingredient
        ? t(lang, `Le rituel est simple, et ${ingredient} fait la différence soir après soir.`, `The ritual is simple, and ${ingredient} makes the difference night after night.`)
        : t(lang, 'Le rituel est devenu un moment que j’attends, pas une contrainte.', 'The ritual became a moment I look forward to, not a chore.')
    case 'testimonial_result':
      return t(lang, 'Trente jours plus tard : mes soirées sont à moi de nouveau.', 'Thirty days later: my evenings are mine again.')
    case 'testimonial_cta':
      return str(b.cta).trim() || t(lang, audience ? `Si vous êtes ${audience}, ${name} est fait pour vous. Lien en dessous.` : `${name} est fait pour vous si vos soirées vous échappent. Lien en dessous.`, audience ? `If you're ${audience}, ${name} is made for you. Link below.` : `${name} is for you if your evenings keep slipping away. Link below.`)
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
  podcast_result_hook: 'curiosity',
  podcast_intro: 'anticipation',
  podcast_empathy: 'hope',
  podcast_discovery_q: 'curiosity',
  podcast_skeptic: 'reassurance',
  podcast_turn: 'hope',
  podcast_result: 'satisfaction',
  podcast_host_endorse: 'trust',
  testimonial_before: 'frustration',
  testimonial_search: 'tension',
  testimonial_experience: 'relief',
  testimonial_result: 'satisfaction',
  testimonial_cta: 'action',
  unbox_open: 'anticipation',
  unbox_reaction: 'satisfaction',
  review_verdict: 'trust',
  review_con: 'reassurance',
  tutorial_step: 'confidence',
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
    podcast_result_hook: 'Hook (Result First)',
    podcast_intro: 'Host Intro',
    podcast_empathy: 'Host Reaction',
    podcast_discovery_q: 'Discovery Question',
    podcast_skeptic: 'First Impression',
    podcast_turn: 'The Turn',
    podcast_result: 'Result',
    podcast_host_endorse: 'Host Endorsement',
    testimonial_before: 'The Before',
    testimonial_search: 'The Search',
    testimonial_experience: 'The Experience',
    testimonial_result: 'The Result',
    testimonial_cta: 'CTA (Who It’s For)',
    unbox_open: 'Open / Reveal',
    unbox_reaction: 'First Reaction',
    review_verdict: 'Verdict',
    review_con: 'Honest Con',
    tutorial_step: 'Step',
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
  const scenes = buildSceneOutline(studio)
  const s = normalizeStudio(studio)
  const settingId = defaultSettingForFormat(s.format)
  return scenes.map((sc) => ({
    ...sc,
    settingId,
    visualDescription: applySettingToDescription(sc.visualDescription, settingId)
  }))
}

function buildSceneOutline(studio) {
  const s = normalizeStudio(studio)
  const format = formatById(s.format)
  if (!format) return []
  const lang = studioLanguage(s)
  const chars = s.characters
  const c1 = chars[0] || ''
  const c2 = chars[1] || c1

  if (format.id === 'ugc_talking_head') {
    // 6-scene arc: hook → problem → discovery → mechanism → proof → CTA.
    const baseVisual = 'Mid-shot, speaker centered, phone-camera framing. Natural daylight from a window, lived-in room behind.'
    const arc = ['hook', 'problem', 'discovery', 'mechanism', 'proof', 'cta']
    return arc.slice(0, format.clipCount).map((purpose, i) => {
      const sc = speakerScene(i + 1, purpose, c1, s, lang, baseVisual)
      if (purpose === 'hook') {
        sc.shotType = 'talking head — product held at chest height'
        sc.visualDescription = 'Mid-shot, speaker centered, product held up at chest height. The speaker freezes a beat before the line lands. Natural daylight.'
      } else {
        sc.shotType = 'talking head — static camera, mid-shot'
      }
      return sc
    })
  }

  if (format.id === 'ugc_testimonial') {
    // 7-scene arc: verdict first, then the story earns it.
    const baseVisual = 'Mid-shot, lived-in room, soft window light. Handheld phone framing with slight natural movement.'
    const arc = ['hook', 'testimonial_before', 'testimonial_search', 'discovery', 'testimonial_experience', 'testimonial_result', 'testimonial_cta']
    return arc.slice(0, format.clipCount).map((purpose, i) => {
      const sc = speakerScene(i + 1, purpose, c1, s, lang, baseVisual)
      sc.shotType = 'testimonial — handheld mid-shot, eye level'
      return sc
    })
  }

  if (format.id === 'ugc_podcast' || format.id === 'french_podcast') {
    // Reverse-chronology podcast arc: the guest gives the RESULT first, then
    // the conversation earns it. Explicit speaker map (host = c1, guest = c2).
    const slots = [
      ['podcast_result_hook', 'guest'], // 1 — result first
      ['podcast_intro', 'host'], // 2 — welcome + topic
      ['podcast_problem', 'guest'], // 3 — the problem
      ['podcast_empathy', 'host'], // 4 — "I had no idea"
      ['podcast_discovery_q', 'host'], // 5 — how did you find it?
      ['podcast_skeptic', 'guest'], // 6 — skepticism, first try
      ['podcast_turn', 'guest'], // 7 — something changed
      ['podcast_result', 'guest'], // 8 — concrete result
      ['podcast_host_endorse', 'host'], // 9 — host tried it too
      ['cta', 'host'] // 10 — direct recommendation
    ]
    const guestVisual = 'Two-shot at the podcast desk, both speakers visible. The host leans slightly toward the guest as the guest speaks. Warm key light per speaker, soft background falloff. Static camera.'
    const hostVisual = 'Two-shot at the podcast desk, both speakers visible. The guest listens and nods naturally as the host speaks. Warm podcast lighting, mics in frame. Static camera.'
    return slots.slice(0, format.clipCount).map(([purpose, role], i) => {
      const speaker = role === 'host' ? c1 : c2
      const sc = speakerScene(i + 1, purpose, speaker, s, lang, role === 'host' ? hostVisual : guestVisual)
      sc.shotType = `podcast two-shot — ${role} speaking, static camera`
      return sc
    })
  }

  if (format.id === 'unboxing') {
    const setting = 'Desk or table with the sealed delivery box, handheld UGC framing'
    const arc = ['hook', 'unbox_open', 'unbox_reaction', 'benefit', 'mechanism', 'proof', 'cta']
    return arc.slice(0, format.clipCount).map((purpose, i) => {
      const sc = speakerScene(i + 1, purpose, c1, s, lang, setting)
      if (purpose === 'hook') sc.shotType = 'talking head — sealed box held up to camera'
      if (purpose === 'unbox_open') sc.shotType = 'close-up — hands opening the box'
      if (purpose === 'unbox_reaction') sc.shotType = 'talking head — product in hand, first look'
      return sc
    })
  }

  if (format.id === 'tutorial') {
    const setting = 'Clean work surface, product and tools laid out, top-light'
    const name = str(s.product.name).trim() || t(lang, 'le produit', 'the product')
    const frSteps = [
      `Première étape : on prépare ${name}, ça prend trente secondes.`,
      'Ensuite, on suit la dose indiquée — pas plus, pas moins.',
      'Étape trois : on mélange doucement et on laisse agir.',
      'Le geste qui change tout, c’est la régularité, chaque jour.',
      'Étape cinq : on l’intègre dans la routine du soir.',
      'Petit conseil : préparez tout à l’avance, c’est plus simple.',
      'Dernière étape : on observe la différence semaine après semaine.'
    ]
    const enSteps = [
      `Step one: get ${name} ready — it takes thirty seconds.`,
      'Next, follow the indicated dose — no more, no less.',
      'Step three: mix it gently and let it work.',
      'The move that changes everything is doing it daily.',
      'Step five: build it into your evening routine.',
      'Quick tip: prepare everything ahead — it’s much easier.',
      'Last step: watch the difference build week after week.'
    ]
    const stepCount = format.clipCount - 2
    const scenes = [speakerScene(1, 'hook', c1, s, lang, setting)]
    for (let i = 0; i < stepCount; i++) {
      const line = t(lang, frSteps[i % frSteps.length], enSteps[i % enSteps.length])
      const clipDuration = durationForLine(line)
      scenes.push({
        sceneNumber: i + 2,
        duration: clipDuration,
        purpose: 'tutorial_step',
        shotType: 'demo shot — hands and product, instructive framing',
        character: c1,
        dialogueLine: line,
        visualDescription: setting,
        emotionalBeat: EMOTIONAL_BEATS.tutorial_step,
        clipDuration
      })
    }
    scenes.push(speakerScene(format.clipCount, 'cta', c1, s, lang, setting))
    return scenes
  }

  if (format.id === 'product_review') {
    const setting = 'Lived-in room, product on the table in front, honest framing'
    const arc = ['hook', 'discovery', 'benefit', 'mechanism', 'review_con', 'proof', 'cta']
    return arc.slice(0, format.clipCount).map((purpose, i) => {
      const sc = speakerScene(i + 1, purpose, c1, s, lang, setting)
      if (purpose === 'hook') {
        sc.dialogueLine = lineFor('review_verdict', s, lang)
        sc.clipDuration = durationForLine(sc.dialogueLine)
        sc.duration = sc.clipDuration
      }
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

// Scene-specific body language per emotional beat (gesture/delivery only —
// never appearance; the attached frame carries identity).
export const GESTURE_MAP = {
  curiosity: 'with a slight lean-in and a raised eyebrow, building tension',
  frustration: 'with a tired expression and a slow head shake',
  tension: 'with a serious tone, slowing slightly on the key words',
  hope: 'with a genuine surprised expression, eyes widening as the memory lands',
  relief: 'with an easing tone and shoulders visibly relaxing',
  confidence: 'with a calm, confident nod on the key word',
  satisfaction: 'with a bright expression and one small animated hand gesture',
  trust: 'with a confident smile and steady, direct eye contact',
  reassurance: 'with a knowing half-smile and an open-palm gesture',
  action: 'looking straight ahead, warm and direct, no hesitation',
  anticipation: 'with a thoughtful pause before speaking, then leaning in'
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
  // Studio-level overrides: aspect ratio (platform/override wins over the format
  // default) and a quality hint surfaced in the setup header when not Standard.
  const aspectRatio = effectiveAspectRatio(s)
  const qualitySuffix = s.output.qualityHint && s.output.qualityHint !== 'Standard' ? ` · Quality: ${s.output.qualityHint}` : ''

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
      const cue = GESTURE_MAP[str(scene.emotionalBeat)] || 'with a natural conversational tone'
      const gaze = isPodcast
        ? `${pr.subj} looks toward the other speaker, not at the camera.`
        : `${pr.subj} speaks directly to the camera.`
      promptText = `${pr.subj} ${verb}: "${line}" — ${cue}. ${gaze} ${naturalPaceTail(gender)}`
      const n = wordCount(line)
      notes.push(`${n} words → ${clipDuration}s clip.`)
      if (n > 25) notes.push('Line exceeds 25 words — trim it or the clip will feel rushed.')
      if (format.id === 'french_podcast') notes.push('Use Gemini Omni Flash in Google Flow. Never Seedance for French.')
    }

    const setupHeader = `${shortModelName(model)} · ${aspectRatio} · select [${clipDuration}s] · attach Frame [${num}]${qualitySuffix}`

    return {
      sceneNumber: num,
      model,
      promptText,
      setupHeader,
      attachFrame: `Frame ${num}`,
      duration: clipDuration,
      aspectRatio,
      notes: notes.join(' ')
    }
  })
}

// Build static start-frame image prompts to pair with motion/dialogue clip prompts.
// Frames establish composition, identity, setting, and mood; clip prompts own action.
export function generateFramePrompts(studio, scenes, prompts) {
  const s = normalizeStudio(studio)
  const sceneList = Array.isArray(scenes) ? scenes : []
  const promptList = Array.isArray(prompts) ? prompts : []
  const isPodcast = isTwoCharacterFormat(s.format)
  const isCinematic = s.format === 'cinematic_product'
  const lastSceneNumber = sceneList.reduce((max, scene) => Math.max(max, Number(scene && scene.sceneNumber) || 0), 0)
  const quality = s.output.qualityHint

  return sceneList.map((scene, index) => {
    const num = Number(scene && scene.sceneNumber) || index + 1
    const purpose = str(scene && scene.purpose).trim() || 'scene'
    const beat = str(scene && scene.emotionalBeat).trim() || 'authentic and composed'
    const shot = str(scene && scene.shotType).trim() || 'medium shot'
    const setting = settingById(scene && scene.settingId) || settingById(defaultSettingForFormat(s.format))
    const character = characterById(scene && scene.character) || characterById(s.characters[index % Math.max(s.characters.length, 1)])
    const characterName = character ? character.name : 'Primary character'
    const clipPrompt = promptList.find((p) => Number(p && p.sceneNumber) === num)
    const isVisual = isCinematic || !str(scene && scene.dialogueLine).trim() || ['product_hero', 'product_reveal', 'macro_detail', 'product_in_use', 'end_card'].includes(purpose)
    const isHook = num === 1 || purpose === 'hook'
    const isCta = num === lastSceneNumber || purpose === 'cta' || purpose === 'end_card'
    const settingText = setting ? `${setting.description}; ${setting.lightingNote}` : 'natural, believable setting with soft motivated light'
    const detail = quality === 'Maximum'
      ? 'Fine material texture, natural skin detail, and precise background separation.'
      : quality === 'High'
        ? 'Natural texture and clean background separation.'
        : ''

    let framePrompt
    if (isVisual) {
      const product = str(s.product.name).trim() || 'Product'
      framePrompt = `${shot} of ${product} in frame, composed for ${beat}. ${settingText}.`
    } else if (isCta && isPodcast) {
      framePrompt = `Both speakers visible in a two-shot, direct and warm, looking at the viewer with ${beat}. ${settingText}.`
    } else if (isCta) {
      framePrompt = `${shot} of ${characterName}, direct and warm, looking at the viewer with ${beat}. ${settingText}.`
    } else if (isHook) {
      framePrompt = `${shot} of ${characterName}, eye contact with camera, direct engagement, expression conveying ${beat}. ${settingText}.`
    } else if (isPodcast) {
      framePrompt = `${shot} of ${characterName} angled toward the other speaker, attentive listening expression conveying ${beat}, not looking at camera. ${settingText}.`
    } else {
      framePrompt = `${shot} of ${characterName}, composed expression conveying ${beat}. ${settingText}.`
    }

    return {
      sceneNumber: num,
      purpose,
      framePrompt: [framePrompt, detail].filter(Boolean).join(' '),
      setupHeader: `Attach Frame [${num}] — ${isVisual ? str(s.product.name).trim() || 'Product' : characterName}${clipPrompt && clipPrompt.attachFrame ? ` · ${clipPrompt.attachFrame}` : ''}`
    }
  })
}

// Camera/product motion per cinematic purpose (atmosphere included, no people).
function motionFor(purpose) {
  const map = {
    hook: 'Camera slowly pushes in on the product as the rim light brightens. Fine dust particles drift through the beam; the liquid inside catches the light as it settles',
    cta: 'The product settles into its final position as the backdrop light evens out. Gentle camera drift to stillness, condensation beading on the surface',
    product_hero: 'Camera slowly pushes in on the product as the rim light brightens. Fine dust particles drift through the beam',
    lifestyle: 'Slow lateral dolly across the scene, shallow focus breathing between foreground objects and the environment behind',
    product_reveal: 'The product rotates slowly into a beam of light as the camera tilts up, shadows receding across the surface',
    macro_detail: 'Macro slider move across the surface texture; light catches each detail in turn, micro-bubbles rising through the liquid',
    product_in_use: 'Locked-off top-down frame. Hands enter to use the product naturally; steam curls and settles, ripples calm',
    end_card: 'The product settles into its final position as the backdrop light evens out. Gentle camera drift to stillness'
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

// ---- Named saved sessions (localStorage list; replaces the single slot) ----

export const SESSION_STORAGE_KEY = 'aaf_marketing_studio_sessions'
const LEGACY_SESSION_KEY = 'aaf_marketing_studio_session'

// Auto-name: "Calme · French Podcast (Omni)" or "Untitled Session · 12/06/2026".
export function sessionAutoName(studio) {
  const s = normalizeStudio(studio)
  const product = str(s.product.name).trim()
  const format = formatById(s.format)
  if (product) return format ? `${product} · ${format.name}` : product
  return `Untitled Session · ${new Date().toLocaleDateString()}`
}

function normalizeSession(x) {
  const o = x && typeof x === 'object' ? x : {}
  return {
    id: str(o.id) || `ms_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    name: str(o.name).trim() || 'Untitled Session',
    name_custom: !!o.name_custom,
    createdAt: Number(o.createdAt) || Date.now(),
    updatedAt: Number(o.updatedAt) || Date.now(),
    studio: normalizeStudio(o.studio)
  }
}

// Read all sessions. Migrates the legacy single-slot session (if any, non-empty)
// into the list on first load.
export function loadSessions() {
  let sessions = []
  try {
    const raw = localStorage.getItem(SESSION_STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) sessions = parsed.map(normalizeSession)
    }
  } catch {
    sessions = []
  }
  if (sessions.length === 0) {
    try {
      const legacy = localStorage.getItem(LEGACY_SESSION_KEY)
      if (legacy) {
        const studio = normalizeStudio(JSON.parse(legacy))
        if (studio.product.name.trim() || studio.scenes.length || studio.format) {
          sessions = [createSession(studio)]
          saveSession(sessions)
        }
        localStorage.removeItem(LEGACY_SESSION_KEY)
      }
    } catch {
      // Legacy slot unreadable — start fresh.
    }
  }
  return sessions
}

export function saveSession(sessions) {
  try {
    localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(Array.isArray(sessions) ? sessions : []))
  } catch {
    // Storage unavailable (private mode, quota). Non-fatal.
  }
}

export function createSession(studio) {
  const s = normalizeStudio(studio)
  return {
    id: `ms_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    name: sessionAutoName(s),
    name_custom: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    studio: s
  }
}

// Update a session's studio. Auto-renames unless the user renamed it manually.
export function updateSession(sessions, id, studio) {
  return (Array.isArray(sessions) ? sessions : []).map((sess) =>
    sess.id === id
      ? { ...sess, studio: normalizeStudio(studio), updatedAt: Date.now(), name: sess.name_custom ? sess.name : sessionAutoName(studio) }
      : sess
  )
}

export function renameSession(sessions, id, name) {
  const clean = str(name).trim()
  return (Array.isArray(sessions) ? sessions : []).map((sess) =>
    sess.id === id ? { ...sess, name: clean || sess.name, name_custom: !!clean, updatedAt: Date.now() } : sess
  )
}

export function deleteSession(sessions, id) {
  return (Array.isArray(sessions) ? sessions : []).filter((sess) => sess.id !== id)
}

// ---- Recreate From Package (Tier 2) ----

// Parse an exported Markdown package back into a partial studio object.
// Never throws — always returns { ok, studio, errors }.
export function parseMarkdownPackage(markdownText) {
  const errors = []
  const studio = emptyStudio()

  try {
    const text = String(markdownText || '')
    const lines = text.split(/\r?\n/)

    // Product brief section
    const grabField = (re) => {
      for (const l of lines) {
        const m = re.exec(l)
        if (m && str(m[1]).trim()) return str(m[1]).trim().replace(/^\*+|\*+$/g, '')
      }
      return ''
    }

    const productName = grabField(/^\s*-\s+\*\*Product:\*\*\s+(.+)/i) || grabField(/^#\s+(.+?)\s+[—–-]/)
    if (productName) studio.product.name = productName.replace(/\s+—.*$/, '').trim()

    const description = grabField(/^\s*-\s+\*\*Description:\*\*\s+(.+)/i)
    if (description) studio.product.description = description

    const benefits = grabField(/^\s*-\s+\*\*Benefits?:\*\*\s+(.+)/i)
    if (benefits) studio.product.benefits = benefits.split(/;\s*/).filter(Boolean)

    const audience = grabField(/^\s*-\s+\*\*Target audience:\*\*\s+(.+)/i)
    if (audience) studio.product.targetAudience = audience

    const ingredient = grabField(/^\s*-\s+\*\*Key ingredient[^:]*:\*\*\s+(.+)/i)
    if (ingredient) studio.product.keyIngredient = ingredient

    const claim = grabField(/^\s*-\s+\*\*Claim boundary:\*\*\s+(.+)/i)
    if (claim) studio.product.claimBoundary = claim

    const landingPage = grabField(/^\s*-\s+\*\*Landing page:\*\*\s+(https?:\/\/\S+)/i)
    if (landingPage) studio.product.landingPageUrl = landingPage

    const category = grabField(/^\s*-\s+\*\*Category:\*\*\s+(.+)/i)
    if (category) studio.product.category = category

    const langVal = grabField(/^\s*-\s+\*\*Language:\*\*\s+(\w+)/i)
    if (langVal) studio.brief.language = langVal.toLowerCase() === 'en' ? 'en' : 'fr'

    // Format: look for "**Format:** <name>" line
    const formatLine = grabField(/^\s*-\s+\*\*Format:\*\*\s+(.+)/i)
    if (formatLine) {
      const matched = FORMATS.find((f) => formatLine.toLowerCase().includes(f.name.toLowerCase()) || formatLine.toLowerCase().includes(f.id))
      if (matched) studio.format = matched.id
      else errors.push(`Format not recognized: "${formatLine}"`)
    }

    // Scenes: parse the markdown table
    const scenes = []
    let inTable = false
    const tableRowRe = /^\|\s*(\d+)\s*\|\s*(\d+)s\s*\|\s*([^|]+)\|\s*([^|]+)\|\s*([^|]+)\|\s*([^|]*)\|/

    for (const line of lines) {
      if (/^\|\s*#\s*\|/.test(line)) { inTable = true; continue }
      if (/^\|\s*---/.test(line)) continue
      if (inTable && line.trim().startsWith('|')) {
        const m = tableRowRe.exec(line)
        if (m) {
          scenes.push({
            sceneNumber: Number(m[1]),
            clipDuration: Number(m[2]) || 6,
            duration: Number(m[2]) || 6,
            purpose: str(m[3]).trim().toLowerCase().replace(/\s+/g, '_'),
            shotType: str(m[4]).trim(),
            emotionalBeat: str(m[5]).trim(),
            dialogueLine: str(m[6]).trim(),
            visualDescription: '',
            character: '',
            settingId: ''
          })
        }
      } else if (inTable && !line.trim().startsWith('|')) {
        inTable = false
      }
    }
    if (scenes.length) studio.scenes = scenes

    // Prompts: parse "### Clip N" blocks
    const prompts = []
    let inBlock = false
    let currentClip = null
    let inCodeBlock = false
    let codeLines = []

    for (const line of lines) {
      const clipHeader = /^###\s+Clip\s+(\d+)/.exec(line)
      if (clipHeader) {
        if (currentClip && codeLines.length) {
          const [setupHeader, , ...rest] = codeLines
          currentClip.setupHeader = str(setupHeader).trim()
          currentClip.promptText = rest.join('\n').trim()
          prompts.push(currentClip)
        }
        currentClip = { sceneNumber: Number(clipHeader[1]), setupHeader: '', promptText: '', model: '', notes: '', duration: 6, aspectRatio: '9:16', attachFrame: '' }
        codeLines = []
        inBlock = true
        inCodeBlock = false
        continue
      }
      if (inBlock) {
        if (line.trim() === '```text' || line.trim() === '```') {
          if (inCodeBlock) {
            inCodeBlock = false
          } else {
            inCodeBlock = true
          }
          continue
        }
        if (inCodeBlock) codeLines.push(line)
      }
    }
    // flush last block
    if (currentClip && codeLines.length) {
      const [setupHeader, , ...rest] = codeLines
      currentClip.setupHeader = str(setupHeader).trim()
      currentClip.promptText = rest.join('\n').trim()
      prompts.push(currentClip)
    }
    if (prompts.length) studio.prompts = prompts

    if (!studio.product.name) errors.push('Product name not found in the package header.')
    if (!scenes.length) errors.push('No scene table found — scenes could not be parsed.')

    return { ok: errors.filter((e) => !e.startsWith('Format not')).length === 0 && !!studio.product.name, studio, errors }
  } catch (e) {
    errors.push(`Parse error: ${e && e.message ? e.message : String(e)}`)
    return { ok: false, studio, errors }
  }
}

// ---- Product Library (Tier 2) ----

export const PRODUCT_LIBRARY_KEY = 'aaf_product_library'

function slugifyName(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'product'
}

export function loadProductLibrary() {
  try {
    const raw = localStorage.getItem(PRODUCT_LIBRARY_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function saveProductLibrary(products) {
  try {
    localStorage.setItem(PRODUCT_LIBRARY_KEY, JSON.stringify(Array.isArray(products) ? products : []))
  } catch {
    // Storage unavailable — non-fatal.
  }
}

export function saveProductToLibrary(library, product) {
  const list = Array.isArray(library) ? library : []
  const slug = slugifyName(str(product && product.name))
  const existing = list.find((e) => slugifyName(str(e.name)) === slug)
  const entry = {
    id: existing ? existing.id : `${slug}_${Date.now()}`,
    name: str(product && product.name).trim() || 'Untitled',
    savedAt: Date.now(),
    product: { ...product }
  }
  if (existing) {
    return list.map((e) => (e.id === existing.id ? entry : e))
  }
  return [...list, entry]
}

export function deleteProductFromLibrary(library, id) {
  return (Array.isArray(library) ? library : []).filter((e) => e.id !== id)
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

  const platform = platformById(s.output.platform)
  const promptListForHeader = Array.isArray(prompts) ? prompts : []
  out.push('## Output Settings', '')
  out.push(`- **Platform:** ${platform ? platform.name : '(not set)'}`)
  out.push(`- **Aspect Ratio:** ${effectiveAspectRatio(s)}${s.output.aspectRatio ? ' (override)' : ' (format default)'}`)
  out.push(`- **Quality:** ${s.output.qualityHint}`)
  out.push(`- **Language:** ${lang.toUpperCase()}`)
  out.push(`- **Total clips:** ${promptListForHeader.length}`)
  out.push(`- **Estimated duration:** ${totalPromptDuration(promptListForHeader)}s`)
  out.push('')

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
