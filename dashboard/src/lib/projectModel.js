// Structured project state: factory, clip factory, duration validation, and a
// normalizer that produces the clean JSON used for the preview and export.
// Pure functions, no React, no browser APIs.

import { INTAKE_FIELDS } from '../data/stages.js'
import { makeDoc, normalizeDoc, uid as docUid } from './brandDocs.js'
import { DEFAULT_METHOD_ID, METHOD_DATA_KEYS } from '../data/adMethods.js'
import { emptyCanvas, normalizeCanvas } from './canvasModel.js'
import { emptyNodeCanvas, normalizeNodeCanvas } from './nodeCanvasModel.js'

export function uid() {
  return docUid()
}

export function newBrandDoc(title = '', content = '', extra = {}) {
  return makeDoc({ title, content, source_type: 'paste', global: false, active_for_project: true, ...extra })
}

export function newClip(number) {
  return {
    clip_number: number,
    duration_seconds: 6,
    scene_purpose: '',
    start_state: '',
    end_state: '',
    start_frame_prompt: '',
    end_frame_prompt: '',
    flow_agent_prompt: '',
    attach_instructions: '',
    bridge_check: '',
    continuity_references: [],
    negative_constraints: []
  }
}

// Normalize the brief intake: ensure every field key exists plus the optional
// compliance notes, and migrate the legacy `claims_restrictions` field into
// `optional_compliance_notes` so old saved/imported projects keep their text.
export function normalizeIntake(intake) {
  const base = {}
  INTAKE_FIELDS.forEach((f) => {
    base[f.key] = ''
  })
  base.optional_compliance_notes = ''
  const it = intake || {}
  const merged = { ...base, ...it }
  if (!String(merged.optional_compliance_notes || '').trim() && String(it.claims_restrictions || '').trim()) {
    merged.optional_compliance_notes = it.claims_restrictions
  }
  delete merged.claims_restrictions
  return merged
}

export function emptyProject() {
  const product_intake = normalizeIntake({})
  return {
    selected_method: DEFAULT_METHOD_ID,
    method_data: {},
    canvas: emptyCanvas(),
    node_canvas: emptyNodeCanvas(),
    brand_docs: [],
    product_intake,
    script_import: { script: '', notes: '', hook: '', cta: '' },
    audience_psychology: '',
    ad_concept: '',
    story_beats: '',
    continuity_bible: '',
    clips: [],
    voiceover_script: '',
    music_direction: '',
    edit_plan: '',
    negative_constraints: [],
    // Scratch notes for the clip stages; not part of the exported package.
    notes: { frame_prompts: '', flow_clip_prompts: '' }
  }
}

// Declared total duration is read from the intake "Ad duration" field
// (e.g. "30 seconds" -> 30). Returns null when no number is present.
export function parseDeclaredDuration(intake) {
  const match = String((intake && intake.ad_duration) || '').match(/\d+(\.\d+)?/)
  return match ? Number(match[0]) : null
}

export function sumClipDurations(clips) {
  return (clips || []).reduce((total, c) => total + (Number(c.duration_seconds) || 0), 0)
}

export function durationStatus(project) {
  const declared = parseDeclaredDuration(project.product_intake)
  const sum = sumClipDurations(project.clips)
  const clipCount = (project.clips || []).length

  if (clipCount === 0) {
    return { declared, sum, difference: declared == null ? null : sum - declared, ok: false, state: 'empty', message: 'No clips yet.' }
  }
  if (declared == null) {
    return { declared: null, sum, difference: null, ok: false, state: 'unset', message: 'Set "Ad duration" in Product Intake to validate.' }
  }
  const difference = sum - declared
  if (difference === 0) {
    return { declared, sum, difference, ok: true, state: 'ok', message: 'Valid — clip durations match the declared total.' }
  }
  const sign = difference > 0 ? '+' : '-'
  return {
    declared,
    sum,
    difference,
    ok: false,
    state: 'mismatch',
    message: `Mismatch — declared ${declared}s, clips sum to ${sum}s (difference ${sign}${Math.abs(difference)}s).`
  }
}

function cleanLines(arr) {
  return (arr || []).map((s) => String(s).trim()).filter(Boolean)
}

