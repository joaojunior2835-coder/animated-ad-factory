// Canvas Workspace model for competitor ad replication. Scenes hold the visual
// map of a competitor ad and the adaptation to our product. Pure helpers.

import { uid } from './brandDocs.js'
import { providerName } from '../data/providers.js'
import { selectedImageProvider, selectedTextProvider } from './ai/providerActions.js'

export const COMPETITOR_METHOD_IDS = ['competitor_recreation', 'competitor_video_recreation']

export function isCompetitorMethod(id) {
  return COMPETITOR_METHOD_IDS.includes(id)
}

// Editable scene fields (scene_number, providers, and image are handled separately).
export const SCENE_FIELDS = [
  { key: 'timestamp_start', label: 'Timestamp start', type: 'text' },
  { key: 'timestamp_end', label: 'Timestamp end', type: 'text' },
  { key: 'competitor_frame_description', label: 'Competitor frame description', type: 'textarea' },
  { key: 'what_happens', label: 'What happens', type: 'textarea' },
  { key: 'camera_angle', label: 'Camera angle', type: 'text' },
  { key: 'camera_movement', label: 'Camera movement', type: 'text' },
  { key: 'subject_action', label: 'Subject action', type: 'textarea' },
  { key: 'product_role', label: 'Product role', type: 'text' },
  { key: 'text_overlay_seen', label: 'Text overlay seen', type: 'textarea' },
  { key: 'voiceover_or_dialogue', label: 'Voiceover / dialogue', type: 'textarea' },
  { key: 'emotional_purpose', label: 'Emotional purpose', type: 'textarea' },
  { key: 'editing_notes', label: 'Editing notes', type: 'textarea' },
  { key: 'why_this_scene_works', label: 'Why this scene works', type: 'textarea' },
  { key: 'adaptation_instruction_for_our_product', label: 'Adaptation instruction for our product', type: 'textarea' },
  { key: 'required_assets', label: 'Required assets', type: 'textarea' },
  { key: 'output_prompt', label: 'Output prompt', type: 'textarea' }
]

const REFERENCE_KEYS = ['competitor_ad_name', 'competitor_brand', 'source_url', 'platform', 'ad_duration', 'notes']
const DEFAULT_KEYS = ['default_llm_provider', 'default_image_provider', 'default_video_provider', 'default_voice_provider', 'default_music_provider']

function nonEmpty(v) {
  return String(v == null ? '' : v).trim().length > 0
}

export const ASSET_TYPES = ['competitor_reference', 'product_asset', 'generated_image', 'generated_video', 'script', 'other']
export const ASSET_STATUSES = ['reference', 'draft', 'selected', 'rejected']
export const VARIATION_TYPES = ['image', 'video', 'prompt', 'other']
export const VARIATION_STATUSES = ['draft', 'generated', 'selected', 'rejected']

const STORAGE_KINDS = ['session', 'external_url', 'local_disk', 'mock']

export function newVariation(label, partial = {}) {
  return {
    id: partial.id || uid(),
    label: label || partial.label || '',
    type: VARIATION_TYPES.includes(partial.type) ? partial.type : 'image',
    provider: partial.provider || '',
    prompt: partial.prompt || '',
    external_url: partial.external_url || '',
    local_url: partial.local_url || '',
    storage: STORAGE_KINDS.includes(partial.storage) ? partial.storage : '',
    file_name: partial.file_name || '',
    mime_type: partial.mime_type || '',
    file_size: typeof partial.file_size === 'number' ? partial.file_size : 0,
    // Optional normalized media-result metadata (for export/traceability).
    source_type: partial.source_type || '',
    action_type: partial.action_type || '',
    request_id: partial.request_id || '',
    model: partial.model || '',
    created_at: partial.created_at || '',
    notes: partial.notes || '',
    status: VARIATION_STATUSES.includes(partial.status) ? partial.status : 'draft'
  }
}

// Single source of truth for media preview + health, across variations and assets.
// Precedence: local disk file -> external URL (real or mock) -> session preview -> none.
export function mediaSource(item, hasSessionPreview) {
  const it = item || {}
  const local = String(it.local_url || '').trim()
  const ext = String(it.external_url || '').trim()
  if (local) return { url: local, storage: 'local_disk', label: 'Local file saved' }
  if (ext) {
    return classifyMedia(ext) === 'mock'
      ? { url: ext, storage: 'mock', label: 'Mock result' }
      : { url: ext, storage: 'external_url', label: 'URL saved' }
  }
  if (hasSessionPreview || it.file_name) return { url: '', storage: 'session', label: 'Session-only preview' }
  return { url: '', storage: 'none', label: 'No media attached' }
}

