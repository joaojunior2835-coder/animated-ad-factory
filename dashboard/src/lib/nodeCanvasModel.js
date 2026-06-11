// Pure model for the Production Node Canvas (a freeform node graph). DOM/drag logic
// lives in the component; all graph mutations are pure functions here. No API calls,
// no generation, no media — this is graph state only.

import { uid } from './brandDocs.js'

export const NODE_TYPES = ['prompt', 'upload', 'asset', 'image_generator', 'video_generator', 'reference', 'character', 'style', 'output', 'upscale']
export const VIDEO_MODELS = ['Seedance 2.0', 'Kling 3.0', 'Veo 3.1', 'Wan 2.7', 'Sora 2']
export const RESOLUTIONS = ['720p', '1080p']
export const ASPECT_RATIOS = ['9:16', '16:9', '1:1', '4:5']
export const IMAGE_MODELS = ['Nano Banana Pro', 'Soul 2.0', 'GPT Image 2.0', 'Seedream 5.0', 'Flux 2']
export const IMAGE_RESOLUTIONS = ['1K', '2K', '4K']
export const IMAGE_ASPECT_RATIOS = ['1:1', '3:4', '4:3', '16:9', '9:16']

// Generation lifecycle for generator/upscale nodes. The legacy free-text message
// field stays on `status_message`; `status` is strictly this enum.
export const GEN_STATUSES = ['idle', 'queued', 'generating', 'done', 'error']
export const REF_TYPES = ['character', 'product', 'style', 'startFrame', 'endFrame']
export const VIDEO_DURATIONS = [4, 6, 8, 10]
export const UPSCALE_FACTORS = [2, 4]

// ---- Model registry ----
// Local registry of generation models the canvas can route to. NOT fetched.
// `type` is what the model produces ('image' | 'video' | 'any' for manual).
// Custom entries persist in localStorage (aaf_custom_models) — guarded so this
// module stays importable in Node (the QA harness imports it outside a browser).
export const MODEL_REGISTRY = [
  { id: 'mock-image', name: 'Mock Image', type: 'image', category: 'Test', previewUrl: null, description: 'Returns a placeholder immediately. Free.' },
  { id: 'mock-video', name: 'Mock Video', type: 'video', category: 'Test', previewUrl: null, description: 'Returns a placeholder immediately. Free.' },
  { id: 'openai-image', name: 'OpenAI Image (gpt-image-1)', type: 'image', category: 'Premium', previewUrl: null, description: 'Real OpenAI image generation. Uses API credits.' },
  { id: 'manual', name: 'Manual / Paste URL', type: 'any', category: 'Manual', previewUrl: null, description: 'No generation. Paste a URL or upload a file.' }
]

export const CUSTOM_MODELS_KEY = 'aaf_custom_models'

export function loadCustomModels() {
  try {
    if (typeof localStorage === 'undefined') return []
    const raw = localStorage.getItem(CUSTOM_MODELS_KEY)
    const arr = raw ? JSON.parse(raw) : []
    if (!Array.isArray(arr)) return []
    return arr
      .filter((m) => m && typeof m === 'object' && String(m.id || '').trim())
      .map((m) => ({
        id: String(m.id).trim(),
        name: String(m.name || m.id).trim(),
        type: ['image', 'video', 'any'].includes(m.type) ? m.type : 'any',
        category: String(m.category || 'Custom').trim() || 'Custom',
        previewUrl: m.previewUrl || null,
        description: String(m.description || ''),
        custom: true
      }))
  } catch {
    return []
  }
}

export function saveCustomModels(models) {
  try {
    if (typeof localStorage === 'undefined') return false
    localStorage.setItem(CUSTOM_MODELS_KEY, JSON.stringify(Array.isArray(models) ? models : []))
    return true
  } catch {
    return false
  }
}

// Built-in + custom models. Custom models never shadow a built-in id.
export function allModels() {
  const builtinIds = new Set(MODEL_REGISTRY.map((m) => m.id))
  return [...MODEL_REGISTRY, ...loadCustomModels().filter((m) => !builtinIds.has(m.id))]
}

export function modelById(id) {
  return allModels().find((m) => m.id === id) || null
}

export function modelsForType(type) {
  return allModels().filter((m) => m.type === type || m.type === 'any')
}

// Human credit-cost label for a model (shown in node footers / Run All confirm).
export function creditEstimateForModel(modelId) {
  const m = modelById(modelId)
  if (!m) return 'Unknown model'
  if (m.category === 'Test') return 'Free (mock)'
  if (m.id === 'manual' || m.category === 'Manual') return 'Free (manual)'
  if (m.id === 'openai-image') return 'Uses API credits'
  return m.category === 'Premium' ? 'Uses API credits' : 'Unknown cost'
}

