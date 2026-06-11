# Frame Generation Template

Use this template to generate start and end keyframe image prompts for each scene.

## Input

Every variable below is either echoed into the output or marked `context`. Context variables are read to keep continuity but are never pasted verbatim into the image prompt. A still frame has no duration, so duration is intentionally not an input here.

```text
Project title:
{{PROJECT_TITLE}}

Scene number:
{{SCENE_NUMBER}}

Frame type:
{{START_OR_END_FRAME}}

Continuity bible (context, read only):
{{CONTINUITY_BIBLE}}

Scene purpose (context, read only):
{{SCENE_PURPOSE}}

Moment in scene:
{{MOMENT_DESCRIPTION}}

Required subject state:
{{SUBJECT_STATE}}

Required product state:
{{PRODUCT_STATE}}

Required environment state:
{{ENVIRONMENT_STATE}}

Camera and composition:
{{CAMERA_AND_COMPOSITION}}

Lighting:
{{LIGHTING}}

Style:
{{VISUAL_STYLE}}

Required continuity details:
{{REQUIRED_CONTINUITY_DETAILS}}

Negative constraints:
{{NEGATIVE_CONSTRAINTS}}
```

## Output Format

```text
SCENE {{SCENE_NUMBER}} - {{START_OR_END_FRAME}} PROMPT

Create a still image for {{PROJECT_TITLE}}.

The image shows {{MOMENT_DESCRIPTION}}.

Subject: {{SUBJECT_STATE}}.
Product: {{PRODUCT_STATE}}.
Environment: {{ENVIRONMENT_STATE}}.
Camera and composition: {{CAMERA_AND_COMPOSITION}}.
Lighting: {{LIGHTING}}.
Style: {{VISUAL_STYLE}}.

Continuity requirements: preserve all relevant continuity bible details, especially {{REQUIRED_CONTINUITY_DETAILS}}.

Do not include: {{NEGATIVE_CONSTRAINTS}}.
```

## Rules

- The prompt must describe a still frame, not video motion.
- Deterministic: the same input must always produce the same output. Do not invent fields, subjects, or props that are not in the input.
- Echo only the variables shown in the output block. `Continuity bible` and `Scene purpose` are read for consistency but are never pasted into the prompt; their effect appears through `{{REQUIRED_CONTINUITY_DETAILS}}`.