// Classify a media URL for preview: 'image' | 'video' | 'mock' | 'link' | 'none'.
export function classifyMedia(url) {
  const u = String(url || '').trim()
  if (!u) return 'none'
  if (u.startsWith('mock://')) return 'mock'
  const low = u.toLowerCase().split('?')[0]
  if (/\.(png|jpe?g|webp|gif)$/.test(low)) return 'image'
  if (/\.(mp4|webm|mov)$/.test(low)) return 'video'
  return 'link'
}

function normalizeVariation(v) {
  return newVariation((v && v.label) || '', v || {})
}

export function newAsset(partial = {}) {
  const type = ASSET_TYPES.includes(partial.type) ? partial.type : 'other'
  const defaultStatus = type === 'competitor_reference' || type === 'product_asset' ? 'reference' : 'draft'
  return {
    id: partial.id || uid(),
    type,
    title: partial.title || 'Untitled asset',
    source: partial.source || 'manual',
    file_name: partial.file_name || '',
    external_url: partial.external_url || '',
    local_url: partial.local_url || '',
    storage: STORAGE_KINDS.includes(partial.storage) ? partial.storage : '',
    mime_type: partial.mime_type || '',
    file_size: typeof partial.file_size === 'number' ? partial.file_size : 0,
    notes: partial.notes || '',
    linked_scene_id: partial.linked_scene_id || '',
    status: ASSET_STATUSES.includes(partial.status) ? partial.status : defaultStatus
  }
}

function normalizeAsset(a) {
  return newAsset(a || {})
}

export function selectedVariation(scene) {
  return ((scene && scene.variations) || []).find((v) => v.status === 'selected') || null
}

// Reorder a scene's variations WITHIN the scene: move `fromId` to `toId`'s slot.
// Pure — returns a new array; never changes any variation's fields (so selection
// is preserved). Same-scene only; callers don't move across scenes.
export function reorderVariations(variations, fromId, toId) {
  const arr = Array.isArray(variations) ? [...variations] : []
  const from = arr.findIndex((v) => v && v.id === fromId)
  const to = arr.findIndex((v) => v && v.id === toId)
  if (from === -1 || to === -1 || from === to) return arr
  const [moved] = arr.splice(from, 1)
  arr.splice(to, 0, moved)
  return arr
}

// Remove a variation from a scene's array. Pure — returns a new array and never
// touches other variations' fields. Selection rule: if the removed variation was
// the selected one, the scene is simply left with NO selected variation (no
// auto-promotion) because filtering it out removes the only `status:'selected'`.
export function removeVariation(variations, varId) {
  const arr = Array.isArray(variations) ? variations : []
  return arr.filter((v) => !(v && v.id === varId))
}

// Replace a variation's MEDIA in place: same id, same array index, same status.
// `mediaPatch` should contain only media fields (local_url/external_url/storage/
// file_name/mime_type/file_size/source_type/notes); identity/selection/prompt are
// preserved because they aren't in the patch. Pure — returns a new array.
export function replaceVariationMedia(variations, varId, mediaPatch) {
  const arr = Array.isArray(variations) ? variations : []
  return arr.map((v) => (v && v.id === varId ? { ...v, ...(mediaPatch || {}) } : v))
}

// Reorder scenes: move `fromId` to `toId`'s slot. Pure — returns a new array and
// NEVER mutates scene fields. scene_number is left STABLE (it's an identity/label;
// the array order is the timeline order), so scene<NN>_v<NN> filename matching keeps
// working. Selected variations and all variation arrays are untouched.
export function reorderScenes(scenes, fromId, toId) {
  const arr = Array.isArray(scenes) ? [...scenes] : []
  const from = arr.findIndex((s) => s && s.id === fromId)
  const to = arr.findIndex((s) => s && s.id === toId)
  if (from === -1 || to === -1 || from === to) return arr
  const [moved] = arr.splice(from, 1)
  arr.splice(to, 0, moved)
  return arr
}

export function newScene(number) {
  const s = { id: uid(), scene_number: number, scene_type: '', image_name: '', duration_seconds: 0, llm_provider: '', image_provider: '', video_provider: '', variations: [] }
  SCENE_FIELDS.forEach((f) => {
    s[f.key] = ''
  })
  return s
}