// True when running this model spends real API credits.
export function modelUsesCredits(modelId) {
  const m = modelById(modelId)
  return !!m && m.category === 'Premium'
}

// Node type definitions: typed input/output sockets + default inert data.
// IMPORTANT: existing socket names/types are load-bearing (typed wiring + QA);
// new sockets are ADDITIVE only.
export const NODE_DEFS = {
  prompt: {
    title: 'Prompt',
    inputs: [],
    outputs: [{ name: 'prompt', label: 'Prompt', type: 'text' }],
    defaultData: () => ({ label: '', text: '', output_text: '' })
  },
  upload: {
    title: 'Upload',
    inputs: [],
    outputs: [{ name: 'image', label: 'Image', type: 'image' }],
    // Image files only this sprint. data_url preview is session-only (component
    // state), NEVER stored here — only the saved local_url + metadata persist.
    defaultData: () => ({ file_name: '', file_size: 0, mime_type: '', width: 0, height: 0, local_url: '', storage: '', status: '' })
  },
  asset: {
    title: 'Asset',
    inputs: [],
    outputs: [{ name: 'image', label: 'Image', type: 'image' }],
    // References an image already saved in the Local Media Library (by local_url).
    defaultData: () => ({ file_name: '', width: 0, height: 0, local_url: '', storage: 'local_disk' })
  },
  image_generator: {
    title: 'Image Generator',
    inputs: [
      { name: 'prompt', label: 'Prompt', type: 'text' },
      { name: 'reference_image_1', label: 'Reference Image 1', type: 'image' },
      { name: 'reference_image_2', label: 'Reference Image 2', type: 'image' },
      { name: 'reference_image_3', label: 'Reference Image 3', type: 'image' },
      { name: 'character_ref', label: 'Character', type: 'image' },
      { name: 'style_ref', label: 'Style', type: 'image' }
    ],
    outputs: [{ name: 'image', label: 'Image', type: 'image' }],
    defaultData: () => ({
      label: '',
      user_prompt: '',
      model: IMAGE_MODELS[0],
      model_id: 'mock-image',
      aspect_ratio: '1:1',
      resolution: '2K',
      count: 1,
      seed: '',
      status: 'idle',
      status_message: '',
      result_external_url: '',
      result_local_url: '',
      result_file_name: '',
      result_mime_type: '',
      result_saved: false
    })
  },
  video_generator: {
    title: 'Video Generator',
    inputs: [
      { name: 'prompt', label: 'Prompt', type: 'text' },
      { name: 'reference_image', label: 'Reference Image', type: 'image' },
      { name: 'reference_video', label: 'Reference Video', type: 'video' },
      { name: 'start_frame', label: 'Start Frame', type: 'image' },
      { name: 'end_frame', label: 'End Frame', type: 'image' },
      { name: 'character_ref', label: 'Character', type: 'image' },
      { name: 'style_ref', label: 'Style', type: 'image' }
    ],
    outputs: [{ name: 'video', label: 'Video', type: 'video' }],
    defaultData: () => ({
      label: '',
      user_prompt: '',
      model: VIDEO_MODELS[0],
      model_id: 'mock-video',
      duration_seconds: 5,
      resolution: '1080p',
      aspect_ratio: '9:16',
      generate_audio: false,
      seed: '',
      status: 'idle',
      status_message: '',
      result_external_url: '',
      result_local_url: '',
      result_file_name: '',
      result_mime_type: '',
      result_saved: false
    })
  },
  reference: {
    title: 'Reference',
    inputs: [],
    outputs: [
      { name: 'image', label: 'Image', type: 'image' },
      { name: 'video', label: 'Video', type: 'video' }
    ],
    // A typed reference asset (character/product/style/startFrame/endFrame).
    // data_url previews are session-only (component state) — only local_url/
    // file_url + metadata persist (same rule as Upload).
    defaultData: () => ({
      label: '',
      file_url: '',
      local_url: '',
      file_name: '',
      mime_type: '',
      width: 0,
      height: 0,
      media_type: 'image',
      ref_type: 'product',
      storage: '',
      status_message: ''
    })
  },
  character: {
    title: 'Character',
    inputs: [],
    outputs: [{ name: 'image', label: 'Ref Image', type: 'image' }],
    defaultData: () => ({
      label: '',
      character_name: '',
      description: '',
      ref_image_url: '',
      local_url: '',
      file_name: '',
      locked: false,
      status_message: ''
    })
  },
  style: {
    title: 'Style',
    inputs: [],
    outputs: [{ name: 'image', label: 'Ref Image', type: 'image' }],
    defaultData: () => ({
      label: '',
      style_description: '',
      ref_image_url: '',
      local_url: '',
      file_name: '',
      status_message: ''
    })
  },
  output: {
    title: 'Output',
    inputs: [
      { name: 'image', label: 'Image', type: 'image' },
      { name: 'video', label: 'Video', type: 'video' }
    ],
    outputs: [],
    // Scene-facing sink: collects variations and the final pick for one scene.
    // variations: [{ id, url, local_url, media_type, label }]
    defaultData: () => ({
      label: '',
      scene_number: 1,
      final_media_url: '',
      final_local_path: '',
      selected_variation_index: -1,
      variations: [],
      status_message: ''
    })
  },
  upscale: {
    title: 'Upscale',
    inputs: [{ name: 'image', label: 'Image', type: 'image' }],
    outputs: [{ name: 'image', label: 'Image', type: 'image' }],
    defaultData: () => ({
      label: '',
      input_image_url: '',
      output_image_url: '',
      scale_factor: 2,
      status: 'idle',
      status_message: ''
    })
  }
}

