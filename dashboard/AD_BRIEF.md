# Ad Brief Engine

The **Ad Brief** engine turns a competitor video into a complete, production-ready
brief for **our** product. Paste the output of the `/watch` competitor-video analysis
(a timestamped frame-by-frame breakdown + transcript) and one OpenAI call decodes its
structure, rewrites the script for our product, and writes a **real shot-by-shot
prompt per scene** straight into the existing competitor-canvas scenes.

> Text/JSON only, via the **existing** OpenAI provider (`/api/llm` → `generate_json`).
> No new providers, no image/video generation, no paid image/video calls. The button
> forces `provider_id: 'openai'` for this one action and does **not** change your
> Provider Mode.

## Where it lives

Canvas → **Competitor Recreation** method → **List View** → the **“Ad Brief — Decode a
Competitor /watch Breakdown”** panel (just above *Generate Adaptation*).

- A large textarea: **Paste /watch output here**.
- Product/brand context is pulled automatically from the project (active **Brand
  Library** docs + **Product / Offer Brief** + **Competitor Reference**) — you do not
  re-enter it. It reuses the same `contextBlock(project)` the other API prompts use.
- **Generate Ad Brief** button (enabled when Provider Mode = API and the textarea is
  non-empty).
- **overwrite existing scenes** checkbox (fill-only vs overwrite — see below).

## How to run /watch

Run `/watch` on the competitor video and paste the full breakdown + transcript.
For soft-cut UGC sources, run with `--scene-threshold ~0.2` so subtle cuts still
produce separate beats. Prompts default to **short-form vertical (9:16) UGC**.

## The brief JSON contract

The model must return **one JSON object only** (no markdown, no code fences). The
backend parses it with the existing `parsed_json` / `parse_error` handling:

```json
{
  "decoded_structure": [
    { "beat_name": "hook|problem|solution|proof|cta|...",
      "timestamp_range": "0:00-0:03",
      "what_competitor_does": "string",
      "why_it_works": "string" }
  ],
  "adapted_script": "string or timed lines rewritten for OUR product",
  "scenes": [
    { "scene_number": 1,
      "what_happens": "string",
      "adaptation_instruction_for_our_product": "string",
      "output_prompt": "real single-shot prompt: camera movement, shot type, lens/feel, lighting, framing, subject action, pacing, duration" }
  ],
  "dont_copy": ["competitor product", "actors", "brand", "logos", "specific claims"],
  "preserve": ["structure", "pacing", "shot logic", "emotional sequence", "editing rhythm"]
}
```

`output_prompt` is required to be a **real** single-shot generation prompt (explicit
camera movement, shot type, lens/feel, lighting, framing, subject action, pacing, and
duration) — not a vague summary.

## Writeback into the existing scenes

The returned `scenes[]` are written into the **existing** `canvas.scenes` by
`scene_number` via `applyAdBriefScenes(scenes, parsed, overwrite)` in
[`src/lib/canvasModel.js`](src/lib/canvasModel.js). There is **no parallel scene
model** — scenes are created with the existing `newScene()`:

- **Fill-only (default):** a scene that already has an `output_prompt` is left
  untouched; empty scenes get `output_prompt`, `what_happens`, and
  `adaptation_instruction_for_our_product` filled.
- **Overwrite:** every matching scene is replaced (all three fields).
- **Alignment:** if the brief returns a `scene_number` with no existing scene, a new
  scene is created and the list is re-sorted by `scene_number`. Fewer/more scenes than
  the brief are reconciled this way.

After it runs, the per-scene **Copy prompt** (Board View) copies the real, detailed
`output_prompt`.

## Failure / no-corruption

Writes are applied **only after a clean parse**:

- API failure (quota/network) → the API Action Log records it with the `request_id`;
  the panel shows the error + request id; **no scene and no project state change**.
- Unparseable or invalid JSON (`applyAdBriefScenes` returns `ok: false` for a missing
  `scenes[]`, a non-array, or an empty/`scene_number`-less array) → message shown, the
  canvas is left exactly as it was. The canvas can never be partially corrupted.

## Persistence & migration

`decoded_structure`, `adapted_script`, `dont_copy`, `preserve` (plus `generated_at`,
`request_id`, `model`) are stored on `canvas.ad_brief` and persist through the existing
`setProject → saveProject` path. `normalizeCanvas()` runs `normalizeAdBrief()`, so:

- the brief survives serialize → normalize round-trips, and
- **older projects with no `ad_brief` field load fine** — they normalize to an empty
  brief without error.

## Final Export

`buildFlowPackageMarkdown` adds a concise **“## Ad Brief”** section to the Competitor
Recreation package (in [`src/lib/exportFlowPackage.js`](src/lib/exportFlowPackage.js)):
the decoded structure summary, the adapted script, and the don’t-copy / preserve
lists. It appears only when a brief is present and does not restructure other sections.

## Tests

`scripts/qa-canvas-speed-batch.mjs` step **AB** is keyless (no OpenAI call): it stubs a
realistic brief JSON and asserts multi-field fill-only vs overwrite, scene creation by
`scene_number`, round-trip persistence of the brief fields, malformed-safe no-op
behavior, and migration of a canvas with no `ad_brief`.