function normalizeScene(s, number) {
  const base = newScene(number)
  const merged = { ...base, ...(s || {}) }
  merged.id = (s && s.id) || base.id
  // Keep scene_number STABLE: preserve the stored value (identity/label) so timeline
  // reordering doesn't renumber scenes; fall back to positional only when missing.
  const stored = s && s.scene_number
  merged.scene_number = stored != null && stored !== '' && Number.isFinite(Number(stored)) ? Number(stored) : number
  // Per-scene duration in seconds (numeric; blank/invalid → 0).
  merged.duration_seconds = Number.isFinite(Number(merged.duration_seconds)) ? Number(merged.duration_seconds) : 0
  merged.variations = Array.isArray(merged.variations) ? merged.variations.map(normalizeVariation) : []
  return merged
}

// Sum per-scene durations (seconds). Missing/blank/invalid durations count as 0.
export function sumSceneDurations(scenes) {
  return (Array.isArray(scenes) ? scenes : []).reduce((acc, s) => {
    const n = Number(s && s.duration_seconds)
    return acc + (Number.isFinite(n) && n > 0 ? n : 0)
  }, 0)
}

// Parse a declared ad length to seconds. Handles plain numbers ("30", "30 seconds"
// -> 30), m:ss ("1:30" -> 90, "0:45" -> 45), and h:mm:ss ("1:02:03" -> 3723).
// Returns a positive number, or null when unparseable.
export function parseDeclaredSeconds(value) {
  if (value == null) return null
  const str = String(value).trim()
  if (!str) return null
  // Time format first: h:mm:ss or m:ss (minutes/seconds 0-59).
  const t = /(\d+):([0-5]?\d)(?::([0-5]?\d))?/.exec(str)
  if (t) {
    const a = Number(t[1])
    const b = Number(t[2])
    const hasThird = t[3] !== undefined
    const c = hasThird ? Number(t[3]) : 0
    const secs = hasThird ? a * 3600 + b * 60 + c : a * 60 + b
    return Number.isFinite(secs) && secs > 0 ? secs : null
  }
  // Plain number (optionally followed by a unit word).
  const m = /(\d+(?:\.\d+)?)/.exec(str)
  if (!m) return null
  const n = Number(m[1])
  return Number.isFinite(n) && n > 0 ? n : null
}

// Write API-generated prompts back into scenes' output_prompt. Pure — returns a new
// scenes array + counts. `parsed` is the model's JSON ({ prompts:[{scene_number,
// output_prompt}] }). Matches by scene_number. fill-only by default; overwrite=true
// replaces existing prompts. On a malformed/unparseable `parsed`, NOTHING changes
// (ok:false) so a bad response can never corrupt the canvas.
export function applyGeneratedScenePrompts(scenes, parsed, overwrite) {
  const arr = Array.isArray(scenes) ? scenes : []
  const proposals = parsed && Array.isArray(parsed.prompts) ? parsed.prompts : null
  if (!proposals) return { scenes: arr, filled: 0, ok: false }
  const byNum = new Map()
  for (const p of proposals) {
    const n = Number(p && p.scene_number)
    const v = String((p && p.output_prompt) || '').trim()
    if (Number.isFinite(n) && v) byNum.set(n, v)
  }
  let filled = 0
  const out = arr.map((s) => {
    const isTarget = overwrite || !String(s.output_prompt || '').trim()
    if (!isTarget) return s
    const v = byNum.get(Number(s.scene_number))
    if (!v) return s
    filled++
    return { ...s, output_prompt: v }
  })
  return { scenes: out, filled, ok: true }
}

// ---- Ad Brief (decode a competitor /watch breakdown into our brief) ----
// The Ad Brief lives ON the canvas. It holds the decoded competitor structure, the
// adapted script, and the don't-copy / preserve guidance. The brief's scenes[] are
// written into the EXISTING canvas.scenes via applyAdBriefScenes (below) — there is
// NO parallel scene model. These are pure helpers; no API calls.

export function emptyAdBrief() {
  return { decoded_structure: [], adapted_script: '', dont_copy: [], preserve: [], generated_at: '', request_id: '', model: '' }
}

// Coerce a value into a clean string list (array of strings, or newline/bullet text).
function asStringList(v) {
  if (Array.isArray(v)) return v.map((x) => (typeof x === 'string' ? x : x == null ? '' : JSON.stringify(x))).map((s) => s.trim()).filter(Boolean)
  if (typeof v === 'string') return v.split(/\r?\n/).map((s) => s.replace(/^[-*]\s*/, '').trim()).filter(Boolean)
  return []
}

