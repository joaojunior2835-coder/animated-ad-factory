# Decisions

This file records product and workflow decisions so the system does not sprawl.

## Decision 001: Start With Documentation, Not UI

Decision: The MVP is documentation, prompt templates, and JSON structure.

Reason: The workflow must be clear before building interface complexity.

Impact: No app, database, or automation is included in the first version.

## Decision 002: Use 8-10 Second Scenes

Decision: Scenes should be segmented into 8-10 second clips.

Reason: This keeps each generated video clip focused enough for controlled motion while still long enough to be useful in a sequence.

Impact: A 50-second project should usually produce 5-6 scenes.

## Decision 003: Require Start And End Keyframes

Decision: Every scene gets a start-frame prompt and end-frame prompt.

Reason: Keyframes constrain the model and reduce drift.

Impact: Video prompts should describe motion between frames, not invent the whole scene.

## Decision 004: Continuity Bible Comes Before Scene Prompts

Decision: The continuity bible is created before frame and video prompts.

Reason: Without a source of truth, every generated scene becomes a separate interpretation.

Impact: All prompts reference the continuity bible.

## Decision 005: Export Must Be Copy-Paste Ready

Decision: Export blocks should be clean, labeled, and ready to paste into generation tools.

Reason: Production speed matters. Messy prompts create avoidable friction and mistakes.

Impact: Every template includes explicit output formatting.
