// One-Shot AI Handoff: builds a single master prompt that asks an external LLM to
// return one complete structured project JSON matching the dashboard model.

import { INTAKE_FIELDS } from '../data/stages.js'
import { parseDeclaredDuration } from './projectModel.js'
import { isActive } from './brandDocs.js'
import { getMethod, recommendedToolNames } from '../data/adMethods.js'

export const ACTIVE_DOC_CHAR_WARN = 16000

function nonEmpty(v) {
  return String(v == null ? '' : v).trim().length > 0
}

export function activeProjectDocs(project) {
  return (project.brand_docs || []).filter((d) => isActive(d) && nonEmpty(d.content))
}

export function activeDocsCharCount(project) {
  return activeProjectDocs(project).reduce((n, d) => n + (d.content ? d.content.length : 0), 0)
}

// Returns a warning string when the active docs are large enough to crowd the
// AI context, otherwise null.
export function activeDocsWarning(project) {
  return activeDocsCharCount(project) > ACTIVE_DOC_CHAR_WARN
    ? 'Large context: consider deselecting low-priority docs.'
    : null
}

// The Product / Offer Brief is "empty" when no field has content.
export function briefIsEmpty(project) {
  const intake = project.product_intake || {}
  return INTAKE_FIELDS.every((f) => !nonEmpty(intake[f.key]))
}

// Message shown when AI Handoff will infer the brief from docs (empty brief +
// active docs). Returns null otherwise.
export function briefInferenceNote(project) {
  return briefIsEmpty(project) && activeProjectDocs(project).length > 0
    ? 'Brief is empty. AI will infer product/offer from active docs.'
    : null
}

function schemaString(intake, script) {
  const skeleton = {
    product_intake: intake,
    script_import: {
      script: script.script || '',
      notes: script.notes || '',
      hook: script.hook || '',
      cta: script.cta || ''
    },
    audience_psychology: '<string: persona, core tension, trigger moment, desired identity, objections, avatar card>',
    ad_concept: '<string: visual concept, world/environment, mood, palette>',
    story_beats: '<string: ordered beats mapped to clips>',
    continuity_bible: '<string: subject, product, location, lighting, camera, palette>',
    clips: [
      {
        clip_number: 1,
        duration_seconds: 6,
        scene_purpose: '<string>',
        start_state: '<string>',
        end_state: '<string>',
        start_frame_prompt: '<string: still image>',
        end_frame_prompt: '<string: still image, bridges to next clip>',
        flow_agent_prompt: '<string: controlled motion between the two frames>',
        attach_instructions: '',
        bridge_check: '<string: how this end connects to the next start>',
        continuity_references: ['<string>'],
        negative_constraints: ['<string>']
      }
    ],
    voiceover_script: '<string: voiceover timing mapping the imported script lines onto clips>',
    music_direction: '<string: mood, reference, energy curve, sound design>',
    edit_plan: '<string: clip order, transitions, captions, end card, total runtime>',
    negative_constraints: ['<string>']
  }
  return JSON.stringify(skeleton, null, 2)
}

