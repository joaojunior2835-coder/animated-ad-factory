import { canonicalCanvasValue, canvasInputConfig, canvasUpstreamClosure, canvasNodeFingerprint, nodeAssetId } from './nodeCanvasExecution.js'
import { GENERATOR_TYPES, propagateResultToOutputs } from './nodeCanvasModel.js'

// Input-only signature: arriving outputs never make their own frozen draft stale.
export function canvasDraftSignature(canvas,nodeId){
  const closure=new Set(canvasUpstreamClosure(canvas,[nodeId]).nodeIds)
  return canonicalCanvasValue({nodes:(canvas.nodes||[]).filter(n=>closure.has(n.id)).map(n=>({id:n.id,config:canvasInputConfig(n)})),connections:(canvas.connections||[]).filter(c=>closure.has(c.to_node)).map(({from_node,from_socket,to_node,to_socket})=>({from_node,from_socket,to_node,to_socket}))})
}

// Compare consumed media, not this generator's own arriving output. A generated
// dependency is resolved to its actual Job Asset by the server before this check.
export function canvasProductionInputsMatch(canvas, item) {
  if (canvasDraftSignature(canvas, item.nodeId) !== item.draftSignature || item.inputVersionsValid === false) return false
  const incoming = (canvas.connections || []).filter(w => w.to_node === item.nodeId && w.to_socket !== 'prompt')
  if (!Array.isArray(item.inputBindings)) return incoming.length === 0
  if (incoming.length !== item.inputBindings.length) return false
  return item.inputBindings.every(binding => {
    const source = canvas.nodes.find(n => n.id === binding.nodeId)
    return binding.assetId && nodeAssetId(source) === binding.assetId
      && incoming.some(w => w.from_node === binding.nodeId && w.to_socket === binding.input && w.from_socket === binding.output)
      && !(GENERATOR_TYPES.includes(source?.type) && source.data?.stale)
  })
}

const mediaUrl = asset => asset.relative_path === 'mock-video-output.mp4' ? '/mock-video-output.mp4' : `/media/${asset.relative_path}`

// Shared by browser polling and the authoritative server compiler. Recovering
// completed Jobs must not depend on the browser having persisted a status poll.
export function mergeCanvasProduction(canvas, status) {
  const items = new Map((status.nodes || []).map(item => [item.nodeId, item]))
  let next = {...canvas, nodes: (canvas.nodes || []).map(n => ({...n, data: {...n.data}}))}
  const order = canvasUpstreamClosure(next, [...items.keys()]).nodeIds
  for (const id of order) {
    const item = items.get(id), node = next.nodes.find(n => n.id === id)
    if (!item || !node) continue
    const history = item.history || [item]
    const active = ['queued', 'generating', 'downloading', 'reconciliation_required'].includes(item.status)
    const reusable = [...history].reverse().find(record => record.status === 'done' && record.assets?.length && record.outputMediaValid !== false && canvasProductionInputsMatch(next, record))
    const effective = !active && reusable ? reusable : item
    const completed = reusable || [...history].reverse().find(record => record.status === 'done' && record.assets?.length)
    const assets = [...(completed?.assets || [])].sort((a, b) => a.job_id - b.job_id || a.id - b.id)
    const asset = assets.find(a => a.id === node.data.result_asset_id) || assets[0]
    const current = !active && Boolean(reusable)
    const fields = {status: effective.status, run_id: effective.runId, job_ids: effective.jobIds, reconciliation_required: effective.status === 'reconciliation_required', status_message: effective.error || '', stale: !current}
    if (asset) Object.assign(fields, {result_asset_id: asset.id, result_local_url: mediaUrl(asset), result_mime_type: asset.mime_type, result_saved: true,
      generated_fingerprint: current ? canvasNodeFingerprint(next, id) : (completed?.fingerprint || node.data.generated_fingerprint)})
    next.nodes = next.nodes.map(n => n.id === id ? {...n, data: {...n.data, ...fields}} : n)
    for (const record of history) {
      // A result belongs to its frozen output targets, not sinks added/rewired
      // while it was running. Keep existing variations and explicit selections.
      const targets = new Set(record.outputNodeIds || [])
      if (!targets.size) continue
      const connections = next.connections
      for (const output of record.assets || []) {
        next = propagateResultToOutputs({...next, connections: connections.filter(w => w.from_node === id && targets.has(w.to_node))}, id, {
          asset_id: output.id, local_url: mediaUrl(output), media_type: output.mime_type.startsWith('video/') ? 'video' : 'image', run_id: record.runId,
        })
      }
      next = {...next, connections}
    }
  }
  return next
}
