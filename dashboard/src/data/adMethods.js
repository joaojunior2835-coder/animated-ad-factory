// Ad Method / Recipe registry + Method Adapter metadata. Each method declares
// what it requires (validation_profile), what the AI should return
// (ai_return_schema_notes), and what the export renders (export_profile).
//
// validation_profile entries are interpreted by src/lib/validation.js:
//   kind 'text'        + path                -> non-empty string at path
//   kind 'array'       + path                -> non-empty array at path
//   kind 'array_items' + path + field        -> every item has non-empty field
//   kind 'clips'                             -> project.clips is non-empty
//   kind 'clip_field'  + clipField           -> every clip has that field
//   kind 'duration'                          -> clip durations sum to declared
//   kind 'bridge'                            -> bridge_check on every clip but last
//   kind 'script'                            -> imported script OR voiceover OR script_reference
//   kind 'hook'                              -> script_import.hook OR method_data.hook
// path scopes: 'intake:<key>' | 'project:<key>' | 'data:<key>' (method_data)

import { providerName } from './providers.js'

const pn = { id: 'product_name', label: 'Product name present', kind: 'text', path: 'intake:product_name' }
const ml = { id: 'market_language', label: 'Market / language present', kind: 'text', path: 'intake:market_language' }

export const METHODS = [
  {
    id: 'animated_story_ad',
    name: 'Animated Story Ad',
    description: 'A short narrative animated ad built from AI keyframes and Flow clips.',
    best_for: 'Emotional brand/product stories in claymation, 3D, or illustrated styles for social.',
    required_inputs: ['Active brand docs or product/offer brief', 'Visual style', 'Ad duration'],
    optional_inputs: ['Imported script', 'Market/language', 'Music references'],
    stages: ['Audience / Avatar', 'Visual Concept', 'Story Beats', 'Continuity Bible', 'Frame Prompts', 'Flow Clip Prompts', 'Music Direction', 'Edit Plan'],
    outputs: ['Per-clip start/end frame prompts', 'Flow Agent Mode motion prompts', 'Voiceover timing', 'Music direction', 'Edit plan'],
    recommended_tools: ['anthropic', 'openai', 'google_flow', 'kling', 'seedance'],
    validation_rules: ['Clip durations must sum to ad duration', 'Every clip needs start + end frame prompts', 'Every clip needs a Flow prompt', 'Bridge checks between clips'],
    export_sections: ['Ad Method', 'Audience / Avatar', 'Visual Concept', 'Story Beats', 'Continuity Bible', 'Clip-by-Clip Plan', 'Frame Prompts', 'Flow Agent Mode Prompts', 'Voiceover Timing', 'Music Direction', 'Edit Plan'],

    required_project_fields: ['product_intake.product_name', 'product_intake.market_language'],
    required_stage_fields: ['ad_concept', 'story_beats', 'continuity_bible', 'music_direction', 'edit_plan'],
    required_clip_fields: ['duration_seconds', 'start_frame_prompt', 'end_frame_prompt', 'flow_agent_prompt'],
    optional_clip_fields: ['attach_instructions', 'continuity_references', 'negative_constraints'],
    validation_profile: [
      pn,
      ml,
      { id: 'visual_concept', label: 'Visual concept present', kind: 'text', path: 'project:ad_concept' },
      { id: 'story_beats', label: 'Story beats present', kind: 'text', path: 'project:story_beats' },
      { id: 'continuity_bible', label: 'Continuity bible present', kind: 'text', path: 'project:continuity_bible' },
      { id: 'clips', label: 'Clips exist', kind: 'clips' },
      { id: 'duration_sum', label: 'Clip durations sum correctly', kind: 'duration' },
      { id: 'start_frame', label: 'Every clip has a start frame prompt', kind: 'clip_field', clipField: 'start_frame_prompt' },
      { id: 'end_frame', label: 'Every clip has an end frame prompt', kind: 'clip_field', clipField: 'end_frame_prompt' },
      { id: 'flow', label: 'Every clip has a Flow prompt', kind: 'clip_field', clipField: 'flow_agent_prompt' },
      { id: 'bridge', label: 'Bridge checks (every clip except the last)', kind: 'bridge' },
      { id: 'music', label: 'Music direction present', kind: 'text', path: 'project:music_direction' },
      { id: 'edit', label: 'Edit plan present', kind: 'text', path: 'project:edit_plan' }
    ],
    ai_return_schema_notes: 'Fill audience/avatar, visual concept, story beats, continuity bible, clips[] (each with start/end frame prompts, a Flow prompt, bridge_check), voiceover timing, music direction, edit plan, and negative constraints. Clip durations must sum to the declared ad duration.',
    export_profile: ['Visual Concept', 'Story Beats', 'Continuity Bible', 'Clip-by-Clip Plan', 'Frame Prompts', 'Flow Agent Mode Prompts', 'Voiceover Timing', 'Music Direction', 'Edit Plan']
  },
  {
    id: 'competitor_recreation',
    name: 'Competitor Video Recreation',
    description: 'Recreate a competitor video’s structure as a brand-safe original, shot by shot.',
    best_for: 'Proven-winning competitor ads you want to adapt without copying.',
    required_inputs: ['Competitor video reference or breakdown', 'Active brand docs or brief'],
    optional_inputs: ['Imported script', 'Visual style', 'Market/language'],
    stages: ['Competitor Structure Adaptation', 'Shot-by-Shot Recreation Logic', 'Brand-Safe Changes', 'Frame Prompts', 'Video Prompts', 'Edit Plan'],
    outputs: ['Shot-by-shot recreation plan', 'Brand-safe substitutions', 'Per-shot frame/video prompts', 'Edit plan'],
    recommended_tools: ['anthropic', 'google_flow', 'kling', 'seedance', 'fal'],
    validation_rules: ['Each competitor beat mapped to a brand-safe shot', 'No copyrighted assets reproduced', 'Frame + video prompt per shot'],
    export_sections: ['Ad Method', 'Competitor Structure', 'Adapted Structure', 'Shot-by-Shot Plan', 'Frame/Video Prompts', 'Edit Plan'],

    required_project_fields: ['product_intake.product_name', 'product_intake.market_language'],
    required_stage_fields: ['edit_plan'],
    required_clip_fields: [],
    optional_clip_fields: ['frame_prompt', 'video_prompt'],
    // Canvas-aware validation: the Canvas is the source of truth. These mirror the
    // Canvas Readiness checklist so readiness predicts export readiness. Export
    // auto-syncs Canvas → method_data, so the old method_data fields are populated
    // from this same data at download time.
    validation_profile: [
      pn,
      ml,
      { id: 'comp_ref', label: 'Competitor reference present', kind: 'canvas_ref' },
      { id: 'comp_scenes', label: 'At least 3 scenes', kind: 'canvas_min', min: 3 },
      { id: 'comp_timestamps', label: 'Every scene has timestamps', kind: 'canvas_timestamps' },
      { id: 'comp_what', label: 'Every scene has what happens', kind: 'canvas_field', field: 'what_happens' },
      { id: 'comp_adapt_output', label: 'Every scene has adaptation or output prompt', kind: 'canvas_adapt_or_output' }
    ],
    ai_return_schema_notes: 'Return competitor_structure, adapted_structure, shot_by_shot_plan[] (each: shot, competitor_beat, adapted_shot, optional frame_prompt and video_prompt, brand_safe_change), visual_style_transfer_notes, edit_plan, and negative constraints. Flow/video prompts are optional. Do not reproduce any copyrighted assets.',
    export_profile: ['Competitor Structure', 'Adapted Structure', 'Shot-by-Shot Plan', 'Visual Style Transfer Notes', 'Edit Plan']
  },
  {
    id: 'ugc_talking_head',
    name: 'UGC Talking-Head Ad',
    description: 'A creator-style talking-head ad: hook, script delivery, b-roll, captions.',
    best_for: 'Authentic UGC, testimonials, founder/creator delivery.',
    required_inputs: ['Script or hook', 'Active brand docs or brief'],
    optional_inputs: ['Avatar/persona', 'B-roll list', 'Market/language'],
    stages: ['Audience / Avatar', 'Hook Variations', 'Talking-Head Script Beats', 'B-Roll Plan', 'Caption Plan', 'Edit Plan'],
    outputs: ['Hook options', 'Spoken script segments', 'B-roll shot list', 'Caption timing', 'Edit plan'],
    recommended_tools: ['anthropic', 'kling', 'fal', 'replicate'],
    validation_rules: ['Script present (imported or generated)', 'Hook defined', 'B-roll mapped to script beats'],
    export_sections: ['Ad Method', 'Script / Imported Script', 'Performance Direction', 'Shot List', 'B-roll Plan', 'Edit Plan'],

    required_project_fields: ['product_intake.product_name', 'product_intake.market_language'],
    required_stage_fields: ['edit_plan'],
    required_clip_fields: [],
    optional_clip_fields: [],
    validation_profile: [
      pn,
      ml,
      { id: 'script', label: 'Script or imported script present', kind: 'script' },
      { id: 'hook', label: 'Hook present', kind: 'hook' },
      { id: 'performance', label: 'Performance direction present', kind: 'text', path: 'data:performance_direction' },
      { id: 'shot_list', label: 'Shot list present', kind: 'array', path: 'data:shot_list' },
      { id: 'broll', label: 'B-roll plan present', kind: 'array', path: 'data:broll_plan' },
      { id: 'edit', label: 'Edit plan present', kind: 'text', path: 'project:edit_plan' }
    ],
    ai_return_schema_notes: 'Return hook, script_reference (which imported lines to use — do not rewrite the script), performance_direction, talking_head_notes, shot_list[], broll_plan[] (each: timecode, visual, source), edit_plan, and negative constraints. Do NOT produce start/end frame prompts, Flow prompts, or bridge checks.',
    export_profile: ['Script / Imported Script', 'Performance Direction', 'Talking-Head Notes', 'Shot List', 'B-roll Plan', 'Edit Plan']
  },
  {
    id: 'product_demo',
    name: 'Product Demo Ad',
    description: 'A clear product demonstration: problem, feature reveals, proof, CTA.',
    best_for: 'Feature-rich products and how-it-works demos.',
    required_inputs: ['Product/offer brief or active docs', 'Key features/benefits'],
    optional_inputs: ['Script', 'Visual style', 'Market/language'],
    stages: ['Audience / Avatar', 'Demo Flow', 'Feature Beats', 'Frame Prompts', 'Video Prompts', 'Edit Plan'],
    outputs: ['Demo flow outline', 'Per-feature shots', 'Frame/video prompts', 'Edit plan'],
    recommended_tools: ['anthropic', 'google_flow', 'seedance', 'fal'],
    validation_rules: ['Each key feature has a demo beat', 'Frame + video prompt per beat', 'Compliance inferred from docs'],
    export_sections: ['Ad Method', 'Demo Flow', 'Feature Beats', 'Shot List', 'Edit Plan'],

    required_project_fields: ['product_intake.product_name', 'product_intake.market_language'],
    required_stage_fields: ['edit_plan'],
    required_clip_fields: [],
    optional_clip_fields: ['frame_prompt', 'video_prompt'],
    validation_profile: [
      pn,
      ml,
      { id: 'demo_sequence', label: 'Product demonstration sequence present', kind: 'text', path: 'data:demo_sequence' },
      { id: 'feature_mapping', label: 'Feature/benefit mapping present', kind: 'array', path: 'data:feature_mapping' },
      { id: 'shot_list', label: 'Shot list present', kind: 'array', path: 'data:shot_list' },
      { id: 'edit', label: 'Edit plan present', kind: 'text', path: 'project:edit_plan' }
    ],
    ai_return_schema_notes: 'Return demo_sequence, feature_mapping[] (each: feature, benefit, shot), shot_list[], edit_plan, and negative constraints. Frame/video prompts are optional depending on the chosen output.',
    export_profile: ['Demo Flow', 'Feature Mapping', 'Shot List', 'Edit Plan']
  },
  {
    id: 'static_ad_pack',
    name: 'Static Ad Pack',
    description: 'A set of static image ad concepts with headlines, layouts, and image prompts.',
    best_for: 'Image ads for paid social and quick concept testing — no video.',
    required_inputs: ['Active brand docs or brief', 'Visual style'],
    optional_inputs: ['Offer', 'Market/language'],
    stages: ['Audience / Avatar', 'Angle Set', 'Headline Variations', 'Layout Concepts', 'Image Prompts'],
    outputs: ['Ad angles', 'Headlines', 'Layout descriptions', 'Per-ad image prompts'],
    recommended_tools: ['openai', 'fal', 'replicate'],
    validation_rules: ['At least 3 distinct angles', 'Image prompt per concept', 'Format/aspect ratio per concept'],
    export_sections: ['Ad Method', 'Static Concepts', 'Image Prompts', 'Copy Blocks', 'Layout Notes', 'Export Formats'],

    required_project_fields: ['product_intake.product_name', 'product_intake.market_language'],
    required_stage_fields: [],
    required_clip_fields: [],
    optional_clip_fields: [],
    validation_profile: [
      pn,
      ml,
      { id: 'concepts', label: 'Concepts present', kind: 'array', path: 'data:static_concepts' },
      { id: 'image_prompts', label: 'Every concept has an image prompt', kind: 'array_items', path: 'data:static_concepts', field: 'visual_prompt' },
      { id: 'formats', label: 'Every concept has a format / aspect ratio', kind: 'array_items', path: 'data:static_concepts', field: 'format' }
    ],
    ai_return_schema_notes: 'Return static_concepts[] (each: angle, headline, visual_prompt, layout_notes, negative_constraints[], format such as 1:1 / 4:5 / 9:16) and export_formats[]. No clips, no duration math, no Flow prompts, no bridge checks.',
    export_profile: ['Static Concepts', 'Export Formats']
  },
  {
    id: 'marketing_studio',
    name: 'Marketing Studio',
    description: 'One brief → complete ad package. UGC, podcast, or cinematic.',
    icon: '🎬',
    category: 'studio',
    phases: ['brief', 'format', 'character', 'script', 'prompts', 'export'],
    best_for: 'Turning one product brief into a full scene-by-scene prompt package (Omni Flash / Seedance) without leaving the dashboard.',
    required_inputs: ['Product name + description', 'Format choice', 'Character pick'],
    optional_inputs: ['Competitor analysis paste', 'Claim boundary', 'Landing page URL'],
    stages: ['Product Brief', 'Format', 'Characters', 'Script & Scenes', 'Prompts & Export'],
    outputs: ['Scene-by-scene outline', 'Paste-ready Omni Flash / Seedance prompts', 'Full script', 'Markdown production package'],
    recommended_tools: ['google_flow', 'seedance'],
    validation_rules: ['Product name + description required before format', 'Scene 1 is the hook, last scene is the CTA', 'Duration never in prompt text (setup header only)'],
    export_sections: ['Product Brief Summary', 'Scene Outline', 'Prompts'],

    required_project_fields: [],
    required_stage_fields: [],
    required_clip_fields: [],
    optional_clip_fields: [],
    validation_profile: [pn, ml],
    ai_return_schema_notes: 'Marketing Studio generates its package locally (pure JS) — no AI return schema. Use the Marketing Studio wizard in the left nav.',
    export_profile: ['Product Brief Summary', 'Scene Outline', 'Prompts']
  },
  {
    id: 'hook_testing_pack',
    name: 'Hook Testing Pack',
    description: 'A batch of hook variations (visual + verbal) to test scroll-stopping power.',
    best_for: 'Rapid hook testing before committing to a full ad.',
    required_inputs: ['Active brand docs or brief'],
    optional_inputs: ['Script', 'Angle preferences', 'Market/language'],
    stages: ['Audience / Avatar', 'Hook Angles', 'Verbal Hooks', 'Visual Hook Frames'],
    outputs: ['Hook angle matrix', 'Verbal hook lines', 'First-frame image prompts'],
    recommended_tools: ['anthropic', 'openai', 'fal'],
    validation_rules: ['At least 5 distinct hooks', 'Each hook has a verbal + visual idea', 'Ranking/selection logic'],
    export_sections: ['Ad Method', 'Hook Angles', 'Verbal Hooks', 'Visual Hook Frames', 'Ranking Logic'],

    required_project_fields: ['product_intake.product_name', 'product_intake.market_language'],
    required_stage_fields: [],
    required_clip_fields: [],
    optional_clip_fields: [],
    validation_profile: [
      pn,
      ml,
      { id: 'hook_list', label: 'Hook list present', kind: 'array', path: 'data:hook_list' },
      { id: 'angle_labels', label: 'Every hook has an angle label', kind: 'array_items', path: 'data:hook_list', field: 'angle_label' },
      { id: 'first_frame', label: 'Every hook has first-frame/first-line direction', kind: 'array_items', path: 'data:hook_list', field: 'first_frame_or_line' },
      { id: 'ranking', label: 'Ranking / selection logic present', kind: 'text', path: 'data:ranking_logic' }
    ],
    ai_return_schema_notes: 'Return hook_list[] (each: angle_label, verbal_hook, first_frame_or_line) and ranking_logic. No clips, no duration math, no Flow prompts, no bridge checks.',
    export_profile: ['Hook List', 'Ranking Logic']
  }
]

export const DEFAULT_METHOD_ID = 'animated_story_ad'

// Method-specific data keys captured from AI JSON into project.method_data.
export const METHOD_DATA_KEYS = [
  'static_concepts',
  'export_formats',
  'hook',
  'script_reference',
  'performance_direction',
  'talking_head_notes',
  'shot_list',
  'broll_plan',
  'competitor_structure',
  'adapted_structure',
  'shot_by_shot_plan',
  'visual_style_transfer_notes',
  'demo_sequence',
  'feature_mapping',
  'hook_list',
  'ranking_logic'
]

const BY_ID = Object.fromEntries(METHODS.map((m) => [m.id, m]))

export function getMethod(id) {
  return BY_ID[id] || BY_ID[DEFAULT_METHOD_ID]
}

export function recommendedToolNames(method) {
  return (method.recommended_tools || []).map(providerName).join(', ')
}
