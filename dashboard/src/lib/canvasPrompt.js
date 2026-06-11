// Builds the one-shot "Generate Adaptation Prompt" for the Canvas. No API calls —
// assembles brand docs, brief, script, competitor reference, scene board, and
// providers into a prompt that returns adapted-canvas JSON.

import { INTAKE_FIELDS } from '../data/stages.js'
import { activeProjectDocs } from './masterPrompt.js'
import { providerName } from '../data/providers.js'
import { SCENE_FIELDS } from './canvasModel.js'

function nonEmpty(v) {
  return String(v == null ? '' : v).trim().length > 0
}

function providerLine(label, id) {
  return `- ${label}: ${nonEmpty(id) ? providerName(id) : '(default / unset)'}`
}

export function buildCanvasPrompt(project) {
  const intake = project.product_intake || {}
  const script = project.script_import || {}
  const canvas = project.canvas || {}
  const ref = canvas.competitor_reference || {}
  const defaults = canvas.model_defaults || {}
  const scenes = canvas.scenes || []

  const out = []
  out.push('You are adapting a competitor video ad into an original, brand-safe ad for OUR product.')
  out.push('Return ONLY one JSON object in the shape at the end. No markdown, no code fences, no commentary — JSON only.')
  out.push('')

  out.push('=== ACTIVE BRAND DOCS ===')
  const docs = activeProjectDocs(project)
  if (docs.length) {
    for (const d of docs) {
      out.push(`-- ${d.title || 'Untitled doc'} [source: ${d.source_type || 'paste'}] --`)
      out.push(String(d.content || '').trim())
      out.push('')
    }
  } else {
    out.push('(no active brand docs)', '')
  }

  out.push('=== PRODUCT / OFFER BRIEF ===')
  for (const f of INTAKE_FIELDS) out.push(`${f.label}: ${nonEmpty(intake[f.key]) ? intake[f.key] : '(empty)'}`)
  out.push('')

  if (nonEmpty(script.script)) {
    out.push('=== IMPORTED SCRIPT (SOURCE OF TRUTH — DO NOT REWRITE) ===')
    if (nonEmpty(script.hook)) out.push(`Hook: ${script.hook}`)
    out.push('Script:', script.script.trim())
    if (nonEmpty(script.cta)) out.push(`CTA / slogan: ${script.cta}`)
    out.push('')
  }

  out.push('=== COMPETITOR REFERENCE ===')
  out.push(`- Ad name: ${ref.competitor_ad_name || '(unknown)'}`)
  out.push(`- Brand: ${ref.competitor_brand || '(unknown)'}`)
  out.push(`- Source URL: ${ref.source_url || '(none)'}`)
  out.push(`- Platform: ${ref.platform || '(unknown)'}`)
  out.push(`- Ad duration: ${ref.ad_duration || '(unknown)'}`)
  if (nonEmpty(ref.notes)) out.push(`- Notes: ${ref.notes}`)
  out.push('')

  out.push('=== SCENE BOARD (competitor map) ===')
  if (scenes.length) {
    scenes.forEach((s) => {
      out.push(`# Scene ${s.scene_number} (${s.timestamp_start || '?'}–${s.timestamp_end || '?'})`)
      if (nonEmpty(s.scene_type)) out.push(`  Scene type: ${s.scene_type}`)
      for (const f of SCENE_FIELDS) {
        if (nonEmpty(s[f.key])) out.push(`  ${f.label}: ${s[f.key]}`)
      }
      out.push('')
    })
  } else {
    out.push('(no scenes yet)', '')
  }

  out.push('=== SELECTED PROVIDERS (manual for now) ===')
  out.push(providerLine('Default LLM', defaults.default_llm_provider))
  out.push(providerLine('Default image', defaults.default_image_provider))
  out.push(providerLine('Default video', defaults.default_video_provider))
  out.push(providerLine('Default voice', defaults.default_voice_provider))
  out.push(providerLine('Default music', defaults.default_music_provider))
  out.push('')

  out.push('=== INSTRUCTIONS ===')
  out.push('- Adapt the competitor structure to OUR product using the brand docs, brief, and script above.')
  out.push('- Do NOT copy logos, exact claims, exact actors, exact brand identity, or any protected/copyrighted assets.')
  out.push('- DO preserve structure, pacing, shot logic, emotional sequence, and editing rhythm.')
  out.push('- For each scene, write an adaptation_instruction_for_our_product and an output_prompt (the generation prompt for that shot).')
  out.push('- Keep claims within what the brand docs support; invent no unsupported claims.')
  out.push('')

  out.push('=== RETURN THIS JSON SHAPE ===')
  out.push(
    JSON.stringify(
      {
        scenes: [
          {
            scene_number: 1,
            timestamp_start: '',
            timestamp_end: '',
            what_happens: '<string>',
            adaptation_instruction_for_our_product: '<string>',
            required_assets: '<string>',
            output_prompt: '<string: generation prompt for this shot>'
          }
        ],
        method_data: {
          competitor_structure: '<string>',
          adapted_structure: '<string>',
          visual_style_transfer_notes: '<string>'
        },
        edit_plan: '<string>'
      },
      null,
      2
    )
  )

  return out.join('\n')
}

