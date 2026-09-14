// Pure Canvas regressions. No database, provider credentials or network access.
import assert from 'node:assert/strict'
import { addConnection, addNode, addStarterGraph, duplicateNodes, emptyNodeCanvas, moveNode, newNode, normalizeNodeCanvas, propagateResultToOutputs, removeNode, restoreCanvasGraph, updateNodeData } from '../src/lib/nodeCanvasModel.js'
import { canvasNodeFingerprint, canvasUpstreamClosure, compileCanvasExecution } from '../src/lib/nodeCanvasExecution.js'

const capabilities = [
  { id: 'mock-image', provider: 'mock', model: 'mock-image', label: 'Mock image', capability: 'generate_image', modes: ['text-to-image'], aspects: ['1:1', '9:16'], imageSizes: [{ id: 'square', width: 1024, height: 1024 }, { id: 'portrait', width: 576, height: 1024 }], quantity: { min: 1, max: 4 }, configured: true, priced: true, references: {} },
  { id: 'mock-video', provider: 'mock', model: 'mock-video', label: 'Mock video', capability: 'generate_video', modes: ['text-to-video', 'image-to-video', 'reference-to-video'], aspects: ['9:16', '16:9', '1:1'], resolutions: ['480p', '720p'], durations: [4, 5, 6], quantity: { min: 1, max: 4 }, configured: true, priced: true, audio: true }
]
let checks = 0
function test(name, check) { check(); checks++; console.log(`PASS ${name}`) }
function fixture() {
  const prompt = newNode('prompt', 0, 0), image = newNode('image_generator', 340, 0), video = newNode('video_generator', 680, 0), output = newNode('output', 1020, 0), unrelated = newNode('video_generator', 0, 600)
  prompt.data.text = 'A factual product close-up'
  image.data.image_size = 'square'
  video.data.resolution = '480p'; video.data.user_prompt = 'Gentle camera movement'
  let canvas = [prompt, image, video, output, unrelated].reduce(addNode, emptyNodeCanvas())
  for (const [from, fromSocket, to, toSocket] of [[prompt, 'prompt', image, 'prompt'], [image, 'image', video, 'start_frame'], [video, 'video', output, 'video']]) canvas = addConnection(canvas, { from_node: from.id, from_socket: fromSocket, to_node: to.id, to_socket: toSocket })
  return { canvas, prompt, image, video, output, unrelated }
}