// Method-specific JSON skeleton the AI must return.
function methodReturnSchema(method, intake, script) {
  const echoIntake = intake
  const echoScript = { script: script.script || '', notes: script.notes || '', hook: script.hook || '', cta: script.cta || '' }

  if (method.id === 'static_ad_pack') {
    return JSON.stringify(
      {
        product_intake: echoIntake,
        selected_method: 'static_ad_pack',
        audience_psychology: '<string>',
        static_concepts: [
          { angle: '<string>', headline: '<string>', visual_prompt: '<string: image prompt>', layout_notes: '<string>', negative_constraints: ['<string>'], format: '1:1 | 4:5 | 9:16' }
        ],
        export_formats: ['1:1', '4:5', '9:16'],
        negative_constraints: ['<string>']
      },
      null,
      2
    )
  }
  if (method.id === 'ugc_talking_head') {
    return JSON.stringify(
      {
        product_intake: echoIntake,
        script_import: echoScript,
        selected_method: 'ugc_talking_head',
        audience_psychology: '<string>',
        hook: '<string>',
        script_reference: '<string: which imported lines to deliver — do not rewrite>',
        performance_direction: '<string: tone, energy, pacing, delivery>',
        talking_head_notes: '<string: framing, wardrobe, setting>',
        shot_list: ['<shot>'],
        broll_plan: [{ timecode: '<string>', visual: '<string>', source: '<string>' }],
        edit_plan: '<string>',
        negative_constraints: ['<string>']
      },
      null,
      2
    )
  }
  if (method.id === 'competitor_recreation') {
    return JSON.stringify(
      {
        product_intake: echoIntake,
        selected_method: 'competitor_recreation',
        competitor_structure: '<string: the competitor video’s beat structure>',
        adapted_structure: '<string: brand-safe adapted structure>',
        shot_by_shot_plan: [{ shot: 1, competitor_beat: '<string>', adapted_shot: '<string>', frame_prompt: '<string or empty>', video_prompt: '<string or empty>', brand_safe_change: '<string>' }],
        visual_style_transfer_notes: '<string>',
        edit_plan: '<string>',
        negative_constraints: ['<string>']
      },
      null,
      2
    )
  }
  if (method.id === 'product_demo') {
    return JSON.stringify(
      {
        product_intake: echoIntake,
        selected_method: 'product_demo',
        audience_psychology: '<string>',
        demo_sequence: '<string: problem -> feature reveals -> proof -> CTA>',
        feature_mapping: [{ feature: '<string>', benefit: '<string>', shot: '<string>' }],
        shot_list: ['<shot>'],
        edit_plan: '<string>',
        negative_constraints: ['<string>']
      },
      null,
      2
    )
  }
  if (method.id === 'hook_testing_pack') {
    return JSON.stringify(
      {
        product_intake: echoIntake,
        selected_method: 'hook_testing_pack',
        audience_psychology: '<string>',
        hook_list: [{ angle_label: '<string>', verbal_hook: '<string>', first_frame_or_line: '<string>' }],
        ranking_logic: '<string: how to rank/select the strongest hooks>',
        negative_constraints: ['<string>']
      },
      null,
      2
    )
  }
  // Default: Animated Story Ad
  return schemaString(echoIntake, script)
}

