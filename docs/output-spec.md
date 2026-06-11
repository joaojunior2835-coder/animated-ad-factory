# Output Spec

This file is the contract for what `scripts/render_project.py` must produce. The renderer is deterministic: the same project JSON must always produce the same Markdown. If you change the renderer, change this file first.

A "clip" and a "scene" are the same thing. The project JSON stores them under the `scenes` key.

## File

- Location: `exports/<project-slug>-flow-export.md`
- `<project-slug>` is `project.title` lowercased, with every run of non-alphanumeric characters replaced by a single hyphen, trimmed of leading/trailing hyphens.
  - Example: `Premium Desk Lamp Product Story` -> `premium-desk-lamp-product-story`
- Encoding: UTF-8. Existing file is overwritten.

## Section Order

The Markdown must contain these sections, in this exact order:

1. `# <Project Title> — Flow Export` (H1) followed by a one-line "generated" note.
2. `## Project Overview`
3. `## Continuity Bible`
4. `## Clip-by-Clip Plan`
5. `## Clips`
6. `## Negative Constraints (Global)`
7. `## Final Execution Checklist`

## Section Contents

### Project Overview

A bullet list containing, in order:

- **Title** — `project.title`
- **Total runtime** — `project.target_runtime_seconds` seconds
- **Platform** — `project.platform`
- **Aspect ratio** — `project.aspect_ratio` (only if present)
- **Visual style** — `project.visual_style` (only if present)
- **Goal** — `project.goal` (only if present)
- **Clip duration rule** — `project.scene_duration_rule` (only if present)
- **Clip count** — number of items in `scenes`
- **Sum of clip durations** — total of all `duration_seconds`

### Continuity Bible

One `###` subsection per top-level key of `continuity_bible`, keys title-cased. Object values render as a `**Key:** value` bullet list; list values render as plain bullets; string values render as a single bullet.

### Clip-by-Clip Plan

A Markdown table with columns `Clip | Duration | Purpose`, one row per clip in `scenes` order.

### Clips

One `###` subsection per clip, titled `Clip <scene_number> — <purpose> (<duration>s)`. Each contains:

- `Start state` and `End state` bullets (only if present)
- Motion-prompt bullets: `Camera movement`, `Subject motion`, `Environment motion`
- A **Start-Frame Prompt** label followed by a fenced ```text block with `start_frame_prompt`
- An **End-Frame Prompt** label followed by a fenced ```text block with `end_frame_prompt`
- A **Flow Agent Mode Prompt** label, then an `Attach:` block listing the two frame images to attach in Flow (`- Scene <n> start frame image` and `- Scene <n> end frame image`), then a fenced ```text block with `flow_agent_prompt`
- `Continuity references` bullet (comma-joined)
- `Negative constraints` bullet (comma-joined)

After every clip except the last, a `#### Bridge Check → Clip <n> to Clip <n+1>` subsection with three bullets:

- **Next clip start state** — the next clip's `start_state`
- **Visual connection** — whether this end frame plausibly connects to the next start state. Heuristic: shared content keywords between this clip's `end_state` and the next clip's `start_state`. This is a text-based review aid, not a visual verdict; confirm against the actual frames.
- **Continuity risk** — any of the next clip's `continuity_references` whose keywords are not already present in this clip's `end_state` or `continuity_references` (i.e. anchors the next clip needs but this clip may not establish). "Low" when all anchors are covered.

### Negative Constraints (Global)

Bullets from `continuity_bible.negative_constraints`. If absent, a single bullet noting none are defined.

### Final Execution Checklist

A checkbox list (`- [ ]`). Uses `exports.review_checklist` if present; otherwise a built-in default checklist.

## Field Mapping

| Spec concept | JSON path |
| --- | --- |
| Project title | `project.title` |
| Total duration | `project.target_runtime_seconds` |
| Target platform | `project.platform` |
| Continuity bible | `continuity_bible` |
| Clips array | `scenes` |
| Clip duration | `scenes[].duration_seconds` |
| Start frame prompt | `scenes[].start_frame_prompt` |
| End frame prompt | `scenes[].end_frame_prompt` |
| Motion prompt | `scenes[].camera_movement`, `subject_motion`, `environment_motion` |
| Flow Agent Mode instruction block | `scenes[].flow_agent_prompt` |
| Continuity references | `scenes[].continuity_references` |
| Negative constraints | `scenes[].negative_constraints` |
