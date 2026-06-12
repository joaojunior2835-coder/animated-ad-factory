# Marketing Studio

A Higgsfield-inspired, fully local wizard (left nav → **🎬 Marketing Studio**) that
turns **one structured brief into one complete scene-by-scene ad package** of
paste-ready prompts for Google Flow (Gemini Omni Flash) and Seedance 2.0.

This is a **prompt-generation tool, not a video generator**: zero API calls,
zero paid calls, everything runs as pure JS in the browser.

Implementation:

- `src/lib/marketingStudioModel.js` — pure data model + generators (no React, no DOM, no API)
- `src/components/MarketingStudio.jsx` — the 5-step wizard
- `src/data/adMethods.js` — the `marketing_studio` method registry entry
- `App.jsx` — studio state, localStorage session, Send-to-Node-Canvas bridge
- Styles: the `MARKETING STUDIO` section at the bottom of `src/styles.css`
- Tests: `npm run test:studio` (114 model checks) and
  `node scripts/dev-probe-marketing-studio.mjs` (31 in-browser checks; dev server must be running)

## Tier 1 additions (post gap-analysis)

After the live Higgsfield walkthrough (`MARKETING_STUDIO_GAP_ANALYSIS.md`), the
studio gained:

- **Named saved sessions** — the studio opens on a Session Home (list of saved
  sessions, newest first, inline rename, Open/Delete, empty-state CTA). Each
  session is one ad package, auto-saved on every change under
  `aaf_marketing_studio_sessions` and auto-named `Product · Format`
  ("Calme · French Podcast (Omni)"); manual renames stick. The old single-slot
  session migrates automatically.
- **Hook library** — 17 proven openers (8 FR, 7 EN, 2 universal) as clickable
  chips in Step 1, filtered by brief language; hover shows the full line, click
  drops it into the hook field; 🎲 Surprise me picks one.
- **Settings library** — 15 named scene settings (Bedroom Morning → Gym Locker
  Room), each with a visual mood + lighting note. Every generated scene gets a
  format default (podcasts → Podcast Setup, cinematic → Clean White Studio…);
  a per-scene dropdown and an "apply to all" control swap them, appending a
  `[Setting: …]` block to the visual description (idempotent on re-pick).
- **3 new formats + categories** — Unboxing / First Reaction, Tutorial / How To
  (numbered step arc), and Product Review (verdict-first with an honest con),
  all passing the same omni-v51 rule checks. Step 2 groups formats under
  UGC / French / Cinematic with a category filter bar.
- **Output settings** — platform target (TikTok/Reels/Feed/Shorts/YouTube/
  Facebook, auto-setting aspect ratio), an aspect-ratio override
  (9:16/16:9/1:1/4:3 vs format default), and a quality hint
  (Standard/High/Maximum). The override drives every prompt's setup header;
  quality (when not Standard) is appended to headers; the markdown export
  gains an Output Settings block; the Step 5 summary shows all three.

## The 5 wizard steps

1. **Brief** — product name*, description*, key benefit/hook, target audience,
   key ingredient/mechanism, claim boundary (compliance), language (🇫🇷 default / 🇬🇧),
   ad duration (15/30/45/60s), landing page URL, category. A **Paste Competitor
   Analysis** box accepts a `/watch`-style breakdown; **Extract Brief** parses
   labeled lines (`Product:`, `Hook:`, `Problem:`, `CTA:`, …, EN + FR labels)
   with pure string parsing and pre-fills the form — auto-filled fields get a
   green border. Next is disabled until name + description are filled.
2. **Format** — card grid of the 5 formats (clip count, aspect ratio, style
   badges; the French/Omni warning shows in orange). Changing between a 1-person
   and 2-person format resets the character picks.
3. **Characters** — one picker for talking-head/testimonial/cinematic, two
   side-by-side pickers (Host + Guest) for podcasts. Cards show gender/style/
   language tags; a language mismatch against the brief is flagged with ⚠. A
   **Custom** card takes a free-text character description
   (stored as `custom:<description>`; prompts then use neutral *They* pronouns).
4. **Script** — `generateSceneOutline(studio)` runs on arrival. Each scene is an
   editable card: dialogue line, visual description, clip duration (4/6/8/10s),
   with purpose/beat/shot labels. **Regenerate Outline** re-derives everything;
   **Regenerate Scene** re-derives one card. A full-script view concatenates all
   lines with one-click copy. **Generate Prompts →** runs `generateOmniPrompts`.
5. **Export** — prompt cards (setup header in a bordered monospace box, prompt
   text, model badge, notes, per-card copy with "Copied ✓"), a summary bar
   (total clips, estimated duration vs target, models needed, language), and:
   - **Copy All Prompts** — paste-ready text, clips separated by `----`
   - **Export as Markdown** — full production package (`<product>-marketing-studio.md`)
   - **Send to Node Canvas** — see below
   - **Save Studio Session** / **Clear Session**

The studio state lives under its own localStorage key
(`aaf_marketing_studio_session`), independent of the project, and auto-loads on
return. Every edit persists through `updateStudio`.

## The 5 formats

