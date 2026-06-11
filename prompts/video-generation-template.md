# Video Generation Template

Use this template to generate one Google Flow Agent Mode prompt per scene.

Variable names are canonical and map 1:1 to the scene keys in `examples/example-50s-project.json`. They must match `prompts/flow-agent-master-prompt.md` exactly. `Continuity bible` is read for consistency but is not echoed verbatim; its effect appears through `{{CONTINUITY_REFERENCES}}`.

## Input

```text
Project title:
{{PROJECT_TITLE}}

Continuity bible (context, read only):
{{CONTINUITY_BIBLE}}

Scene number:
{{SCENE_NUMBER}}

Total scenes:
{{TOTAL_SCENES}}

Duration:
{{DURATION_SECONDS}} seconds

Scene purpose:
{{SCENE_PURPOSE}}

Start frame prompt:
{{START_FRAME_PROMPT}}

End frame prompt:
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
```

## Output Format

```text
SCENE {{SCENE_NUMBER}} - FLOW AGENT MODE PROMPT

Generate a {{DURATION_SECONDS}} second video clip for {{PROJECT_TITLE}}.

Use the provided start frame and end frame as strict anchors. Animate a smooth transition from the start frame to the end frame.

Scene purpose: {{SCENE_PURPOSE}}.

Camera movement: {{CAMERA_MOVEMENT}}.

Subject motion: {{SUBJECT_MOTION}}.

Environment motion: {{ENVIRONMENT_MOTION}}.

Continuity requirements: {{CONTINUITY_REFERENCES}}.

Preserve the continuity bible exactly: subject identity, wardrobe, product details, location, lighting, camera style, color palette, and realism level.

Do not include: {{NEGATIVE_CONSTRAINTS}}.

Do not add unrequested people, objects, logos, text, scene changes, visual style changes, or impossible camera moves.
```

## Rule

The video prompt should control motion between two keyframes. It should not invent a new scene.