// Normalize a stored/returned ad brief into the canonical shape. Migration-safe:
// a missing or malformed brief yields an empty brief (never throws).
export function normalizeAdBrief(b) {
  const x = b && typeof b === 'object' && !Array.isArray(b) ? b : {}
  const decoded_structure = Array.isArray(x.decoded_structure)
    ? x.decoded_structure.map((beat) => {
        const o = beat && typeof beat === 'object' ? beat : {}
        return {
          beat_name: String(o.beat_name || '').trim(),
          timestamp_range: String(o.timestamp_range || '').trim(),
          what_competitor_does: String(o.what_competitor_does || '').trim(),
          why_it_works: String(o.why_it_works || '').trim()
        }
      })
    : []
  let adapted_script = ''
  if (typeof x.adapted_script === 'string') adapted_script = x.adapted_script
  else if (Array.isArray(x.adapted_script)) {
    adapted_script = x.adapted_script
      .map((l) => (typeof l === 'string' ? l : l && typeof l === 'object' ? `${l.timing ? `[${l.timing}] ` : ''}${l.line || l.text || ''}`.trim() : ''))
      .filter(Boolean)
      .join('\n')
  }
  return {
    decoded_structure,
    adapted_script: String(adapted_script || ''),
    dont_copy: asStringList(x.dont_copy),
    preserve: asStringList(x.preserve),
    generated_at: String(x.generated_at || ''),
    request_id: String(x.request_id || ''),
    model: String(x.model || '')
  }
}

// Write an Ad Brief's scenes[] back into the EXISTING canvas scenes by scene_number.
// Reuses the fill-only-vs-overwrite logic of applyGeneratedScenePrompts but writes the
// three brief fields (output_prompt, what_happens, adaptation_instruction_for_our_product)
// and CREATES scenes (via newScene) for brief scene_numbers that have no existing scene,
// so the canvas aligns to the brief. On a malformed/empty parse NOTHING changes
// (ok:false) so a bad response can never corrupt the canvas. Pure — returns a new array.
export function applyAdBriefScenes(scenes, parsed, overwrite) {
  const arr = Array.isArray(scenes) ? scenes : []
  const proposals = parsed && typeof parsed === 'object' && Array.isArray(parsed.scenes) ? parsed.scenes : null
  if (!proposals) return { scenes: arr, filled: 0, created: 0, ok: false }
  const byNum = new Map()
  for (const p of proposals) {
    const n = Number(p && p.scene_number)
    if (!Number.isFinite(n)) continue
    byNum.set(n, {
      output_prompt: String((p && p.output_prompt) || '').trim(),
      what_happens: String((p && p.what_happens) || '').trim(),
      adaptation_instruction_for_our_product: String((p && p.adaptation_instruction_for_our_product) || '').trim()
    })
  }
  if (byNum.size === 0) return { scenes: arr, filled: 0, created: 0, ok: false }
  let filled = 0
  let created = 0
  const existingNums = new Set(arr.map((s) => Number(s.scene_number)))
  const out = arr.map((s) => {
    const prop = byNum.get(Number(s.scene_number))
    if (!prop) return s
    // Scene-level target rule (mirrors applyGeneratedScenePrompts): a scene with an
    // output_prompt is "filled" and is left alone unless overwrite is set.
    const isTarget = overwrite || !String(s.output_prompt || '').trim()
    if (!isTarget) return s
    const patch = {}
    if (prop.output_prompt) patch.output_prompt = prop.output_prompt
    if (prop.what_happens) patch.what_happens = prop.what_happens
    if (prop.adaptation_instruction_for_our_product) patch.adaptation_instruction_for_our_product = prop.adaptation_instruction_for_our_product
    if (Object.keys(patch).length === 0) return s
    filled++
    return { ...s, ...patch }
  })
  for (const [n, prop] of byNum) {
    if (existingNums.has(n)) continue
    const s = newScene(n)
    if (prop.output_prompt) s.output_prompt = prop.output_prompt
    if (prop.what_happens) s.what_happens = prop.what_happens
    if (prop.adaptation_instruction_for_our_product) s.adaptation_instruction_for_our_product = prop.adaptation_instruction_for_our_product
    out.push(s)
    created++
  }
  out.sort((a, b) => Number(a.scene_number) - Number(b.scene_number))
  return { scenes: out, filled, created, ok: true }
}

