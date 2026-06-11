# Product Spec

## Scope Note

The product is now a **reusable animated ad production assistant** (see `docs/system-vision.md`). It takes one product input and produces a complete animated ad through ten staged outputs (`docs/pipeline-stages.md`).

This spec covers the **Flow frame-to-video and export module** — the part that owns stages 5, 6, and 10 (frame prompts, Flow clip prompts, and the deterministic export). It is intact and unchanged in capability; it now sits inside the larger assistant rather than standing alone. Stage-level specs live in `docs/pipeline-stages.md`; claims and localization rules live in `docs/quality-control-rules.md`.

## Product Name

Flow Keyframe Video Pipeline (frame-to-video / export module)

## Product Type

Prompt-and-workflow system for producing segmented AI videos in Google Flow using start and end keyframes. Within the assistant, this is the module that turns story beats into keyframes, Flow clip prompts, and a final export package.

## User

Creators, marketers, ecommerce operators, and AI video producers who need repeatable short-form animated ad generation without losing continuity across clips, and without making unverified product claims.

## Problem

AI video clips often fail because each clip is prompted independently. This creates:

- Character drift.
- Product drift.
- Inconsistent lighting.
- Inconsistent camera style.
- Weak clip-to-clip transitions.
- Messy prompts that are hard to copy into production tools.

## MVP Goal

Create a structured prompt workflow that turns one video idea into a scene-by-scene production package.

## MVP Inputs

- Full video idea.
- Target runtime.
- Target scene duration.
- Visual style.
- Subject details.
- Continuity constraints.
- Platform or aspect ratio.
- Optional brand rules.

## MVP Outputs

- Scene breakdown.
- Continuity bible.
- Start-frame prompts.
- End-frame prompts.
- Google Flow Agent Mode prompts.
- Copy-paste export blocks.
- Example JSON representation.

## Non-Goals

- No complex app.
- No UI yet.
- No APIs or external service calls.
- No database.
- No authentication.
- No rendering pipeline.
- No audio or music generation.
- No automated Google Flow integration.
- No asset manager yet.
- No medical, weight-loss, or guaranteed appetite-suppression claims, and no unverified claims of any kind (see `docs/quality-control-rules.md`).

## Future UI Requirements

When this becomes a UI tool, it should support:

- Project setup form.
- Continuity bible editor.
- Scene table.
- Prompt generation panel.
- Export-by-scene buttons.
- JSON import and export.
- Review checklist.

## Data Model

The export module validates and renders these top-level keys:

- `project`
- `continuity_bible`
- `scenes`
- `exports`

A full assistant project JSON also carries the additive stage keys authored by the upstream stages (`product_intake`, `audience_psychology`, `ad_concept`, `story_beats`, `voiceover_script`, `music_direction`, `edit_plan`). The renderer ignores keys it does not own, so a complete project still renders through the module. See `examples/french-craving-control-claymation-ad.json` and `docs/pipeline-stages.md`.

Each scene should contain:

- `scene_number`
- `duration_seconds`
- `purpose`
- `start_state`
- `end_state`
- `start_frame_prompt`
- `end_frame_prompt`
- `flow_agent_prompt`
- `continuity_references`
- `negative_constraints`

## Success Criteria

The MVP is successful if a user can:

- Paste in a full video idea.
- Generate a reliable 5-8 scene plan for a 50-60 second video.
- Copy each frame prompt into an image generator.
- Copy each video prompt into Google Flow Agent Mode.
- Keep the same subject, style, and environment across clips.

## Highest-Leverage Priority

The deterministic export module exists. The next highest-leverage build is the **upstream staged authoring** that fills the project JSON before it reaches the module: a stage-by-stage generator (intake → psychology → concept → beats) plus a stage-aware export that also renders the assistant-owned stages (voiceover, music, edit plan) into the final package. Build the staged method as documentation and schema first, then automate it — not a UI, not a broad creative assistant.
