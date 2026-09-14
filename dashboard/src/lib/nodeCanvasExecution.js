// Shared, side-effect-free Canvas compilation. The backend must resolve local
// Asset IDs, validate capabilities/prices, freeze this scope and dispatch via M5.
// Nothing in this module requests media, reserves money or changes a graph.
import { NODE_DEFS, GENERATOR_TYPES, effectivePromptText, socketType } from './nodeCanvasModel.js'

export function canonicalCanvasValue(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalCanvasValue).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.keys(value).filter((key) => value[key] !== undefined).sort().map((key) => `${JSON.stringify(key)}:${canonicalCanvasValue(value[key])}`).join(',')}}`
  return JSON.stringify(value ?? null)
}

// Compact change indicator, not an authorization/security token. The server has
// the exact canonical graphSignature as well for frozen-plan comparisons.
function fingerprint(value) {
  const text = canonicalCanvasValue(value)
  let a = 2166136261, b = 2246822507
  for (let i = 0; i < text.length; i++) { a = Math.imul(a ^ text.charCodeAt(i), 16777619); b = Math.imul(b ^ text.charCodeAt(i), 3266489909) }
  return `nc1-${(a >>> 0).toString(16)}${(b >>> 0).toString(16)}`
}

export function canvasInputConfig(node) {
  const d = node?.data || {}
  const keys = ['text', 'user_prompt', 'model_id', 'mode', 'aspect_ratio', 'resolution', 'image_size', 'count', 'quantity', 'seed', 'duration_seconds', 'generate_audio', 'asset_id', 'local_url', 'file_url', 'ref_image_url', 'ref_type', 'media_type', 'frame_prompt', 'character_name', 'description', 'style_description', 'locked', 'scale_factor']
  return { type: node?.type, ...Object.fromEntries(keys.filter((key) => d[key] !== undefined).map((key) => [key, d[key]])) }
}

export function nodeAssetId(node) {
  const d = node?.data || {}
  const value = d.selected_asset_id || d.result_asset_id || d.asset_id
  return Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : null
}

export function nodeHasMedia(node) {
  const d = node?.data || {}
  return Boolean(nodeAssetId(node) || d.result_local_url || d.result_external_url || d.local_url || d.file_url || d.ref_image_url || d.output_image_url || d.final_local_path || d.final_media_url)
}

export function canvasNodeFingerprint(canvas, nodeId) {
  const byId = new Map((canvas?.nodes || []).map((node) => [node.id, node])), memo = new Map()
  function visit(id, path = new Set()) {
    if (memo.has(id)) return memo.get(id)
    if (path.has(id)) return { cycle: id }
    const node = byId.get(id)
    if (!node) return { missing: id }
    const next = new Set(path); next.add(id)
    const inputs = (canvas.connections || []).filter((wire) => wire.to_node === id).sort((a, b) => a.to_socket.localeCompare(b.to_socket)).map((wire) => ({ input: wire.to_socket, output: wire.from_socket, nodeId: wire.from_node, assetId: nodeAssetId(byId.get(wire.from_node)), source: visit(wire.from_node, next) }))
    const result = { config: canvasInputConfig(node), inputs }
    memo.set(id, result); return result
  }
  return fingerprint(visit(nodeId))
}

export function canvasUpstreamClosure(canvas, roots) {
  const byId = new Map((canvas?.nodes || []).map((node) => [node.id, node])), visited = new Set(), active = new Set(), order = [], cycles = []
  function visit(id) {
    if (active.has(id)) { cycles.push(id); return }
    if (visited.has(id) || !byId.has(id)) return
    active.add(id)
    for (const wire of canvas.connections || []) if (wire.to_node === id) visit(wire.from_node)
    active.delete(id); visited.add(id); order.push(id)
  }
  for (const id of roots || []) visit(id)
  return { nodeIds: order, cycles: [...new Set(cycles)], missing: (roots || []).filter((id) => !byId.has(id)) }
}

export function compileCanvasExecution(canvas, { nodeIds = [], scope = 'node', capabilities = [], forceNodeIds = [] } = {}) {
  const nodes = canvas?.nodes || [], wires = canvas?.connections || [], byId = new Map(nodes.map((node) => [node.id, node]))
  const roots = scope === 'workflow' && !nodeIds.length ? nodes.filter((node) => GENERATOR_TYPES.includes(node.type) || node.type === 'output').map((node) => node.id) : [...new Set(nodeIds)]
  const closure = canvasUpstreamClosure(canvas, roots), inScope = new Set(closure.nodeIds), force = new Set(forceNodeIds)
  const blockers = [], steps = [], planned = new Set()
  const block = (nodeId, code, message) => blockers.push({ nodeId, code, message })
  if (!['node', 'selection', 'workflow'].includes(scope)) block(null, 'scope_invalid', 'Choose Run Node, Run selection, or Run Workflow.')
  if (new Set(nodes.map((node) => node.id)).size !== nodes.length) block(null, 'duplicate_node_id', 'The imported graph contains duplicate node IDs. Restore a valid snapshot before running.')
  for (const id of closure.missing) block(id, 'node_missing', 'A selected node no longer exists.')
  for (const id of closure.cycles) block(id, 'cycle', 'Disconnect the circular path before running.')
  if (!roots.length) block(null, 'empty_scope', 'Add a generator or choose a node to run.')
  for (const wire of wires.filter((c) => inScope.has(c.to_node))) {
    const from = byId.get(wire.from_node), to = byId.get(wire.to_node)
    if (!from || !to || !socketType(from.type, 'output', wire.from_socket) || socketType(from.type, 'output', wire.from_socket) !== socketType(to.type, 'input', wire.to_socket)) block(wire.to_node, 'invalid_connection', 'This path has an incompatible or missing input connection.')
  }
  for (const id of closure.nodeIds) {
    const node = byId.get(id), d = node.data || {}, currentFingerprint = canvasNodeFingerprint(canvas, id)
    if (!NODE_DEFS[node.type]) { block(id, 'unsupported_node', `The ${node.type} node is preserved but cannot execute.`); continue }
    if (node.type === 'prompt' && wires.some((wire) => wire.to_node === id && wire.to_socket === 'reference')) block(id, 'prompt_reference_unsupported', 'Prompt nodes do not analyze reference images. Describe it manually and disconnect this visual-guide wire, or connect the Asset to a supported media input.')
    if (node.type === 'output' && !wires.some((wire) => wire.to_node === id) && !nodeHasMedia(node)) block(id, 'output_disconnected', 'Connect an image or video to this Output node.')
    if (node.type === 'upscale' && !nodeHasMedia(node)) { block(id, 'unsupported_upscale', 'Upscale is not connected to a production provider.'); continue }
    if (!GENERATOR_TYPES.includes(node.type)) continue
    const upstreamWillRun = wires.some((wire) => wire.to_node === id && planned.has(wire.from_node))
    const stale = d.stale === true || Boolean(d.generated_fingerprint && d.generated_fingerprint !== currentFingerprint)
    if (nodeHasMedia(node) && !stale && !upstreamWillRun && !force.has(id)) continue
    if (['queued', 'generating', 'downloading', 'reconciliation_required'].includes(d.status) || d.reconciliation_required) { block(id, 'existing_execution', 'An existing request is still active or requires reconciliation.'); continue }
    const capability = node.type === 'image_generator' ? 'generate_image' : 'generate_video'
    const model = capabilities.find((entry) => entry.id === d.model_id && entry.capability === capability)
    if (!model || !model.configured || !model.priced) { block(id, 'model_unavailable', 'Choose a configured, priced model from the shared model picker.'); continue }
    const prompt = effectivePromptText(canvas, id).trim()
    if (!prompt) block(id, 'prompt_missing', 'Type a prompt or connect a Prompt node.')
    const quantity = Number(d.count ?? d.quantity ?? 1)
    if (!Number.isInteger(quantity) || quantity < (model.quantity?.min || 1) || quantity > (model.quantity?.max || 1)) block(id, 'quantity_invalid', 'Choose a supported output count.')
    const inputs = wires.filter((wire) => wire.to_node === id && socketType(node.type, 'input', wire.to_socket) !== 'text')
    const dependencies = inputs.map((wire) => {
      const source = byId.get(wire.from_node)
      if (!planned.has(wire.from_node) && !nodeHasMedia(source)) block(id, 'input_missing', `${NODE_DEFS[source?.type]?.title || 'Connected'} input has no saved media.`)
      const actualType = source?.data?.mime_type?.split('/')[0] || (source?.type === 'reference' ? source.data?.media_type : null)
      const expectedType = socketType(node.type, 'input', wire.to_socket)
      if (actualType && actualType !== expectedType) block(id, 'input_type_mismatch', `The ${wire.to_socket.replaceAll('_', ' ')} connection needs ${expectedType} media.`)
      return { nodeId: wire.from_node, input: wire.to_socket, output: wire.from_socket, assetId: planned.has(wire.from_node) ? null : nodeAssetId(source), outputIndex: 0 }
    })
    const mode = d.mode || (capability === 'generate_image' ? 'text-to-image' : inputs.some((wire) => wire.to_socket === 'reference_video') ? 'reference-to-video' : inputs.length ? 'image-to-video' : 'text-to-video')
    if (!model.modes?.includes(mode)) block(id, 'mode_invalid', 'This model does not support the connected input mode.')
    if (capability === 'generate_video' && mode !== 'reference-to-video') {
      if (inputs.some((wire) => !['start_frame', 'reference_image'].includes(wire.to_socket)) || inputs.length > 1) block(id, 'video_inputs_unsupported', 'Image-to-video supports one start frame. End frames, character/style references and multiple images need a documented reference mode.')
      if (mode === 'text-to-video' && inputs.length) block(id, 'video_mode_inputs', 'Switch to image-to-video to use the connected start frame.')
    }
    if (capability === 'generate_video' && mode === 'image-to-video' && !inputs.length) block(id, 'start_frame_missing', 'Connect a saved start frame or an image generation node.')
    if (capability === 'generate_video' && mode === 'reference-to-video') {
      if (!inputs.some((wire) => wire.to_socket === 'reference_video')) block(id, 'reference_video_missing', 'Reference mode needs one saved reference video.')
      for (const mediaType of ['image', 'video']) {
        const count = inputs.filter((wire) => socketType(node.type, 'input', wire.to_socket) === mediaType).length
        const maximum = model.references?.[mediaType] ?? (mediaType === 'video' ? 1 : 9)
        if (count > maximum) block(id, 'reference_limit', `This model accepts up to ${maximum} ${mediaType} reference(s).`)
      }
    }
    if (capability === 'generate_image' && inputs.length && !model.references?.images && !model.references?.image) block(id, 'references_unsupported', 'This image model cannot use product/reference images. Disconnect them or choose a supported model.')
    const params = { mode, quantity, aspect_ratio: d.aspect_ratio, ...(d.seed !== '' && d.seed != null ? { seed: Number(d.seed) } : {}) }
    if (capability === 'generate_image') {
      const size = model.imageSizes?.find((value) => value.id === d.image_size)
      if (model.imageSizes?.length && !size) block(id, 'image_size_invalid', 'Choose a supported image size.')
      if (size) { params.image_size = size.id; params.width = size.width; params.height = size.height }
      if (size && d.aspect_ratio) {
        const [width, height] = d.aspect_ratio.split(':').map(Number)
        if (width && height && Math.abs(size.width / size.height - width / height) > 0.035) block(id, 'image_shape_mismatch', 'The selected image size and aspect ratio describe different shapes.')
      }
    } else {
      params.seconds = Number(d.duration_seconds); params.resolution = d.resolution; params.generate_audio = Boolean(d.generate_audio)
      if (model.durations?.length && !model.durations.includes(params.seconds)) block(id, 'duration_invalid', 'Choose a supported video duration.')
      if (model.resolutions?.length && !model.resolutions.includes(params.resolution)) block(id, 'resolution_invalid', 'Choose a supported resolution.')
      if (params.generate_audio && !model.audio) block(id, 'audio_unsupported', 'The selected model does not support generated audio.')
    }
    const aspects = mode === 'reference-to-video' && model.referenceAspects?.length ? model.referenceAspects : model.aspects
    if (aspects?.length && !aspects.includes(d.aspect_ratio)) block(id, 'aspect_invalid', 'Choose a supported aspect ratio.')
    planned.add(id)
    steps.push({ nodeId: id, capability, modelId: model.id, provider: model.provider, model: model.model, prompt, params, dependencies, fingerprint: currentFingerprint, provenance: { canvasId: canvas.id || 'default', nodeId: id, label: d.label || NODE_DEFS[node.type].title } })
  }
  const graph = { roots, nodes: closure.nodeIds.map((id) => ({ id, config: canvasInputConfig(byId.get(id)), assetId: nodeAssetId(byId.get(id)) })), connections: wires.filter((wire) => inScope.has(wire.to_node)).map(({ from_node, from_socket, to_node, to_socket }) => ({ from_node, from_socket, to_node, to_socket })) }
  return { scope, nodeIds: roots, closureNodeIds: closure.nodeIds, steps, blockers, outputCount: steps.reduce((total, step) => total + (Number.isInteger(step.params.quantity) ? step.params.quantity : 0), 0), graphFingerprint: fingerprint(graph), graphSignature: canonicalCanvasValue(graph) }
}
