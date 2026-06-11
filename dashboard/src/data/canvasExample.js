// Starter competitor recreation example: a 5-scene canvas with placeholder
// competitor data. Returns a full project so "Load" sets everything at once.

import { emptyProject } from '../lib/projectModel.js'
import { makeDoc } from '../lib/brandDocs.js'

function scene(n, start, end, what, adapt, prompt, extra = {}) {
  return {
    id: `ex-scene-${n}`,
    scene_number: n,
    timestamp_start: start,
    timestamp_end: end,
    competitor_frame_description: extra.frame || '',
    what_happens: what,
    camera_angle: extra.angle || '',
    camera_movement: extra.move || '',
    subject_action: extra.subject || '',
    product_role: extra.product_role || '',
    text_overlay_seen: extra.overlay || '',
    voiceover_or_dialogue: extra.vo || '',
    emotional_purpose: extra.emotion || '',
    editing_notes: extra.edit || '',
    why_this_scene_works: extra.why || '',
    adaptation_instruction_for_our_product: adapt,
    required_assets: extra.assets || '',
    output_prompt: prompt,
    image_name: '',
    llm_provider: '',
    image_provider: '',
    video_provider: ''
  }
}

export function competitorCanvasExample() {
  const base = emptyProject()
  return {
    ...base,
    selected_method: 'competitor_recreation',
    brand_docs: [
      makeDoc({
        title: 'Brand Guide (example)',
        content: 'Tone: warm, confident, honest. No medical or guaranteed-result claims. Visual world: bright, tactile, real.',
        source_type: 'paste',
        tags: ['brand voice', 'compliance'],
        active_for_project: true
      })
    ],
    product_intake: {
      ...base.product_intake,
      product_name: 'Our Product (example)',
      product_description: 'A simple everyday product the ad will feature.',
      market_language: 'US / English',
      visual_style: 'bright, tactile, real',
      ad_duration: '30 seconds'
    },
    canvas: {
      competitor_reference: {
        competitor_ad_name: 'Competitor Hero Ad (placeholder)',
        competitor_brand: 'Competitor Brand (placeholder)',
        source_url: 'https://example.com/competitor-ad',
        platform: 'Instagram Reels',
        ad_duration: '30 seconds',
        notes: 'Placeholder reference — replace with the real competitor ad details and screenshots.'
      },
      model_defaults: {
        default_llm_provider: 'anthropic',
        default_image_provider: 'fal',
        default_video_provider: 'kling',
        default_voice_provider: '',
        default_music_provider: ''
      },
      scenes: [
        scene(1, '0:00', '0:05', 'Bold scroll-stopping opening shot with the product revealed fast.', 'Open on OUR product with the same fast reveal energy; new framing and brand-safe styling.', 'Generation prompt: a bright, tactile hero shot of our product, fast reveal energy, no competitor branding.', { angle: 'close-up', move: 'quick push-in', emotion: 'curiosity', why: 'Strong pattern interrupt in the first second.' }),
        scene(2, '0:05', '0:12', 'Relatable problem moment that sets up the need.', 'Show OUR audience’s version of the problem, authentic and brand-safe.', 'Generation prompt: a relatable everyday problem moment for our audience.', { emotion: 'tension', why: 'Creates the need before the solution.' }),
        scene(3, '0:12', '0:20', 'Product demonstrated solving the problem.', 'Demonstrate OUR product solving the problem; preserve pacing, change specifics.', 'Generation prompt: our product clearly solving the problem, clean and convincing.', { product_role: 'hero', emotion: 'relief', why: 'Payoff moment.' }),
        scene(4, '0:20', '0:26', 'Quick proof / benefit montage with text overlays.', 'Adapt to OUR benefits and supported claims only; new overlay copy.', 'Generation prompt: quick benefit montage of our product, supported claims only.', { overlay: 'benefit callouts', emotion: 'confidence', why: 'Stacks value quickly.' }),
        scene(5, '0:26', '0:30', 'Final hero shot with CTA.', 'Final hero of OUR product with our CTA; brand-safe, original identity.', 'Generation prompt: final hero shot of our product with a clean CTA.', { product_role: 'hero', emotion: 'resolve', why: 'Clear close and CTA.' })
      ],
      canvas_board: { nodes: [], edges: [] }
    },
    edit_plan: 'Clip order 1-5. Match the competitor pacing; transitions on the product reveal. CTA end card.',
    method_data: {
      competitor_structure: 'Hook → problem → product solves → proof montage → hero CTA.',
      adapted_structure: 'Same 5-beat structure rebuilt with our product, brand-safe styling, and supported claims.',
      visual_style_transfer_notes: 'Keep pacing and emotional sequence; swap visual identity to our bright, tactile style.',
      shot_by_shot_plan: []
    }
  }
}
