# Workflow

> This is the **Flow module workflow** — stages 5, 6, and 10 of the larger assistant. It assumes stages 1-4 (product intake, audience psychology, ad concept, story beats) are already done. For the full ten-stage procedure, see `docs/staged-workflow.md`. For compliance and localization gates, see `docs/quality-control-rules.md`.

Hard truth: the output quality will be decided before Google Flow ever renders a clip. Bad scene segmentation and weak continuity rules create visual drift, pacing issues, and unusable clips.

## Where This Fits

The story beats from stage 4 arrive as the scene list. This workflow turns each beat into keyframes (stage 5) and a Flow clip prompt (stage 6), reviews continuity, and exports the production package (stage 10). The voiceover, music, and edit-plan stages run in parallel and join at export.

## Real Bottleneck

The bottleneck is not prompt length. The bottleneck is the absence of a repeatable handoff between:

- Full video concept.
- Scene breakdown.
- Keyframe generation.
- Video generation.
- Continuity review.
- Final export.

## Build Order

1. Write the full video idea.
2. Extract the continuity bible.
3. Segment the idea into 8-10 second scenes.
4. Generate start-frame prompts.
5. Generate end-frame prompts.
6. Generate Flow Agent Mode prompts.
7. Review continuity.
8. Export clean copy-paste prompt blocks.

## Step 1: Full Video Idea

Capture the minimum viable brief:

- Goal: what the video must accomplish.
- Audience: who it is for.
- Runtime: target total duration.
- Format: aspect ratio, platform, and style.
- Subject: people, product, place, or concept.
- Visual language: camera style, lighting, texture, realism level.
- Non-negotiables: what must remain consistent.

## Step 2: Continuity Bible

Before scenes are generated, define:

- Character appearance.
- Wardrobe.
- Product appearance.
- Location rules.
- Lighting rules.
- Camera language.
- Color palette.
- Motion style.
- Brand constraints.
- Things to avoid.

Use `docs/continuity-bible.md` as the source of truth.

## Step 3: Scene Segmentation

Each scene should be 8-10 seconds.

For every scene, define:

- Scene number.
- Duration.
- Purpose.
- Start state.
- End state.
- Primary subject.
- Camera movement.
- Required continuity references.

Scene transitions should be intentional. Do not create scenes that merely restate the previous one.

## Step 4: Frame Prompts

For each scene, generate two image prompts:

- Start frame: the exact visual state at second 0 of the clip.
- End frame: the exact visual state at the final second of the clip.

The end frame should be meaningfully different from the start frame, but still continuous.

Use `prompts/frame-generation-template.md`.

## Step 5: Flow Agent Prompts

For each scene, generate one Google Flow Agent Mode prompt.

The prompt should specify:

- Use the provided start frame and end frame as anchors.
- Preserve continuity bible details.
- Animate only the intended motion.
- Maintain camera, lighting, and subject consistency.
- Avoid adding unrequested objects or style shifts.

Use `prompts/video-generation-template.md`.

## Step 6: Continuity Review

Check every scene against:

- Character drift.
- Wardrobe drift.
- Product drift.
- Location drift.
- Lighting drift.
- Camera inconsistency.
- Timeline confusion.
- Unwanted new objects.
- Overly complex action.

If a scene fails, fix the prompt before generation.

## Step 7: Export

Export in this order:

1. Continuity bible.
2. Scene list.
3. Frame prompts by scene.
4. Flow Agent prompts by scene.
5. Negative prompt block.

## Main Mistake To Avoid

Do not ask the video model to invent the scene. Ask it to execute a narrow movement between two controlled keyframes.
