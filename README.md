# Flow Keyframe Video Pipeline

> Now the frame-to-video and export module inside a larger **animated ad production assistant**. See `docs/system-vision.md` for the full mission.

Hard truth: segmented AI video only works when continuity is managed before generation. If you generate clips one at a time without a continuity bible, you will waste time fixing drift.

## Project Mission

This project is the foundation for a **reusable animated ad production assistant**. The assistant takes one product input and helps generate a complete animated video ad through ten staged outputs:

1. Product intake
2. Audience psychology
3. Ad concept
4. Story beats
5. Frame prompts
6. Flow frame-to-video clip prompts
7. Voiceover script
8. Music direction
9. Edit plan
10. Final export

The original Flow keyframe system is **not removed**. It is reframed as the module that owns stages 5, 6, and 10 (frame prompts, Flow clip prompts, and the deterministic export). The new stages feed it better inputs.

Start here:

- `docs/system-vision.md` — what the assistant is and why.
- `docs/pipeline-stages.md` — the canonical definition of all ten stages.
- `docs/staged-workflow.md` — how to run a product through the stages.
- `docs/quality-control-rules.md` — claims, compliance, localization, and continuity gates.

## Flow Export Module

The Flow module helps you:

- Turn a full video idea into 6-10 second scenes (beats).
- Generate start-frame and end-frame prompts for each scene.
- Generate Google Flow Agent Mode prompts for turning those frames into video clips.
- Maintain continuity across clips using a continuity bible.
- Export all prompts in clean copy-paste format.

This is intentionally not an app yet. The current version is a clean operating system: documentation, templates, and a JSON structure that can later become a UI.

## Folder Structure

```text
flow-keyframe-video-pipeline/
  README.md
  docs/
    system-vision.md
    pipeline-stages.md
    staged-workflow.md
    quality-control-rules.md
    workflow.md
    product-spec.md
    continuity-bible.md
    decisions.md
    output-spec.md
  prompts/
    claude-skill-system-prompt.md
    flow-agent-master-prompt.md
    frame-generation-template.md
    video-generation-template.md
  schema/
    project.schema.json
  scripts/
    render_project.py
  examples/
    example-50s-project.json
    french-craving-control-claymation-ad.json
  exports/
  dashboard/            # local web dashboard MVP (Vite + React)
```

## Dashboard (Local MVP)

`dashboard/` is a local web app — **Animated Ad Factory** — that turns one product
input into a staged ad package through editable stages, a live project-JSON preview,
and a Markdown export. It runs entirely in the browser (no backend, auth, database,
or external APIs).

```bash
cd dashboard
npm install
npm run dev
```

This opens <http://localhost:5173>. See `dashboard/README.md` for details. The
dashboard sits on top of the existing schema, templates, docs, and Python export
renderer without modifying them.

## Core Workflow

1. Define the full video idea.
2. Break it into 8-10 second scenes.
3. Build the continuity bible before prompting frames.
4. Generate a start-frame prompt and end-frame prompt for each scene.
5. Generate a Flow Agent Mode prompt for each clip.
6. Review every scene against the continuity bible.
7. Export prompts in production order.

## Render a Flow Project

Turn a project JSON into a single copy-paste Markdown export with a deterministic generator (Python standard library only, no dependencies):

```bash
python scripts/render_project.py examples/example-50s-project.json
```

This validates the required fields against `schema/project.schema.json`, then writes `exports/<project-slug>-flow-export.md` and prints the output path. The exact output structure is defined in `docs/output-spec.md`.

The same command works on the staged animated-ad example, which carries all ten stages in one project JSON (the renderer consumes `project`, `continuity_bible`, `scenes`, and `exports`; the assistant-owned stages are additive context):

```bash
python scripts/render_project.py examples/french-craving-control-claymation-ad.json
```

## Minimum Useful Output

For each scene, the system should produce:

- Scene number and duration.
- Narrative purpose.
- Start-frame image prompt.
- End-frame image prompt.
- Flow Agent Mode video prompt.
- Continuity references.
- Negative constraints.
- Copy-paste export block.

## Main Mistake To Avoid

Do not start by building UI. The real bottleneck is prompt consistency and review discipline. Build the workflow first, then automate it.
