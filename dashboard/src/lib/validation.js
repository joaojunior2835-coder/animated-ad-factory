// Method-aware validation gate. validateProject reads selected_method and runs
// only that method's validation_profile, plus a universal brand-context check and
// light universal warnings. Pure function.

import { INTAKE_FIELDS } from '../data/stages.js'
import { durationStatus } from './projectModel.js'
import { isActive } from './brandDocs.js'
import { getMethod } from '../data/adMethods.js'

const REQUIRED_BRIEF_KEYS = ['product_name', 'product_description', 'offer', 'target_audience', 'market_language', 'visual_style', 'product_benefits']

function nonEmpty(v) {
  return String(v == null ? '' : v).trim().length > 0
}

function activeBrandDocs(project) {
  return (project.brand_docs || []).filter((d) => isActive(d) && nonEmpty(d.content))
}

function readPath(project, path) {
  if (!path) return undefined
  const idx = path.indexOf(':')
  const scope = path.slice(0, idx)
  const key = path.slice(idx + 1)
  if (scope === 'intake') return (project.product_intake || {})[key]
  if (scope === 'project') return project[key]
  if (scope === 'data') return (project.method_data || {})[key]
  return undefined
}

// Canvas-first scenes for competitor validation: prefer the live Canvas scenes;
// fall back to a legacy shot_by_shot_plan so old projects still validate.
function effectiveScenes(project) {
  const scenes = (project.canvas && project.canvas.scenes) || []
  if (scenes.length) return scenes
  const sbs = (project.method_data || {}).shot_by_shot_plan
  if (Array.isArray(sbs) && sbs.length) {
    return sbs.map((it, i) => ({
      __legacy: true,
      scene_number: it.shot || i + 1,
      what_happens: it.competitor_beat || '',
      adaptation_instruction_for_our_product: it.adapted_shot || '',
      output_prompt: it.frame_prompt || ''
    }))
  }
  return []
}

// Interpret a single validation_profile descriptor against the project.
function runProfileCheck(project, c) {
  const out = (status, detail) => ({ id: c.id, label: c.label, status, detail })

  switch (c.kind) {
    // ---- Canvas-aware checks (Competitor Video Recreation source of truth) ----
    case 'canvas_ref': {
      const ref = (project.canvas && project.canvas.competitor_reference) || {}
      const ok = nonEmpty(ref.competitor_ad_name) || nonEmpty(ref.competitor_brand) || nonEmpty((project.method_data || {}).competitor_structure)
      return out(ok ? 'pass' : 'fail', ok ? 'Present.' : 'Add a competitor reference in the Canvas.')
    }
    case 'canvas_min': {
      const scenes = effectiveScenes(project)
      const min = c.min || 3
      return out(scenes.length >= min ? 'pass' : 'fail', `${scenes.length} scene(s) (need ${min}).`)
    }
    case 'canvas_timestamps': {
      const scenes = effectiveScenes(project)
      if (!scenes.length) return out('fail', 'No scenes.')
      const missing = scenes.map((s, i) => ({ n: s.scene_number || i + 1, ok: s.__legacy || (nonEmpty(s.timestamp_start) && nonEmpty(s.timestamp_end)) })).filter((x) => !x.ok).map((x) => x.n)
      return out(missing.length ? 'fail' : 'pass', missing.length ? `Missing in scene(s): ${missing.join(', ')}` : `Present in all ${scenes.length}.`)
    }
    case 'canvas_field': {
      const scenes = effectiveScenes(project)
      if (!scenes.length) return out('fail', 'No scenes.')
      const missing = scenes.map((s, i) => ({ n: s.scene_number || i + 1, ok: nonEmpty(s[c.field]) })).filter((x) => !x.ok).map((x) => x.n)
      return out(missing.length ? 'fail' : 'pass', missing.length ? `Missing in scene(s): ${missing.join(', ')}` : `Present in all ${scenes.length}.`)
    }
    case 'canvas_adapt_or_output': {
      const scenes = effectiveScenes(project)
      if (!scenes.length) return out('fail', 'No scenes.')
      const missing = scenes.map((s, i) => ({ n: s.scene_number || i + 1, ok: nonEmpty(s.adaptation_instruction_for_our_product) || nonEmpty(s.output_prompt) })).filter((x) => !x.ok).map((x) => x.n)
      return out(missing.length ? 'fail' : 'pass', missing.length ? `Missing in scene(s): ${missing.join(', ')}` : `Present in all ${scenes.length}.`)
    }

    case 'text': {
      const v = readPath(project, c.path)
      return out(nonEmpty(v) ? 'pass' : 'fail', nonEmpty(v) ? 'Present.' : 'Missing.')
    }
    case 'array': {
      const v = readPath(project, c.path)
      const ok = Array.isArray(v) && v.length > 0
      return out(ok ? 'pass' : 'fail', ok ? `${v.length} item(s).` : 'None.')
    }
    case 'array_items': {
      const v = readPath(project, c.path)
      if (!Array.isArray(v) || !v.length) return out('fail', 'None.')
      const missing = v.map((it, i) => ({ n: i + 1, ok: nonEmpty(it && it[c.field]) })).filter((x) => !x.ok).map((x) => x.n)
      return out(missing.length ? 'fail' : 'pass', missing.length ? `Missing in item(s): ${missing.join(', ')}` : `Present in all ${v.length}.`)
    }
    case 'clips': {
      const clips = project.clips || []
      return out(clips.length > 0 ? 'pass' : 'fail', clips.length > 0 ? `${clips.length} clip(s).` : 'No clips.')
    }
    case 'clip_field': {
      const clips = project.clips || []
      if (!clips.length) return out('fail', 'No clips.')
      const missing = clips.map((cl, i) => ({ n: i + 1, ok: nonEmpty(cl && cl[c.clipField]) })).filter((x) => !x.ok).map((x) => x.n)
      return out(missing.length ? 'fail' : 'pass', missing.length ? `Missing in clip(s): ${missing.join(', ')}` : `Present in all ${clips.length}.`)
    }
    case 'duration': {
      const ds = durationStatus(project)
      return out(ds.ok ? 'pass' : 'fail', ds.message)
    }
    case 'bridge': {
      const clips = project.clips || []
      if (clips.length <= 1) return out('pass', clips.length === 1 ? 'Single clip — no bridge needed.' : 'No clips yet.')
      const missing = clips.slice(0, -1).map((cl, i) => ({ n: i + 1, ok: nonEmpty(cl.bridge_check) })).filter((x) => !x.ok).map((x) => x.n)
      return out(missing.length ? 'fail' : 'pass', missing.length ? `Missing in clip(s): ${missing.join(', ')}` : 'Present where needed.')
    }
    case 'script': {
      const si = project.script_import || {}
      const ok = nonEmpty(si.script) || nonEmpty(project.voiceover_script) || nonEmpty((project.method_data || {}).script_reference)
      return out(ok ? 'pass' : 'fail', ok ? 'Present.' : 'Import a script or fill voiceover.')
    }
    case 'hook': {
      const si = project.script_import || {}
      const ok = nonEmpty(si.hook) || nonEmpty((project.method_data || {}).hook)
      return out(ok ? 'pass' : 'fail', ok ? 'Present.' : 'Add a hook.')
    }
    default:
      return out('pass', '')
  }
}

