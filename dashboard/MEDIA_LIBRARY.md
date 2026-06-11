# Local Media Library

A **local-disk-only** store for uploaded media (asset images and result
files) so previews survive page reloads. This is **not cloud storage** — files
live only on this computer and are private to you.

## What it is / is not

- ✅ Files are saved to a folder on **your machine** by the local backend.
- ✅ Served back to the dashboard from `http://127.0.0.1:8787/media/...` (localhost only).
- ❌ No cloud upload, no database, no account, no sharing.
- ❌ Not used for image/video **generation** — this only stores files you upload.

## Where files are saved

```
dashboard/local-media/
  projects/
    default/
      assets/        # files saved from the Asset Tray
      variations/    # files saved from Add Existing Result
```

Each saved file gets a unique, sanitized name (timestamp + random suffix + your
original name). The folder is created automatically on first save.

`dashboard/local-media/` is **gitignored** — media files are never committed.

## How to save media

- **Asset Tray:** upload an image, then click **Save To Local Media Library** on the
  asset card. The card then shows **Local file saved**.
- **Add Existing Result:** choose **Upload file**, keep **Save To Local Media Library**
  checked, then **Save Result**. The variation is stored with a local file so its
  preview survives reloads.
- **Import from Flow:** batch-import images you generated externally in Google Flow.

## Import from Flow (manual, no API)

A fast path for images you generated in **Google Flow** (or any tool) and want to pull
into a project. It calls **no AI provider** and makes **no paid calls** — it only reads
the files you choose and reuses the existing local-media save endpoint.

- **Where:** Canvas → **Board View** → **Import from Flow** panel.
- **Formats:** PNG, JPG, WebP.
- **Batch:** pick or **drag-and-drop one or many** files at once. Each becomes a
  previewable result (via the shared Media Result Contract) with its real
  **width × height** read in the browser, `mime_type`, `provider: "manual"`, and
  `source: "flow_import"`.
- **Explicit save only:** nothing is written on drop. Each image has a **Save & Attach**
  button (and a **Save all** for the batch). Saving uses the existing media endpoint
  (same sanitize + path-traversal protection) and writes under
  `local-media/projects/default/variations/`. After saving, the image attaches as a
  **scene variation** — selectable, shown in the **Final Timeline**, and included in
  **Final Export** with `source: flow_import` in its metadata.

## Deleting and replacing variations

Each variation card has two extra controls:

