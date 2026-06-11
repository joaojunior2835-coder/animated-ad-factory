// Intake field and stage metadata. Pure data — no logic, no React.
// The project state factory lives in src/lib/projectModel.js.

export const INTAKE_FIELDS = [
  { key: 'product_name', label: 'Product name', type: 'text', placeholder: 'Evening craving-control ritual drink' },
  { key: 'product_description', label: 'Product description', type: 'textarea', placeholder: 'What it is and what it does, in plain language.' },
  { key: 'offer', label: 'Offer', type: 'textarea', placeholder: 'The specific offer / promise (e.g. a 30-day evening ritual starter).' },
  { key: 'target_audience', label: 'Target audience', type: 'textarea', placeholder: 'Who it serves and the core tension they feel.' },
  { key: 'market_language', label: 'Market / language', type: 'text', placeholder: 'France / French' },
  { key: 'visual_style', label: 'Visual style', type: 'text', placeholder: 'warm tactile claymation' },
  { key: 'ad_duration', label: 'Ad duration', type: 'text', placeholder: '30 seconds' },
  { key: 'product_benefits', label: 'Product benefits', type: 'textarea', placeholder: 'Benefits framed safely: ritual, support, evening routine, control.' },
  { key: 'brand_tone', label: 'Brand tone', type: 'text', placeholder: 'warm, understanding, in control' },
  { key: 'brand_colors', label: 'Brand colors', type: 'text', placeholder: 'amber, warm neutrals' }
]

// kind: 'text'   -> instructions + a free-text box bound to project[key]
//       'clips'  -> instructions + notes box + the structured Clip Builder
//       'export' -> instructions + duration validation + export action
export const STAGES = [
  {
    key: 'audience_psychology',
    label: 'Audience / Avatar',
    kind: 'text',
    instructions:
      'Interpret the audience and build one concrete avatar: persona, the single core\n' +
      'tension, the trigger moment, desired identity, and main objections.\n' +
      'Gate: one specific avatar and one core tension — not a demographic list.'
  },
  {
    key: 'ad_concept',
    label: 'Visual Concept',
    kind: 'text',
    instructions:
      'Define the visual world and environment for the ad: the visual concept, the\n' +
      'world / setting, mood, and palette — and how it expresses the brief and the\n' +
      'imported script. This is visual direction, not script copy.'
  },
  {
    key: 'story_beats',
    label: 'Story Beats',
    kind: 'text',
    instructions:
      'Break the ad into ordered story beats mapped to clips. If a script was imported,\n' +
      'segment THAT script into beats (do not rewrite it). Default arc:\n' +
      '  1) Scroll-stopper  2) Tension  3) The ritual / product  4) The shift  5) Product hero\n' +
      'One idea per beat. Each beat maps to a clip in the Clip Builder.'
  },
  {
    key: 'continuity_bible',
    label: 'Continuity Bible',
    kind: 'text',
    showNegatives: true,
    instructions:
      'Lock the things that must stay consistent: subject, product, location,\n' +
      'lighting, camera language, color palette.\n' +
      'Define the global negative constraints below — they apply to every clip.'
  },
  {
    key: 'frame_prompts',
    label: 'Frame Prompts',
    kind: 'clips',
    instructions:
      'For each clip, write a START-frame and an END-frame still-image prompt in the\n' +
      'Clip Builder below. Each frame preserves continuity; the end frame bridges into\n' +
      'the next clip. Describe a still image — no motion here.'
  },
  {
    key: 'flow_clip_prompts',
    label: 'Flow Clip Prompts',
    kind: 'clips',
    instructions:
      'For each clip, write the Google Flow Agent Mode prompt in the Clip Builder below.\n' +
      'Describe the controlled motion between the two keyframes only — one primary action\n' +
      'per clip; do not invent a new scene.'
  },
  {
    key: 'voiceover_script',
    label: 'Voiceover Timing',
    kind: 'text',
    optional: true,
    instructions:
      'Map the imported script (the source of truth) onto the clips: which line/segment\n' +
      'plays over which clip, with rough in/out timing that fits each clip’s duration.\n' +
      'Do not rewrite the script. Optional if no script was imported.'
  },
  {
    key: 'music_direction',
    label: 'Music Direction',
    kind: 'text',
    instructions:
      'Define mood, a reference feel, the energy curve across the clips, and sound-design\n' +
      'notes. The energy curve should track the arc — restraint at tension, lift at the\n' +
      'shift and hero.'
  },
  {
    key: 'edit_plan',
    label: 'Edit Plan',
    kind: 'text',
    instructions:
      'Specify clip order, transitions, caption language and placement, and the end card.\n' +
      'Confirm total runtime equals the sum of clip durations (see the duration check).'
  },
  {
    key: 'final_export',
    label: 'Final Export',
    kind: 'export',
    instructions:
      'Assemble and review the full package:\n' +
      '  - No prohibited claims in any line or frame.\n' +
      '  - Correct market language throughout.\n' +
      '  - Product and subject visually consistent; one action per clip; end frames bridge.\n' +
      '  - Duration math clean (declared total equals the sum of clip durations).\n' +
      'Export the full Flow ad package as Markdown below or from the right panel.'
  }
]
