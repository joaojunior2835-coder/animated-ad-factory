# Manual QA: Canvas Speed Batch (Competitor Video Recreation)

> **Automated smoke test:** most of this flow is also covered by a Playwright
> script. With the dev server running (`npm run dev`), run `npm run qa:canvas` in
> another terminal. It prints PASS/FAIL per step and saves failure screenshots +
> the exported markdown to `dashboard/qa-artifacts/`. Use the manual steps below
> for anything the script doesn't assert (visual checks, edge cases).

Browser test steps for the Canvas workspace and the Speed Batch features
(outline import, scene-type presets, collapse/expand, bulk providers, readiness
checklist, adaptation prompt, and method-specific export).

Pure-logic for these features is covered indirectly by `npm run test:docs`; the
steps below verify the browser behaviour that can't be tested in Node.

## Setup

```bash
cd dashboard
npm install      # only if not already installed
npm run dev      # opens http://localhost:5173
```

Tip: to start from a populated board, open **Canvas** and click **Load
Competitor Canvas Example** (5 placeholder scenes). To test from scratch, use a
fresh project (right panel → **Reset**, then follow the steps).

Sample outline used in several steps below:

```
0:00-0:03 Hook: creator opens fridge and sees snack temptation
0:03-0:07 Problem: she looks frustrated after training
0:07-0:12 Product reveal: ritual drink appears on counter
0:12-0:20 Demo: she mixes the drink
0:20-0:27 Shift: kitchen becomes calm
0:27-0:30 CTA: final product hero shot
```

---

## 1. Select Competitor Video Recreation
- **Do:** Left nav → **Ad Methods** → select **Competitor Video Recreation**.
- **Expected:** The card shows a **Selected** label; the method persists (visible in the right-panel Project JSON as `"selected_method": "competitor_recreation"`).
- **Pass/Fail:** [ ]
- **Notes:**

## 2. Open Canvas
- **Do:** Left nav → **Canvas**.
- **Expected:** Heading reads **"Canvas — Competitor Recreation"** with Competitor Reference, Model Defaults, Quick Add From Outline, Scene Board, Canvas Readiness, Generate Adaptation, and Import sections. (If another method is selected, Canvas instead shows "Canvas is currently optimized for Competitor Video Recreation." with a switch button.)
- **Pass/Fail:** [ ]
- **Notes:**

## 3. Fill competitor reference
- **Do:** In **Competitor Reference**, fill ad name, brand, source URL, platform, ad duration, and notes.
- **Expected:** Values stay after switching nav away and back, and after page reload (persisted in `localStorage`). They appear under `canvas.competitor_reference` in the Project JSON.
- **Pass/Fail:** [ ]
- **Notes:**

## 4. Create scenes from outline
- **Do:** Paste the sample outline into **Quick Add From Outline** → click **Create Scenes From Outline**.
- **Expected:** 6 scene cards are created. Scene 1 has `timestamp_start 0:00`, `timestamp_end 0:03`, `what happens` = "creator opens fridge…", scene type **Hook**, and an `emotional purpose` prefilled. "Reveal" → **Product Reveal**, "Shift" → **Transformation**, "CTA" → **CTA**. A confirmation message shows how many scenes were added.
- **Pass/Fail:** [ ]
- **Notes:**

## 5. Append vs Replace
- **Do (Append):** With scenes already present, paste 2 more outline lines and click **Create Scenes From Outline**.
- **Expected:** New scenes are appended after existing ones; scene numbers renumber 1..N. No confirmation needed.
- **Do (Replace):** Paste the full outline again and click **Replace existing scenes**.
- **Expected:** A confirm dialog warns it will replace all existing scenes. Confirm → board is replaced with the parsed scenes; Cancel → nothing changes.
- **Pass/Fail:** [ ]
- **Notes:**

## 6. Scene type presets
- **Do:** Expand a scene with an **empty** `emotional purpose` / `product role` / `editing notes` / `adaptation instruction`. Change **Scene type** to e.g. **Demo**.
- **Expected:** The four helper fields fill with Demo defaults **only where empty**. Then set Scene type on a scene where those fields already have your text → your text is **not** overwritten (only `scene_type` changes). **Other** changes only the type, no prefill.
- **Pass/Fail:** [ ]
- **Notes:**