| Format | Clips | Ratio | Style | Use when |
| --- | --- | --- | --- | --- |
| UGC Talking Head | 6-8 (7) | 9:16 | authentic/raw | One creator speaking straight to camera — hooks, claims-light education |
| UGC Podcast | 8-12 (10) | 9:16 | conversational | Two-person discovery conversation; social proof through dialogue |
| Cinematic Product | 6-8 (7) | 16:9 | cinematic | Product-first hero/macro shots with a separately recorded voiceover |
| UGC Testimonial | 6-8 (7) | 9:16 | authentic/raw | Problem→solution personal story arc |
| French Podcast (Omni) | 8-12 (10) | 9:16 | conversational/french | French 2-person podcast. **Gemini Omni Flash in Google Flow only — never Seedance for French.** |

The number in parentheses is the exact scene count generated.

## The 8 starter characters

| id | Language | Profile |
| --- | --- | --- |
| `confident_woman_fr` | FR | Confident woman, 28-35, direct to camera |
| `friendly_man_fr` | FR | Friendly man, 30-40, warm energy |
| `expert_woman_en` | EN | Expert woman, calm authority tone |
| `young_woman_ugc` | EN | Gen-Z UGC woman, casual energy |
| `podcast_host_fr` | FR | Podcast host, professional but warm |
| `podcast_guest_fr` | FR | Podcast guest, curious/engaged |
| `testimonial_woman` | FR | Relatable testimonial woman, problem-aware |
| `testimonial_man` | FR | Relatable testimonial man, solution-focused |

Characters carry **identity only for your frame workflow** — prompts never
describe appearance (see rules below). Gender drives prompt pronouns
(She/He/They for custom).

## How generation works (pure functions)

`generateSceneOutline(studio)` is deterministic — same studio, same outline:

- Scene count = `format.clipCount`. **Scene 1 is always the hook; the last
  scene is always the CTA.**
- Dialogue comes from the brief fields (hook/problem/solution/CTA win when
  filled) with French or English template fallbacks per purpose
  (hook → problem → agitation → product entry → mechanism → proof → CTA, with
  podcast- and testimonial-specific arcs).
- Podcasts alternate strictly: odd scenes = character 1 (Host), even = character 2 (Guest).
- Talking head/testimonial keep one speaker throughout.
- Cinematic mixes product shots (hero/lifestyle/reveal/macro/in-use/end-card);
  its lines are **voiceover** — recorded separately, never lip-synced.
- Clip duration derives from the line's word count:
  **≤8 words = 4s · 9-13 = 6s · 14-18 = 8s · 19-25 = 10s** (longer lines clamp
  to 10s and get a "trim" note). Visual-only clips default to 6s.

`generateOmniPrompts(studio, scenes)` maps each (possibly user-edited) scene to
a prompt object `{ sceneNumber, model, promptText, setupHeader, attachFrame,
duration, aspectRatio, notes }`.

## The omni-v51 rules baked in (non-negotiable)

- **Duration never appears in the prompt text.** It lives only in the setup
  header: `Gemini Omni Flash · 9:16 · select [6s] · attach Frame [3]`.
- **Appearance is never described.** The attached frame carries identity;
  prompts describe speech, delivery, gaze, and motion only.
- **Dialogue formats route to Gemini Omni Flash (Google Flow).** French
  dialogue is *never* routed to Seedance.
- **Cinematic/product clips route to Seedance 2.0** and describe **motion only**
  (camera movement, product behavior, atmosphere — no people speaking); the VO
  line moves into the prompt's notes.
- **Podcast gaze rule:** every podcast prompt includes
  "looks toward the other speaker, not at the camera." Talking heads speak
  directly to the camera.
- **Natural-pace tail** ends every dialogue prompt:
  "She says the line once at a natural pace — do not slow it down to fill time;
  after the line she stays silent with a natural expression." (pronoun-adapted).

All of these are enforced by real assertions in `npm run test:studio` and
re-verified against the rendered DOM by the browser probe.

## Send to Node Canvas

On the Export step, **Send to Node Canvas** converts each prompt into an
appended row on the existing Node Canvas — Prompt node (the prompt text) →
Image Generator (`mock-image`) → Output (scene number) — by reusing the same
`addSceneNodesToCanvas` helper as the toolbar's Import Scenes. Existing nodes
are never touched; rows land below the current graph. From there the normal
Node Canvas flow applies (mock generation, manual paste, attach to scene,
export to timeline).

## Testing

- `npm run test:studio` — 114 pure-model checks (rule enforcement, determinism,
  arcs, extraction, export builders, normalization).
- `node scripts/dev-probe-marketing-studio.mjs` — 31-step Playwright probe over
  the live wizard (dev server must be running). A development aid, not part of
  `qa:all`.
- The existing suites stay green and untouched: `qa:canvas` 68, `qa:e2e` 8,
  `test:docs` 16, `npm run build` exit 0.

## Intentionally left for a future sprint

- Real character image upload (frame management stays manual in Flow for now).
- A/B variant generation (multiple hook/CTA variants per package).
- Direct Omni API connection (everything stays paste-ready and local).
- Competitor URL scraping (the paste-extraction box is the local stand-in).
