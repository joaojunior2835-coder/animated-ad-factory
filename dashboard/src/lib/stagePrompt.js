// Stage Prompt Generator. Builds a copy-paste prompt for an external LLM that
// carries the active brand docs, the product/offer brief, the imported script
// (source of truth, if present), completed prior stages, the current objective,
// output format, and compliance / style / continuity rules. No API calls.

import { INTAKE_FIELDS, STAGES } from '../data/stages.js'
import { isActive } from './brandDocs.js'

// Authoring stages in order. Brand Vault, Brief, Script Import, and Final Export
// are handled as fixed context blocks, not as "prior stages".
const PROMPT_STAGE_ORDER = [
  'audience_psychology',
  'ad_concept',
  'story_beats',
  'continuity_bible',
  'frame_prompts',
  'flow_clip_prompts',
  'voiceover_script',
  'music_direction',
  'edit_plan'
]

const META = {
  audience_psychology: {
    objective:
      'Interpret the audience and build one concrete avatar: persona, the single core tension, the trigger moment, desired identity, and main objections.',
    outputFormat: 'Labeled lines: Persona, Core tension, Trigger moment, Desired identity, Objections, plus a short Avatar card (name, age, lifestyle, relationship to the product).',
    continuity: false
  },
  ad_concept: {
    objective:
      'Define the visual concept and environment: the visual world, setting, mood, and palette, and how it expresses the brief and the imported script. This is visual direction, not script copy.',
    outputFormat: 'Labeled sections: Visual concept, World / environment, Mood, Palette, How it serves the script & offer.',
    continuity: false
  },
  story_beats: {
    objective:
      'Break the ad into ordered story beats mapped to clips, opening on a scroll-stopper and ending on a product hero. If a script was imported, segment THAT script into beats; do not rewrite it.',
    outputFormat:
      'A numbered list (1..N). For each beat: Beat name, Purpose, the script line(s) it covers (if a script exists), and a one-line visual idea. Suggest a duration (seconds) per beat so the total matches the declared ad duration.',
    continuity: true
  },
  continuity_bible: {
    objective:
      'Write the continuity bible: lock subject identity, product, location, lighting, camera language, and color palette so every clip stays consistent. Also propose the global negative constraints.',
    outputFormat: 'Labeled sections: Main subject, Product, Location, Camera language. Then a "Negative constraints:" list, one per line.',
    continuity: false
  },
  frame_prompts: {
    objective:
      'For each beat/clip, write a START-frame and an END-frame still-image prompt. Each frame preserves continuity; the end frame must bridge into the next clip. Still images only — no motion.',
    outputFormat: 'For each clip N: "Clip N START frame:" then the prompt, then "Clip N END frame:" then the prompt.',
    continuity: true
  },
  flow_clip_prompts: {
    objective:
      "For each clip, write one Google Flow Agent Mode prompt describing the controlled motion between the clip's start and end keyframes. One primary action per clip; do not invent a new scene.",
    outputFormat: 'For each clip N: "Clip N Flow Agent Mode prompt:" then the prompt.',
    continuity: true
  },
  voiceover_script: {
    objective:
      'Map the imported script (source of truth) onto the clips as voiceover timing: which line/segment plays over which clip, with rough in/out timing fitting each clip duration. Do not rewrite the script. If no script was imported, propose timing placeholders per clip.',
    outputFormat: 'Per clip N: the line(s) and approximate timing (e.g. 0.0s–6.0s).',
    continuity: false
  },
  music_direction: {
    objective: 'Define the music direction: mood, a reference feel, the energy curve across the clips, and sound-design notes.',
    outputFormat: 'Labeled sections: Mood, Reference feel, Energy curve (per clip), Sound design.',
    continuity: false
  },
  edit_plan: {
    objective:
      'Write the edit plan: clip order, transitions, caption language and placement, and the end card. Confirm total runtime equals the sum of clip durations.',
    outputFormat: 'Labeled sections: Clip order, Transitions, Captions, End card, Total runtime.',
    continuity: false
  }
}

function labelFor(key) {
  const s = STAGES.find((x) => x.key === key)
  return s ? s.label : key
}

function nonEmpty(v) {
  return String(v == null ? '' : v).trim().length > 0
}

function clipsBlock(project, mode) {
  const clips = project.clips || []
  if (!clips.length) return '(no clips yet)'
  return clips
    .map((c, i) => {
      const n = i + 1
      const parts = [`Clip ${n} (${c.duration_seconds || '?'}s): ${c.scene_purpose || '(no purpose)'}`]
      if (nonEmpty(c.start_state)) parts.push(`  Start state: ${c.start_state}`)
      if (nonEmpty(c.end_state)) parts.push(`  End state: ${c.end_state}`)
      if (mode === 'frames') {
        if (nonEmpty(c.start_frame_prompt)) parts.push(`  START frame prompt: ${c.start_frame_prompt}`)
        if (nonEmpty(c.end_frame_prompt)) parts.push(`  END frame prompt: ${c.end_frame_prompt}`)
      }
      if (mode === 'flow' && nonEmpty(c.flow_agent_prompt)) parts.push(`  Flow prompt: ${c.flow_agent_prompt}`)
      return parts.join('\n')
    })
    .join('\n')
}

