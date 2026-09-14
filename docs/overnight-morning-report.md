# Overnight creative workstation — morning report

Date: 2026-09-15. Baseline: `0b4830e33b96346bff9be6abb13b38748cdc62b9`.

## 1. Status

**COMPLETE — implementation and isolated local verification.** Paid provider calls during this mission: **exactly zero**. This does not certify live model quality, account funding, provider availability or invoice amounts. The capability limitations below are explicit; unsupported models and editing controls were not presented as working features.

The implementation is committed and pushed to `origin/main` at **`86ee31919bd58a4c46a8b2b0122a02d9486d3eee`**. This report is a separate documentation-only handoff commit; its final branch SHA is supplied in the operator handoff.

## 2. Navigation and first use

Open `http://localhost:5173`. The top navigation is:

`Create Ad | Image | Video | Remix | Node Canvas | Marketing Studio | Assets`

The two header selectors choose the shared ProductTest and Creative. `Product Tests` and the other supporting tools remain in the secondary navigation; the older scene `Canvas` is preserved separately from `Node Canvas`.

1. Select an existing appropriate ProductTest/Creative, or explicitly create a disposable one through `Product Tests` and the normal Create Ad context controls. Nothing silently creates a financial context or invents a budget.
2. Open `Image` for text-to-image; `Video` for clips; `Create Ad` for ordered scenes and assembly; `Remix` for reference-video work; `Marketing Studio` for product presets; `Node Canvas` for connected workflows; `Assets` for saved local media.
3. Choose a supported model and settings. The local Mock models are clearly labeled and cost nothing. FLUX/Seedance are paid and require a fresh quote and explicit confirmation.
4. Review output count, estimated EUR amount and one-attempt limit before confirming. Changing settings/references invalidates confirmation.
5. Select an output, reuse its Asset directly in another workspace, or approve video scenes and assemble/download through existing M6.

No ordinary creative step requires copying a prompt to another website. Account funding and credentials remain external setup when missing; no account funding check or paid account test was performed tonight.

## 3. Completed behavior and boundaries by workspace

| Workspace | Delivered | Explicit boundary |
| --- | --- | --- |
| Shared shell | Neutral-dark surfaces, consistent accent/focus controls, compact primary navigation, shared product/creative context, preserved supporting workflows and draft saves | No authentication, SaaS, public deployment or new remote-access architecture |
| Image | Backend-authoritative FLUX/Mock choices; actual dimensions and PNG/JPEG; 1–4 outputs; M5 quote/confirmation, durable Jobs, local validation, history, selection/download; transfers to Video, Studio and Canvas | FLUX Schnell is text-only. No product-conditioned image editing, decorative quality control, unsupported model or identity guarantee |
| Video / Create Ad | Shared model settings, local start frame, explicit audio choice, 1–4 separate output Jobs, stable take selection/history, refresh-safe status, local playback, approval and selected-take M6 assembly | Multiple outputs are alternative takes, not automatic concatenation. Live Seedance quality was not tested |
| Remix | Motion Transfer/Object Swap, local automatic preparation, reference images and one instruction; Generate → confirmation → result; original/result and Creative reuse retained | Advanced remains optional. Local frame/metadata preparation is not claimed as semantic AI analysis. Raw Canvas reference videos must first use the existing Remix preparation path |
| Marketing Studio | Four original visual presets with filters, factual product context/photo, French-first editable scenes, preserved locked scripts, finite priced batch, direct M5 outputs, variations, sessions/history, Create Ad/Canvas handoffs | Product photo is an actual Seedance start frame, not silently ignored by FLUX. No guaranteed identity retention or fabricated product claims. Full existing wizard/export tools remain under Advanced |
| Node Canvas | Persisted graph/viewport, typed connections and cycles, drag/pan/zoom/fit, multi-select/duplicate/delete/undo/redo, editable properties, local Asset inputs, shared settings, starters, scoped Run Node/Selection/Workflow confirmation, upstream dependencies, staleness/history, media results and Creative reuse | Unsupported execution types such as upscale remain visibly unavailable. Multi-scene output proceeds to Creative/M6; there is no second assembly engine. Dependent video uses upstream image output 1, stated in the review |
| Assets | Shared local image/video/reference/final-ad records, filters/search, previews, metadata/download and no-copy reuse | No new media database or cloud storage; generated outputs remain local |
| Mobile / remote | 390×844 browser coverage, reachable composers, responsive navigation, video playback, Studio/Assets and Canvas properties; existing relative API/media proxy preserved | Tested in browser emulation and existing tunnel/proxy QA, not on a physical phone or a newly provisioned tunnel. Video/Remix forms still scroll vertically |