## 7. Collapse all / Expand all
- **Do:** In the Scene Board header, click **Collapse all**, then **Expand all**. Also toggle a single scene with its ▾/▸ caret.
- **Expected:** Collapsed cards show a one-line summary `[SceneType] start–end · what happens…`; expanded cards show all fields. Collapse state is per-scene and does not change saved data.
- **Pass/Fail:** [ ]
- **Notes:**

## 8. Provider defaults
- **Do:** In **Model Defaults**, set Default LLM / image / video (and optionally voice/music) from the dropdowns.
- **Expected:** Selections persist and appear under `canvas.model_defaults` in the Project JSON.
- **Pass/Fail:** [ ]
- **Notes:**

## 9. Apply Defaults To All Scenes
- **Do:** Click **Apply Defaults To All Scenes**.
- **Expected:** A confirm dialog appears. Confirm → every scene's LLM/image/video provider fields are set to the canvas defaults (visible when a scene is expanded). The button is disabled when there are no scenes.
- **Pass/Fail:** [ ]
- **Notes:**

## 10. Clear Scene Provider Overrides
- **Do:** Click **Clear Scene Provider Overrides**.
- **Expected:** A confirm dialog appears. Confirm → every scene's LLM/image/video provider fields are blanked (back to "(default / none)"). Disabled when there are no scenes.
- **Pass/Fail:** [ ]
- **Notes:**

## 11. Canvas Readiness checklist
- **Do:** Review the **Canvas Readiness** panel as you fill the board.
- **Expected:** 7 checks with ✓/✗: competitor reference filled, at least 3 scenes (shows count), every scene has timestamps, every scene has what happens, every scene has adaptation instruction, every scene has output prompt, providers selected (defaults). It updates live and never blocks editing.
- **Pass/Fail:** [ ]
- **Notes:**

## 12. Generate Adaptation Prompt
- **Do:** Click **Preview prompt** to inspect, then **Generate Adaptation Prompt**.
- **Expected:** Preview shows active brand docs, product/offer brief, imported script (if any), competitor reference, the full scene board (including `Scene type:` lines), selected providers, the do-not-copy rule (logos/claims/actors/identity/protected assets), the preserve rule (structure/pacing/shot logic/emotional sequence/editing rhythm), and a return-JSON shape. The button copies the prompt to the clipboard ("Copied ✓"). No network request is made.
- **Pass/Fail:** [ ]
- **Notes:**

## 13. Import Adapted Canvas JSON (optional round-trip)
- **Do:** Paste a JSON object with `scenes:[{what_happens, adaptation_instruction_for_our_product, output_prompt}, ...]` into **Import Adapted Canvas JSON** → **Import Adapted Canvas JSON**.
- **Expected:** Valid JSON updates the scenes and shows "Imported — scenes updated." Missing `scenes[]`, or a scene missing `what_happens` / `adaptation_instruction_for_our_product` / `output_prompt`, shows a clear error and does not change the board. Brand docs and the brief are untouched.
- **Pass/Fail:** [ ]
- **Notes:**

## 14. Final Export includes Canvas sections
- **Do:** Left nav → **Final Export**. Confirm product name + market/language are filled (export hard-stop), then **Export Flow Package Markdown**. Also try **Export Project JSON**.
- **Expected:** The Markdown title reads "— Competitor Video Recreation Package" and includes: **Competitor Reference**, **Adaptation Strategy**, **Scene Board** (table), **Scene-by-Scene Prompts**, **Selected Providers**, **Required Assets**, and **Edit Plan**. Project JSON contains the full `canvas` object. Export Project JSON works even if the package is incomplete.
- **Pass/Fail:** [ ]
- **Notes:**

## 15. Generate Scene Prompt Skeletons (Prepare Export)
- **Do:** With scenes that have empty **Output prompt**, click **Generate Scene Prompt Skeletons**.
- **Expected:** Each empty `output_prompt` is filled with a placeholder built from timestamp, scene type, what happens, camera, subject action, product role, adaptation instruction, and the selected video provider. A scene with an existing output prompt is **not** overwritten. A message reports how many were filled. No AI call.
- **Pass/Fail:** [ ]
- **Notes:**

## 16. Sync Canvas To Export Data
- **Do:** Click **Sync Canvas To Export Data**.
- **Expected:** The canvas scenes are written into the competitor `method_data` (competitor_structure, adapted_structure, shot_by_shot_plan, required_assets, providers summary) — visible in the right-panel Project JSON. The app does not crash. Brand docs and brief are untouched.
- **Pass/Fail:** [ ]
- **Notes:**