// Detect scenes that are NOT export-ready. Pure — read-only, no auto-fix.
// Reasons: 'no_variations' (empty variations) and 'no_selection' (has variations
// but none with status:'selected'). Returns [] when every scene is ready.
export function findSceneGaps(scenes) {
  const out = []
  for (const s of Array.isArray(scenes) ? scenes : []) {
    if (!s) continue
    const vars = Array.isArray(s.variations) ? s.variations : []
    if (vars.length === 0) out.push({ scene_id: s.id, scene_number: s.scene_number, reason: 'no_variations' })
    else if (!vars.some((v) => v && v.status === 'selected')) out.push({ scene_id: s.id, scene_number: s.scene_number, reason: 'no_selection' })
  }
  return out
}

// One consolidated, pure export-readiness assessment. Composes the existing helpers
// (findSceneGaps, sumSceneDurations, parseDeclaredSeconds, durationStatus) — read-only.
// Blockers make the package NOT ready; warnings surface but don't block.
export function assessExportReadiness(project) {
  const p = project || {}
  const scenes = (p.canvas && p.canvas.scenes) || []
  const blockers = []
  const warnings = []

  if (!scenes.length) {
    blockers.push({ code: 'no_scenes', message: 'Canvas has no scenes.' })
    return { ready: false, blockers, warnings }
  }

  const gaps = findSceneGaps(scenes)
  if (gaps.length) {
    blockers.push({ code: 'scene_gaps', message: `${gaps.length} scene(s) not export-ready (no variations or no selection): Scene ${gaps.map((g) => g.scene_number).join(', ')}.` })
  }

  // Timeline scenes = those with a selected variation (matches the duration section).
  const timelineScenes = scenes.filter((s) => (s.variations || []).some((v) => v && v.status === 'selected'))
  const summed = sumSceneDurations(timelineScenes)
  const declared = parseDeclaredSeconds((p.product_intake || {}).ad_duration)
  if (declared != null) {
    const st = durationStatus(declared, summed)
    if (st.status === 'mismatch') {
      warnings.push({ code: 'duration_mismatch', message: `Declared ${declared}s but scenes sum to ${summed}s (difference ${st.difference > 0 ? '+' : ''}${st.difference}s).` })
    }
  }
  const zeroDur = timelineScenes.filter((s) => !(Number(s.duration_seconds) > 0))
  if (zeroDur.length) {
    warnings.push({ code: 'zero_duration_scenes', message: `${zeroDur.length} timeline scene(s) have no duration set: Scene ${zeroDur.map((s) => s.scene_number).join(', ')}.` })
  }

  return { ready: blockers.length === 0, blockers, warnings }
}

// Compare declared vs summed durations. Pure; expects `declared` as a number.
export function durationStatus(declared, summed) {
  const d = Number(declared) || 0
  const s = Number(summed) || 0
  return { summed: s, declared: d, difference: s - d, status: s === d ? 'valid' : 'mismatch' }
}

export const NODE_STATUSES = ['draft', 'ready', 'generated', 'selected', 'rejected']

export function emptyBoard() {
  return { nodes: [], edges: [] }
}

function normalizeNode(n) {
  const o = n || {}
  return {
    id: o.id || uid(),
    type: o.type || 'reference',
    title: o.title || '',
    subtitle: o.subtitle || '',
    scene_id: o.scene_id || '',
    status: NODE_STATUSES.includes(o.status) ? o.status : 'draft',
    x: typeof o.x === 'number' ? o.x : 0,
    y: typeof o.y === 'number' ? o.y : 0,
    data: o.data && typeof o.data === 'object' ? o.data : {}
  }
}

export function normalizeBoard(board) {
  const b = board || {}
  return {
    nodes: Array.isArray(b.nodes) ? b.nodes.map(normalizeNode) : [],
    edges: Array.isArray(b.edges) ? b.edges.map((e) => ({ id: (e && e.id) || uid(), from: (e && e.from) || '', to: (e && e.to) || '', label: (e && e.label) || '' })) : []
  }
}

export function emptyCanvas() {
  const competitor_reference = {}
  REFERENCE_KEYS.forEach((k) => {
    competitor_reference[k] = ''
  })
  const model_defaults = {}
  DEFAULT_KEYS.forEach((k) => {
    model_defaults[k] = ''
  })
  return { competitor_reference, model_defaults, scenes: [], canvas_board: emptyBoard(), assets: [], ad_brief: emptyAdBrief(), provider_mode: 'manual', api_text_provider_id: 'groq', api_image_provider_id: 'pollinations' }
}