// Shared brand/brief/reference context block (used by the API "improve" prompts).
function contextBlock(project) {
  const intake = project.product_intake || {}
  const canvas = project.canvas || {}
  const ref = canvas.competitor_reference || {}
  const out = []

  out.push('=== ACTIVE BRAND DOCS ===')
  const docs = activeProjectDocs(project)
  if (docs.length) {
    for (const d of docs) {
      out.push(`-- ${d.title || 'Untitled doc'} --`)
      out.push(String(d.content || '').trim())
      out.push('')
    }
  } else {
    out.push('(no active brand docs)', '')
  }

  out.push('=== PRODUCT / OFFER BRIEF ===')
  for (const f of INTAKE_FIELDS) out.push(`${f.label}: ${nonEmpty(intake[f.key]) ? intake[f.key] : '(empty)'}`)
  out.push('')

  out.push('=== COMPETITOR REFERENCE ===')
  out.push(`- Ad name: ${ref.competitor_ad_name || '(unknown)'}`)
  out.push(`- Brand: ${ref.competitor_brand || '(unknown)'}`)
  out.push(`- Platform: ${ref.platform || '(unknown)'}`)
  if (nonEmpty(ref.notes)) out.push(`- Notes: ${ref.notes}`)
  out.push('')

  return out
}

function sceneDetailLines(scene, defaults) {
  const out = []
  out.push(`- Timestamp: ${scene.timestamp_start || '?'}–${scene.timestamp_end || '?'}`)
  if (nonEmpty(scene.scene_type)) out.push(`- Scene type: ${scene.scene_type}`)
  if (nonEmpty(scene.what_happens)) out.push(`- What happens: ${scene.what_happens}`)
  if (nonEmpty(scene.camera_angle)) out.push(`- Camera angle: ${scene.camera_angle}`)
  if (nonEmpty(scene.camera_movement)) out.push(`- Camera movement: ${scene.camera_movement}`)
  if (nonEmpty(scene.subject_action)) out.push(`- Subject action: ${scene.subject_action}`)
  if (nonEmpty(scene.product_role)) out.push(`- Product role: ${scene.product_role}`)
  if (nonEmpty(scene.adaptation_instruction_for_our_product)) out.push(`- Adaptation instruction: ${scene.adaptation_instruction_for_our_product}`)
  const vp = scene.video_provider || (defaults && defaults.default_video_provider) || ''
  const ip = scene.image_provider || (defaults && defaults.default_image_provider) || ''
  out.push(`- Target tool (video): ${nonEmpty(vp) ? providerName(vp) : '(unset)'}`)
  out.push(`- Target tool (image): ${nonEmpty(ip) ? providerName(ip) : '(unset)'}`)
  return out
}

// Improve a single scene's output_prompt. Returns plain text only (no JSON).
export function buildSceneImprovePrompt(project, scene) {
  const canvas = project.canvas || {}
  const defaults = canvas.model_defaults || {}
  const out = []
  out.push('You are improving the production prompt for ONE shot of an original, brand-safe ad adapted from a competitor video.')
  out.push('Return ONLY the improved production prompt as plain text. No preamble, no labels, no markdown, no code fences.')
  out.push('')
  out.push(...contextBlock(project))
  out.push('=== THIS SCENE ===')
  out.push(...sceneDetailLines(scene, defaults))
  if (nonEmpty(scene.output_prompt)) {
    out.push('')
    out.push('=== CURRENT OUTPUT PROMPT (improve this) ===')
    out.push(String(scene.output_prompt).trim())
  }
  out.push('')
  out.push('=== RULES ===')
  out.push('- Write a single, vivid, production-ready generation prompt for this shot tailored to OUR product.')
  out.push('- Honor the camera angle, movement, subject action, and product role above.')
  out.push('- Stay within claims the brand docs support; do not copy the competitor brand, logos, or exact claims.')
  out.push('- Keep it concise and directly usable in the target tool.')
  return out.join('\n')
}

// Improve ALL empty output prompts in one structured request. Returns JSON only.
export function buildEmptyPromptsImprovePrompt(project, emptyScenes) {
  const canvas = project.canvas || {}
  const defaults = canvas.model_defaults || {}
  const out = []
  out.push('You are writing production prompts for the shots below that currently have NO output prompt.')
  out.push('Return ONLY one JSON object. No markdown, no code fences, no commentary — JSON only.')
  out.push('')
  out.push(...contextBlock(project))
  out.push('=== SCENES NEEDING AN OUTPUT PROMPT ===')
  ;(emptyScenes || []).forEach((s) => {
    out.push(`# Scene ${s.scene_number}`)
    out.push(...sceneDetailLines(s, defaults))
    out.push('')
  })
  out.push('=== RULES ===')
  out.push('- For each scene, write a vivid, production-ready generation prompt tailored to OUR product.')
  out.push('- Honor each scene’s camera angle, movement, subject action, and product role.')
  out.push('- Stay within claims the brand docs support; do not copy the competitor brand, logos, or exact claims.')
  out.push('')
  out.push('=== RETURN THIS JSON SHAPE ===')
  out.push(
    JSON.stringify(
      { prompts: [{ scene_number: 1, output_prompt: '<string: generation prompt for this shot>' }] },
      null,
      2
    )
  )
  return out.join('\n')
}

