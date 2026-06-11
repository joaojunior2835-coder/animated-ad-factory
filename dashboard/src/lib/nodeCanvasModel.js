// Pure model for the Production Node Canvas (a freeform node graph). DOM/drag logic
// lives in the component; all graph mutations are pure functions here. No API calls,
// no generation, no media — this is graph state only.

import { uid } from './brandDocs.js'

export const NODE_TYPES = ['prompt', 'upload', 'asset', 'image_generator', 'video_generator']
export const VIDEO_MODELS = ['Seedance 2.0', 'Kling 3.0', 'Veo 3.1', 'Wan 2.7', 'Sora 2']
export const RESOLUTIONS = ['720p', '1080p']
export const ASPECT_RATIOS = ['9:16', '16:9', '1:1', '4:5']
export const IMAGE_MODELS = ['Nano Banana Pro', 'Soul 2.0', 'GPT Image 2.0', 'Seedream 5.0', 'Flux 2']
export const IMAGE_RESOLUTIONS = ['1K', '2K', '4K']
export const IMAGE_ASPECT_RATIOS = ['1:1', '3:4', '4:3', '16:9', '9:16']

// Node type definitions: typed input/output sockets + default inert data.
export const NODE_DEFS = {
  prompt: {
    title: 'Prompt',
    inputs: [],
    outputs: [{ name: 'prompt', label: 'Prompt', type: 'text' }],
    defaultData: () => ({ text: '' })
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
      { name: 'reference_image_3', label: 'Reference Image 3', type: 'image' }
    ],
    outputs: [{ name: 'image', label: 'Image', type: 'image' }],
    defaultData: () => ({
      user_prompt: '',
      model: IMAGE_MODELS[0],
      aspect_ratio: '1:1',
      resolution: '2K',
      count: 1,
      seed: '',
      status: ''
    })
  },
  video_generator: {
    title: 'Video Generator',
    inputs: [
      { name: 'prompt', label: 'Prompt', type: 'text' },
      { name: 'reference_image', label: 'Reference Image', type: 'image' },
      { name: 'reference_video', label: 'Reference Video', type: 'video' },
      { name: 'start_frame', label: 'Start Frame', type: 'image' },
      { name: 'end_frame', label: 'End Frame', type: 'image' }
    ],
    outputs: [{ name: 'video', label: 'Video', type: 'video' }],
    defaultData: () => ({
      user_prompt: '',
      model: VIDEO_MODELS[0],
      duration_seconds: 5,
      resolution: '1080p',
      aspect_ratio: '9:16',
      generate_audio: false,
      status: ''
    })
  }
}

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
  return { nodes: [], connections: [], pan_x: 0, pan_y: 0, zoom: 1 }
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
// that reference missing nodes; clamps zoom to a sane range.
export function normalizeNodeCanvas(nc) {
  const c = nc || {}
  const nodes = Array.isArray(c.nodes)
    ? c.nodes.map((n) => {
        const t = NODE_DEFS[n && n.type] ? n.type : 'video_generator'
        const def = NODE_DEFS[t]
        const data = { ...(def.defaultData ? def.defaultData() : {}), ...((n && n.data) || {}) }
        // Never persist large inline previews — previews are session-only; local_url persists.
        if ('data_url' in data) delete data.data_url
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
    nodes,
    connections,
    pan_x: Number.isFinite(Number(c.pan_x)) ? Number(c.pan_x) : 0,
    pan_y: Number.isFinite(Number(c.pan_y)) ? Number(c.pan_y) : 0,
    zoom: Number.isFinite(zoom) && zoom > 0 ? Math.min(2.5, Math.max(0.25, zoom)) : 1
  }
}
