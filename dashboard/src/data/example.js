// The French Craving-Control Claymation example as a structured dashboard project.
// Mirrors examples/french-craving-control-claymation-ad.json from the repo root.
// exampleProject() returns a fresh deep copy so edits never mutate this constant.

const EXAMPLE = {
  brand_docs: [
    {
      id: 'brand-tone-claims',
      title: 'Brand Tone & Claims Guide',
      content:
        'Tone: warm, understanding, in control. Speak to the woman as a capable adult, never shaming.\n' +
        'Always frame around: ritual, support, evening routine, control, alignment with training goals.\n' +
        'Never claim or imply: medical benefits, weight loss, fat burning, or appetite suppression ("coupe-faim").\n' +
        'No before/after, no scales, no calorie counts, no guaranteed results.\n' +
        'Visual world: warm tactile claymation, amber and warm neutrals, evening home kitchen.',
      source_type: 'paste',
      tags: ['brand voice', 'compliance'],
      active_for_project: true,
      global: false
    }
  ],
  product_intake: {
    product_name: 'Evening craving-control ritual drink',
    product_description:
      'An evening ritual drink for women who train and want to stay in control of evening cravings.',
    offer: 'A 30-day evening ritual: one calming drink and a simple nightly routine to stay aligned with your training.',
    target_audience:
      'Women who train regularly but struggle with evening cravings. Persona: Léa, early 30s, trains four times a week, disciplined by day but ambushed by cravings in the evening. Core tension: in control all day, loses it at night and feels she is undoing her own effort.',
    market_language: 'France / French',
    visual_style: 'warm tactile claymation',
    ad_duration: '30 seconds',
    product_benefits:
      'A calming evening ritual that helps you stay in control and aligned with your training goals.',
    brand_tone: 'warm, understanding, in control',
    brand_colors: 'amber, warm neutrals',
    optional_compliance_notes:
      'No medical, weight-loss, or guaranteed appetite-suppression claims. Frame around ritual, support, evening routine, control, and alignment with training goals.'
  },

  script_import: {
    hook: '« Le soir, c’est là que tout se joue. »',
    script:
      '« Le soir, c’est là que tout se joue. »\n' +
      '« Les envies arrivent. Toujours à la même heure. »\n' +
      '« Alors j’ai mon rituel. »\n' +
      '« Un geste simple, et je reste alignée avec mes objectifs. »\n' +
      '« Mon rituel du soir. Reste en contrôle, sans te priver. »',
    cta: '« Ton rituel du soir. »',
    notes: 'Imported from the Nick Launch Project. Source of truth — adapt visuals around it; do not rewrite.'
  },

  audience_psychology:
    'Persona: Léa, early 30s, trains four times a week, disciplined by day but ambushed by cravings in the evening.\n' +
    'Core tension: She feels in control all day, then loses that control at night and feels she is undoing her own effort.\n' +
    'Trigger moment: The quiet evening hour after training when fatigue and cravings arrive together.\n' +
    'Desired identity: A woman who stays aligned with her goals without punishing herself.\n' +
    'Objections: another product that overpromises; fear of being shamed about food or body; skepticism of appetite-suppressant gimmicks.',

  ad_concept:
    'Idea: The evening ritual that hands control back to her.\n' +
    'Angle: Not a fix for her body — a ritual for her evening.\n' +
    'Visual style: warm tactile claymation.\n' +
    'Hook premise: A bold claymation evening-ritual image that stops the scroll.\n' +
    'Desired feeling: warm, understood, in control.',

  story_beats:
    '1. Scroll-stopper — a bold tactile claymation image of the evening ritual.\n' +
    '2. Evening craving moment — the emotional trigger, shown with empathy.\n' +
    '3. The ritual drink — introduced as a calm, intentional ritual.\n' +
    '4. Shift back into control — alignment with training goals.\n' +
    '5. Product hero — a clean tactile hero shot.',

  continuity_bible:
    'Main subject: woman in her early 30s who trains; warm tactile claymation figure, athletic build, relaxed ponytail; fitted workout wear in muted warm tones, no logos. Do not change: claymation texture, face identity, workout wear, warm tone.\n' +
    'Product: amber craving-control ritual drink; small rounded glass bottle with a soft cork-style cap; frosted amber glass, clay-rendered; minimal unbranded label. Do not change: amber color, rounded shape, minimal label, claymation finish.\n' +
    'Location: warm home kitchen in the evening; dusk into night; wooden counter, soft cupboard, wall clock, gym bag; warm amber key light, soft evening shadows. Do not change: evening setting, warm amber light, wooden kitchen, claymation world.\n' +
    'Camera language: intimate close and medium claymation framing; slow push-ins and gentle slides, no impossible moves; soft depth of field, product stays readable.',

  clips: [
    {
      clip_number: 1,
      duration_seconds: 6,
      scene_purpose: 'Stop the scroll with a bold tactile claymation image of the evening ritual.',
      start_state:
        'A tight claymation close-up of a small amber ritual drink bottle being set on a warm wooden kitchen counter at dusk.',
      end_state:
        'A clay woman in fitted workout wear holds the amber drink and looks directly at camera with a calm, confident expression.',
      start_frame_prompt:
        'SCENE 1 - START FRAME PROMPT\n\nCreate a still image for French Craving-Control Claymation Ad.\n\nThe image shows a tight claymation close-up of a small amber ritual drink bottle being set on a warm wooden kitchen counter at dusk.\n\nSubject: a clay hand placing the bottle, warm tactile claymation.\nProduct: small rounded amber glass bottle with a soft cork-style cap, minimal unbranded label, clearly the hero.\nEnvironment: warm home kitchen in the evening, wooden counter, soft cupboard behind.\nCamera and composition: vertical 9:16 close product shot, bottle just right of center.\nLighting: warm amber key light, soft evening shadows.\nStyle: warm tactile claymation, handmade clay texture.\n\nContinuity requirements: preserve the amber bottle shape, claymation texture, and warm evening kitchen.\n\nDo not include: photoreal style, brand logos, weight-loss or appetite-suppressant claims, scales, calorie counts.',
      end_frame_prompt:
        'SCENE 1 - END FRAME PROMPT\n\nCreate a still image for French Craving-Control Claymation Ad.\n\nThe image shows a clay woman in fitted workout wear holding the amber ritual drink and looking directly at camera with a calm, confident expression.\n\nSubject: warm claymation woman, early 30s, athletic build, relaxed ponytail, fitted muted workout wear, no logos.\nProduct: same amber rounded bottle held toward the camera, minimal label, clearly visible.\nEnvironment: same warm evening kitchen, wooden counter, soft cupboard.\nCamera and composition: vertical 9:16 hero framing, woman and drink centered.\nLighting: warm amber key light, gentle evening glow.\nStyle: warm tactile claymation.\n\nContinuity requirements: preserve the woman\'s identity, workout wear, amber bottle, and claymation world.\n\nDo not include: photoreal style, brand logos, weight-loss or appetite-suppressant claims, body comparison, scales.',
      flow_agent_prompt:
        'SCENE 1 - FLOW AGENT MODE PROMPT\n\nGenerate a 6 second video clip for French Craving-Control Claymation Ad.\n\nUse the provided start frame and end frame as strict anchors. Animate a smooth transition from the start frame to the end frame.\n\nScene purpose: stop the scroll with a bold tactile claymation image of the evening ritual.\n\nCamera movement: slow push-in toward the woman and the drink.\n\nSubject motion: the clay woman lifts the amber drink slightly toward the camera.\n\nEnvironment motion: warm evening light glows softly; clay textures catch the light.\n\nContinuity requirements: same clay woman and workout wear, same amber ritual drink, same warm evening kitchen, claymation texture.\n\nDo not include: photoreal style, brand logos, weight-loss or appetite-suppressant claims, scales, calorie counts, body comparison.',
      attach_instructions: '',
      bridge_check:
        'End frame (woman holding the drink, facing camera) should lead into Clip 2 start: she sits on the kitchen floor, tired after training. Keep the same woman, workout wear, and kitchen.',
      continuity_references: [
        'clay woman in fitted workout wear',
        'amber ritual drink bottle',
        'warm evening kitchen',
        'claymation texture'
      ],
      negative_constraints: [
        'no weight-loss claims',
        'no appetite-suppressant claims',
        'no scales or body comparison',
        'no calorie counts',
        'no photoreal style'
      ]
    },
    {
      clip_number: 2,
      duration_seconds: 6,
      scene_purpose: 'Show the emotional evening craving moment with empathy.',
      start_state:
        'The clay woman sits on the kitchen floor in the evening, tired after training, glancing toward a cupboard of snacks.',
      end_state:
        'She rests her head in her hand, the pull of the craving visible on her face, warm but tense light.',
      start_frame_prompt:
        'SCENE 2 - START FRAME PROMPT\n\nCreate a still image for French Craving-Control Claymation Ad.\n\nThe image shows the clay woman sitting on the warm kitchen floor in the evening, tired after training, glancing toward a cupboard of snacks.\n\nSubject: same claymation woman, fitted workout wear, tired but dignified expression.\nProduct: the amber ritual drink resting on the counter in the background, still visible.\nEnvironment: same warm evening kitchen, wooden floor, soft cupboard, wall clock reading late.\nCamera and composition: vertical 9:16 medium shot at floor level.\nLighting: warm amber light with deeper evening shadows.\nStyle: warm tactile claymation.\n\nContinuity requirements: preserve the woman\'s identity, workout wear, kitchen, and claymation world.\n\nDo not include: binge or shame imagery, photoreal style, weight-loss claims, scales, body comparison.',
      end_frame_prompt:
        'SCENE 2 - END FRAME PROMPT\n\nCreate a still image for French Craving-Control Claymation Ad.\n\nThe image shows the clay woman resting her head in her hand, the pull of the evening craving visible on her face.\n\nSubject: same claymation woman, quietly tense expression, hand near her temple.\nProduct: amber ritual drink still visible on the counter behind her.\nEnvironment: same warm evening kitchen, deeper shadows, late clock.\nCamera and composition: vertical 9:16 closer framing on her face and shoulders.\nLighting: warm amber key light with a tense, low evening tone.\nStyle: warm tactile claymation.\n\nContinuity requirements: preserve the woman\'s identity, workout wear, kitchen, and claymation texture.\n\nDo not include: binge or shame imagery, photoreal style, weight-loss or appetite-suppressant claims, body comparison.',
      flow_agent_prompt:
        'SCENE 2 - FLOW AGENT MODE PROMPT\n\nGenerate a 6 second video clip for French Craving-Control Claymation Ad.\n\nUse the provided start frame and end frame as strict anchors. Animate a smooth transition from the start frame to the end frame.\n\nScene purpose: show the emotional evening craving moment with empathy.\n\nCamera movement: slow drift toward her face.\n\nSubject motion: she reaches halfway toward the cupboard, then hesitates and lowers her hand.\n\nEnvironment motion: evening shadows deepen slightly; the kitchen stays still.\n\nContinuity requirements: same clay woman and workout wear, same warm evening kitchen, claymation texture, evening timing.\n\nDo not include: binge or shame imagery, photoreal style, weight-loss or appetite-suppressant claims, body comparison, scales.',
      attach_instructions: '',
      bridge_check:
        'End frame (head in hand, craving visible) should lead into Clip 3 start: she reaches for the amber drink instead of the cupboard. Keep the same woman and kitchen; drink visible.',
      continuity_references: [
        'same clay woman and workout wear',
        'same warm evening kitchen',
        'claymation texture',
        'evening timing'
      ],
      negative_constraints: [
        'no binge imagery',
        'no shame framing',
        'no weight-loss claims',
        'no body comparison',
        'no photoreal style'
      ]
    },
    {
      clip_number: 3,
      duration_seconds: 6,
      scene_purpose: 'Introduce the drink as a calm, intentional ritual.',
      start_state: 'She pauses, then reaches instead for the amber ritual drink on the counter.',
      end_state: 'She prepares the drink with a small deliberate ritual gesture, her expression softening.',
      start_frame_prompt:
        'SCENE 3 - START FRAME PROMPT\n\nCreate a still image for French Craving-Control Claymation Ad.\n\nThe image shows the clay woman pausing, then reaching for the amber ritual drink on the wooden counter instead of the cupboard.\n\nSubject: same claymation woman, expression beginning to steady, hand reaching for the bottle.\nProduct: amber rounded bottle with cork-style cap, minimal label, clearly visible and central.\nEnvironment: same warm evening kitchen, wooden counter.\nCamera and composition: vertical 9:16 medium-close shot on her hands and the drink.\nLighting: warm amber key light, gentle glow.\nStyle: warm tactile claymation.\n\nContinuity requirements: preserve the amber bottle, the woman\'s identity, kitchen, and claymation world.\n\nDo not include: magical transformation, photoreal style, appetite-suppressant or weight-loss claims, calorie counts.',
      end_frame_prompt:
        'SCENE 3 - END FRAME PROMPT\n\nCreate a still image for French Craving-Control Claymation Ad.\n\nThe image shows the clay woman preparing the ritual drink with a small deliberate gesture, pouring it into a clay glass, her expression softening.\n\nSubject: same claymation woman, calmer expression, careful ritual gesture.\nProduct: amber ritual drink being poured into a clay glass, bottle and glass both clearly visible.\nEnvironment: same warm evening kitchen, wooden counter.\nCamera and composition: vertical 9:16 close shot on the pour and her face.\nLighting: warmer amber glow than the previous beat.\nStyle: warm tactile claymation.\n\nContinuity requirements: preserve the amber drink, the woman\'s identity, kitchen, and claymation texture.\n\nDo not include: magical transformation, photoreal style, appetite-suppressant or weight-loss claims, calorie counts.',
      flow_agent_prompt:
        'SCENE 3 - FLOW AGENT MODE PROMPT\n\nGenerate a 6 second video clip for French Craving-Control Claymation Ad.\n\nUse the provided start frame and end frame as strict anchors. Animate a smooth transition from the start frame to the end frame.\n\nScene purpose: introduce the drink as a calm, intentional ritual.\n\nCamera movement: gentle slide following her hands to the drink.\n\nSubject motion: she pours and stirs the ritual drink slowly and deliberately.\n\nEnvironment motion: the warm light warms further; a soft swirl moves in the glass.\n\nContinuity requirements: same amber ritual drink, same clay woman, same warm evening kitchen, warm evening light.\n\nDo not include: magical transformation, photoreal style, appetite-suppressant or weight-loss claims, calorie counts, body comparison.',
      attach_instructions: '',
      bridge_check:
        'End frame (preparing the drink, expression softening) should lead into Clip 4 start: she sips, shoulders relaxing. Keep the same drink and warm light.',
      continuity_references: [
        'amber ritual drink bottle',
        'same clay woman',
        'same warm evening kitchen',
        'warm evening light'
      ],
      negative_constraints: [
        'no appetite-suppressant claims',
        'no magical transformation',
        'no weight-loss claims',
        'no calorie counts',
        'no photoreal style'
      ]
    },
    {
      clip_number: 4,
      duration_seconds: 6,
      scene_purpose: 'Show the shift back into control and alignment with training goals.',
      start_state: 'She sips the drink, shoulders relaxing, the craving’s grip easing into calm.',
      end_state: 'She stands, steady and in control, glancing at her gym bag with quiet resolve.',
      start_frame_prompt:
        'SCENE 4 - START FRAME PROMPT\n\nCreate a still image for French Craving-Control Claymation Ad.\n\nThe image shows the clay woman sipping the ritual drink, her shoulders relaxing as the craving\'s grip eases into calm.\n\nSubject: same claymation woman, calmer face, holding the clay glass.\nProduct: amber ritual drink in the clay glass, clearly visible.\nEnvironment: same warm evening kitchen, gym bag visible nearby.\nCamera and composition: vertical 9:16 medium shot at seated level.\nLighting: warm amber light, steadier and a touch brighter.\nStyle: warm tactile claymation.\n\nContinuity requirements: preserve the woman\'s identity, workout wear, drink, kitchen, and claymation world.\n\nDo not include: photoreal style, weight-loss or appetite-suppressant claims, guaranteed-result text, body comparison.',
      end_frame_prompt:
        'SCENE 4 - END FRAME PROMPT\n\nCreate a still image for French Craving-Control Claymation Ad.\n\nThe image shows the clay woman standing, steady and in control, glancing at her gym bag with quiet resolve.\n\nSubject: same claymation woman, calm and grounded posture, settled expression.\nProduct: amber ritual drink resting on the counter beside her, still visible.\nEnvironment: same warm evening kitchen, gym bag in frame.\nCamera and composition: vertical 9:16 medium shot at standing eye level.\nLighting: warm amber light, settled and confident.\nStyle: warm tactile claymation.\n\nContinuity requirements: preserve the woman\'s identity, workout wear, drink, kitchen, and claymation texture.\n\nDo not include: photoreal style, weight-loss or appetite-suppressant claims, guaranteed-result text, body comparison.',
      flow_agent_prompt:
        'SCENE 4 - FLOW AGENT MODE PROMPT\n\nGenerate a 6 second video clip for French Craving-Control Claymation Ad.\n\nUse the provided start frame and end frame as strict anchors. Animate a smooth transition from the start frame to the end frame.\n\nScene purpose: show the shift back into control and alignment with training goals.\n\nCamera movement: slow rise from seated to standing eye level.\n\nSubject motion: she breathes, sips, then stands with calm, grounded posture.\n\nEnvironment motion: the light steadies and brightens gently; shadows settle.\n\nContinuity requirements: same clay woman and workout wear, same amber ritual drink, same warm evening kitchen, gym bag detail.\n\nDo not include: photoreal style, weight-loss or appetite-suppressant claims, guaranteed results, body comparison, scales.',
      attach_instructions: '',
      bridge_check:
        'End frame (standing, in control, glancing at gym bag) should lead into Clip 5 start: camera pulls back to the drink on the counter. Keep the same woman, drink, and kitchen.',
      continuity_references: [
        'same clay woman and workout wear',
        'amber ritual drink',
        'same warm evening kitchen',
        'gym bag detail'
      ],
      negative_constraints: [
        'no weight-loss claims',
        'no guaranteed results',
        'no appetite-suppressant claims',
        'no body comparison',
        'no photoreal style'
      ]
    },
    {
      clip_number: 5,
      duration_seconds: 6,
      scene_purpose: 'End on a clean tactile product hero shot.',
      start_state:
        'The camera pulls back from the woman to the amber ritual drink standing on the counter in warm light.',
      end_state:
        'Final hero composition: the ritual drink centered, the calm woman softly behind, warm claymation glow.',
      start_frame_prompt:
        'SCENE 5 - START FRAME PROMPT\n\nCreate a still image for French Craving-Control Claymation Ad.\n\nThe image begins to pull back from the calm clay woman toward the amber ritual drink standing on the warm wooden counter.\n\nSubject: same claymation woman, calm and settled, slightly behind the drink.\nProduct: amber rounded bottle, minimal label, clearly the hero in warm light.\nEnvironment: same warm evening kitchen, wooden counter.\nCamera and composition: vertical 9:16 composition opening toward a hero framing.\nLighting: warm amber glow on the bottle.\nStyle: warm tactile claymation.\n\nContinuity requirements: preserve the amber bottle, the woman\'s identity, kitchen, and claymation world.\n\nDo not include: extra claims text, photoreal style, weight-loss or appetite-suppressant claims, body comparison.',
      end_frame_prompt:
        'SCENE 5 - END FRAME PROMPT\n\nCreate a still image for French Craving-Control Claymation Ad.\n\nThe image shows a final clean hero composition: the amber ritual drink centered on the counter, the calm clay woman softly behind it, in a warm claymation glow.\n\nSubject: same claymation woman, calm and in control, softly out of focus behind the drink.\nProduct: amber ritual drink centered as the hero, minimal label, sharply rendered.\nEnvironment: same warm evening kitchen, wooden counter.\nCamera and composition: vertical 9:16 balanced product hero shot.\nLighting: warm amber hero glow.\nStyle: warm tactile claymation.\n\nContinuity requirements: preserve the amber bottle, the woman\'s identity, kitchen, and claymation texture.\n\nDo not include: extra claims text, photoreal style, weight-loss or appetite-suppressant claims, body comparison.',
      flow_agent_prompt:
        'SCENE 5 - FLOW AGENT MODE PROMPT\n\nGenerate a 6 second video clip for French Craving-Control Claymation Ad.\n\nUse the provided start frame and end frame as strict anchors. Animate a smooth transition from the start frame to the end frame.\n\nScene purpose: end on a clean tactile product hero shot.\n\nCamera movement: slow pullback to a balanced hero composition.\n\nSubject motion: the woman settles calmly in the background.\n\nEnvironment motion: warm light holds steady; a gentle glow rests on the bottle.\n\nContinuity requirements: same amber ritual drink, same clay woman, same warm evening kitchen, claymation texture.\n\nDo not include: extra claims text, photoreal style, weight-loss or appetite-suppressant claims, body comparison, scales.',
      attach_instructions: '',
      bridge_check: '',
      continuity_references: [
        'amber ritual drink bottle',
        'same clay woman',
        'warm evening kitchen',
        'claymation texture'
      ],
      negative_constraints: [
        'no on-screen claims text beyond the approved tagline',
        'no weight-loss claims',
        'no appetite-suppressant claims',
        'no body comparison',
        'no photoreal style'
      ]
    }
  ],

  voiceover_script:
    'Voiceover timing — the imported script mapped onto the clips (script unchanged):\n' +
    'Clip 1 (0.0s–6.0s): « Le soir, c’est là que tout se joue. »\n' +
    'Clip 2 (6.0s–12.0s): « Les envies arrivent. Toujours à la même heure. »\n' +
    'Clip 3 (12.0s–18.0s): « Alors j’ai mon rituel. »\n' +
    'Clip 4 (18.0s–24.0s): « Un geste simple, et je reste alignée avec mes objectifs. »\n' +
    'Clip 5 (24.0s–30.0s): « Mon rituel du soir. Reste en contrôle, sans te priver. »',

  music_direction:
    'Mood: warm, intimate, tactile. Reference feel: soft French indie-pop, gentle and modern.\n' +
    'Energy curve: 1) warm, inviting open — 2) sparse, tender tension — 3) a calm turn, first lift — 4) steady, confident rise — 5) settled, warm resolve.\n' +
    'Sound design: soft clay foley on the bottle and the pour; gentle room tone of an evening kitchen; no aggressive drops.',

  edit_plan:
    'Clip order: 1 → 2 → 3 → 4 → 5.\n' +
    'Transitions: soft match cut on the drink between the craving beat and the ritual beat; gentle dissolve into the hero pullback.\n' +
    'Captions: French, lower third, minimal, mirroring the voiceover (no added claims).\n' +
    'End card: amber ritual drink in a warm claymation glow; tagline « Ton rituel du soir. » (tagline only, no claims).\n' +
    'Total runtime: 30 seconds.',

  negative_constraints: [
    'no medical claims',
    'no weight-loss claims',
    'no appetite-suppressant or coupe-faim claims',
    'no before/after or body comparison',
    'no scales, calorie counts, or weight numbers',
    'no shame or binge imagery',
    'no guaranteed results',
    'no visible brand logos',
    'no live-action or photoreal style, claymation only'
  ],

  notes: { frame_prompts: '', flow_clip_prompts: '' }
}

export function exampleProject() {
  return structuredClone(EXAMPLE)
}