// Build the ONE-SHOT Ad Brief prompt: decode a competitor /watch breakdown and adapt
// it to OUR product. Reuses the shared brand/brief/competitor context block so the
// existing project fields are pulled in (no re-entry). Returns JSON-only instructions.
export function buildAdBriefPrompt(project, watchOutput) {
  const out = []
  out.push('You are an expert short-form UGC ad strategist. DECODE a competitor video (given as a /watch frame-by-frame breakdown + transcript) and produce a complete AD BRIEF that ADAPTS its structure to OUR product.')
  out.push('Return ONLY one JSON object in the exact shape at the end. No markdown, no code fences, no commentary — JSON only.')
  out.push('')
  out.push(...contextBlock(project))
  out.push('=== COMPETITOR /watch BREAKDOWN + TRANSCRIPT (decode this — do NOT copy its product/brand) ===')
  out.push(String(watchOutput || '').trim() || '(none provided)')
  out.push('')
  out.push('=== WHAT TO PRODUCE ===')
  out.push('- decoded_structure: the psychology behind each beat (hook/problem/solution/proof/cta/etc.) — what the competitor does and WHY it works.')
  out.push('- adapted_script: the competitor VO/script REWRITTEN for OUR product, matching their pacing and emotional sequence (rough timing is welcome).')
  out.push('- scenes: one per beat/shot. Each output_prompt MUST be a REAL single-shot generation prompt with explicit camera movement, shot type, lens/feel, lighting, framing, subject action, pacing, and duration — NOT a vague summary.')
  out.push('- dont_copy: the competitor product, actors, brand, logos, and specific claims.')
  out.push('- preserve: structure, pacing, shot logic, emotional sequence, editing rhythm.')
  out.push('')
  out.push('=== RULES ===')
  out.push('- Default to short-form VERTICAL (9:16) UGC framing and pacing unless the brief clearly says otherwise.')
  out.push('- Stay within claims the brand docs support; invent no unsupported claims.')
  out.push('- Do NOT copy the competitor brand, logos, exact claims, or actors. DO preserve structure, pacing, shot logic, emotional sequence, and editing rhythm.')
  out.push('- scene_number must start at 1 and increase by 1 in beat/time order.')
  out.push('')
  out.push('=== RETURN THIS JSON SHAPE ===')
  out.push(
    JSON.stringify(
      {
        decoded_structure: [{ beat_name: '<hook|problem|solution|proof|cta|...>', timestamp_range: '<0:00-0:03>', what_competitor_does: '<string>', why_it_works: '<string>' }],
        adapted_script: '<string or timed lines for OUR product>',
        scenes: [
          {
            scene_number: 1,
            what_happens: '<string>',
            adaptation_instruction_for_our_product: '<string>',
            output_prompt: '<real single-shot prompt: camera movement, shot type, lens/feel, lighting, framing, subject action, pacing, duration>'
          }
        ],
        dont_copy: ['<competitor brand>', '<actors>', '<logos>', '<specific claims>'],
        preserve: ['<structure>', '<pacing>', '<shot logic>', '<emotional sequence>', '<editing rhythm>']
      },
      null,
      2
    )
  )
  return out.join('\n')
}

const CANVAS_SHAPE = `{
  "scenes": [
    {
      "scene_number": 1,
      "timestamp_start": "0:00",
      "timestamp_end": "0:03",
      "what_happens": "<string>",
      "adaptation_instruction_for_our_product": "<string>",
      "required_assets": "<string>",
      "output_prompt": "<string>"
    }
  ],
  "method_data": { "competitor_structure": "<string>", "adapted_structure": "<string>", "visual_style_transfer_notes": "<string>" },
  "edit_plan": "<string>"
}`

// Repair prompt for AI canvas JSON that failed validation.
export function buildCanvasRepairPrompt(rawJson, errors) {
  const out = []
  out.push('You returned JSON for a competitor-recreation canvas that failed validation. Fix it.')
  out.push('Return ONLY the corrected JSON object. No markdown, no code fences, no commentary.')
  out.push('')
  out.push('=== VALIDATION ERRORS TO FIX ===')
  if (errors && errors.length) {
    for (const e of errors) out.push(`- ${e}`)
  } else {
    out.push('- (unspecified)')
  }
  out.push('')
  out.push('=== REQUIRED JSON SHAPE ===')
  out.push(CANVAS_SHAPE)
  out.push('')
  out.push('Rules:')
  out.push('- Every scene must have what_happens, adaptation_instruction_for_our_product, and output_prompt.')
  out.push('- Do NOT invent new scenes unless required to satisfy the errors.')
  out.push('- Preserve the existing scene order and timestamps.')
  out.push('')
  out.push('=== JSON TO FIX ===')
  out.push(String(rawJson || '').trim() || '(empty)')
  return out.join('\n')
}
