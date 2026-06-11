# Pipeline Stages

This is the canonical definition of the ten stages of the animated ad assistant. Each stage lists its purpose, inputs, outputs, the module that owns it, and the gate that must pass before the next stage begins.

A stage may not start until the previous stage's gate passes. See `docs/staged-workflow.md` for the operating procedure and `docs/quality-control-rules.md` for the gates in detail.

The structured representation of all ten stages lives in a single project JSON. See `examples/french-craving-control-claymation-ad.json` for a complete worked example, and `schema/project.schema.json` for the part of that JSON the export module validates today.

## Stage 1 — Product Intake

- **Purpose:** Capture the product, its real promise, the market, and hard constraints.
- **Inputs:** Raw product description from the user.
- **Outputs:** `product_intake` — name, category, what it is, who it serves, core benefit framed safely, market, language, claim constraints.
- **Owner:** Assistant (intake module, documentation-defined).
- **Gate:** The benefit is stated without prohibited claims. Market and language are set.

## Stage 2 — Audience Psychology

- **Purpose:** Define who the ad is for and what they actually feel, want, and fear.
- **Inputs:** `product_intake`.
- **Outputs:** `audience_psychology` — target persona, core tension, the trigger moment, desired identity, objections.
- **Owner:** Assistant.
- **Gate:** There is one specific persona and one core emotional tension, not a demographic list.

## Stage 3 — Ad Concept

- **Purpose:** Commit to one creative idea and angle that resolves the tension.
- **Inputs:** `audience_psychology`.
- **Outputs:** `ad_concept` — the single idea, the angle, the visual style, the hook premise, the desired feeling.
- **Owner:** Assistant.
- **Gate:** One concept, one angle, one visual style. No competing ideas carried forward.

## Stage 4 — Story Beats

- **Purpose:** Turn the concept into an ordered emotional arc.
- **Inputs:** `ad_concept`.
- **Outputs:** `story_beats` — an ordered list of beats; each beat has a purpose and maps to a scene number. The continuity bible is also drafted here.
- **Owner:** Assistant; feeds the Flow module.
- **Gate:** The arc opens with a scroll-stopper and ends with a product hero. Each beat is one idea.

## Stage 5 — Frame Prompts

- **Purpose:** Produce start and end keyframe image prompts for each beat.
- **Inputs:** `story_beats`, `continuity_bible`.
- **Outputs:** `scenes[].start_frame_prompt`, `scenes[].end_frame_prompt`.
- **Owner:** Flow module — `prompts/frame-generation-template.md`.
- **Gate:** Each frame describes a still image, preserves the continuity bible, and the end frame bridges to the next beat.

## Stage 6 — Flow Frame-to-Video Clip Prompts

- **Purpose:** Describe controlled motion between each beat's two keyframes.
- **Inputs:** `scenes[]` frame prompts, `continuity_bible`.
- **Outputs:** `scenes[].flow_agent_prompt` plus `camera_movement`, `subject_motion`, `environment_motion`.
- **Owner:** Flow module — `prompts/video-generation-template.md`, `prompts/flow-agent-master-prompt.md`.
- **Gate:** The clip animates between the two frames only. It does not invent a new scene.

## Stage 7 — Voiceover Script

- **Purpose:** Write the spoken line for each beat in the ad's language.
- **Inputs:** `story_beats`, `audience_psychology`, `ad_concept`.
- **Outputs:** `voiceover_script` — language plus one line per scene number.
- **Owner:** Assistant.
- **Gate:** Every line is in the correct language, matches its beat, and respects the claim rules.

## Stage 8 — Music Direction

- **Purpose:** Define the audio mood, energy curve, and sound design.
- **Inputs:** `ad_concept`, `story_beats`.
- **Outputs:** `music_direction` — mood, reference feel, energy curve across beats, sound-design notes.
- **Owner:** Assistant.
- **Gate:** The energy curve aligns with the emotional arc (e.g. tension at the craving beat, lift at the resolution).

## Stage 9 — Edit Plan

- **Purpose:** Specify how the clips assemble into the finished ad.
- **Inputs:** `scenes[]`, `voiceover_script`, `music_direction`.
- **Outputs:** `edit_plan` — clip order, transitions, caption language and placement, end card, total runtime.
- **Owner:** Assistant; consumed by the export module.
- **Gate:** Clip order matches the beats. Total runtime equals the sum of clip durations.

## Stage 10 — Final Export

- **Purpose:** Produce one clean, copy-paste production package.
- **Inputs:** The full project JSON.
- **Outputs:** `exports/<project-slug>-flow-export.md` and the in-JSON `exports` block.
- **Owner:** Flow module — `scripts/render_project.py`.
- **Gate:** Validation passes (required fields, duration math). No leftover template variables.

## Stage-to-JSON Map

| Stage | JSON location | Owner |
| --- | --- | --- |
| 1 Product intake | `product_intake` | Assistant |
| 2 Audience psychology | `audience_psychology` | Assistant |
| 3 Ad concept | `ad_concept` | Assistant |
| 4 Story beats | `story_beats`, `continuity_bible` | Assistant → Flow |
| 5 Frame prompts | `scenes[].start_frame_prompt`, `scenes[].end_frame_prompt` | Flow |
| 6 Flow clip prompts | `scenes[].flow_agent_prompt` + motion fields | Flow |
| 7 Voiceover script | `voiceover_script` | Assistant |
| 8 Music direction | `music_direction` | Assistant |
| 9 Edit plan | `edit_plan` | Assistant |
| 10 Final export | `exports`, rendered Markdown | Flow |

Today the export module (`schema/project.schema.json`, `scripts/render_project.py`) validates and renders `project`, `continuity_bible`, `scenes`, and `exports`. The stage 1–4 and 7–9 keys are additive context the assistant authors; the renderer ignores keys it does not own, so a full project JSON renders cleanly through the existing module.