- **Delete (🗑):** removes the variation from the scene after a **confirm** prompt (so a
  single misclick can't destroy it). Removal is **model-only** — the underlying file in
  `local-media/` is **left on disk** (media cleanup is a separate concern). Selection
  rule: if you delete the **selected** variation, the scene is left with **no** selected
  variation (it does **not** auto-promote another); deleting a non-selected one keeps the
  current selection. Deleting the last one leaves an empty variation list. The change
  persists through the normal save/reload.
- **Replace:** opens a single-file picker (PNG/JPG/WebP). The chosen image is read
  client-side, saved through the **existing** Local Media Library save path
  (`/api/media/save`, same sanitize + traversal guard), and the **same** variation is
  updated **in place** — its `id`, array position, and **selected status are kept**;
  only the media fields change (`local_url`, `file_name`, `file_size`, `mime_type`,
  `storage: local_disk`, `source_type: flow_import`). No new array entry is created, and
  it flows through the existing Media Result Contract.

## Reordering variations within a scene

In Board View, each scene's variation cards have a **drag handle** (⠿). Drag a card by
its handle and drop it onto another card **in the same scene** to reorder. The scene's
`variations` array order is the source of truth, so the new order:

- **persists** through the normal save/reload (it's saved with the project), and
- is reflected in the **Final Timeline** and **Final Export** (both emit variations in
  array order).

Reordering only changes position — it never changes which variation is **selected** or
edits any field. **Out of scope (intentionally):** dragging a variation into a different
scene.

## Export readiness gate

Before producing a Flow Package, the dashboard runs one consolidated, read-only check
(`assessExportReadiness`) that aggregates every blocker and warning:

- **Blockers (package NOT ready):** `no_scenes` (canvas has no scenes) and `scene_gaps`
  (any scene with no variations or no selected variation — scene numbers included).
- **Warnings (don't block, just surface):** `duration_mismatch` (declared ad length
  parses but ≠ summed scene duration — declared/summed/difference shown) and
  `zero_duration_scenes` (one or more timeline scenes have `duration_seconds ≤ 0`).

It **reuses** the existing helpers (`findSceneGaps`, `sumSceneDurations`,
`parseDeclaredSeconds`, `durationStatus`) — it does not re-detect anything, and it never
changes canvas data.

**Indicator:** next to the Export button a small badge shows live status — green
*"Ready to export"*, amber *"Ready with N warning(s)"*, or red *"N blocker(s) — not
export-ready"*.

**Gate behavior on Export Flow Package:**

- **Blockers:** a confirm lists them (and any warnings); you can **Export anyway** or
  cancel and fix. It never blocks forever — you can always force it after seeing them.
- **Warnings only:** a lighter confirm lists the warnings; proceed or cancel.
- **Ready:** exports normally.

**Export Readiness Summary:** the exported package begins with a **Readiness Summary**
section — `✓ READY`, or the list of blockers/warnings — complementing (not replacing)
the existing **Timeline Gaps** and **Timeline Duration** sections.

## Gap detection (export readiness)

The Final Timeline only lists scenes that have a **selected** variation, so scenes that
aren't ready are otherwise invisible. A **gap panel** above the timeline surfaces them:

- **Reasons:** `no_variations` (the scene has no variations) and `no_selection` (it has
  variations but none is marked selected). Listed as e.g. *"Scene 3: no selected
  variation"*.
- **Read-only:** detection never auto-selects or auto-fixes anything — it just warns.
  When every scene is ready it shows *"All scenes have a selected variation."*
- **Export:** Final Export includes a **Timeline Gaps** section — a ⚠️ warning listing
  the gap scenes/reasons, or *"Package complete"* when there are none.

## Scene durations in the Final Timeline

Each scene in the **Final Timeline** has an editable **Duration (s)** number input
(stored as `scene.duration_seconds`, a numeric field added to the scene model). Edits
persist through the normal save/reload.

- **Total:** the timeline shows a **summed total** of `duration_seconds` across the
  scenes in the timeline (i.e. scenes that have a selected variation — the same
  membership rule the timeline already uses). Blank/invalid durations count as 0.
- **Declared comparison:** if a declared ad length exists (parsed from
  `product_intake.ad_duration`), the timeline shows
  **declared vs summed**, the **difference**, and a **Valid/Mismatch** badge. If no
  numeric declared length is present, the comparison is skipped and only the summed
  total is shown. Declared-length parsing accepts plain numbers (`30`, `30 seconds`),
  `m:ss` (`1:30` → 90), and `h:mm:ss` (`1:02:03` → 3723).
- **Export:** Final Export includes a **Timeline Duration** section — per-scene
  durations, the summed total, and the declared-vs-summed comparison when available.

## Reordering scenes in the Final Timeline

Each scene in the **Final Timeline** has a **drag handle** (⠿). Drag a scene by its
handle and drop it onto another timeline scene to reorder. The `scenes` array order is
the source of truth (= timeline order), so the new order **persists** through the normal
save/reload and is reflected in **Final Export** (scenes are emitted in array order, no
sort).

- **scene_number is STABLE.** Reordering does **not** renumber scenes — `scene_number`
  is treated as a fixed identity/label, so the timeline can show e.g. Scene 3, Scene 1,
  Scene 2. This keeps `scene<NN>_v<NN>` Flow-import filename matching working.
- Reordering never changes any scene's **selected variation** or its variations.
- **Out of scope (intentionally):** dragging a variation across scenes, and the Board
  View grouping still orders by `scene_number` (that's a separate view).

### Save & Attach all matched (batch)

The **Matched** section has a **Save & Attach all matched (N)** button, where N = the
number of matched images that have a target scene selected. It runs the **same**
per-image save+attach (existing media endpoint → variation), so there's no new save
path:

- **Sequential**, one image at a time (not parallel), to avoid hammering the local
  backend. Each image shows progress (`Saving…` → saved/failed).
- **Skips** Unsorted images and matched images with no target scene — those stay as
  session previews for manual handling. The per-image **Save & Attach** and **Save
  all (N)** buttons still work unchanged.
- **Failure-continues:** if one image fails to save, the batch keeps going and reports
  which files failed at the end. Successfully-saved images are removed from the pending
  preview list; failed ones stay so you can retry.
- Each successfully saved image attaches to its target scene exactly like the single
  path — selectable, in the Final Timeline, exported with `source: flow_import`.

### Filename → scene mapping

Files named `scene<NN>_v<NN>` (case-insensitive, extra suffix text allowed — e.g.
`scene01_v02.png`, `Scene3_V1_final.webp`) are grouped by **scene number**. If a canvas
scene with that number exists, the image is **pre-associated** with it as a *suggested*
target scene. Files that don't match go to an **Unsorted** group. Pre-association only
fills the suggested target — **nothing attaches until you click Save & Attach** (you can
change the target scene first).

> Image generation in this tool is intentionally **manual Flow import** — the status
> panel showing "OpenAI image: not configured" is expected, not an error.

If the backend is not running, the upload falls back to a **session-only** preview
(lost on reload). Start the backend (`npm run dev:server` or `npm run dev:all`) and
save again to persist it.

## Media health labels

- **Local file saved** — stored on local disk (survives reload).
- **URL saved** — an external URL you pasted.
- **Session-only preview** — uploaded but not saved; lost on reload.
- **Mock result** — a Mock-mode placeholder (`mock://…`).
- **No media attached** — nothing yet.

## Export

The Final Export (Competitor Video Recreation) records each variation's storage type
(`local_disk` / `external_url` / `mock` / session-only), and for local files the
`local_url`, file name, and file size.

## Generate all scene prompts (API)

A one-click button — **"Generate all scene prompts (API)"**, in both **List View**
(Prepare Export) and **Board View** (Production Board) — fills every scene's
`output_prompt` using the **existing OpenAI text/JSON provider** through the local
backend (`/api/llm`). No external ChatGPT/Claude tab, no paste-JSON-back, no new
provider, and image/video generation is untouched.

- **What it sends:** the brief + competitor reference + each target scene's context,
  asking OpenAI to return **strict JSON** `{ "prompts": [ { "scene_number", "output_prompt" } ] }`
  (JSON-only is enforced in the prompt and by the provider's JSON mode). The output
  prompts are single-shot generation prompts suitable for pasting into Google Flow.
- **Fill-only vs overwrite:** by default it fills only **empty** prompts; tick
  **"overwrite existing"** (the checkbox next to the button) to regenerate all of them.
- **Writeback:** results are matched to scenes by `scene_number` and written via the
  normal save path, so they **persist** across reload. Writes are applied **only on a
  clean JSON parse** — a failed/garbled response changes **no** scene (no partial
  corruption); the error (with `request_id`) is shown and logged in the API Action Log
  so you can retry.
- **Provider:** the action always uses **OpenAI text** and does **not** permanently
  switch your Provider Mode. It needs `OPENAI_API_KEY` configured on the backend; keys
  never reach the browser.
- After it runs, Board View's per-scene **Copy prompt** has real content to copy into
  Flow, one shot at a time.

## Testing: qa:canvas vs qa:e2e

Two key-free, paid-call-free suites:

- **`npm run qa:canvas`** — fast headless harness (Playwright + pure unit checks). Spawns
  its own **keyless** backend on **8788** and drives the app via the file input and
  pure model functions. Covers logic + most flows (63 checks).
- **`npm run qa:e2e`** — real-browser coverage for the **interactive layer** that
  qa:canvas can't physically perform: native **HTML5 drag-and-drop** gestures and
  native **`confirm()`** dialogs. It is fully self-contained — it spawns its **own
  keyless backend on 8788** (all provider keys cleared) **and** its own Vite dev server
  on **5273**, points the app at 8788 via a `localStorage` override, runs headless, then
  tears everything down. **No API key, zero AI-provider calls, zero paid calls.**

`qa:e2e` exercises: Flow import via real drag-drop (one + many files, dimensions +
matched/unsorted grouping), the **Save & Attach all matched** batch, **variation
reorder** within a scene (and rejecting cross-scene drag), **scene reorder** in the
Final Timeline, the **delete-variation confirm** (dismiss keeps / accept removes), and
the **export readiness confirm** ("Export anyway" still emits the Readiness Summary).

Run everything in order with **`npm run qa:all`** (build → test:docs → qa:canvas → qa:e2e).

## Media cleanup (reclaim orphaned files)

Deleting or replacing a variation removes its reference from the project but **leaves the
old file on disk** (by design). Over time those become **orphans** — files in
`local-media/projects/<project>/variations/` that no variation references anymore. The
**Media Cleanup** panel (Board View) reclaims them safely:

1. **Scan for orphaned files** (read-only): gathers every referenced filename/URL from the
   live canvas (all variations across all scenes) and asks the backend
   (`POST /api/media/orphans`) which variation files are unreferenced. Shows a **dry-run**
   list — filenames, sizes, total reclaimable space. **Deletes nothing.**
2. **Delete N orphaned files** (explicit): after a `window.confirm`, sends the orphan list
   **plus** the referenced set to `POST /api/media/cleanup`. Reports what was deleted /
   skipped, then re-scans.

**Safety guarantees:**

- **Never auto-deletes.** Cleanup runs only on an explicit, confirmed click with an
  explicit file list.
- **Server re-verifies.** Before deleting each file the backend re-checks it is **not** in
  the referenced set — a referenced file is **skipped** even if the client asks for it.
- **Stays in bounds.** Filenames are sanitized (path segments stripped) and resolved
  strictly inside the project's `variations/` directory; anything that would escape is
  refused. Files outside that directory are never touched.
- **Conservative:** the client treats anything referenced by a live variation as in-use,
  so a file is an orphan only when **no** variation references it.

## How to clear local media

Delete the folder (or any project subfolder) when nothing is using it:

```bash
# from the dashboard/ folder
rm -rf local-media            # all local media
rm -rf local-media/projects/default   # just the default project
```

On Windows PowerShell:

```powershell
Remove-Item -Recurse -Force local-media
```

Removing files only breaks previews that pointed at them; your project data
(localStorage) is untouched. Re-upload and save again to restore previews.

## Security

- The backend only writes inside `local-media/` and refuses path traversal.
- Filenames are sanitized (no directory parts, safe characters only).
- The media endpoints require **no API keys** and never touch any provider.
- The server listens on `127.0.0.1` only.