// Node types that can run a generation (used by Run All + the engine).
export const GENERATOR_TYPES = ['image_generator', 'video_generator']

// Type of a socket by node type / side ('input'|'output') / socket name.
export function socketType(nodeType, side, socketName) {
  const def = NODE_DEFS[nodeType]
  if (!def) return null
  const list = side === 'input' ? def.inputs : def.outputs
  const s = (list || []).find((x) => x.name === socketName)
  return s ? s.type : null
}

export function newNode(type, x, y) {
  const t = NODE_DEFS[type] ? type : 'video_generator'
  const def = NODE_DEFS[t]
  return {
    id: uid(),
    type: t,
    x: Number.isFinite(Number(x)) ? Number(x) : 0,
    y: Number.isFinite(Number(y)) ? Number(y) : 0,
    width: 280,
    data: def.defaultData ? def.defaultData() : {}
  }
}

export function emptyNodeCanvas() {
  return { name: 'Untitled Canvas', nodes: [], connections: [], pan_x: 0, pan_y: 0, zoom: 1 }
}

export function addNode(nc, node) {
  const base = nc || emptyNodeCanvas()
  if (!node || !node.id) return base
  return { ...base, nodes: [...(base.nodes || []), node] }
}

export function moveNode(nc, id, x, y) {
  const base = nc || emptyNodeCanvas()
  return { ...base, nodes: (base.nodes || []).map((n) => (n.id === id ? { ...n, x: Number(x) || 0, y: Number(y) || 0 } : n)) }
}

export function updateNodeData(nc, id, patch) {
  const base = nc || emptyNodeCanvas()
  return { ...base, nodes: (base.nodes || []).map((n) => (n.id === id ? { ...n, data: { ...n.data, ...(patch || {}) } } : n)) }
}

// Remove a node AND every connection that touches it.
export function removeNode(nc, id) {
  const base = nc || emptyNodeCanvas()
  return {
    ...base,
    nodes: (base.nodes || []).filter((n) => n.id !== id),
    connections: (base.connections || []).filter((c) => c.from_node !== id && c.to_node !== id)
  }
}

// Validate + add an output→input connection. Returns the SAME canvas (no change) when
// invalid: self-connection, missing nodes, incompatible socket types, or duplicate.
// At most one wire per input socket (a new wire into a used input replaces the old).
export function addConnection(nc, conn) {
  const base = nc || emptyNodeCanvas()
  const { from_node, from_socket, to_node, to_socket } = conn || {}
  if (!from_node || !from_socket || !to_node || !to_socket) return base
  if (from_node === to_node) return base
  const fromN = (base.nodes || []).find((n) => n.id === from_node)
  const toN = (base.nodes || []).find((n) => n.id === to_node)
  if (!fromN || !toN) return base
  const ft = socketType(fromN.type, 'output', from_socket)
  const tt = socketType(toN.type, 'input', to_socket)
  if (!ft || !tt || ft !== tt) return base
  const dup = (base.connections || []).some((c) => c.from_node === from_node && c.from_socket === from_socket && c.to_node === to_node && c.to_socket === to_socket)
  if (dup) return base
  const cleaned = (base.connections || []).filter((c) => !(c.to_node === to_node && c.to_socket === to_socket))
  return { ...base, connections: [...cleaned, { id: uid(), from_node, from_socket, to_node, to_socket }] }
}

export function removeConnection(nc, id) {
  const base = nc || emptyNodeCanvas()
  return { ...base, connections: (base.connections || []).filter((c) => c.id !== id) }
}