test('cycle rejection preserves existing graph', () => {
  const a = newNode('video_generator', 0, 0), b = newNode('video_generator', 400, 0)
  let canvas = addNode(addNode(emptyNodeCanvas(), a), b)
  canvas = addConnection(canvas, { from_node: a.id, from_socket: 'video', to_node: b.id, to_socket: 'reference_video' })
  assert.equal(addConnection(canvas, { from_node: b.id, from_socket: 'video', to_node: a.id, to_socket: 'reference_video' }), canvas)
})
test('selected output closure excludes unrelated nodes and orders dependencies', () => {
  const { canvas, prompt, image, video, output, unrelated } = fixture()
  assert.deepEqual(canvasUpstreamClosure(canvas, [output.id]).nodeIds, [prompt.id, image.id, video.id, output.id])
  const compiled = compileCanvasExecution(canvas, { nodeIds: [output.id], capabilities })
  assert.deepEqual(compiled.blockers, [])
  assert.deepEqual(compiled.steps.map((step) => step.nodeId), [image.id, video.id])
  assert.equal(compiled.steps[1].dependencies[0].nodeId, image.id)
  assert.equal(compiled.steps[1].dependencies[0].outputIndex, 0)
  assert.equal(compiled.outputCount, 2)
  assert.ok(!compiled.closureNodeIds.includes(unrelated.id))
})
test('legacy cyclic snapshots are preserved but never executable', () => {
  const a = newNode('video_generator', 0, 0), b = newNode('video_generator', 340, 0)
  const canvas = normalizeNodeCanvas({ nodes: [a, b], connections: [{ id: 'a', from_node: a.id, from_socket: 'video', to_node: b.id, to_socket: 'reference_video' }, { id: 'b', from_node: b.id, from_socket: 'video', to_node: a.id, to_socket: 'reference_video' }] })
  assert.equal(canvas.connections.length, 2)
  assert.ok(compileCanvasExecution(canvas, { nodeIds: [a.id], capabilities }).blockers.some((block) => block.code === 'cycle'))
})
test('upstream editing marks descendants stale without deleting outputs or approvals', () => {
  const { canvas, prompt, image, video } = fixture()
  let done = updateNodeData(canvas, image.id, { status: 'done', result_asset_id: 91, result_local_url: '/media/start.png', stale: false })
  done = updateNodeData(done, video.id, { status: 'done', result_asset_id: 92, approved: true, stale: false })
  const edited = updateNodeData(done, prompt.id, { text: 'A different factual angle' })
  for (const id of [image.id, video.id]) assert.equal(edited.nodes.find((node) => node.id === id).data.stale, true)
  assert.equal(edited.nodes.find((node) => node.id === image.id).data.result_asset_id, 91)
  assert.equal(edited.nodes.find((node) => node.id === video.id).data.approved, true)
})
test('moving and renaming do not invalidate generated content', () => {
  const { canvas, image } = fixture()
  const done = updateNodeData(canvas, image.id, { stale: false, result_asset_id: 99, status: 'done' })
  const fingerprint = canvasNodeFingerprint(done, image.id)
  const moved = updateNodeData(moveNode(done, image.id, 870, 160), image.id, { label: 'Renamed' })
  assert.equal(moved.nodes.find((node) => node.id === image.id).data.stale, false)
  assert.equal(canvasNodeFingerprint(moved, image.id), fingerprint)
})
test('completed upstream output is reused and bound to its stable Asset ID', () => {
  const { canvas, image, video } = fixture()
  const done = updateNodeData(canvas, image.id, { stale: false, result_asset_id: 123, status: 'done' })
  const compiled = compileCanvasExecution(done, { nodeIds: [video.id], capabilities })
  assert.deepEqual(compiled.steps.map((step) => step.nodeId), [video.id])
  assert.equal(compiled.steps[0].dependencies[0].assetId, 123)
})
test('duplicate copies internal wires and source references but no paid outputs', () => {
  const { canvas, prompt, image } = fixture()
  const done = updateNodeData(canvas, image.id, { result_asset_id: 12, result_local_url: '/media/output.png', run_id: 42 })
  const copied = duplicateNodes(done, [prompt.id, image.id])
  assert.equal(copied.nodeIds.length, 2)
  const duplicate = copied.canvas.nodes.find((node) => node.id === copied.nodeIds[1])
  assert.equal(duplicate.data.result_asset_id, undefined)
  assert.equal(duplicate.data.run_id, undefined)
  assert.equal(duplicate.data.result_local_url, '')
  assert.equal(copied.canvas.connections.filter((wire) => copied.nodeIds.includes(wire.from_node) && copied.nodeIds.includes(wire.to_node)).length, 1)
})
test('undo preserves results arriving after snapshot and execution metadata', () => {
  const { canvas, image } = fixture()
  const snapshot = moveNode(canvas, image.id, 20, 30)
  const current = { ...updateNodeData(canvas, image.id, { result_asset_id: 77, result_local_url: '/media/result.png', run_id: 7, status: 'done' }), execution_context: { creativeId: 10 }, execution_runs: [{ id: 7 }] }
  const undone = restoreCanvasGraph(current, snapshot)
  const restored = undone.nodes.find((node) => node.id === image.id)
  assert.equal(restored.x, 20); assert.equal(restored.data.result_asset_id, 77); assert.equal(restored.data.run_id, 7)
  assert.deepEqual(undone.execution_runs, [{ id: 7 }])
  assert.deepEqual(undone.execution_context, { creativeId: 10 })
})
test('delete and undo retain generated media history without file deletion', () => {
  const { canvas, image } = fixture()
  const current = updateNodeData(canvas, image.id, { result_asset_id: 88, run_id: 8, status: 'done' })
  const deleted = removeNode(current, image.id)
  assert.equal(deleted.detached_outputs.find((node) => node.id === image.id).data.result_asset_id, 88)
  const restored = restoreCanvasGraph(deleted, canvas)
  assert.equal(restored.nodes.find((node) => node.id === image.id).data.result_asset_id, 88)
  assert.equal(restored.detached_outputs.length, 0)
})
test('stable Asset propagation is idempotent and preserves selected output', () => {
  const { canvas, video, output } = fixture()
  let result = propagateResultToOutputs(canvas, video.id, { asset_id: 100, local_url: '/media/a.mp4', media_type: 'video' })
  result = propagateResultToOutputs(result, video.id, { asset_id: 100, local_url: '/media/a.mp4', media_type: 'video' })
  result = propagateResultToOutputs(result, video.id, { asset_id: 101, local_url: '/media/b.mp4', media_type: 'video' })
  const data = result.nodes.find((node) => node.id === output.id).data
  assert.equal(data.variations.length, 2); assert.equal(data.selected_asset_id, 100); assert.equal(data.selected_variation_id, 'asset-100')
})
test('persistent normalization retains production associations and old QA status behavior', () => {
  const { canvas, image, video } = fixture()
  let running = updateNodeData(canvas, image.id, { status: 'generating', run_id: 30 })
  running = updateNodeData(running, video.id, { status: 'generating' })
  const result = normalizeNodeCanvas({ ...running, execution_context: { creativeId: 10 }, zoom: 1.4, pan_x: 23, pan_y: 45 })
  assert.equal(result.nodes.find((node) => node.id === image.id).data.status, 'generating')
  assert.equal(result.nodes.find((node) => node.id === video.id).data.status, 'idle')
  assert.equal(result.execution_context.creativeId, 10)
  assert.deepEqual([result.zoom, result.pan_x, result.pan_y], [1.4, 23, 45])
})
test('exact compilation signature is immutable and changes when inputs change', () => {
  const { canvas, image, prompt } = fixture()
  const first = compileCanvasExecution(canvas, { nodeIds: [image.id], capabilities })
  const original = first.graphSignature
  const changed = compileCanvasExecution(updateNodeData(canvas, prompt.id, { text: 'A new prompt' }), { nodeIds: [image.id], capabilities })
  assert.equal(first.graphSignature, original)
  assert.notEqual(changed.graphSignature, original)
  assert.notEqual(changed.graphFingerprint, first.graphFingerprint)
})
test('unsupported settings, unknown model and reference-conditioned text-only image are blocked', () => {
  const { canvas, image, video } = fixture()
  const invalid = updateNodeData(canvas, video.id, { resolution: '1080p', duration_seconds: 99, count: 5 })
  const codes = compileCanvasExecution(invalid, { nodeIds: [video.id], capabilities }).blockers.map((block) => block.code)
  assert.ok(codes.includes('resolution_invalid')); assert.ok(codes.includes('duration_invalid')); assert.ok(codes.includes('quantity_invalid'))
  assert.ok(compileCanvasExecution(updateNodeData(canvas, image.id, { model_id: 'fictional' }), { nodeIds: [image.id], capabilities }).blockers.some((block) => block.code === 'model_unavailable'))
  const reference = newNode('reference', -300, 0); reference.data.asset_id = 5
  const conditioned = addConnection(addNode(canvas, reference), { from_node: reference.id, from_socket: 'image', to_node: image.id, to_socket: 'reference_image_1' })
  assert.ok(compileCanvasExecution(conditioned, { nodeIds: [image.id], capabilities }).blockers.some((block) => block.code === 'references_unsupported'))
})
test('unconnected Output and missing media input give actionable blockers', () => {
  const output = newNode('output', 0, 0)
  assert.ok(compileCanvasExecution(addNode(emptyNodeCanvas(), output), { nodeIds: [output.id], capabilities }).blockers.some((block) => block.code === 'output_disconnected'))
  const { canvas, image } = fixture(), reference = newNode('reference', -340, 0)
  const graph = addConnection(addNode(canvas, reference), { from_node: reference.id, from_socket: 'image', to_node: image.id, to_socket: 'reference_image_1' })
  assert.ok(compileCanvasExecution(graph, { nodeIds: [image.id], capabilities }).blockers.some((block) => block.code === 'input_missing'))
})
test('quantity counts authorized outputs and aspect/size mismatches are rejected', () => {
  const { canvas, image } = fixture()
  assert.equal(compileCanvasExecution(updateNodeData(canvas, image.id, { count: 4 }), { nodeIds: [image.id], capabilities }).outputCount, 4)
  assert.ok(compileCanvasExecution(updateNodeData(canvas, image.id, { aspect_ratio: '9:16', image_size: 'square' }), { nodeIds: [image.id], capabilities }).blockers.some((block) => block.code === 'image_shape_mismatch'))
})
test('starter graphs append inert drafts and preserve existing graph/media', () => {
  const { canvas, image } = fixture()
  const existing = updateNodeData(canvas, image.id, { result_asset_id: 123 })
  for (const template of ['image-video', 'remix', 'scenes']) {
    const result = addStarterGraph(existing, template)
    assert.ok(result.nodeIds.length >= 4)
    assert.equal(result.canvas.nodes.find((node) => node.id === image.id).data.result_asset_id, 123)
    assert.ok(result.canvas.nodes.filter((node) => result.nodeIds.includes(node.id)).every((node) => !node.data.run_id))
    assert.deepEqual(canvasUpstreamClosure(result.canvas, result.nodeIds).cycles, [])
  }
})
test('unsupported image-to-video ports cannot be silently ignored', () => {
  const { canvas, video } = fixture(), frame = newNode('reference', -300, 0)
  frame.data.asset_id = 81
  for (const port of ['end_frame', 'character_ref', 'style_ref']) {
    const graph = addConnection(addNode(canvas, frame), { from_node: frame.id, from_socket: 'image', to_node: video.id, to_socket: port })
    assert.ok(compileCanvasExecution(graph, { nodeIds: [video.id], capabilities }).blockers.some((block) => block.code === 'video_inputs_unsupported'))
  }
})
test('choosing another generated Asset invalidates descendants without rerunning its source', () => {
  const { canvas, image, video } = fixture()
  let done = updateNodeData(canvas, image.id, { result_asset_id: 81, stale: false, status: 'done' })
  done = updateNodeData(done, video.id, { result_asset_id: 82, stale: false, status: 'done' })
  const selected = updateNodeData(done, image.id, { selected_asset_id: 83 })
  assert.equal(selected.nodes.find((node) => node.id === image.id).data.stale, false)
  assert.equal(selected.nodes.find((node) => node.id === video.id).data.stale, true)
})
test('duplicate IDs and unsupported prompt-image analysis are rejected', () => {
  const { canvas, prompt, image } = fixture(), reference = newNode('reference', -300, 0)
  reference.data.asset_id = 90
  const graph = addConnection(addNode(canvas, reference), { from_node: reference.id, from_socket: 'image', to_node: prompt.id, to_socket: 'reference' })
  assert.ok(compileCanvasExecution(graph, { nodeIds: [image.id], capabilities }).blockers.some((block) => block.code === 'prompt_reference_unsupported'))
  assert.ok(compileCanvasExecution({ ...canvas, nodes: [...canvas.nodes, image] }, { nodeIds: [image.id], capabilities }).blockers.some((block) => block.code === 'duplicate_node_id'))
})
console.log(`Canvas model/execution regressions: ${checks}/${checks}`)