// Clean structured object for the JSON preview and the export. Drops scratch
// notes, trims empty constraint lines, and renumbers clips sequentially.
export function normalizeProject(project) {
  const clips = (project.clips || []).map((c, i) => ({
    clip_number: i + 1,
    duration_seconds: Number(c.duration_seconds) || 0,
    scene_purpose: c.scene_purpose || '',
    start_state: c.start_state || '',
    end_state: c.end_state || '',
    start_frame_prompt: c.start_frame_prompt || '',
    end_frame_prompt: c.end_frame_prompt || '',
    flow_agent_prompt: c.flow_agent_prompt || '',
    attach_instructions: c.attach_instructions || '',
    bridge_check: c.bridge_check || '',
    continuity_references: cleanLines(c.continuity_references),
    negative_constraints: cleanLines(c.negative_constraints)
  }))

  const brand_docs = (project.brand_docs || []).map((d) => normalizeDoc(d, { global: false }))

  const si = project.script_import || {}

  return {
    selected_method: project.selected_method || DEFAULT_METHOD_ID,
    method_data: project.method_data && typeof project.method_data === 'object' ? project.method_data : {},
    canvas: normalizeCanvas(project.canvas),
    node_canvas: normalizeNodeCanvas(project.node_canvas),
    brand_docs,
    product_intake: normalizeIntake(project.product_intake),
    script_import: { script: si.script || '', notes: si.notes || '', hook: si.hook || '', cta: si.cta || '' },
    audience_psychology: project.audience_psychology || '',
    ad_concept: project.ad_concept || '',
    story_beats: project.story_beats || '',
    continuity_bible: project.continuity_bible || '',
    clips,
    voiceover_script: project.voiceover_script || '',
    music_direction: project.music_direction || '',
    edit_plan: project.edit_plan || '',
    negative_constraints: cleanLines(project.negative_constraints)
  }
}

// Coerce a parsed object (from an imported JSON file or AI JSON) into a valid
// project shape. When `current` is provided, keys the parsed object omits are
// backfilled from the current project — so an AI JSON that only fills authoring
// fields does not wipe the brief, imported script, or project brand docs.
export function fromImported(parsed, current = null) {
  const base = emptyProject()
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return current ? { ...current } : base

  const cur = current || {}
  const has = (key) => Object.prototype.hasOwnProperty.call(parsed, key) && parsed[key] != null
  const text = (key) => (has(key) ? parsed[key] : cur[key] || '')

  const clips = Array.isArray(parsed.clips)
    ? parsed.clips.map((c, i) => ({
        ...newClip(i + 1),
        ...c,
        clip_number: i + 1,
        continuity_references: Array.isArray(c && c.continuity_references) ? c.continuity_references : [],
        negative_constraints: Array.isArray(c && c.negative_constraints) ? c.negative_constraints : []
      }))
    : Array.isArray(cur.clips)
    ? cur.clips
    : []

  const rawBrand = Array.isArray(parsed.brand_docs)
    ? parsed.brand_docs
    : Array.isArray(cur.brand_docs)
    ? cur.brand_docs
    : []
  const brand_docs = rawBrand.map((d) => normalizeDoc(d, { global: false }))

  const intake = normalizeIntake(
    has('product_intake')
      ? { ...base.product_intake, ...parsed.product_intake }
      : cur.product_intake
      ? { ...base.product_intake, ...cur.product_intake }
      : base.product_intake
  )

  const siSrc = has('script_import') ? parsed.script_import : cur.script_import || {}
  const script_import = { script: siSrc.script || '', notes: siSrc.notes || '', hook: siSrc.hook || '', cta: siSrc.cta || '' }

  const negatives = Array.isArray(parsed.negative_constraints)
    ? parsed.negative_constraints
    : Array.isArray(cur.negative_constraints)
    ? cur.negative_constraints
    : []

  // Method-specific data: keep current, merge any parsed.method_data, then capture
  // any method keys the AI returned at the top level.
  const method_data = {
    ...(cur.method_data && typeof cur.method_data === 'object' ? cur.method_data : {}),
    ...(parsed.method_data && typeof parsed.method_data === 'object' ? parsed.method_data : {})
  }
  METHOD_DATA_KEYS.forEach((k) => {
    if (parsed[k] != null) method_data[k] = parsed[k]
  })

  const canvas = normalizeCanvas(parsed.canvas || cur.canvas || base.canvas)

  return {
    ...base,
    selected_method: parsed.selected_method || cur.selected_method || DEFAULT_METHOD_ID,
    method_data,
    canvas,
    brand_docs,
    product_intake: intake,
    script_import,
    audience_psychology: text('audience_psychology'),
    ad_concept: text('ad_concept'),
    story_beats: text('story_beats'),
    continuity_bible: text('continuity_bible'),
    clips,
    voiceover_script: text('voiceover_script'),
    music_direction: text('music_direction'),
    edit_plan: text('edit_plan'),
    negative_constraints: negatives,
    notes: { ...base.notes, ...(cur.notes || {}), ...(parsed.notes || {}) }
  }
}