export function validateProject(project) {
  const method = getMethod(project.selected_method)
  const intake = project.product_intake || {}
  const activeDocs = activeBrandDocs(project)
  const briefFilled = REQUIRED_BRIEF_KEYS.every((k) => nonEmpty(intake[k]))

  const checks = []

  // Universal: there must be product context (doc-first OR a filled brief).
  checks.push({
    id: 'brand_or_brief',
    label: 'Active brand doc or product brief present',
    status: activeDocs.length >= 1 || briefFilled ? 'pass' : 'fail',
    detail: activeDocs.length >= 1 ? `${activeDocs.length} active brand doc(s).` : briefFilled ? 'Product brief is filled.' : 'Add an active brand doc or fill the product/offer brief.'
  })

  // Method-specific checks.
  for (const c of method.validation_profile) checks.push(runProfileCheck(project, c))

  // Light universal warnings (non-blocking, method-agnostic).
  const warnings = []
  const warn = (cond, label, detail) => {
    if (cond) warnings.push({ id: label, label, status: 'warn', detail })
  }
  warn(!nonEmpty(intake.product_description), 'Product description is blank', 'Often fine if the offer explains the product; fill if unclear.')
  warn(activeDocs.length === 0, 'No active brand docs', 'Mark a Brand Library doc active to inform the AI prompt.')

  const passed = checks.filter((c) => c.status === 'pass')
  const failed = checks.filter((c) => c.status === 'fail')

  return { method: method.id, methodName: method.name, checks, passed, failed, warnings, ready: failed.length === 0 }
}

// Hard stop for the Flow Package export: product name + market/language. Applies
// to every method. Does NOT affect AI Handoff, Auto-Brief, or Project JSON export.
export function exportBlockReason(project) {
  const intake = project.product_intake || {}
  const blocked = !nonEmpty(intake.product_name) || !nonEmpty(intake.market_language)
  return blocked ? 'Final export blocked: product name and market/language are required.' : null
}

// Method-specific missing fields (the failed checks for the selected method).
export function missingSections(project) {
  return validateProject(project).failed.map((c) => c.label)
}