// Normalize a stored node canvas (and migrate absent → empty). Drops connections
// that reference missing nodes; clamps zoom to a sane range. UNKNOWN node types
// are preserved as-is (id/position/data kept) so a newer snapshot loaded into an
// older build never silently loses nodes — they render as inert generic nodes.
export function normalizeNodeCanvas(nc) {
  const c = nc || {}
  const nodes = Array.isArray(c.nodes)
    ? c.nodes.map((n) => {
        const known = !!NODE_DEFS[n && n.type]
        const t = known ? n.type : String((n && n.type) || 'unknown')
        const def = known ? NODE_DEFS[t] : null
        const data = { ...(def && def.defaultData ? def.defaultData() : {}), ...((n && n.data) || {}) }
        // Never persist large inline previews — previews are session-only; local_url persists.
        if ('data_url' in data) delete data.data_url
        // Generator/upscale lifecycle status is strictly the enum; legacy free-text
        // values (old dormant-stub messages) migrate to idle.
        if (known && 'status' in (def.defaultData ? def.defaultData() : {}) && GEN_STATUSES.includes((def.defaultData ? def.defaultData() : {}).status)) {
          if (!GEN_STATUSES.includes(data.status)) data.status = 'idle'
          // A reload can never resume an in-flight generation.
          if (data.status === 'queued' || data.status === 'generating') data.status = 'idle'
        }
        return {
          id: (n && n.id) || uid(),
          type: t,
          x: Number.isFinite(Number(n && n.x)) ? Number(n.x) : 0,
          y: Number.isFinite(Number(n && n.y)) ? Number(n.y) : 0,
          width: Number.isFinite(Number(n && n.width)) ? Number(n.width) : 280,
          data
        }
      })
    : []
  const ids = new Set(nodes.map((n) => n.id))
  const connections = Array.isArray(c.connections)
    ? c.connections
        .filter((x) => x && ids.has(x.from_node) && ids.has(x.to_node) && x.from_socket && x.to_socket)
        .map((x) => ({ id: x.id || uid(), from_node: x.from_node, from_socket: x.from_socket, to_node: x.to_node, to_socket: x.to_socket }))
    : []
  const zoom = Number(c.zoom)
  return {
    name: String(c.name || '').trim() || 'Untitled Canvas',
    nodes,
    connections,
    pan_x: Number.isFinite(Number(c.pan_x)) ? Number(c.pan_x) : 0,
    pan_y: Number.isFinite(Number(c.pan_y)) ? Number(c.pan_y) : 0,
    zoom: Number.isFinite(zoom) && zoom > 0 ? Math.min(3, Math.max(0.2, zoom)) : 1
  }
}

// Topological order of node ids (upstream first) for Run All. Kahn's algorithm
// over the connection graph; nodes in cycles (shouldn't happen with one-wire-per-
// input, but be safe) are appended last in stored order.
export function topologicalNodeOrder(nc) {
  const base = nc || emptyNodeCanvas()
  const nodes = base.nodes || []
  const conns = base.connections || []
  const indegree = new Map(nodes.map((n) => [n.id, 0]))
  const out = new Map(nodes.map((n) => [n.id, []]))
  for (const c of conns) {
    if (!indegree.has(c.from_node) || !indegree.has(c.to_node)) continue
    indegree.set(c.to_node, indegree.get(c.to_node) + 1)
    out.get(c.from_node).push(c.to_node)
  }
  const queue = nodes.filter((n) => indegree.get(n.id) === 0).map((n) => n.id)
  const order = []
  const seen = new Set()
  while (queue.length) {
    const id = queue.shift()
    if (seen.has(id)) continue
    seen.add(id)
    order.push(id)
    for (const next of out.get(id) || []) {
      indegree.set(next, indegree.get(next) - 1)
      if (indegree.get(next) <= 0) queue.push(next)
    }
  }
  for (const n of nodes) if (!seen.has(n.id)) order.push(n.id)
  return order
}

// Text reaching a generator's prompt input: a wired Prompt node's text wins,
// else the node's own user_prompt.
export function effectivePromptText(nc, nodeId) {
  const base = nc || emptyNodeCanvas()
  const node = (base.nodes || []).find((n) => n.id === nodeId)
  if (!node) return ''
  const wire = (base.connections || []).find((c) => c.to_node === nodeId && c.to_socket === 'prompt')
  if (wire) {
    const src = (base.nodes || []).find((n) => n.id === wire.from_node)
    const t = src && src.data ? String(src.data.text || '') : ''
    if (t.trim()) return t
  }
  return String((node.data && node.data.user_prompt) || '')
}
