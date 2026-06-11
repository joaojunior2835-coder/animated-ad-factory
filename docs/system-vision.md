# System Vision

Hard truth: a great animated ad is not one prompt. It is a chain of decisions — who it is for, what it must make them feel, how it opens, how it resolves — and every link must hold before the next is worth writing. Most AI ad attempts fail because they jump straight to clip prompts and skip the thinking that makes a clip worth generating.

## What This Is Now

This project began as a Google Flow keyframe exporter. It is now the foundation for a **reusable animated ad production assistant**.

The assistant takes **one product input** and helps produce a **complete animated video ad** through a fixed sequence of staged outputs. Each stage has a clear purpose, a defined input, and a defined output that the next stage consumes.

The same pipeline must work for any product: a craving-control ritual drink, a desk lamp, a skincare serum, a B2B SaaS tool. The product changes; the staged method does not.

## The Ten Stages

1. **Product intake** — capture the product, promise, and constraints.
2. **Audience psychology** — who this is for and what they actually feel.
3. **Ad concept** — the single creative idea and angle.
4. **Story beats** — the emotional arc, beat by beat.
5. **Frame prompts** — start and end keyframe image prompts per beat.
6. **Flow frame-to-video clip prompts** — controlled motion between keyframes.
7. **Voiceover script** — the spoken line per beat, in the ad's language.
8. **Music direction** — mood, energy curve, and sound design.
9. **Edit plan** — clip order, transitions, captions, end card.
10. **Final export** — one clean, copy-paste production package.

`docs/pipeline-stages.md` is the canonical definition of each stage. `docs/staged-workflow.md` is how you run a product through them.

## Where the Flow System Fits

The original Flow keyframe pipeline is not replaced. It is **reframed as the frame-to-video and export module** inside the larger assistant — it owns stages 5, 6, and 10:

- Frame prompts (stage 5) → `prompts/frame-generation-template.md`
- Flow clip prompts (stage 6) → `prompts/video-generation-template.md`, `prompts/flow-agent-master-prompt.md`
- Final export (stage 10) → `scripts/render_project.py`, `schema/project.schema.json`, `docs/output-spec.md`

Everything that module already does — continuity bible, keyframe discipline, deterministic export, duration math, bridge checks — stays. The new stages feed it better inputs.

## Design Principles

- **Staged, not monolithic.** One product in, ten gated outputs. Never skip ahead to a later stage with an unresolved earlier one.
- **Continuity-first.** The continuity bible is built early (stage 1–2 feed it) and governs every visual stage.
- **Deterministic where possible.** Structured project JSON drives a repeatable export. Same input, same package.
- **Compliance-aware.** Claims are constrained by `docs/quality-control-rules.md`. The assistant defaults to safe framing and never invents stronger claims.
- **Localized.** Language and market are first-class inputs, not an afterthought. An ad for the French market is written and voiced in French.
- **Reusable.** The method is product-agnostic. New products reuse the same stages and schema.

## Out of Scope Right Now

This expansion is documentation only. Deliberately **not** included yet:

- No UI.
- No APIs or external service calls.
- No video rendering or audio generation.

The bottleneck is still method and review discipline, not tooling. Build the staged method clearly, then automate it.
