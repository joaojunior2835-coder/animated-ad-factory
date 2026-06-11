# Staged Workflow

Hard truth: the order is the product. If you write clip prompts before you know the audience tension, you will generate beautiful clips that sell nothing. Run the stages in order. Pass each gate before moving on.

This is the operating procedure for taking one product through the ten stages defined in `docs/pipeline-stages.md`. Gates are enforced by `docs/quality-control-rules.md`.

## Principles

- **One product in.** Start from a single product brief.
- **One stage at a time.** Produce the stage's output, pass its gate, then continue.
- **No skipping ahead.** A later stage may not paper over an unresolved earlier one.
- **Continuity is built early.** The continuity bible is drafted during story beats (stage 4) and governs every visual stage after it.
- **Write it down.** Each stage's output lands in the project JSON so the export module can consume it.

## Procedure

### Stage 1 — Product intake

Capture: product name, category, what it is, who it serves, the core benefit (framed safely), market, language, and claim constraints. Confirm the market and language before anything visual. Pass the gate: the benefit is stated with no prohibited claims.

### Stage 2 — Audience psychology

From the intake, define one specific persona and the single emotional tension they live with. Name the trigger moment (the exact situation where the tension peaks). Pass the gate: one persona, one tension.

### Stage 3 — Ad concept

Commit to one creative idea, one angle, and one visual style. State the hook premise and the feeling the ad must leave behind. Pass the gate: no competing concepts survive this stage.

### Stage 4 — Story beats

Translate the concept into an ordered arc. For this assistant the default arc is:

1. **Scroll-stopper** — an arresting opening image.
2. **Tension** — the emotional trigger moment.
3. **The ritual / product** — the product introduced as the answer.
4. **The shift** — the move back into control.
5. **Product hero** — the final clean hero shot.

Draft the continuity bible here (subject, product, location, visual rules, negative constraints). Map each beat to a scene number. Pass the gate: opens on a scroll-stopper, ends on a hero, each beat is one idea.

### Stage 5 — Frame prompts

For each beat, write a start-frame and an end-frame image prompt using `prompts/frame-generation-template.md`. Each frame is a still image that preserves the continuity bible; the end frame must bridge to the next beat. Pass the gate: still images only, continuity preserved.

### Stage 6 — Flow frame-to-video clip prompts

For each beat, write one Flow Agent Mode prompt using `prompts/video-generation-template.md`. Describe only the controlled motion between the two keyframes. Pass the gate: animates between frames, invents nothing new.

### Stage 7 — Voiceover script

Write one spoken line per beat in the ad's language. Match each line to its beat's emotional job. Keep every line inside the claim rules. Pass the gate: correct language, on-beat, compliant.

### Stage 8 — Music direction

Define mood, a reference feel, the energy curve across the beats, and sound-design notes. The curve must track the arc — restraint at tension, lift at the shift and hero. Pass the gate: energy curve matches the emotional arc.

### Stage 9 — Edit plan

Specify clip order, transitions, caption language and placement, and the end card. Confirm total runtime equals the sum of clip durations. Pass the gate: order matches beats, duration math is clean.

### Stage 10 — Final export

Render the project JSON with `scripts/render_project.py`. Fix any validation error it reports (required fields, duration math). Pass the gate: validation passes, no leftover template variables, package is copy-paste ready.

## Review Between Stages

Do not batch all review to the end. After each visual stage, run the relevant checks from `docs/quality-control-rules.md`. The export already includes a Bridge Check between clips; treat any flagged continuity risk as a stage-5 fix, not a stage-10 fix.

## Main Mistake To Avoid

Do not start at stage 5. The clips are downstream of the thinking. Earn the right to prompt frames by finishing intake, psychology, concept, and beats first.
