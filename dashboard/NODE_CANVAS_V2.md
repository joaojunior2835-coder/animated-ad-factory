# Production Node Canvas v2

A Higgsfield-inspired, fully functional node-based infinite canvas (left nav →
**Node Canvas**) for producing animated ad scenes: typed nodes wired with bezier
connections, a node palette + Model Gallery sidebar, a production toolbar with
Run All, a real (but key-safe) generation engine, and two-way integration with
the existing scene/variation workflow. Supersedes the v1 dormant engine described
in `NODE_CANVAS.md` (same persistence model; everything additive).

Implementation:

- `src/lib/nodeCanvasModel.js` — pure graph model + model registry (no DOM, no API)
- `src/components/nodecanvas/NodeCanvas.jsx` — the board
- `src/components/nodecanvas/CanvasSidebar.jsx` — palette + Model Gallery
- `src/components/nodecanvas/CanvasToolbar.jsx` — top toolbar
- `src/components/nodecanvas/nodeTheme.js` — per-type colors/icons
- `App.jsx` — generation engine + scene-workflow bridges
- Styles: the `NODE CANVAS v2` section at the bottom of `src/styles.css`

## Node types and data shapes

All nodes are `{ id, type, x, y, width, data }`. Existing v1 types (`prompt`,
`upload`, `asset`) are unchanged; generator types gained generation fields.
Field names stay snake_case to match the rest of the project model.

| Type | Color | Sockets (in → out) | Key data fields |
| --- | --- | --- | --- |
| `prompt` | purple `#7c3aed` | — → Prompt (text) | `label`, `text`, `output_text` |
| `image_generator` | blue `#2563eb` | Prompt (text), Reference Image 1–3, Character, Style (image) → Image | `label`, `user_prompt`, `model_id`, `aspect_ratio`, `resolution`, `seed`, `status`, `status_message`, `result_external_url`, `result_local_url`, `result_file_name`, `result_mime_type`, `result_saved` |
| `video_generator` | teal `#0d9488` | Prompt (text), Reference Image/Start/End Frame, Character, Style (image), Reference Video (video) → Video | image fields + `duration_seconds` (4/6/8/10s selector), `generate_audio` |
| `reference` | orange `#ea580c` | — → Image, Video | `label`, `ref_type` (`character\|product\|style\|startFrame\|endFrame`), `file_url`, `local_url`, `file_name`, `media_type`, `width`, `height` |
| `character` | pink `#db2777` | — → Ref Image | `label`, `character_name`, `description`, `ref_image_url`, `local_url`, `locked` |
| `style` | yellow `#ca8a04` | — → Ref Image | `label`, `style_description`, `ref_image_url`, `local_url` |
| `output` | green `#16a34a` | Image, Video → — | `label`, `scene_number`, `variations[]` (`{id,label,url,local_url,media_type}`), `selected_variation_index`, `final_media_url`, `final_local_path` |
| `upscale` | gray `#6b7280` | Image → Image | `label`, `scale_factor` (2/4), `input_image_url`, `output_image_url`, `status` (placeholder seam — no backend) |
| `upload` / `asset` | amber / olive | — → Image | unchanged from v1 |

Connections stay `{ id, from_node, from_socket, to_node, to_socket }` with typed
sockets (`text`/`image`/`video`) enforced by `addConnection`: incompatible types,
self-connections and duplicates are rejected; one wire per input (new replaces old).

Generation status enum (`GEN_STATUSES`): `idle | queued | generating | done |
error`. `normalizeNodeCanvas` migrates legacy free-text statuses to `idle` and
resets in-flight `queued/generating` on reload. Unknown node types are
**preserved** (rendered as inert generic nodes) so newer snapshots never lose
data; `data_url` is still always stripped before persistence.

## Model registry

`MODEL_REGISTRY` (local JS, never fetched):

| id | type | category | behavior |
| --- | --- | --- | --- |
| `mock-image` | image | Test | placeholder immediately, free |
| `mock-video` | video | Test | placeholder immediately, free |
| `openai-image` | image | Premium | real OpenAI image via the local backend, uses credits |
| `manual` | any | Manual | no generation — paste a URL |

**Custom models** persist in localStorage under `aaf_custom_models` (Model
Gallery → *Add Custom Model*: id, name, type, category, description, previewUrl).
They appear in the gallery and node model dropdowns immediately; custom ids never
shadow built-ins. Helpers: `allModels()`, `modelById()`, `modelsForType()`,
`creditEstimateForModel()`, `modelUsesCredits()`.

## The board

- **Pan**: drag empty space, middle-mouse drag anywhere, or Space+drag. **Zoom**:
  scroll wheel, 0.2×–3×, centered on the cursor.
- **Select**: click; Shift+click multi-select (drag moves the whole selection);
  click empty space or Escape to deselect; Ctrl+A selects all.
- **Wires**: drag from an output socket — a live rubber-band follows the cursor
  and input sockets glow green (compatible) or red (incompatible). Click a wire
  to select it (orange), Delete removes it.
