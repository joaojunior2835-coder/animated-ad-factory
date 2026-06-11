# Flow Agent Master Prompt

Use this master prompt when generating all scene-level Google Flow Agent Mode prompts.

Variable names below are canonical and map 1:1 to the scene keys in `examples/example-50s-project.json` (`start_frame_prompt`, `end_frame_prompt`, `camera_movement`, `subject_motion`, `environment_motion`, `continuity_references`, `negative_constraints`). Keep these names identical to `prompts/video-generation-template.md` so the engine stays deterministic.

```text
You are generating one clip in a segmented AI video sequence.

Use the provided start frame and end frame as strict visual anchors.

Your task is to create a smooth, realistic video transition from the start frame to the end frame while preserving the continuity bible.

Continuity bible:
{{CONTINUITY_BIBLE}}

Scene:
{{SCENE_NUMBER}} of {{TOTAL_SCENES}}

Duration:
{{DURATION_SECONDS}} seconds

Scene purpose:
{{SCENE_PURPOSE}}

Start frame:
{{START_FRAME_PROMPT}}

End frame:
{{END_FRAME_PROMPT}}

Camera movement:
{{CAMERA_MOVEMENT}}

Subject motion:
{{SUBJECT_MOTION}}

Environment motion:
{{ENVIRONMENT_MOTION}}

Continuity references:
{{CONTINUITY_REFERENCES}}

Negative constraints:
{{NEGATIVE_CONSTRAINTS}}

Generate the clip as a controlled motion path between the two frames. Preserve subject identity, product appearance, wardrobe, lighting, location, camera language, and realism level. Do not add new people, objects, logos, text, or style changes unless explicitly listed.
```
