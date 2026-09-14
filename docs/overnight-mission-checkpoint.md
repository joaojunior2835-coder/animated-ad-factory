# Overnight creative workstation checkpoint

## Scope and safety

Mission: `Animated_Ad_Factory_Overnight_Mission.md`, 2026-09-15. Zero real provider generations, uploads, paid drafting or reference-site generations. No new provider, SaaS, schema, or ledger. Preserve live ProductionRun 2 / Job 1 and all existing production records. Existing `.claude/settings.local.json` is unrelated and must not be staged.

Baseline HEAD: `0b4830e33b96346bff9be6abb13b38748cdc62b9` on main. Live backend 8787, MCP 8789, Vite 5173 remain user processes. Isolated tests own their ports/databases. Baseline production-table SHA-256: `dc639f5fce99b84187e18cce65038189cb19c7f2bed558bf4b6ac1b488a87fb2` (ordered rows of product_test, iteration, creative, production_run, job, job_execution_attempt, budget_reservation, cost, asset, asset_link, publication, metric_snapshot, review_event).

## Acceptance checklist

- [x] Shared neutral-dark shell; obvious Create Ad / Image / Video / Remix / Canvas / Studio / Assets; preserve supporting tools and drafts.
- [x] Backend-authoritative model capabilities and documented rates; compatible controls; no unsupported paid options.
- [x] Image: durable M5 image jobs, conservative fractional pricing, quantity, local validation, history, output selection and transfers.
- [x] Video/Create Ad: shared composer, local start frame, exact quote/confirmation, refresh/status/playback/approval/M6.
- [x] Remix: preserve reference + images + instruction flow, automatic local preparation, optional Advanced, original/result/reuse.
- [x] Studio: factual French-first visual presets, product references, editable/locked scripts, finite priced production and handoffs; preserve Advanced wizard.
- [x] Canvas: graph interactions/validation/staleness/history, persisted Asset identity, scoped M5 dependency execution, useful populated board and mobile controls.
- [x] Shared Assets/history and no-copy cross-workspace transfers.
- [x] Required isolated browser journeys, recovery tests, desktop/mobile screenshots visually inspected.
- [x] Full regressions and unchanged production-data hash. Commit/push receipts are recorded in the morning report.

## Baseline (passed before feature edits)

`npm run build` PASS (existing bundle-size warning); `npm run qa:canvas` 68/68; `npm run qa:e2e` 8/8; `npm run test:docs` 16/16; `node scripts/test-studio.mjs` 13/13; `npm run test:studio` 255/255.

M5 dispatch, restart, retry and Seedance fal suites PASS. Money hardening 12/12; MCP confirmation PASS; Operator M6/M7/M8 21/21; Creative Generator 17/17; Reference Remix 23/23. Browser Creative 12/12; Operator 14/14; Remix 21/21. No real calls.

## Confirmed gaps / decisions

Image direct path is intentionally blocked outside M5. Node Canvas still uses the legacy blocked generation path; missing cycle detection, redo, staleness and durable Asset identity. Studio is an export wizard with no direct production. Generator autosave can lose the latest edit on immediate unmount. Existing registry and JSON persistence will be extended, not replaced. Legacy Scene Canvas and Node Canvas remain distinct and compatible.

Authenticated Higgsfield browser is accessible. Reconnaissance is read-only/nonbillable; screenshots referenced by the mission were not separately attached. Record only actual observations. Official FLUX schema/pricing reviewed at https://fal.ai/models/fal-ai/flux/schnell/api and https://fal.ai/models/fal-ai/flux/schnell (2026-09-15): text-to-image, documented dimensions, PNG/JPEG, $0.003 per rounded-up megapixel per output. No reference-image field in that route's input schema; never silently consume a product reference.

## Focused Phase 0 — image / graph dispatch extension (before implementation)

Invariant: claim + budget reservation + unresolved marker precede any paid submission; one durable external ID per attempt; unknown billing holds without retry; Asset and Cost settle idempotently. Existing M5 does this for video. Existing image plans contain counts only and use one run-level provider/model; graph dependency currently selects the first image. Existing integer-cent conversion uses round, so a fractional positive image cost could become zero.

Minimal change: add optional explicit frozen image/per-step specs to the existing production snapshot, with a legacy-compatible fallback. Compile graph dependencies into existing job_dependency rows. Extend fal's existing durable queue adapter with a distinct image external-ID prefix, one output per request, safe diagnostics and local decoded-image validation. Keep raw fractional source estimate in frozen metadata; convert conservatively at the existing integer-cent reservation boundary (explicit image rounding policy, with legacy video rounding unchanged). No schema migration and no second ledger/scheduler. Keep direct MCP image generation blocked.

Required proof: image price/quantity and FX quote matches actual reserved amount; no positive price becomes free; invalid inputs/missing FX blocked before submit; duplicate confirmation and settlement cannot duplicate Jobs/Assets/Cost; COMPLETED/result errors and uncertain submit retain hold and request ID, never resubmit; dependency graph only dispatches after successful upstream local Assets; old video/retry/reconciliation tests remain green. All provider behavior mocked and network-forbidden.

## Final implementation and verification

Implemented the shared shell, Image workspace with M5 FLUX and local Mock adapters, shared model registry, visual Studio, shared Assets, explicit frozen graph steps and scoped Canvas quote/start/status. No schema changes. Authenticated read-only Higgsfield Image, Video/Genjutsu, Studio and Canvas observations informed layout, not provider capabilities. FLUX remains explicitly text-only; Studio product photos use the existing Seedance start-frame path. Unsupported image editing and upscale are not advertised as working.

Corrections found through review and browser QA: duration normalization; missing/competing image dependencies; frozen FX/reference-byte quote invalidation; canonical media validation; concurrent Mock image rendering; immediate-navigation autosave; Canvas Run click propagation, starter settings, output hydration/staleness and populated-board fit; media thumbnail sizing; mobile composer reachability; actual decoded video duration versus requested Mock duration. Invalid completed provider media retains reconciliation rather than inventing settlement.

Final required regression: build PASS (existing bundle-size warning), qa:canvas 68/68, qa:e2e 8/8, test:docs 16/16, test-studio 13/13, test:studio 255/255. M5 dispatch/restart/retry and Seedance fal PASS. Money 12/12; MCP confirmation PASS; Operator 21/21; Creative Generator 17/17; Remix 23/23; Image 11/11; Video quantity 12/12; scope safety 9/9; Node Canvas 19/19; Canvas production 15/15; Studio production 22/22; recovery 8/8.

Final browser suites: Creative Generator 12/12; Operator 14/14; Remix 21/21; Node Canvas 12/12; connected workstation 19/19. Workstation evidence: 31 visually reviewed screenshots and 26 decoded-frame playback receipts. Isolated connected journey produced 8 Mock Jobs, 8 reconciled attempts, 9 Assets, zero Costs/reservations and zero external calls. Local fixture output is not AI quality evidence.

Only the normal backend and MCP were restarted after verification (PIDs 43232 and 19008); existing Vite PID 18036 retained. All three listen on 127.0.0.1 at their established ports. Health checks passed; live model registry exposes configured FLUX, Seedance and the two local Mock models. Existing USD/EUR rate 0.86534 retains source manual-live-rate-2026-09-14; no fresh market-rate claim. Production hash after restart exactly matches the baseline above; SQLite integrity is ok. Historical Run 2 / Job 1 is unchanged and its billing remains unknown.

Next action: review the morning report and perform one explicitly authorized operator acceptance run when desired. No paid generation was made during this mission. See `docs/overnight-morning-report.md` for test commands, screenshot paths, capability limitations and final Git receipts.
