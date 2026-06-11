# Production Node Canvas

A **separate**, freeform node-graph surface (left nav → **Node Canvas**), modeled on
Higgsfield Canvas. It is **additive** — the existing scene-card **Canvas** (List/Board,
Flow Import, variations, duration, gaps, cleanup, readiness, export) is unchanged.

> The engine ships with **five node types** — Prompt, Upload, Asset, Image Generator,
> Video Generator. There is **no generation, no API provider, no paid call**. Every
> **Generate** button is a **dormant stub** — it only writes a placeholder status onto the
> node; it never calls anything. (Upload's **Save to Library** is the one real I/O — it
> writes a file to the local disk via the existing media-save endpoint, no AI involved.)

## The engine

- **Infinite board:** drag empty space to **pan**; **scroll to zoom** (clamped 0.25×–2.5×,
  zoom centers on the cursor). Dark dotted grid background.
- **Nodes:** absolutely-positioned boxes with `x/y/width` in state. Drag a node by its
  **header** to move it. Click selects (highlight). **Delete/Backspace** (or the node's ✕)
  removes the selected node and every wire attached to it.
- **Spawn:** **right-click** empty space → context menu → **+ Prompt / + Upload / + Asset /
  + Image Generator / + Video Generator** creates a node at the cursor.
- **Sockets + wires:** typed input sockets on the left edge, output sockets on the right.
  Drag from an **output** socket to a compatible **input** socket to create a wire (an SVG
  bezier). Socket types must match (`text`/`image`/`video`); self-connections and
  duplicates are rejected; one wire per input (a new wire replaces the old). **Click a
  wire** to delete it.

## Node types (all dormant — UI + state only)

Right-click → context menu spawns five node types: **Prompt**, **Upload**, **Asset**,
**Image Generator**, **Video Generator**. They prove the engine handles a multi-node
**Prompt/Image → Image → Video** chain. None generate anything.

### "Prompt" node (text source)
- **No inputs.** **Output:** Prompt (text).
- **Field:** `text` (textarea) — a reusable text source you wire into Image/Video
  nodes' Prompt inputs.

### "Upload" node (real image → board)
- **No inputs.** **Output:** Image (image).
- **Body:** a **file picker** + **drag-drop dropzone** (reuses the same client-side
  FileReader read as Flow Import: `FileReader → data_url`, then `Image → naturalWidth/
  naturalHeight`). Shows a thumbnail. **Images only** this sprint.
- The decoded **`data_url` is session-only preview state** (kept in the component's
  `previews` map, keyed by node id) — it is **never** written to `node.data` or
  localStorage. Only metadata persists: `file_name`, `file_size`, `mime_type`,
  `width`, `height`.
- **No auto-save on drop.** A **Save to Library** button is the explicit action: it
  sends the preview `data_url` through the **existing** `saveMediaToLocal →
  POST /api/media/save` path, normalizes the result via `normalizeMediaResult`
  (`source_type: 'upload'`), and stores the returned **`local_url`** + `storage:
  'local_disk'` onto `node.data`. That `local_url` persists and is what re-loads.
- The Image output wires into Image Generator **Reference Image 1/2/3** and Video
  Generator **Reference Image / Start Frame / End Frame** (all image → image).

### "Asset" node (pick from saved library)
- **No inputs.** **Output:** Image (image).
- **Body:** a `<select>` of images **already saved** in the Local Media Library
  (supplied by App from media the project already references — scene variations,
  canvas assets, and prior Upload-node `local_url`s; **no new backend list endpoint**).
  Picking one stores its `local_url` / `file_name` / dimensions on `node.data` and shows
  a thumbnail.
- **Empty state** when nothing is saved yet: *"No saved media — use an Upload node or
  Flow Import first."*

### "Image Generator" node
- **Inputs:** Prompt (text), Reference Image 1 / 2 / 3 (image — the multi-reference
  `@Image1–3` system). **Output:** Image (image).
- **Fields (inert):** User prompt (textarea), Model (Nano Banana Pro / Soul 2.0 /
  GPT Image 2.0 / Seedream 5.0 / Flux 2), Aspect Ratio (1:1 / 3:4 / 4:3 / 16:9 / 9:16),
  Resolution (1K / 2K / 4K), Count (number, default 1), Seed (number, optional/blank).
- **Generate button:** **dormant stub** — only sets *"Generation not connected yet"*;
  no API/network call.

### Valid wiring (type-checked)
Socket types are enforced by `addConnection` (no loosening):
- **Prompt → Image/Video "Prompt"** inputs (text → text). ✓
- **Image "Image" → Video "Reference Image" / "Start Frame" / "End Frame"** (image → image). ✓
- **Upload/Asset "Image" → Image Gen "Reference Image 1/2/3"** and Video Gen
  "Reference Image / Start Frame / End Frame" (image → image). ✓
- text **cannot** connect to image/video sockets, and vice-versa (e.g. Upload Image →
  Video Prompt is **rejected**). ✗

## The "Video Generator" node (UI + state only)

- **Inputs:** Prompt (text), Reference Image (image), Reference Video (video),
  Start Frame (image), End Frame (image).
- **Output:** Video (video).
- **Fields (all inert this sprint, stored in `node.data`):** User prompt (textarea),
  Model (Seedance 2.0 / Kling 3.0 / Veo 3.1 / Wan 2.7 / Sora 2 — plain strings, no
  behavior), Duration seconds, Resolution (720p/1080p), Aspect Ratio (9:16/16:9/1:1/4:5),
  Generate Audio (toggle).
- **Generate button:** **dormant stub** — clicking it sets a node status of
  *"Generation not connected yet"* and makes **no** network/API call. This is the seam
  where real generation will attach in a future sprint.

## Persistence

The whole graph (nodes with positions + data, connections, and pan/zoom) is stored in
`project.node_canvas` and saved through the existing `setProject → saveProject` path, so
it **survives reload**. `nodeCanvasModel.normalizeNodeCanvas` normalizes on load and
**migrates** old projects with no `node_canvas` to an empty graph without error; it also
drops any connection that references a missing node. As a hard invariant it **strips any
`data_url`** off node data on normalize, so large inline image previews can never leak
into localStorage — only `local_url` + metadata persist.

## Model (pure, testable)

`src/lib/nodeCanvasModel.js`: `newNode`, `addNode`, `moveNode`, `updateNodeData`,
`removeNode` (cascades to attached connections), `addConnection` (validates socket-type
compatibility, blocks self/duplicate), `removeConnection`, `emptyNodeCanvas`,
`normalizeNodeCanvas`. DOM/drag logic stays in `src/components/nodecanvas/NodeCanvas.jsx`;
all graph mutations are pure here and covered by the keyless `NC.` unit test in
`qa-canvas-speed-batch.mjs`.