export function normalizeCanvas(canvas) {
  const base = emptyCanvas()
  const c = canvas || {}
  return {
    competitor_reference: { ...base.competitor_reference, ...(c.competitor_reference || {}) },
    model_defaults: { ...base.model_defaults, ...(c.model_defaults || {}) },
    scenes: Array.isArray(c.scenes) ? c.scenes.map((s, i) => normalizeScene(s, i + 1)) : [],
    canvas_board: normalizeBoard(c.canvas_board),
    assets: Array.isArray(c.assets) ? c.assets.map(normalizeAsset) : [],
    ad_brief: normalizeAdBrief(c.ad_brief),
    provider_mode: ['manual', 'mock', 'api'].includes(c.provider_mode) ? c.provider_mode : 'manual',
    api_text_provider_id: selectedTextProvider(c),
    api_image_provider_id: selectedImageProvider(c)
  }
}

// Build a production board from scenes. Columns:
// Competitor Reference -> Adaptation -> Prompt -> Output -> Final Selection.
// Pass `existingBoard` to preserve manual status/positions for matching node ids.
export function buildBoardFromScenes(scenes, existingBoard) {
  const prev = {}
  if (existingBoard && Array.isArray(existingBoard.nodes)) existingBoard.nodes.forEach((n) => (prev[n.id] = n))
  const COLS = ['reference', 'adaptation', 'prompt', 'output', 'final']
  const nodes = []
  const edges = []

  ;(scenes || []).forEach((s, idx) => {
    const mk = (type, title, subtitle, status, data) => {
      const id = `${s.id}-${type}`
      const old = prev[id]
      const col = COLS.indexOf(type)
      return {
        id,
        type,
        title,
        subtitle,
        scene_id: s.id,
        status: old ? old.status : status,
        x: old && typeof old.x === 'number' ? old.x : col * 240,
        y: old && typeof old.y === 'number' ? old.y : idx * 150,
        data: data || {}
      }
    }
    const n = s.scene_number
    const clip = (v, len) => (nonEmpty(v) ? String(v).slice(0, len) : '')
    const ref = mk('reference', `Scene ${n}`, nonEmpty(s.scene_type) ? s.scene_type : clip(s.what_happens, 40) || 'Reference', nonEmpty(s.what_happens) ? 'ready' : 'draft', {
      scene_number: n,
      timestamp_start: s.timestamp_start,
      timestamp_end: s.timestamp_end,
      what_happens: s.what_happens
    })
    const adapt = mk('adaptation', 'Adaptation', clip(s.adaptation_instruction_for_our_product, 40) || '(empty)', nonEmpty(s.adaptation_instruction_for_our_product) ? 'ready' : 'draft', { text: s.adaptation_instruction_for_our_product })
    const prompt = mk('prompt', 'Prompt', nonEmpty(s.output_prompt) ? 'Output prompt' : '(empty)', nonEmpty(s.output_prompt) ? 'ready' : 'draft', { prompt: s.output_prompt })
    const output = mk('output', 'Generated Output', 'Placeholder', 'draft', { provider: s.video_provider || '' })
    const final = mk('final', 'Final Selection', 'Placeholder', 'draft', {})
    nodes.push(ref, adapt, prompt, output, final)

    const e = (a, b) => ({ id: `${s.id}-${a}-${b}`, from: `${s.id}-${a}`, to: `${s.id}-${b}`, label: '→' })
    edges.push(e('reference', 'adaptation'), e('adaptation', 'prompt'), e('prompt', 'output'), e('output', 'final'))
  })

  return { nodes, edges }
}

// Validate AI-returned canvas JSON before applying it.
export function validateCanvasImport(parsed) {
  const errors = []
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, errors: ['JSON must be a single object.'], scenes: [] }
  }
  const scenes = Array.isArray(parsed.scenes) ? parsed.scenes : null
  if (!scenes || !scenes.length) {
    return { ok: false, errors: ['scenes[] is missing or empty.'], scenes: [] }
  }
  scenes.forEach((s, i) => {
    if (!nonEmpty(s.what_happens)) errors.push(`Scene ${i + 1}: what_happens is empty.`)
    if (!nonEmpty(s.adaptation_instruction_for_our_product)) errors.push(`Scene ${i + 1}: adaptation_instruction_for_our_product is empty.`)
    if (!nonEmpty(s.output_prompt)) errors.push(`Scene ${i + 1}: output_prompt is empty.`)
  })
  const normalized = scenes.map((s, i) => normalizeScene(s, i + 1))
  return { ok: errors.length === 0, errors, scenes: normalized }
}

// ---- Scene type presets ----