## 17. Adaptation Prompt modal
- **Do:** Click **Generate Adaptation Prompt**.
- **Expected:** A modal opens titled "Adaptation Prompt" with a scrollable preview and **Copy Prompt** / **Close** buttons. The preview includes brand docs, product/offer brief, the COMPETITOR REFERENCE block, the SCENE BOARD, and SELECTED PROVIDERS. Opening also copies the prompt (current behavior). **Copy Prompt** re-copies; **Close** dismisses.
- **Pass/Fail:** [ ]
- **Notes:**

## 18. Copy Repair Prompt on failed import
- **Do:** Paste invalid/incomplete JSON (e.g. `{"scenes":[{"what_happens":"x"}]}`) into **Import Adapted Canvas JSON** → click **Import Adapted Canvas JSON**.
- **Expected:** Validation errors show, the board is unchanged, and a **Copy Repair Prompt** button appears. Clicking it copies a prompt containing the invalid JSON, the exact errors, the required shape, and instructions to return corrected JSON only, not invent new scenes unless required, and preserve scene order/timestamps.
- **Pass/Fail:** [ ]
- **Notes:**

## 19. Board View — toggle + build
- **Do:** At the top of Canvas, click **Board View**, then **Build Board From Scenes**.
- **Expected:** A board appears with 5 columns (Competitor Reference → Adaptation → Prompt → Output → Final Selection) and one row per scene, each row showing connected node cards with `→` between them. Building over an existing board asks for confirmation. **List View** switches back to the scene editor unchanged.
- **Pass/Fail:** [ ]
- **Notes:**

## 20. Board node cards + actions
- **Do:** On a node card, use **View details**, **Copy prompt** (on the Prompt node), **Mark selected**, **Mark rejected**.
- **Expected:** Cards show title, subtitle, scene number, timestamp range, status badge, and selected provider where available. Copy prompt copies the scene's output prompt. Selected/rejected update the card status (selected = green border, rejected = dimmed). On the **Output** node, **Regenerate Image / Regenerate Video** show: "API generation is not connected yet. Use Copy Prompt and paste into your selected tool."
- **Pass/Fail:** [ ]
- **Notes:**

## 21. Rebuild Board From Scenes (non-destructive)
- **Do:** Mark a node selected, edit a scene's text in List View, return to Board View, click **Rebuild Board From Scenes**.
- **Expected:** Node content updates from the scenes, but your manual status (e.g., selected) and node positions are preserved.
- **Pass/Fail:** [ ]
- **Notes:**

## 22. Export includes board summaries
- **Do:** After building a board, export the Flow Package (Final Export).
- **Expected:** The Markdown includes **Board Nodes Summary**, **Board Edges Summary**, and **Final Selections** sections in addition to the competitor sections.
- **Pass/Fail:** [ ]
- **Notes:**

## 23. Asset Tray (Board View)
- **Do:** In Board View, use the **Asset Tray**: enter a title, pick a type and linked scene, optionally an external URL or **Upload image (session preview)**, then **Add Asset**.
- **Expected:** An asset card appears with type/status badges, linked scene, file name / external link, and an uploaded image preview (session-only). **Mark selected / Mark rejected / Delete** work. Reference/product assets linked to a scene appear on that scene's **Competitor Reference** node.
- **Pass/Fail:** [ ]
- **Notes:**

## 24. Scene Variations (Board View)
- **Do:** On a scene row, click **Add Variation**. Set type/provider/prompt/URL. Use **Mark selected**, **Mark rejected**, **Copy variation prompt**.
- **Expected:** Variation cards (A, B, C…) appear under the row. Marking one **selected** demotes any previously-selected variation in that scene. The **Output** node shows the variation labels; the **Final Selection** node shows the selected variation.
- **Pass/Fail:** [ ]
- **Notes:**

## 25. Final Timeline (Board View)
- **Do:** Review the **Final Timeline** panel.
- **Expected:** It lists selected variations by scene order (scene number, timestamp, label, provider, external URL, notes). With no selection it shows "No selected output yet."
- **Pass/Fail:** [ ]
- **Notes:**

## 26. Export includes asset/variation/timeline
- **Do:** With assets, variations, and a selection set, export the Flow Package (Final Export).
- **Expected:** The Markdown includes **Asset Tray Summary**, **Scene Variations**, and **Final Timeline** sections.
- **Pass/Fail:** [ ]
- **Notes:**

