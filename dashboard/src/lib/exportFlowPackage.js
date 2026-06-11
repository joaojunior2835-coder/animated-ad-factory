// Method-aware ad package export. A shared header (overview, method, brand docs,
// brief, compliance, imported script) is followed by a method-specific body and a
// shared footer (negative constraints + checklist).

import { INTAKE_FIELDS } from '../data/stages.js'
import { normalizeProject, durationStatus } from './projectModel.js'
import { isActive } from './brandDocs.js'
import { getMethod, recommendedToolNames } from '../data/adMethods.js'
import { providerName } from '../data/providers.js'
import { mediaSource, sumSceneDurations, parseDeclaredSeconds, durationStatus as canvasDurationStatus, findSceneGaps, assessExportReadiness, isCompetitorMethod } from './canvasModel.js'

function fmtSize(bytes) {
  const n = Number(bytes) || 0
  if (n <= 0) return ''
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

// A markdown tag describing where a variation's media lives (local disk / external
// URL / mock / session-only), including local_url, file name and size when present.
function mediaTag(v) {
  const src = mediaSource(v, false)
  if (src.storage === 'local_disk') {
    const size = fmtSize(v.file_size)
    return ` [local disk: ${v.file_name || 'file'}${size ? ', ' + size : ''}] <${v.local_url}>`
  }
  if (src.storage === 'mock') return ' [mock result]'
  if (src.storage === 'external_url') return ` <${v.external_url}>`
  if (v.file_name) return ` [file: ${v.file_name} — preview session-only, not saved]`
  return ''
}

// Normalized media-result metadata recorded on a variation (only non-empty parts).
function mediaMeta(v) {
  const bits = []
  if (v.source_type) bits.push(`source: ${v.source_type}`)
  if (v.storage) bits.push(`storage: ${v.storage}`)
  if (v.action_type) bits.push(`action: ${v.action_type}`)
  if (v.model) bits.push(`model: ${v.model}`)
  if (v.request_id) bits.push(`req: ${v.request_id}`)
  if (v.created_at) bits.push(`at: ${v.created_at}`)
  return bits.length ? ` { ${bits.join(' · ')} }` : ''
}

export function slugify(value) {
  const s = String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return s || 'animated-ad'
}

function textBlock(value) {
  const t = String(value || '').trim()
  return t || '_(not yet written)_'
}

function fenced(value) {
  const t = String(value || '').trim()
  if (!t) return '_(empty)_'
  return '```text\n' + t + '\n```'
}

function attachFor(clip) {
  const t = String(clip.attach_instructions || '').trim()
  if (t) return t
  return `Attach:\n- Clip ${clip.clip_number} start frame image\n- Clip ${clip.clip_number} end frame image`
}

function section(out, title, value) {
  out.push(`## ${title}`, '', textBlock(value), '')
}

function optionalSection(out, title, value) {
  if (String(value || '').trim()) section(out, title, value)
}

function stringArraySection(out, title, arr) {
  out.push(`## ${title}`, '')
  if (Array.isArray(arr) && arr.length) {
    for (const item of arr) out.push(`- ${typeof item === 'string' ? item : JSON.stringify(item)}`)
  } else {
    out.push('_(none)_')
  }
  out.push('')
}

function objectArraySection(out, title, arr, fields) {
  out.push(`## ${title}`, '')
  if (Array.isArray(arr) && arr.length) {
    arr.forEach((item, i) => {
      out.push(`### ${i + 1}`)
      for (const [key, label] of fields) {
        const v = item && item[key]
        if (Array.isArray(v)) {
          if (v.length) out.push(`- **${label}:** ${v.join(', ')}`)
        } else if (String(v || '').trim()) {
          out.push(`- **${label}:** ${v}`)
        }
      }
      out.push('')
    })
  } else {
    out.push('_(none)_', '')
  }
}

// ---- method bodies ----

function animatedBody(out, p, clips) {
  section(out, 'Audience / Avatar', p.audience_psychology)
  section(out, 'Visual Concept', p.ad_concept)
  section(out, 'Story Beats', p.story_beats)
  section(out, 'Continuity Bible', p.continuity_bible)

  out.push('## Clip-by-Clip Plan', '')
  if (clips.length === 0) {
    out.push('_(no clips yet)_', '')
  } else {
    out.push('| Clip | Duration | Purpose |', '| --- | --- | --- |')
    for (const c of clips) out.push(`| ${c.clip_number} | ${c.duration_seconds}s | ${(c.scene_purpose || '').replace(/\|/g, '\\|') || '_(none)_'} |`)
    out.push('')
    for (const c of clips) {
      out.push(`**Clip ${c.clip_number} (${c.duration_seconds}s)** — ${c.scene_purpose || '_(no purpose)_'}`, '')
      if (c.start_state) out.push(`- **Start state:** ${c.start_state}`)
      if (c.end_state) out.push(`- **End state:** ${c.end_state}`)
      out.push(`- **Bridge check:** ${c.bridge_check || '_(none)_'}`)
      if (c.continuity_references.length) out.push(`- **Continuity references:** ${c.continuity_references.join(', ')}`)
      out.push('')
    }
  }

  const perClip = (title, render) => {
    out.push(`## ${title}`, '')
    for (const c of clips) {
      out.push(`### Clip ${c.clip_number}`, '')
      out.push(render(c), '')
    }
  }
  perClip('Start-Frame Prompts', (c) => fenced(c.start_frame_prompt))
  perClip('End-Frame Prompts', (c) => fenced(c.end_frame_prompt))
  perClip('Attach Instructions', (c) => fenced(attachFor(c)))
  perClip('Flow Agent Mode Prompts', (c) => fenced(c.flow_agent_prompt))

  optionalSection(out, 'Voiceover Timing', p.voiceover_script)
  section(out, 'Music Direction', p.music_direction)
  section(out, 'Edit Plan', p.edit_plan)
}

function staticBody(out, p, md) {
  optionalSection(out, 'Audience / Avatar', p.audience_psychology)
  out.push('## Static Concepts', '')
  const concepts = Array.isArray(md.static_concepts) ? md.static_concepts : []
  if (concepts.length) {
    concepts.forEach((c, i) => {
      out.push(`### Concept ${i + 1}${c.angle ? ' — ' + c.angle : ''}`, '')
      if (c.headline) out.push(`- **Headline:** ${c.headline}`)
      if (c.format) out.push(`- **Format:** ${c.format}`)
      if (c.layout_notes) out.push(`- **Layout notes:** ${c.layout_notes}`)
      if (Array.isArray(c.negative_constraints) && c.negative_constraints.length) out.push(`- **Negative constraints:** ${c.negative_constraints.join(', ')}`)
      out.push('', '**Image prompt**', '', fenced(c.visual_prompt), '')
    })
  } else {
    out.push('_(none)_', '')
  }
  stringArraySection(out, 'Export Formats', md.export_formats)
}

function ugcBody(out, p, md) {
  optionalSection(out, 'Audience / Avatar', p.audience_psychology)
  const scriptRef = String(md.script_reference || '').trim()
  section(out, 'Script / Imported Script', scriptRef || (p.script_import && p.script_import.script) || '')
  section(out, 'Performance Direction', md.performance_direction)
  optionalSection(out, 'Talking-Head Notes', md.talking_head_notes)
  stringArraySection(out, 'Shot List', md.shot_list)
  objectArraySection(out, 'B-roll Plan', md.broll_plan, [['timecode', 'Timecode'], ['visual', 'Visual'], ['source', 'Source']])
  section(out, 'Edit Plan', p.edit_plan)
}

function competitorBody(out, p, md) {
  const canvas = p.canvas || {}
  const ref = canvas.competitor_reference || {}
  const defaults = canvas.model_defaults || {}
  const scenes = canvas.scenes || []
  const cell = (v) => String(v || '').replace(/\|/g, '\\|').replace(/\n+/g, ' ')
  const pn = (id) => (String(id || '').trim() ? providerName(id) : '_(default / none)_')

  // Competitor Reference
  out.push('## Competitor Reference', '')
  out.push(`- **Ad name:** ${ref.competitor_ad_name || '_(none)_'}`)
  out.push(`- **Brand:** ${ref.competitor_brand || '_(none)_'}`)
  out.push(`- **Source URL:** ${ref.source_url || '_(none)_'}`)
  out.push(`- **Platform:** ${ref.platform || '_(none)_'}`)
  out.push(`- **Ad duration:** ${ref.ad_duration || '_(none)_'}`)
  if (String(ref.notes || '').trim()) out.push(`- **Notes:** ${ref.notes}`)
  out.push('')

  // Adaptation Strategy
  out.push('## Adaptation Strategy', '')
  out.push(`- **Competitor structure:** ${md.competitor_structure || '_(none)_'}`)
  out.push(`- **Adapted structure:** ${md.adapted_structure || '_(none)_'}`)
  out.push(`- **Visual style transfer notes:** ${md.visual_style_transfer_notes || '_(none)_'}`)
  out.push('')

  // Ad Brief (decoded competitor structure → adapted brief for OUR product).
  const brief = canvas.ad_brief || {}
  const decoded = Array.isArray(brief.decoded_structure) ? brief.decoded_structure : []
  const dontCopy = Array.isArray(brief.dont_copy) ? brief.dont_copy : []
  const preserve = Array.isArray(brief.preserve) ? brief.preserve : []
  if (decoded.length || String(brief.adapted_script || '').trim() || dontCopy.length || preserve.length) {
    out.push('## Ad Brief', '')
    if (decoded.length) {
      out.push('**Decoded structure**', '')
      for (const b of decoded) {
        const head = [b.beat_name || 'beat', b.timestamp_range ? `(${b.timestamp_range})` : ''].filter(Boolean).join(' ')
        out.push(`- **${head}:** ${cell(b.what_competitor_does) || '_(n/a)_'}${b.why_it_works ? ` — why: ${cell(b.why_it_works)}` : ''}`)
      }
      out.push('')
    }
    if (String(brief.adapted_script || '').trim()) {
      out.push('**Adapted script**', '', fenced(brief.adapted_script), '')
    }
    if (dontCopy.length) out.push(`- **Don’t copy:** ${dontCopy.join('; ')}`)
    if (preserve.length) out.push(`- **Preserve:** ${preserve.join('; ')}`)
    out.push('')
  }

  // Scene Board
  out.push('## Scene Board', '')
  if (scenes.length) {
    out.push('| Scene | Time | What happens | Adaptation |', '| --- | --- | --- | --- |')
    for (const s of scenes) out.push(`| ${s.scene_number} | ${cell(s.timestamp_start)}–${cell(s.timestamp_end)} | ${cell(s.what_happens) || '_(none)_'} | ${cell(s.adaptation_instruction_for_our_product) || '_(none)_'} |`)
    out.push('')
  } else {
    out.push('_(no scenes yet)_', '')
  }

  // Scene-by-Scene Prompts
  out.push('## Scene-by-Scene Prompts', '')
  for (const s of scenes) {
    out.push(`### Scene ${s.scene_number}`, '')
    if (String(s.adaptation_instruction_for_our_product || '').trim()) out.push(`- **Adaptation:** ${s.adaptation_instruction_for_our_product}`)
    out.push('', fenced(s.output_prompt), '')
  }

  // Selected Providers
  out.push('## Selected Providers', '')
  out.push(`- **Default LLM:** ${pn(defaults.default_llm_provider)}`)
  out.push(`- **Default image:** ${pn(defaults.default_image_provider)}`)
  out.push(`- **Default video:** ${pn(defaults.default_video_provider)}`)
  if (String(defaults.default_voice_provider || '').trim()) out.push(`- **Default voice:** ${pn(defaults.default_voice_provider)}`)
  if (String(defaults.default_music_provider || '').trim()) out.push(`- **Default music:** ${pn(defaults.default_music_provider)}`)
  out.push('')

  // Required Assets
  out.push('## Required Assets', '')
  const assets = scenes.filter((s) => String(s.required_assets || '').trim())
  if (assets.length) {
    for (const s of assets) out.push(`- Scene ${s.scene_number}: ${s.required_assets}`)
  } else {
    out.push('_(none specified)_')
  }
  out.push('')

  section(out, 'Edit Plan', p.edit_plan)

  // Production board (if built)
  const board = canvas.canvas_board || { nodes: [], edges: [] }
  const nodes = board.nodes || []
  const edges = board.edges || []
  out.push('## Board Nodes Summary', '')
  if (nodes.length) {
    for (const n of nodes) out.push(`- [${n.status}] ${n.type} — ${n.title}${n.subtitle ? ': ' + n.subtitle : ''}`)
  } else {
    out.push('_(no board built)_')
  }
  out.push('')

  out.push('## Board Edges Summary', '')
  if (edges.length) {
    for (const e of edges) out.push(`- ${e.from} → ${e.to}${e.label && e.label !== '→' ? ' (' + e.label + ')' : ''}`)
  } else {
    out.push('_(none)_')
  }
  out.push('')

  out.push('## Final Selections', '')
  const selected = nodes.filter((n) => n.status === 'selected')
  if (selected.length) {
    for (const n of selected) out.push(`- ${n.title}${n.subtitle ? ' — ' + n.subtitle : ''} (${n.type})`)
  } else {
    out.push('_(none selected)_')
  }
  out.push('')

  // Asset Tray
  const cassets = canvas.assets || []
  out.push('## Asset Tray Summary', '')
  if (cassets.length) {
    for (const a of cassets) {
      const sc = (canvas.scenes || []).find((s) => s.id === a.linked_scene_id)
      const link = a.local_url ? ` [local disk] <${a.local_url}>` : a.external_url ? ` <${a.external_url}>` : ''
      out.push(`- [${a.status}] ${a.type} — ${a.title}${sc ? ` (Scene ${sc.scene_number})` : ''}${a.file_name ? ` [${a.file_name}]` : ''}${link}`)
    }
  } else {
    out.push('_(no assets)_')
  }
  out.push('')

  // Scene Variations
  out.push('## Scene Variations', '')
  const anyVar = (canvas.scenes || []).some((s) => (s.variations || []).length)
  if (anyVar) {
    for (const s of canvas.scenes || []) {
      const vars = s.variations || []
      if (!vars.length) continue
      out.push(`**Scene ${s.scene_number}**`)
      for (const v of vars) {
        const prov = v.provider ? providerName(v.provider) : ''
        out.push(`- [${v.status}] ${v.label} (${v.type})${prov ? ' · ' + prov : ''}${mediaTag(v)}${mediaMeta(v)}`)
      }
      out.push('')
    }
  } else {
    out.push('_(no variations)_', '')
  }

  // Final Timeline / Selected Outputs
  out.push('## Final Timeline', '')
  const timeline = (canvas.scenes || []).map((s) => ({ s, v: (s.variations || []).find((x) => x.status === 'selected') })).filter((t) => t.v)
  if (timeline.length) {
    for (const { s, v } of timeline) {
      const prov = v.provider ? providerName(v.provider) : ''
      const storage = mediaSource(v, false).storage
      out.push(`- Scene ${s.scene_number} (${s.timestamp_start || '?'}–${s.timestamp_end || '?'}): Variation ${v.label}${prov ? ' · ' + prov : ''} · storage: ${storage}${mediaTag(v)}${mediaMeta(v)}${v.notes ? ' — ' + v.notes : ''}`)
    }
  } else {
    out.push('_(no selected output yet)_')
  }
  out.push('')

  // Timeline Duration: per-scene durations + summed total over timeline scenes
  // (those with a selected variation), plus declared-vs-summed comparison if any.
  out.push('## Timeline Duration', '')
  const durScenes = timeline.map((t) => t.s)
  if (durScenes.length) {
    for (const s of durScenes) out.push(`- Scene ${s.scene_number}: ${Number(s.duration_seconds) || 0}s`)
    const summed = sumSceneDurations(durScenes)
    out.push('', `**Summed total:** ${summed}s`)
    const declared = parseDeclaredSeconds((p.product_intake || {}).ad_duration)
    if (declared != null) {
      const st = canvasDurationStatus(declared, summed)
      out.push(`**Declared:** ${st.declared}s · **Difference:** ${st.difference > 0 ? '+' : ''}${st.difference}s · **${st.status === 'valid' ? 'Valid' : 'Mismatch'}**`)
    }
  } else {
    out.push('_(no timeline scenes)_')
  }
  out.push('')

  // Export readiness: scenes that aren't ready (no variations / no selection).
  out.push('## Timeline Gaps', '')
  const gaps = findSceneGaps(canvas.scenes || [])
  if (gaps.length) {
    out.push(`**⚠️ ${gaps.length} scene(s) not export-ready:**`)
    for (const g of gaps) out.push(`- Scene ${g.scene_number}: ${g.reason === 'no_variations' ? 'no variations' : 'no selected variation'}`)
  } else {
    out.push('**✓ Package complete — every scene has a selected variation.**')
  }
  out.push('')
}

function demoBody(out, p, md) {
  optionalSection(out, 'Audience / Avatar', p.audience_psychology)
  section(out, 'Demo Flow', md.demo_sequence)
  objectArraySection(out, 'Feature Mapping', md.feature_mapping, [['feature', 'Feature'], ['benefit', 'Benefit'], ['shot', 'Shot']])
  stringArraySection(out, 'Shot List', md.shot_list)
  section(out, 'Edit Plan', p.edit_plan)
}

function hookBody(out, p, md) {
  optionalSection(out, 'Audience / Avatar', p.audience_psychology)
  objectArraySection(out, 'Hook List', md.hook_list, [['angle_label', 'Angle'], ['verbal_hook', 'Verbal hook'], ['first_frame_or_line', 'First frame / line']])
  section(out, 'Ranking Logic', md.ranking_logic)
}

export function buildFlowPackageMarkdown(rawProject) {
  const p = normalizeProject(rawProject)
  const status = durationStatus(rawProject)
  const intake = p.product_intake || {}
  const clips = p.clips || []
  const md = p.method_data || {}
  const script = p.script_import || {}
  const activeDocs = (p.brand_docs || []).filter((d) => isActive(d))
  const method = getMethod(p.selected_method)
  const usesClips = method.id === 'animated_story_ad'
  const title = String(intake.product_name || '').trim() || 'Untitled Product'

  const out = []
  out.push(`# ${title} — ${method.name} Package`, '')
  out.push('> Generated by the Animated Ad Factory dashboard. Re-export after editing.', '')

  // Consolidated readiness at the very top (Competitor Video Recreation / canvas).
  if (isCompetitorMethod(p.selected_method)) {
    const readiness = assessExportReadiness(p)
    out.push('## Readiness Summary', '')
    if (readiness.ready && !readiness.warnings.length) {
      out.push('**✓ READY** — every scene has a selected variation; no warnings.')
    } else {
      out.push(readiness.ready ? '**READY (with warnings).**' : `**⚠️ NOT READY** — ${readiness.blockers.length} blocker(s).`)
      for (const b of readiness.blockers) out.push(`- ❌ ${b.message}`)
      for (const w of readiness.warnings) out.push(`- ⚠️ ${w.message}`)
    }
    out.push('', '_See Timeline Gaps and Timeline Duration below for details._', '')
  }

  if (usesClips) {
    if (status.state === 'mismatch') {
      out.push(`> ⚠️ **DURATION MISMATCH** — declared total ${status.declared}s, clips sum to ${status.sum}s (difference ${status.difference > 0 ? '+' : '-'}${Math.abs(status.difference)}s). Fix before production.`, '')
    } else if (status.state === 'unset') {
      out.push('> ⚠️ **Ad duration not set** — duration was not validated. Set "Ad duration" in the brief.', '')
    } else if (status.state === 'empty') {
      out.push('> ⚠️ **No clips** — this package has no visual clips yet.', '')
    }
  }

  // Project Overview
  out.push('## Project Overview', '')
  out.push(`- **Product:** ${title}`)
  if (intake.market_language) out.push(`- **Market / language:** ${intake.market_language}`)
  if (intake.visual_style) out.push(`- **Visual style:** ${intake.visual_style}`)
  out.push(`- **Ad method:** ${method.name}`)
  if (usesClips) {
    out.push(`- **Declared total duration:** ${status.declared == null ? '(not set)' : status.declared + ' seconds'}`)
    out.push(`- **Sum of clip durations:** ${status.sum} seconds`)
    out.push(`- **Difference:** ${status.difference == null ? '(n/a)' : (status.difference > 0 ? '+' : '') + status.difference + ' seconds'}`)
    out.push(`- **Clip count:** ${clips.length}`)
  }
  out.push(`- **Active brand docs:** ${activeDocs.length}`)
  out.push(`- **Imported script:** ${String(script.script || '').trim() ? 'present' : 'none'}`)
  out.push('')

  // Ad Method
  out.push('## Ad Method', '')
  out.push(`- **Method:** ${method.name}`)
  out.push(`- **Description:** ${method.description}`)
  out.push(`- **Best for:** ${method.best_for}`)
  out.push(`- **Recommended tools (manual for now):** ${recommendedToolNames(method)}`)
  out.push('', '**Method output sections:**')
  for (const s of method.export_sections) out.push(`- ${s}`)
  out.push('')

  // Active Brand Docs
  out.push('## Active Brand Docs', '')
  if (activeDocs.length) {
    for (const d of activeDocs) out.push(`### ${d.title || 'Untitled doc'}`, '', textBlock(d.content), '')
  } else {
    out.push('_(no active brand docs)_', '')
  }

  // Product / Offer Brief
  out.push('## Product / Offer Brief', '')
  for (const f of INTAKE_FIELDS) {
    const v = String(intake[f.key] || '').trim()
    out.push(`- **${f.label}:** ${v || '_(empty)_'}`)
  }
  out.push('')

  const compliance = String(intake.optional_compliance_notes || intake.claims_restrictions || '').trim()
  if (compliance) out.push('## Optional Compliance Notes From Docs', '', compliance, '')

  // Imported Script
  out.push('## Imported Script', '')
  if (String(script.script || '').trim()) {
    if (String(script.hook || '').trim()) out.push(`- **Hook:** ${script.hook}`)
    if (String(script.cta || '').trim()) out.push(`- **CTA / slogan:** ${script.cta}`)
    if (String(script.notes || '').trim()) out.push(`- **Notes:** ${script.notes}`)
    out.push('', fenced(script.script), '')
  } else {
    out.push('_(none imported)_', '')
  }

  // Method-specific body
  if (method.id === 'static_ad_pack') staticBody(out, p, md)
  else if (method.id === 'ugc_talking_head') ugcBody(out, p, md)
  else if (method.id === 'competitor_recreation') competitorBody(out, p, md)
  else if (method.id === 'product_demo') demoBody(out, p, md)
  else if (method.id === 'hook_testing_pack') hookBody(out, p, md)
  else animatedBody(out, p, clips)

  // Negative Constraints
  out.push('## Negative Constraints', '')
  if (p.negative_constraints.length) {
    for (const n of p.negative_constraints) out.push(`- ${n}`)
  } else {
    out.push('_(none defined)_')
  }
  out.push('')

  // Final Execution Checklist (method-aware)
  out.push('## Final Execution Checklist', '')
  const checklist = [
    'No medical, weight-loss, or appetite-suppression claims unless supported by the docs.',
    'All copy is in the correct market language.',
    'The output matches the imported script (script not rewritten).',
    'The package is copy-paste ready with no leftover template variables.'
  ]
  if (usesClips) {
    checklist.push('The product and subject stay visually identical across every clip.')
    checklist.push('Each clip has one primary action; each end frame bridges into the next.')
    checklist.push(`Duration math is clean (declared total ${status.declared == null ? '(unset)' : status.declared + 's'} equals clip sum ${status.sum}s).`)
  }
  for (const item of checklist) out.push(`- [ ] ${item}`)
  out.push('')

  return out.join('\n')
}

function triggerDownload(content, filename, mime) {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

export function downloadFlowPackage(rawProject) {
  const md = buildFlowPackageMarkdown(rawProject)
  const slug = slugify(rawProject.product_intake && rawProject.product_intake.product_name)
  triggerDownload(md, `${slug}-ad-package.md`, 'text/markdown;charset=utf-8')
}

export function downloadProjectJson(rawProject) {
  const json = JSON.stringify(rawProject, null, 2)
  const slug = slugify(rawProject.product_intake && rawProject.product_intake.product_name)
  triggerDownload(json, `${slug}-project.json`, 'application/json;charset=utf-8')
}

function snapshotStamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`
}

// Save the full working project for restoring dashboard state later.
export function downloadProjectSnapshot(rawProject) {
  const json = JSON.stringify(rawProject, null, 2)
  triggerDownload(json, `animated-ad-factory-project-${snapshotStamp()}.json`, 'application/json;charset=utf-8')
}