export function buildMasterPrompt(project) {
  const intake = project.product_intake || {}
  const script = project.script_import || {}
  const hasScript = nonEmpty(script.script)
  const declared = parseDeclaredDuration(intake)

  const method = getMethod(project.selected_method)

  const out = []
  out.push(`You are the production director for a ${method.name}. Produce a COMPLETE structured project in ONE pass.`)
  out.push('Scripts are written in a separate tool (the Nick Launch Project). You do not write or rewrite the script.')
  out.push('')
  out.push('Return ONLY one JSON object that matches the schema at the end. No markdown, no code fences, no commentary before or after — JSON only.')
  out.push('')

  out.push('=== AD METHOD ===')
  out.push(`Method: ${method.name}`)
  out.push(method.description)
  out.push(`Best for: ${method.best_for}`)
  out.push(`Produce (method stages): ${method.stages.join(', ')}`)
  out.push(`Method outputs: ${method.outputs.join(', ')}`)
  out.push(`Recommended tools (manual for now): ${recommendedToolNames(method)}`)
  out.push('Map this method’s outputs into the JSON schema below: use clips[] for the method’s shots/segments/concepts, start_frame_prompt/end_frame_prompt for image prompts, and flow_agent_prompt for motion/video prompts (leave flow_agent_prompt "" for static formats).')
  out.push('')

  out.push('=== ACTIVE BRAND DOCS ===')
  const docs = activeProjectDocs(project)
  if (activeDocsWarning(project)) {
    out.push('NOTE: Large context — consider deselecting low-priority docs.')
    out.push('')
  }
  if (docs.length) {
    for (const d of docs) {
      const meta = [`source: ${d.source_type || 'paste'}`]
      if (d.tags && d.tags.length) meta.push(`tags: ${d.tags.join(', ')}`)
      out.push(`-- ${d.title || 'Untitled doc'} [${meta.join('; ')}] --`)
      out.push(d.content.trim())
      out.push('')
    }
  } else {
    out.push('(no active brand docs)')
    out.push('')
  }

  out.push('=== PRODUCT / OFFER BRIEF ===')
  for (const f of INTAKE_FIELDS) {
    out.push(`${f.label}: ${nonEmpty(intake[f.key]) ? intake[f.key] : '(empty)'}`)
  }
  out.push('')

  const docsActive = activeProjectDocs(project).length > 0
  if (briefIsEmpty(project) && docsActive) {
    out.push('NOTE: The Product / Offer Brief is empty. Before building the package, infer the product/offer fields (product, offer, audience, market/language, benefits, claims/restrictions, tone, visual style) from the ACTIVE BRAND DOCS above. Do not invent unsupported claims.')
    out.push('')
  } else if (!briefIsEmpty(project) && docsActive) {
    out.push('NOTE: Use the Product / Offer Brief as the priority and the active brand docs as supporting context. Fill any blank brief fields from the docs.')
    out.push('')
  }

  if (hasScript) {
    out.push('=== IMPORTED SCRIPT (SOURCE OF TRUTH — DO NOT REWRITE) ===')
    if (nonEmpty(script.hook)) out.push(`Hook: ${script.hook}`)
    out.push('Script:')
    out.push(script.script.trim())
    if (nonEmpty(script.cta)) out.push(`CTA / slogan: ${script.cta}`)
    if (nonEmpty(script.notes)) out.push(`Notes: ${script.notes}`)
    out.push('')
    out.push('Build the visuals, clips, and voiceover timing AROUND this exact script. Keep the wording unchanged. The voiceover_script field must map these lines onto clips with timing.')
    out.push('')
  } else {
    out.push('=== SCRIPT ===')
    out.push('(no script imported) — keep any voiceover minimal and compliant; this tool does not write full scripts.')
    out.push('')
  }

  out.push('=== TARGET ===')
  out.push(`- Desired total duration: ${declared != null ? declared + ' seconds' : '(unset — assume 30 seconds)'}`)
  out.push(`- Visual style: ${nonEmpty(intake.visual_style) ? intake.visual_style : '(unspecified)'}`)
  out.push(`- Market / language: ${nonEmpty(intake.market_language) ? intake.market_language : '(unspecified)'} — all ad-facing copy in this language.`)
  out.push('- Default plan: about 5 clips of ~6s for a 30s ad. Clip durations MUST sum exactly to the desired total.')
  out.push('')

  out.push('=== CURRENT PROJECT STATE (refine; do not discard user input) ===')
  const stateLine = (label, val) => out.push(`- ${label}: ${nonEmpty(val) ? '(has content — refine)' : '(empty)'}`)
  stateLine('Audience / Avatar', project.audience_psychology)
  stateLine('Visual Concept', project.ad_concept)
  stateLine('Story Beats', project.story_beats)
  stateLine('Continuity Bible', project.continuity_bible)
  out.push(`- Clips: ${(project.clips || []).length} existing`)
  out.push('')

  out.push('=== COMPLIANCE RULES (internal) ===')
  out.push('Use the active brand docs as the source of truth. Do not invent unsupported product claims. Do not add medical, weight-loss, appetite-suppression, or guaranteed-result claims unless explicitly supported by the provided docs.')
  const compliance = String(intake.optional_compliance_notes || intake.claims_restrictions || '').trim()
  if (compliance) out.push('Optional compliance notes (from docs): ' + compliance)
  out.push('')

  out.push('=== WHAT TO PRODUCE ===')
  out.push(`Produce a complete ${method.name}. ${method.ai_return_schema_notes}`)
  out.push(`Required outputs: ${method.outputs.join(', ')}.`)
  out.push('Echo product_intake (and script_import if present) back UNCHANGED. Keep selected_method as given.')
  out.push('')

  out.push('=== RETURN THIS JSON SHAPE (fill the <...> placeholders) ===')
  out.push(methodReturnSchema(method, intake, script))

  return out.join('\n')
}