Drafts persist through immediate navigation and context changes. Existing image/video scenes and history survive cross-workspace editing. Scene output choices bind to stable Asset IDs. Regeneration creates newly authorized work; it does not overwrite prior files or reverse financial history.

## 4. Reference evidence: observed versus inferred

Authenticated Higgsfield browser access was proved and used read-only. Actually inspected:

- [Image composer](https://higgsfield.ai/ai/image?model=gpt_image_2): prominent gallery, bottom composer, compact model/settings controls.
- [Video / Genjutsu](https://higgsfield.ai/ai/video?model=genjutsu): Motion Transfer/Object Swap, references and output/history arrangement.
- [Marketing Studio](https://higgsfield.ai/marketing-studio): product/template hierarchy and category filtering.
- [Canvas](https://higgsfield.ai/canvas): dark board, compact tools, node creation and an existing board.

These are observed UX patterns, not evidence of our API capabilities. Layout adaptation and our four original Studio presets are design decisions, not copied proprietary templates. No bundles, logos, branded graphics, customer media or private endpoint implementations were copied. No reference-site generation or upload was performed.

Separate user reference screenshots mentioned by the mission were not available as attachments in this run. No fabricated screenshot-derived findings are claimed. Reference-site material remains private QA material, not shipped assets.

Provider documentation, separate from visual reconnaissance: [FLUX input schema](https://fal.ai/models/fal-ai/flux/schnell/api) and [FLUX pricing](https://fal.ai/models/fal-ai/flux/schnell), verified 2026-09-15. Seedance keeps the existing documented catalog and transport; no new provider was introduced.

## 5. Browser evidence and visual corrections

All paths below are local to this repository and intentionally Git-ignored under `dashboard/qa-artifacts/`.

Before, from the unchanged baseline UI:

- `overnight-before/create-ad-1440.png` — empty/loading baseline context, not a populated result comparison.
- `overnight-before/studio-1440.png`, `studio-390.png`.
- `overnight-before/canvas-1440.png`, `canvas-390.png`.
- `overnight-before/assets-context-1440.png`, `assets-context-390.png` — prior context view; no dedicated Assets workspace existed.

No dedicated baseline Image page existed. A separate baseline Remix screenshot was not retained; Remix preservation is evidenced by the existing 21-check browser suite plus final screenshots, not a fabricated before/after pair.

After: `workstation/report.json` lists **31 screenshots and 26 decoded-frame playback receipts**, with 19/19 connected browser checks. Representative files:

| Area | Desktop | Mobile |
| --- | --- | --- |
| Shell / Image | `workstation/shell-desktop.png`, `image-composer-desktop.png`, `image-results-desktop.png` | `workstation/image-composer-mobile.png`, `image-results-mobile.png` |
| Video | `workstation/video-desktop.png`, `video-composer-desktop.png`, `final-ad-desktop.png` | `workstation/video-mobile.png`, `video-composer-mobile.png` |
| Studio | `workstation/studio-gallery-desktop.png`, `studio-results-desktop.png`, `studio-confirm-desktop.png` | `workstation/studio-gallery-mobile.png`, `studio-mobile.png`, `studio-composer-mobile.png` |
| Canvas | `workstation/canvas-results-desktop.png`; `overnight-canvas/canvas-completed.png`, `canvas-board-fit.png` | `workstation/canvas-mobile.png`; `overnight-canvas/canvas-mobile-properties.png` |
| Remix | `workstation/remix-desktop.png`, `remix-references-desktop.png` | `workstation/remix-mobile.png` |
| Assets | `workstation/assets-desktop.png` | `workstation/assets-mobile.png`, `assets-preview-mobile.png` |

Screenshots were visually inspected, not merely saved. Corrected issues included legacy 90px thumbnail constraints, oversized Image previews covering composer space, mobile reachability, Canvas node/edge spacing and fit, Run-button event propagation, incomplete-video screenshots, and requested-versus-actual Mock duration labels. Final Video shots show a decoded blue fixture frame with `640×360 · 2.00 s · Local test fixture (not an AI result)`, not a black loading player. Browser receipts confirm rendered frames after 0.2 seconds, readyState 4 and `playsInline`.

The connected journey used real application Mock execution: 8 Jobs, 8 reconciled attempts, 9 local Assets, zero Cost/reservation rows, zero external calls and zero page errors. Solid-color output is explicitly a test fixture, not evidence of AI visual quality. The separate Canvas interaction harness covers a populated 17-node board and fit-to-content.

## 6. Capability and pricing evidence

Live local options were read after backend restart; configuration below means a configured local credential flag, not proven account funding.

| Model / mode | Implemented | Priced | Configured | Mock tested | Live generation verified this mission |
| --- | --- | --- | --- | --- | --- |
| fal FLUX Schnell — text-to-image | Yes, durable M5 queue adapter | $0.003 per rounded-up MP/output; catalog source recorded | Yes | Yes, including result-error holds and fractional costs | No |
| fal Seedance 2.0 Fast — text-to-video | Existing transport, integrated composer/batches | Existing catalog: $0.1076/s at 480p, $0.2419/s at 720p | Yes | Yes | No |
| fal Seedance — image-to-video | Existing adapter with actual local start frame | Existing resolution/duration catalog | Yes | Yes, including changed reference bytes | No |
| fal Seedance — reference-to-video / Remix | Existing reference preparation/uploads and pricing | Existing reference-token calculation, not a guessed flat clip price | Yes | Yes | No |
| Mock Image / Mock Video | Local fixture generation only | Zero | Yes | Yes, connected browser journeys | Local decoded fixtures only; not a provider model |

Image controls contain supported sizes/aspects, PNG/JPEG and quantity 1–4; no duration/audio/quality placeholders. Video controls reflect the implemented 4–15 second, 480p/720p application subset, supported aspect ratios/modes, audio choice and quantity 1–4. One video output is one Job/request, never a fictional `num_videos` parameter. New low-cost video drafts use audio off; saved explicit choices survive.

Quotes and settlement are catalog estimates unless actual provider billing evidence is available. Example: 1024² FLUX rounds to 2 MP, raw estimate $0.006; positive image amounts reserve conservatively at the existing integer-cent boundary instead of becoming free. Video accounting rounding remains unchanged.

The live existing FX value is USD→EUR **0.86534**, source **`manual-live-rate-2026-09-14`**, captured **`2026-09-14T18:33:15.988Z`**. It was read through the existing repository/options path, not refreshed or described as a current market verification.

## 7. Final regression receipts

Run from `dashboard/`. All final runs passed after the relevant implementation corrections. Tests use isolated databases/local fixtures/fake providers, with generation credentials cleared and external generation/upload traffic forbidden. Counts are reported only where the suites actually report them.

| Command | Final result |
| --- | --- |
| `npm run build` | PASS; 118 modules. Existing >500 KB bundle warning remains |
| `npm run qa:canvas` | **68/68**, port 8788, original assertions preserved |
| `npm run qa:e2e` | **8/8** |
| `npm run test:docs` | 16/16 |
| `node scripts/test-studio.mjs` | 13/13 |
| `npm run test:studio` | 255/255 |
| `node scripts/test-m5-dispatch.mjs` | PASS |
| `node scripts/test-m5-restart.mjs` | PASS |
| `node scripts/test-m5-retry.mjs` | PASS |
| `node scripts/test-seedance-fal.mjs` | PASS |
| `node scripts/test-money-hardening.mjs` | 12/12 |
| `node scripts/test-mcp-paid-confirmation.mjs` | PASS |
| `node scripts/test-operator-mvp.mjs` | 21/21, including M6/M7/M8 |
| `node scripts/test-creative-generator.mjs` | 17/17 |
| `node scripts/test-reference-remix.mjs` | 23/23 |
| `node scripts/test-image-production.mjs` | 11/11 |
| `node scripts/test-video-quantity.mjs` | 12/12 |
| `node scripts/test-production-scope.mjs` | 9/9 |
| `node scripts/test-node-canvas.mjs` | 19/19 |
| `node scripts/test-canvas-production.mjs` | 15/15 |
| `node scripts/test-studio-production.mjs` | 22/22 |
| `node scripts/test-workstation-recovery.mjs` | 8/8 |
| `node scripts/qa-creative-generator.mjs` | 12/12 |
| `node scripts/qa-operator-mvp.mjs` | 14/14 |
| `node scripts/qa-reference-remix.mjs` | 21/21 |
| `node scripts/qa-node-canvas.mjs` | 12/12 |
| `node scripts/qa-workstation.mjs` | 19/19; 31 screenshots, 26 playback receipts |
| `git diff --cached --check` | PASS before implementation commit |

Baseline required suites also passed before feature changes. New tests are separate from the original 68/8 suites. Existing Creative tests were updated only for the now-supported image choices and stricter fresh-FX quote requirement; their behavior/counts were retained. No assertions were skipped to hide defects. `qa:all` was not used as a substitute for these commands.

Recovery coverage includes missing configuration/FX, unknown rates, incompatible settings, duplicate confirmation, stale quote/reference bytes, invalid local media, provider rejection, COMPLETED/result errors with unknown billing, graph staleness, and concurrent Mock image polling. A numerically identical FX rate with a new capture invalidates the old quote; a fresh quote creates a correctly frozen plan.

## 8. Safety, data preservation and operational handoff

**Exactly zero real paid/free-credit generation calls, provider input uploads, paid drafting/vision/audio calls, or Higgsfield generations.** Browser provider discovery was read-only. Test output is isolated Mock data. No packages were installed.

No SQLite schema changes, new provider family, second ledger, alternate scheduler, authentication or MCP transport migration. A focused Phase 0 was recorded before adding explicit frozen image/graph steps and conservative fractional-image rounding; see [checkpoint](overnight-mission-checkpoint.md). Existing production-spec JSON and dependency records carry the new scope. Source/budget conversion for new image Jobs cannot round a positive estimate to zero; established video semantics remain compatible.

Preserved controls: exact confirmation, frozen scope, live FX/price/reference checks before submission, atomic claim/reserve before paid dispatch, one attempt for newly authorized creation batches, durable request IDs, restart reconciliation, ambiguous-billing holds without invented Cost or unauthorized retry, and idempotent Asset/Cost settlement. Direct paid MCP image bypass was not revived. Replicate remains untouched/dormant.

Live database: `dashboard/server/data/factory.db`. Read-only ordered-row SHA-256 before/after implementation and after process restart is identical:

`dc639f5fce99b84187e18cce65038189cb19c7f2bed558bf4b6ac1b488a87fb2`

Tables compared: product_test, iteration, creative, production_run, job, job_execution_attempt, budget_reservation, cost, asset, asset_link, publication, metric_snapshot, review_event. Row counts respectively: 3, 3, 3, 3, 2, 2, 2, 1, 2, 3, 1, 2, 0. SQLite integrity: ok. No real production Job/Asset/Cost was created or changed.

Historical ProductionRun 2 / Job 1 and request `01a0a137-ef18-7043-8588-43cb870563bd` remain unchanged. Its prior released reservation and unknown provider billing were not repaired, reactivated, billed or declared resolved.

Only backend/MCP were restarted after checking no active/unreconciled attempts existed. Backend PID 43232 (`127.0.0.1:8787`) and MCP PID 19008 (`127.0.0.1:8789`) returned healthy responses. Existing Vite PID 18036 (`127.0.0.1:5173`) remained running and returned HTTP 200. All bindings remain loopback. Startup error logs are empty. Test-owned servers were stopped; live media was not removed.

Persistence guidance informed durable identity and conservative quote boundaries; the React/browser verification checklists informed navigation-safe saves, accessible controls and desktop/mobile correction. No new Vercel service or AI SDK was added.

## 9. Git and local artifacts

Implementation commit: `86ee31919bd58a4c46a8b2b0122a02d9486d3eee` — `feat: deliver unified creative workstation with safe M5 generation`.

Push succeeded: baseline `0b4830e` → `86ee319`, `main` → `origin/main`. The following documentation-only commit contains this report; its SHA and push receipt are reported in the final handoff rather than attempting a self-referential commit hash inside this file.

Implementation changed 56 source/test/checkpoint files, with no package/lock/schema/Replicate changes. The exact inventory is available in `git show --stat 86ee319`.

Excluded and untouched: `.env.local`, keys, real database/sidecars, local media, backups, and pre-existing `.claude/settings.local.json`. QA screenshots/reports/logs remain Git-ignored in `dashboard/qa-artifacts/`. The isolated baseline snapshot directory `C:\Users\User\AppData\Local\Temp\aaf-overnight-before-17SmiZ` is retained as local QA material, not production data. Earlier failure screenshots in ignored QA directories are diagnostic history, not final PASS evidence; use the final `workstation/report.json` manifest.

## 10. First operator acceptance task

Create a disposable context, then complete one **Mock-only Image → Video → approval → M6 assembly → download** journey. Choose one image output, use it as the video start frame, and confirm that the saved scene/Asset survives a refresh and appears in Assets. This exercises the connected workstation at zero provider cost.

There is no code/setup blocker to this local acceptance task. FLUX/Seedance live generation quality and invoice reconciliation remain unverified by design: a later explicit paid authorization and sufficient provider funding are required. No paid test is queued or implicitly authorized by this report.