- **Delete**: Delete/Backspace removes selected nodes/wire; confirms when a node
  has results attached.
- **Rename**: double-click a node header (or the canvas name in the toolbar).
- **MiniMap** (bottom-right): type-colored node rectangles + viewport box; click
  to pan there. **⛶ Fit** zooms to show every node.
- Spawn nodes by right-click context menu, palette click (viewport center), or
  palette drag-and-drop (drop position).

## Sidebar

Collapsible (edge toggle). **Nodes** tab: one card per type. **Models** tab: the
gallery — cards sorted Test → Manual → Premium (then customs), live search by
name/category, **Use** sets the selected compatible generator's `model_id` or
spawns a pre-configured generator at center.

## Toolbar

Canvas name (inline edit → `node_canvas.name`), node count, provider-mode badge
(Manual/Mock/API from `project.canvas.provider_mode`), Fit to screen, Save
snapshot (timestamped `.json` download of the graph), Load snapshot (validates,
warns on unknown node types but still loads), Clear canvas (confirm), Import
Scenes (below), and **▶ Run All**.

**Run All** generates every idle/error image/video generator in topological
(upstream-first) order, skipping `manual`-model nodes. It confirms with the node
count and adds a credits warning when any node uses a Premium model; it is
disabled while anything is queued/generating.

## Generation flow

`NodeCanvas` never calls a provider. The Generate button calls
`onGenerateNode(nodeId, action)`; `App.generateForNode` routes by `model_id`:

- **mock-image / mock-video** → the existing mock provider (`runMock`), no
  network. Result is a `mock://` URL; instant `done`.
- **openai-image** → `POST /api/llm` with `action_type: 'generate_image'`,
  the effective prompt, and a `size` derived from the node's aspect ratio
  (`1:1→1024x1024`, `16:9/4:3→1536x1024`, `9:16/3:4→1024x1536`; the backend
  validates against an allowlist and otherwise falls back to
  `OPENAI_IMAGE_SIZE`). Returns a base64 `data_url`.
- **manual** → no call; the node opens a *Result URL* paste entry.

The **effective prompt** is the wired Prompt node's text if connected, else the
node's own `user_prompt` (`effectivePromptText`).

Safety rails:

- Premium models require `provider_mode === 'api'` (set in Canvas → Production
  Board) **and** a credits confirmation (Run All's batch confirm covers it once).
- Base64 results live only in session preview state — never in `node.data` or
  localStorage. **Save to Media Library** (explicit, per result) posts to the
  existing `/api/media/save` and stores the returned `local_url`. Nothing is
  ever auto-saved.
- Errors land on the node (`status: 'error'` + message); the key-free QA backend
  yields friendly "not configured / not reachable" errors, never a paid call.
- Statuses normalize on reload: in-flight → `idle`; results with URLs persist.

Results also **propagate**: when a generator (or manual paste) finishes and its
output socket is wired into an Output node, the result is appended to that
node's `variations[]` (first one auto-selects).

## Connecting to the ad workflow

1. **Import Scenes** (toolbar): for each `project.canvas.scenes` entry, appends a
   wired row — Prompt (`what_happens`) → Image Generator (`output_prompt`,
   `mock-image`) → Output (`scene_number`) — 580px row spacing, existing nodes
   untouched, confirm first.
2. **Attach to Scene** (on a generator result): pick a scene number → App adds
   the result as a new variation on that Canvas scene (same shape as the
   board's generated variations). Session-only previews must be saved to the
   Media Library first.
3. **Export to Final Timeline** (on an Output node): marks the matching scene
   variation `selected` (demoting any other selected one, mirroring
   `selectVariation`), creating the variation if the scene doesn't have it yet.
   Shows "No result to export yet." without a selection.

## Keyboard shortcuts

| Keys | Action |
| --- | --- |
| Space + drag / middle-mouse drag | pan |
| Scroll | zoom (0.2×–3×) |
| Shift + click | multi-select |
| Ctrl/Cmd + A | select all nodes |
| Ctrl/Cmd + Z | undo (20-step, session-only; add/delete/move/wire/clear/load/import) |
| Delete / Backspace | delete selected nodes or wire (confirms on results) |
| Escape | cancel wire / close menu / deselect / close pickers |

## Testing

- `npm run qa:canvas` (68 checks) and `npm run qa:e2e` (8) stay green and
  key-free; the node canvas engine never fires during them.
- `node scripts/dev-probe-nodecanvas.mjs` (dev server must be running) is a
  46-step Playwright probe covering the board, sidebar, toolbar, engine and
  workflow integration. It is a development aid, not part of `qa:all`.

## Intentionally left for a future sprint

- Real video generation (`generate_video` stays a friendly error) and a real
  upscale backend (the Upscale node is a placeholder seam).
- Video playback inside nodes (video results render as links).
- Feeding reference/character/style images into the OpenAI request (sockets and
  data exist; the Images API call is text-only for now).
- ComfyUI-style custom model endpoints (custom registry entries are metadata
  only — they route nowhere until a backend exists).
- Real-time collaboration, marquee box-select, redo, and node copy/paste.