## 27. Provider Mode (Board View)
- **Do:** In the Production Board header, find **Provider Mode** (Manual / Mock). Default is **Manual**. No API keys anywhere.
- **Expected:** The setting persists (stored in `canvas.provider_mode`, visible in Project JSON). No real API calls happen in any mode.
- **Pass/Fail:** [ ]
- **Notes:**

## 28. Manual generation (Regenerate Image / Video / Generate Variation)
- **Do:** With Provider Mode = Manual, on an Output node click **Regenerate Image** (or **Regenerate Video** / **Generate Variation**); on a Prompt node click **Generate Variation**.
- **Expected:** A **Generation Result** modal opens showing provider, mode, action type, and the prompt used. **Copy Prompt** copies it. Paste an external URL + notes and click **Save as Variation** → a variation with status **generated** is added to that scene.
- **Pass/Fail:** [ ]
- **Notes:**

## 29. Mock generation
- **Do:** Switch Provider Mode = **Mock**, then click **Regenerate Image** / **Regenerate Video**.
- **Expected:** A fake variation is added automatically (status **generated**) with a `mock://generated-image/scene-N` or `mock://generated-video/scene-N` URL; the Generation Result modal shows the mock output. No network request occurs.
- **Pass/Fail:** [ ]
- **Notes:**

## 30. Generated variation flows to Final Timeline
- **Do:** On a generated variation, click **Mark selected**.
- **Expected:** The Output node lists the variation, the Final Selection node shows it, and the **Final Timeline** lists it by scene order. Export includes it under Scene Variations / Final Timeline.
- **Pass/Fail:** [ ]
- **Notes:**

## 31. Media preview in variation cards
- **Do:** Add a variation with an external URL ending in `.png`/`.jpg`/`.webp`/`.gif` (image), `.mp4`/`.webm`/`.mov` (video), a non-media URL (link), or a `mock://` URL.
- **Expected:** Image URLs render an `<img>`, video URLs a `<video>` with controls, plain URLs a clickable link, and `mock://` a "Mock image/video output" placeholder (never tries to load mock as real media).
- **Pass/Fail:** [ ]
- **Notes:**

## 32. Add Existing Result (per scene)
- **Do:** In Board View, on a scene row click **Add Existing Result**. Fill label/type/provider/external URL/prompt/notes/status; optionally **Upload file (session preview)**. Click **Save Result**.
- **Expected:** A variation is created with those fields. An uploaded image/video shows an immediate preview in the variation card (session-only; filename kept). Pasted URLs preview per their type.
- **Pass/Fail:** [ ]
- **Notes:**

## 33. Manual generation modal saves result media
- **Do:** Provider Mode = Manual. On an Output node click **Regenerate Image**. In the Generation Result modal, **Copy Prompt**, paste a **Result URL**, pick **Result type**, add **Result notes**, then **Save as Variation**.
- **Expected:** A generated variation is created with the pasted URL; its media previews in the card.
- **Pass/Fail:** [ ]
- **Notes:**

## 34. Mock generation preview
- **Do:** Provider Mode = Mock. Click **Regenerate Image / Regenerate Video**.
- **Expected:** A generated variation appears with a "Mock image/video output" placeholder — no attempt to load `mock://` as real media.
- **Pass/Fail:** [ ]
- **Notes:**

## 35. Final Timeline preview
- **Do:** Mark a variation (with media) selected.
- **Expected:** The Final Timeline shows a small preview (image/video) or a mock placeholder / link for the selected variation, alongside scene number, timestamp, label, and provider. Export's Final Timeline includes the media URL and any filename (with session-only note).
- **Pass/Fail:** [ ]
- **Notes:**

## 36. Save Project Snapshot
- **Do:** In the right panel under **Save & Restore**, click **Save Project Snapshot**.
- **Expected:** Downloads the full project JSON named `animated-ad-factory-project-YYYY-MM-DD-HHMM.json` (distinct from the Flow package / Export Project JSON). This is for restoring working state.
- **Pass/Fail:** [ ]
- **Notes:**

## 37. Unsaved-changes reminder
- **Do:** Make any change, then look at the right panel.
- **Expected:** A non-blocking note appears: "Unsaved project changes. Export a Project Snapshot before closing." It clears after **Save Project Snapshot** and returns if you change something again. It never blocks editing.
- **Pass/Fail:** [ ]
- **Notes:**

