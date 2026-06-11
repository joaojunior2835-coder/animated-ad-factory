// Builds a "repair" prompt to paste back into the AI when its JSON fails
// validation (or fails to parse). Asks for corrected JSON only.

const SHAPE = `{
  "product_intake": { "...keep as provided..." : "" },
  "script_import": { "script": "", "notes": "", "hook": "", "cta": "" },
  "audience_psychology": "string",
  "ad_concept": "string (visual concept)",
  "story_beats": "string",
  "continuity_bible": "string",
  "clips": [
    {
      "clip_number": 1,
      "duration_seconds": 6,
      "scene_purpose": "string",
      "start_state": "string",
      "end_state": "string",
      "start_frame_prompt": "string",
      "end_frame_prompt": "string",
      "flow_agent_prompt": "string",
      "attach_instructions": "",
      "bridge_check": "string",
      "continuity_references": ["string"],
      "negative_constraints": ["string"]
    }
  ],
  "voiceover_script": "string",
  "music_direction": "string",
  "edit_plan": "string",
  "negative_constraints": ["string"]
}`

export function buildRepairPrompt(rawJson, errors) {
  const out = []
  out.push('You returned JSON that does not match the required schema. Fix it.')
  out.push('Return ONLY the corrected JSON object. No markdown, no code fences, no commentary.')
  out.push('')
  out.push('=== PROBLEMS TO FIX ===')
  if (errors && errors.length) {
    for (const e of errors) out.push(`- ${e}`)
  } else {
    out.push('- (unspecified)')
  }
  out.push('')
  out.push('=== REQUIRED JSON SHAPE ===')
  out.push(SHAPE)
  out.push('')
  out.push('Rules:')
  out.push('- clips[] must be non-empty.')
  out.push('- Every clip needs duration_seconds (number), scene_purpose, start_frame_prompt, end_frame_prompt, flow_agent_prompt, attach_instructions (may be ""), bridge_check, continuity_references[], negative_constraints[].')
  out.push('- Clip durations must sum EXACTLY to the declared ad duration (product_intake.ad_duration).')
  out.push('- Keep product_intake and script_import unchanged if they are present.')
  out.push('- Fill audience_psychology, ad_concept, story_beats, continuity_bible, voiceover_script, music_direction, edit_plan, and negative_constraints.')
  out.push('')
  out.push('=== JSON TO FIX ===')
  out.push(String(rawJson || '').trim() || '(empty)')
  return out.join('\n')
}