function stageContent(project, key) {
  if (key === 'frame_prompts') return clipsBlock(project, 'frames')
  if (key === 'flow_clip_prompts') return clipsBlock(project, 'flow')
  return project[key] || ''
}

export function buildStagePrompt(project, stageKey) {
  const meta = META[stageKey]
  if (!meta) return ''
  const intake = project.product_intake || {}
  const script = project.script_import || {}
  const hasScript = nonEmpty(script.script)
  const idx = PROMPT_STAGE_ORDER.indexOf(stageKey)
  const previous = idx > 0 ? PROMPT_STAGE_ORDER.slice(0, idx) : []

  const out = []
  out.push('You are the visual production director inside the Animated Ad Factory.')
  out.push('The dashboard turns brand docs, a product/offer brief, and an externally written script into a complete animated ad. Scripts are written elsewhere (the Nick Launch Project), not here.')
  out.push(`Your task is the "${labelFor(stageKey)}" stage. Use only the context below; do not invent product facts.`)
  out.push('')

  // Active brand docs
  out.push('=== ACTIVE BRAND DOCS ===')
  const activeDocs = (project.brand_docs || []).filter((d) => isActive(d) && nonEmpty(d.content))
  if (activeDocs.length) {
    for (const d of activeDocs) {
      out.push(`-- ${d.title || 'Untitled doc'} --`)
      out.push(d.content.trim())
      out.push('')
    }
  } else {
    out.push('(no active brand docs)')
    out.push('')
  }

  // Product / offer brief
  out.push('=== PRODUCT / OFFER BRIEF ===')
  for (const f of INTAKE_FIELDS) {
    out.push(`${f.label}: ${nonEmpty(intake[f.key]) ? intake[f.key] : '(empty)'}`)
  }
  out.push('')

  // Imported script (source of truth)
  if (hasScript) {
    out.push('=== IMPORTED SCRIPT (SOURCE OF TRUTH) ===')
    if (nonEmpty(script.hook)) out.push(`Hook: ${script.hook}`)
    out.push('Script:')
    out.push(script.script.trim())
    if (nonEmpty(script.cta)) out.push(`CTA / slogan: ${script.cta}`)
    if (nonEmpty(script.notes)) out.push(`Notes: ${script.notes}`)
    out.push('')
    out.push('IMPORTANT: An approved script already exists above. Do NOT invent or rewrite the script. Adapt the visual production (and timing) around this existing script.')
    out.push('')
  }

  // Prior completed stages
  if (previous.length) {
    out.push('=== COMPLETED PRIOR STAGES (context) ===')
    for (const key of previous) {
      const content = stageContent(project, key)
      out.push(`-- ${labelFor(key)} --`)
      out.push(nonEmpty(content) ? content : '(not completed yet)')
      out.push('')
    }
  }

  out.push('=== YOUR OBJECTIVE ===')
  out.push(meta.objective)
  out.push('')

  out.push('=== OUTPUT FORMAT ===')
  out.push(meta.outputFormat)
  out.push('')

  out.push('=== COMPLIANCE RULES (internal) ===')
  out.push('Use the active brand docs as the source of truth. Do not invent unsupported product claims. Do not add medical, weight-loss, appetite-suppression, or guaranteed-result claims unless explicitly supported by the provided docs.')
  const compliance = String(intake.optional_compliance_notes || intake.claims_restrictions || '').trim()
  if (compliance) out.push('Optional compliance notes (from docs): ' + compliance)
  out.push('')

  out.push('=== VISUAL STYLE RULES ===')
  out.push(`- Visual style: ${nonEmpty(intake.visual_style) ? intake.visual_style : '(unspecified)'}`)
  out.push(`- Brand tone: ${nonEmpty(intake.brand_tone) ? intake.brand_tone : '(unspecified)'}`)
  out.push(`- Brand colors: ${nonEmpty(intake.brand_colors) ? intake.brand_colors : '(unspecified)'}`)
  out.push(`- Market / language: ${nonEmpty(intake.market_language) ? intake.market_language : '(unspecified)'} — write all ad-facing copy in this language.`)

  if (meta.continuity) {
    out.push('')
    out.push('=== CONTINUITY RULES ===')
    out.push(nonEmpty(project.continuity_bible) ? project.continuity_bible : '(continuity bible not defined yet)')
    const negs = (project.negative_constraints || []).filter(nonEmpty)
    if (negs.length) {
      out.push('Global negative constraints:')
      for (const n of negs) out.push(`- ${n}`)
    }
  }

  return out.join('\n')
}