## 38. Restore Project Snapshot
- **Do:** Click **Restore Project Snapshot** and pick a snapshot JSON.
- **Expected:** It validates, confirms, and replaces the dashboard state (a backup is kept). It restores full dashboard state, not just the export package.
- **Pass/Fail:** [ ]
- **Notes:**

## 39. Variation media-health labels
- **Do:** Look at variation cards.
- **Expected:** Each shows a label — **URL saved** (non-mock external URL), **Mock result** (`mock://`), **Local upload preview only** (uploaded/session preview, no URL), or **No media attached**. Local-only variations also show "Preview is session-only. Save a real URL or re-upload after reload."
- **Pass/Fail:** [ ]
- **Notes:**

## 40. Export Bundle Checklist
- **Do:** Open **Final Export**.
- **Expected:** A non-blocking **Export Bundle Checklist** lists: project snapshot saved this session, final package exported this session, and (for Competitor Video Recreation) selected variations exist, Final Timeline has selected outputs, and whether selected outputs have saved URLs vs session-only previews. It never blocks export.
- **Pass/Fail:** [ ]
- **Notes:**

---

## Pass criteria
- Outline import creates correctly-parsed scenes (timestamps, what-happens, scene type from labels).
- Append adds; Replace confirms before destroying scenes.
- Scene-type presets fill only empty fields and never overwrite user text.
- Collapse/Expand work per-scene and in bulk.
- Provider defaults save; Apply/Clear confirm before changing scene providers.
- Readiness checklist reflects the board state and never blocks editing.
- Generate Adaptation Prompt copies a full, no-copy/preserve-structure prompt.
- Final Export shows the Competitor Video Recreation sections.

## One Source of Truth / Export Ready by Default

The Canvas is the source of truth; validation, sync, and export agree.

1. **Auto-sync on export.** With **Competitor Video Recreation** selected, open **Final
   Export** (or click **Export Flow Package Markdown**). The Canvas scenes, board,
   assets, variations, selected timeline, and providers are synced into the export
   data automatically — you do **not** need to click **Sync Canvas To Export Data**
   first (it remains as an optional manual button in the Canvas). A note appears:
   *"Canvas data synced to export."*
2. **Stale warning.** If the Canvas changes after the last sync, Final Export shows:
   *"Canvas changed since last export sync. Export will auto-sync before download."*
   This never blocks export.
3. **Readiness predicts export readiness.** The Canvas Readiness checklist and the
   Final Export validation now use the same Canvas data: competitor reference, ≥3
   scenes, timestamps, what-happens, and adaptation **or** output prompt per scene.
   If readiness is green, export validation is green.
4. **Hollow export warning.** If scenes have empty output prompt *and* empty
   adaptation, both the Canvas (Prepare Export) and Final Export show:
   *"Some scenes have no prompt/adaptation content. Export will include empty
   sections."* with a **Generate Scene Prompt Skeletons** button nearby. Non-blocking.
5. **Global Local API badge.** The header shows a live **Local API** status from
   `/health` — *Offline* / *Backend running · OpenAI missing key* / *OpenAI
   configured* — with a **Refresh** button. It refreshes on load and when entering
   API mode. No keys are ever exposed.
6. **Final Export checklist** reflects the source of truth: snapshot saved, Canvas
   synced (not stale), competitor reference present, scene board has scenes,
   prompts/adaptation content present, selected outputs present (if variations
   exist), and media URLs saved or session-only warnings shown. All non-blocking.
7. **Reserved controls.** Voice/music provider defaults are labeled **(reserved)**
   and noted as "reserved for future voice/music generation" — they are not used yet.

## Known limitations
- **No APIs / no Google download / no video analysis** — the competitor ad is mapped manually; the adaptation prompt is copy/paste into an external AI.
- **Screenshots are session-only** — uploads show a preview during the session and store the filename; the image is **not** persisted, so previews disappear after reload (re-upload if needed).
- **Outline parser is line-based** — it expects `H:MM-H:MM Label: description`. Lines without timestamps still become a scene (whole line → what happens); only the leading `Label:` (and known synonyms) sets the scene type.
- **Providers are placeholders** — selecting a provider records intent only; nothing connects out.
- **Storage is browser `localStorage`** (per-machine, per-browser); there is no server or database.
- Canvas is optimized for **Competitor Video Recreation**; other methods show a notice instead of the workspace.