// Light prefill applied only to EMPTY fields when a preset is chosen.
const PRESETS = {
  Hook: { emotional_purpose: 'Grab attention with a pattern interrupt', product_role: 'Teased or absent', editing_notes: 'Fast cut, strong first frame', adaptation_instruction_for_our_product: 'Recreate the hook energy with our product and a fresh, brand-safe opening frame.' },
  Problem: { emotional_purpose: 'Establish the pain or need', product_role: 'Absent', editing_notes: 'Slower, relatable framing', adaptation_instruction_for_our_product: 'Show our audience’s authentic version of the problem.' },
  Agitation: { emotional_purpose: 'Intensify the frustration', product_role: 'Absent', editing_notes: 'Build tension', adaptation_instruction_for_our_product: 'Heighten the problem for our audience without exaggeration or unsupported claims.' },
  'Product Reveal': { emotional_purpose: 'Introduce the solution', product_role: 'Hero reveal', editing_notes: 'Clean reveal beat', adaptation_instruction_for_our_product: 'Reveal our product as the answer with original styling.' },
  Demo: { emotional_purpose: 'Show it working', product_role: 'In use', editing_notes: 'Clear, satisfying motion', adaptation_instruction_for_our_product: 'Demonstrate our product in use; preserve pacing, change specifics.' },
  Proof: { emotional_purpose: 'Build trust and credibility', product_role: 'Supporting', editing_notes: 'Quick proof cuts', adaptation_instruction_for_our_product: 'Use only supported proof points for our product.' },
  Transformation: { emotional_purpose: 'Show the after-state / relief', product_role: 'Enabler', editing_notes: 'Calm resolve', adaptation_instruction_for_our_product: 'Show the positive shift our product enables, brand-safe.' },
  CTA: { emotional_purpose: 'Prompt action', product_role: 'Foreground', editing_notes: 'End card, clear CTA', adaptation_instruction_for_our_product: 'Close with our CTA and original brand identity.' },
  'Product Hero': { emotional_purpose: 'Leave a strong final impression', product_role: 'Hero', editing_notes: 'Hero composition', adaptation_instruction_for_our_product: 'Final hero shot of our product, clean and original.' },
  Other: {}
}

export const SCENE_TYPES = Object.keys(PRESETS)

const PREFILL_KEYS = ['emotional_purpose', 'product_role', 'editing_notes', 'adaptation_instruction_for_our_product']

const SYNONYMS = {
  hook: 'Hook',
  problem: 'Problem',
  agitate: 'Agitation',
  agitation: 'Agitation',
  'product reveal': 'Product Reveal',
  reveal: 'Product Reveal',
  demo: 'Demo',
  demonstration: 'Demo',
  proof: 'Proof',
  transformation: 'Transformation',
  shift: 'Transformation',
  cta: 'CTA',
  'call to action': 'CTA',
  'product hero': 'Product Hero',
  hero: 'Product Hero'
}

function matchPresetValue(label) {
  const k = String(label || '').trim().toLowerCase()
  if (SYNONYMS[k]) return SYNONYMS[k]
  if (PRESETS[label]) return label
  return ''
}

// Patch to apply when a scene_type preset is chosen: sets scene_type, and fills
// the four helper fields ONLY where they are currently empty.
export function presetPrefillPatch(scene, value) {
  const patch = { scene_type: value }
  const preset = PRESETS[value]
  if (preset) {
    PREFILL_KEYS.forEach((k) => {
      if (!nonEmpty(scene[k]) && nonEmpty(preset[k])) patch[k] = preset[k]
    })
  }
  return patch
}

// ---- Outline parsing ----
// Parses lines like "0:00-0:03 Hook: creator opens fridge" into scenes.
export function parseOutlineToScenes(text) {
  const lines = String(text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  return lines.map((line, idx) => {
    const s = newScene(idx + 1)
    let rest = line
    const m = line.match(/^(\d{1,2}:\d{2}(?::\d{2})?)\s*[-–—]\s*(\d{1,2}:\d{2}(?::\d{2})?)\s*(.*)$/)
    if (m) {
      s.timestamp_start = m[1]
      s.timestamp_end = m[2]
      rest = (m[3] || '').trim()
    }
    const lm = rest.match(/^([A-Za-z][A-Za-z /]*?):\s*(.*)$/)
    if (lm) {
      const label = lm[1].trim()
      const presetValue = matchPresetValue(label)
      if (presetValue) {
        s.scene_type = presetValue
        const preset = PRESETS[presetValue]
        if (preset && nonEmpty(preset.emotional_purpose)) s.emotional_purpose = preset.emotional_purpose
      } else {
        s.emotional_purpose = label
      }
      s.what_happens = lm[2].trim()
    } else {
      s.what_happens = rest
    }
    return s
  })
}

// ---- Readiness checklist (non-blocking) ----
export function canvasReadiness(project) {
  const canvas = project.canvas || {}
  const ref = canvas.competitor_reference || {}
  const defaults = canvas.model_defaults || {}
  const scenes = canvas.scenes || []
  const every = (fn) => scenes.length > 0 && scenes.every(fn)
  return [
    { id: 'ref', label: 'Competitor reference filled', ok: nonEmpty(ref.competitor_ad_name) },
    { id: 'count', label: 'At least 3 scenes', ok: scenes.length >= 3, detail: `${scenes.length} scene(s)` },
    { id: 'timestamps', label: 'Every scene has timestamps', ok: every((s) => nonEmpty(s.timestamp_start) && nonEmpty(s.timestamp_end)) },
    { id: 'what', label: 'Every scene has what happens', ok: every((s) => nonEmpty(s.what_happens)) },
    { id: 'adapt', label: 'Every scene has adaptation instruction', ok: every((s) => nonEmpty(s.adaptation_instruction_for_our_product)) },
    { id: 'output', label: 'Every scene has output prompt', ok: every((s) => nonEmpty(s.output_prompt)) },
    { id: 'providers', label: 'Providers selected (defaults)', ok: nonEmpty(defaults.default_llm_provider) && nonEmpty(defaults.default_image_provider) && nonEmpty(defaults.default_video_provider) }
  ]
}

// ---- No-AI scene prompt skeletons ----
// Builds a useful placeholder output_prompt from a scene's mapped fields.
export function buildSceneSkeletonPrompt(scene, videoProviderId) {
  const parts = []
  const time = nonEmpty(scene.timestamp_start) ? `${scene.timestamp_start}–${scene.timestamp_end || ''}` : ''
  const head = [scene.scene_type, time].filter((x) => nonEmpty(x)).join(' ')
  parts.push(`${head ? head + ' — ' : ''}${nonEmpty(scene.what_happens) ? scene.what_happens : '(describe the shot)'}`.trim())
  if (nonEmpty(scene.adaptation_instruction_for_our_product)) parts.push(`Adapt for our product: ${scene.adaptation_instruction_for_our_product}`)
  const cam = [scene.camera_angle, scene.camera_movement].filter((x) => nonEmpty(x)).join(', ')
  if (cam) parts.push(`Camera: ${cam}`)
  if (nonEmpty(scene.subject_action)) parts.push(`Subject: ${scene.subject_action}`)
  if (nonEmpty(scene.product_role)) parts.push(`Product role: ${scene.product_role}`)
  parts.push('Brand-safe: no competitor logos, exact claims, actors, or protected assets.')
  if (nonEmpty(videoProviderId)) parts.push(`Target tool: ${providerName(videoProviderId)}`)
  return parts.join('\n')
}

// ---- Sync canvas → competitor method_data ----
// Returns a patch to merge into project.method_data so Final Export is complete
// even before an AI round-trip.
export function canvasToMethodData(project) {
  const canvas = project.canvas || {}
  const scenes = canvas.scenes || []
  const defaults = canvas.model_defaults || {}

  const competitor_structure = scenes.length
    ? scenes.map((s) => `${s.scene_number}. [${s.scene_type || '—'}] ${s.timestamp_start || '?'}–${s.timestamp_end || '?'}: ${s.what_happens || ''}`.trim()).join('\n')
    : ''
  const adaptedLines = scenes.filter((s) => nonEmpty(s.adaptation_instruction_for_our_product)).map((s) => `${s.scene_number}. ${s.adaptation_instruction_for_our_product}`)
  const adapted_structure = adaptedLines.length ? adaptedLines.join('\n') : ''
  const shot_by_shot_plan = scenes.map((s) => ({
    shot: s.scene_number,
    competitor_beat: s.what_happens || '',
    adapted_shot: s.adaptation_instruction_for_our_product || '',
    frame_prompt: s.output_prompt || '',
    brand_safe_change: ''
  }))
  const required_assets = scenes.filter((s) => nonEmpty(s.required_assets)).map((s) => `Scene ${s.scene_number}: ${s.required_assets}`)
  const ps = (label, id) => `${label}: ${nonEmpty(id) ? providerName(id) : '(none)'}`
  const providers_summary = [ps('LLM', defaults.default_llm_provider), ps('Image', defaults.default_image_provider), ps('Video', defaults.default_video_provider)].join('; ')

  return { competitor_structure, adapted_structure, shot_by_shot_plan, required_assets, providers_summary }
}
