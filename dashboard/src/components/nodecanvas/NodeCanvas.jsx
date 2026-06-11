import { useEffect, useRef, useState } from 'react'
import {
  NODE_DEFS,
  VIDEO_MODELS,
  RESOLUTIONS,
  ASPECT_RATIOS,
  IMAGE_MODELS,
  IMAGE_RESOLUTIONS,
  IMAGE_ASPECT_RATIOS,
  newNode,
  addNode,
  moveNode,
  updateNodeData,
  removeNode,
  addConnection,
  removeConnection,
  socketType
} from '../../lib/nodeCanvasModel.js'
import { normalizeMediaResult } from '../../lib/ai/mediaResultContract.js'
import { saveMediaToLocal } from '../../lib/ai/apiClient.js'

// Read an image file client-side: data_url (session preview) + real dimensions.
function readImageFile(file) {
  return new Promise((resolve) => {
    const r = new FileReader()
    r.onload = () => {
      const dataUrl = String(r.result)
      const img = new Image()
      img.onload = () => resolve({ dataUrl, width: img.naturalWidth, height: img.naturalHeight })
      img.onerror = () => resolve({ dataUrl, width: 0, height: 0 })
      img.src = dataUrl
    }
    r.onerror = () => resolve({ dataUrl: '', width: 0, height: 0 })
    r.readAsDataURL(file)
  })
}

// Production Node Canvas — infinite pan/zoom board with draggable nodes and typed
// socket-to-socket wiring. ENGINE + the "Video Generator" node only. NO generation,
// NO API calls. Generate is a dormant stub. Graph mutations come from nodeCanvasModel.

const HEADER = 34
const SOCK_TOP = 10
const SOCK_H = 26
const ZOOM_MIN = 0.25
const ZOOM_MAX = 2.5

const socketCenter = (node, side, index) => {
  const def = NODE_DEFS[node.type] || NODE_DEFS.video_generator
  const cy = node.y + HEADER + SOCK_TOP + index * SOCK_H + SOCK_H / 2
  const cx = side === 'input' ? node.x : node.x + (node.width || 280)
  return { cx, cy, def }
}

function socketIndex(nodeType, side, name) {
  const def = NODE_DEFS[nodeType] || NODE_DEFS.video_generator
  const list = side === 'input' ? def.inputs : def.outputs
  return (list || []).findIndex((s) => s.name === name)
}

function bezier(x1, y1, x2, y2) {
  const dx = Math.max(40, Math.abs(x2 - x1) / 2)
  return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`
}

export default function NodeCanvas({ nodeCanvas, onChange, savedMedia = [] }) {
  const nc = nodeCanvas || { nodes: [], connections: [], pan_x: 0, pan_y: 0, zoom: 1 }
  // Session-only previews keyed by node id (data_url). NEVER persisted — node.data
  // keeps only local_url + metadata, so localStorage isn't bloated with base64.
  const [previews, setPreviews] = useState({})
  const [uploadBusy, setUploadBusy] = useState('')
  const wrapRef = useRef(null)
  // Local view (pan/zoom) for smooth interaction; committed to store on gesture end.
  const [view, setView] = useState({ panX: nc.pan_x || 0, panY: nc.pan_y || 0, zoom: nc.zoom || 1 })
  const [selected, setSelected] = useState(null)
  const [menu, setMenu] = useState(null) // { sx, sy, cx, cy }
  const [drag, setDrag] = useState(null) // { id, offX, offY } in canvas coords
  const [pan, setPan] = useState(null) // { startX, startY, panX, panY }
  const [wire, setWire] = useState(null) // { fromNode, fromSocket, x, y } live
  const commitTimer = useRef(null)

  // Convert a screen event to canvas coordinates (accounting for pan + zoom).
  const toCanvas = (clientX, clientY) => {
    const r = wrapRef.current.getBoundingClientRect()
    return { x: (clientX - r.left - view.panX) / view.zoom, y: (clientY - r.top - view.panY) / view.zoom }
  }

  const commitView = (next) => {
    if (commitTimer.current) clearTimeout(commitTimer.current)
    commitTimer.current = setTimeout(() => {
      onChange((c) => ({ ...c, pan_x: next.panX, pan_y: next.panY, zoom: next.zoom }))
    }, 250)
  }

  // ---- pan (drag empty space) ----
  const onCanvasMouseDown = (e) => {
    if (e.button !== 0) return
    setMenu(null)
    setSelected(null)
    setPan({ startX: e.clientX, startY: e.clientY, panX: view.panX, panY: view.panY })
  }

  // ---- global mouse move/up for pan, node drag, wiring ----
  useEffect(() => {
    function move(e) {
      if (pan) {
        setView((v) => ({ ...v, panX: pan.panX + (e.clientX - pan.startX), panY: pan.panY + (e.clientY - pan.startY) }))
      } else if (drag) {
        const p = toCanvas(e.clientX, e.clientY)
        onChange((c) => moveNode(c, drag.id, p.x - drag.offX, p.y - drag.offY))
      } else if (wire) {
        const p = toCanvas(e.clientX, e.clientY)
        setWire((w) => (w ? { ...w, x: p.x, y: p.y } : w))
      }
    }
    function up() {
      if (pan) {
        setPan(null)
        commitView(view)
      }
      if (drag) setDrag(null)
      if (wire) setWire(null) // dropped on empty space → no connection
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    return () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
  })

  // ---- zoom (wheel) around cursor ----
  const onWheel = (e) => {
    e.preventDefault()
    const r = wrapRef.current.getBoundingClientRect()
    const mx = e.clientX - r.left
    const my = e.clientY - r.top
    setView((v) => {
      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1
      const zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, v.zoom * factor))
      // keep the point under the cursor stable
      const panX = mx - ((mx - v.panX) * zoom) / v.zoom
      const panY = my - ((my - v.panY) * zoom) / v.zoom
      const next = { panX, panY, zoom }
      commitView(next)
      return next
    })
  }

  // ---- delete selected node via keyboard ----
  useEffect(() => {
    function key(e) {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return
      const tag = (document.activeElement && document.activeElement.tagName) || ''
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      if (selected) {
        onChange((c) => removeNode(c, selected))
        setSelected(null)
      }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  })

  // ---- context menu: spawn node ----
  const onContextMenu = (e) => {
    e.preventDefault()
    const r = wrapRef.current.getBoundingClientRect()
    const p = toCanvas(e.clientX, e.clientY)
    setMenu({ sx: e.clientX - r.left, sy: e.clientY - r.top, cx: p.x, cy: p.y })
  }
  const spawn = (type) => {
    const n = newNode(type, menu.cx, menu.cy)
    onChange((c) => addNode(c, n))
    setSelected(n.id)
    setMenu(null)
  }

  // ---- node drag (by header) ----
  const startNodeDrag = (e, node) => {
    e.stopPropagation()
    if (e.button !== 0) return
    const p = toCanvas(e.clientX, e.clientY)
    setSelected(node.id)
    setDrag({ id: node.id, offX: p.x - node.x, offY: p.y - node.y })
  }

  // ---- wiring ----
  const startWire = (e, node, socketName) => {
    e.stopPropagation()
    const idx = socketIndex(node.type, 'output', socketName)
    const c = socketCenter(node, 'output', idx)
    setWire({ fromNode: node.id, fromSocket: socketName, x: c.cx, y: c.cy })
  }
  const endWire = (e, node, socketName) => {
    e.stopPropagation()
    if (!wire) return
    onChange((c) => addConnection(c, { from_node: wire.fromNode, from_socket: wire.fromSocket, to_node: node.id, to_socket: socketName }))
    setWire(null)
  }

  const setData = (id, patch) => onChange((c) => updateNodeData(c, id, patch))
  const dormantGenerate = (id) => onChange((c) => updateNodeData(c, id, { status: 'Generation not connected yet' }))

  // Upload: read an image file client-side. Keeps data_url ONLY in session preview
  // state; node.data gets just metadata. No auto-save to disk.
  async function uploadPickFile(nodeId, file) {
    if (!file || !/^image\//.test(file.type || '')) {
      setData(nodeId, { status: 'Please choose an image file.' })
      return
    }
    const meta = await readImageFile(file)
    setPreviews((p) => ({ ...p, [nodeId]: meta.dataUrl }))
    setData(nodeId, { file_name: file.name, file_size: file.size || 0, mime_type: file.type || 'image/png', width: meta.width, height: meta.height, local_url: '', storage: 'session', status: '' })
  }

  // Explicit: persist the session preview via the EXISTING media save endpoint,
  // normalized through the Media Result Contract. Stores local_url (not data_url).
  async function uploadSaveToLibrary(node) {
    const dataUrl = previews[node.id]
    const d = node.data || {}
    if (!dataUrl) {
      setData(node.id, { status: 'Choose an image first.' })
      return
    }
    setUploadBusy(node.id)
    const res = await saveMediaToLocal({ file_name: d.file_name || 'upload', mime_type: d.mime_type || 'image/png', data_url: dataUrl, category: 'asset', scene_id: '' })
    setUploadBusy('')
    if (!res || !res.success) {
      setData(node.id, { status: (res && res.error) || 'Save failed (is the local backend running?).' })
      return
    }
    const result = normalizeMediaResult({ provider_id: 'manual', source_type: 'upload', media_type: 'image', local_url: res.local_url, file_name: res.file_name, mime_type: res.mime_type, file_size: res.file_size, storage: 'local_disk', status: 'success' })
    setData(node.id, { local_url: result.local_url, storage: 'local_disk', file_name: result.file_name, mime_type: result.mime_type, file_size: result.file_size, status: 'Saved to Local Media Library' })
  }

  // Per-type properties area. All fields inert; Generate buttons are dormant stubs.
  const renderBody = (node) => {
    const d = node.data || {}
    if (node.type === 'upload') {
      const thumb = previews[node.id] || d.local_url || ''
      return (
        <div className="gnode-body">
          <div
            className="flow-drop"
            style={{ border: '2px dashed var(--border)', borderRadius: '8px', padding: '10px', textAlign: 'center', cursor: 'pointer' }}
            onMouseDown={(e) => e.stopPropagation()}
            onDragOver={(e) => {
              e.preventDefault()
              e.stopPropagation()
            }}
            onDrop={(e) => {
              e.preventDefault()
              e.stopPropagation()
              const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]
              if (f) uploadPickFile(node.id, f)
            }}
            onClick={() => {
              const el = document.getElementById(`upload-input-${node.id}`)
              if (el) el.click()
            }}
          >
            {thumb ? <img src={thumb} alt={d.file_name || 'preview'} style={{ maxWidth: '100%', maxHeight: 120, borderRadius: 6 }} /> : 'Drop an image, or click to choose'}
            <input id={`upload-input-${node.id}`} type="file" accept="image/png,image/jpeg,image/webp" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files && e.target.files[0]; e.target.value = ''; if (f) uploadPickFile(node.id, f) }} />
          </div>
          {d.file_name ? (
            <div className="bn-meta">
              <span>{d.file_name}</span>
              {d.width ? <span>{d.width}×{d.height}</span> : null}
              <span className={d.local_url ? 'media-health health-ok' : 'media-health health-warn'}>{d.local_url ? 'Local file saved' : 'Session preview'}</span>
            </div>
          ) : null}
          {!d.local_url && previews[node.id] ? (
            <div className="row">
              <button className="primary small" onClick={() => uploadSaveToLibrary(node)} disabled={uploadBusy === node.id}>
                {uploadBusy === node.id ? 'Saving…' : 'Save to Library'}
              </button>
            </div>
          ) : null}
          {d.status ? <div className="note">{d.status}</div> : null}
        </div>
      )
    }
    if (node.type === 'asset') {
      const items = savedMedia || []
      return (
        <div className="gnode-body">
          {items.length === 0 ? (
            <div className="note">No saved media — use an Upload node or Flow Import first.</div>
          ) : (
            <label className="field">
              <span className="field-label">Saved media</span>
              <select
                value={d.local_url || ''}
                onChange={(e) => {
                  const url = e.target.value
                  const item = items.find((x) => x.local_url === url)
                  setData(node.id, { local_url: url, file_name: (item && item.file_name) || '', width: (item && item.width) || 0, height: (item && item.height) || 0 })
                }}
              >
                <option value="">(choose an image)</option>
                {items.map((it) => (
                  <option key={it.local_url} value={it.local_url}>
                    {it.file_name || it.local_url}
                  </option>
                ))}
              </select>
            </label>
          )}
          {d.local_url ? <img src={d.local_url} alt={d.file_name || 'asset'} style={{ maxWidth: '100%', maxHeight: 120, borderRadius: 6 }} /> : null}
          {d.local_url ? <div className="bn-meta"><span>{d.file_name}</span><span className="media-health health-ok">Local file saved</span></div> : null}
        </div>
      )
    }
    if (node.type === 'prompt') {
      return (
        <div className="gnode-body">
          <label className="field">
            <span className="field-label">Prompt text</span>
            <textarea rows={3} value={d.text || ''} onChange={(e) => setData(node.id, { text: e.target.value })} />
          </label>
        </div>
      )
    }
    if (node.type === 'image_generator') {
      return (
        <div className="gnode-body">
          <label className="field">
            <span className="field-label">User prompt</span>
            <textarea rows={2} value={d.user_prompt || ''} onChange={(e) => setData(node.id, { user_prompt: e.target.value })} />
          </label>
          <label className="field">
            <span className="field-label">Model</span>
            <select value={d.model || IMAGE_MODELS[0]} onChange={(e) => setData(node.id, { model: e.target.value })}>
              {IMAGE_MODELS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>
          <div className="two">
            <label className="field">
              <span className="field-label">Aspect ratio</span>
              <select value={d.aspect_ratio || '1:1'} onChange={(e) => setData(node.id, { aspect_ratio: e.target.value })}>
                {IMAGE_ASPECT_RATIOS.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="field-label">Resolution</span>
              <select value={d.resolution || '2K'} onChange={(e) => setData(node.id, { resolution: e.target.value })}>
                {IMAGE_RESOLUTIONS.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="two">
            <label className="field">
              <span className="field-label">Count</span>
              <input type="number" min="1" value={d.count || 1} onChange={(e) => setData(node.id, { count: Number(e.target.value) || 1 })} />
            </label>
            <label className="field">
              <span className="field-label">Seed (optional)</span>
              <input type="number" value={d.seed === '' || d.seed == null ? '' : d.seed} onChange={(e) => setData(node.id, { seed: e.target.value === '' ? '' : Number(e.target.value) })} />
            </label>
          </div>
          <div className="row">
            <button className="primary small" title="Dormant stub — generation is not connected yet" onClick={() => dormantGenerate(node.id)}>
              Generate
            </button>
          </div>
          {d.status ? <div className="note">{d.status}</div> : null}
        </div>
      )
    }
    // video_generator
    return (
      <div className="gnode-body">
        <label className="field">
          <span className="field-label">User prompt</span>
          <textarea rows={2} value={d.user_prompt || ''} onChange={(e) => setData(node.id, { user_prompt: e.target.value })} />
        </label>
        <div className="two">
          <label className="field">
            <span className="field-label">Model</span>
            <select value={d.model || VIDEO_MODELS[0]} onChange={(e) => setData(node.id, { model: e.target.value })}>
              {VIDEO_MODELS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field-label">Duration (s)</span>
            <input type="number" min="0" value={d.duration_seconds || 0} onChange={(e) => setData(node.id, { duration_seconds: Number(e.target.value) || 0 })} />
          </label>
        </div>
        <div className="two">
          <label className="field">
            <span className="field-label">Resolution</span>
            <select value={d.resolution || '1080p'} onChange={(e) => setData(node.id, { resolution: e.target.value })}>
              {RESOLUTIONS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field-label">Aspect ratio</span>
            <select value={d.aspect_ratio || '9:16'} onChange={(e) => setData(node.id, { aspect_ratio: e.target.value })}>
              {ASPECT_RATIOS.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="row" style={{ alignItems: 'center', gap: '6px' }}>
          <input type="checkbox" checked={!!d.generate_audio} onChange={(e) => setData(node.id, { generate_audio: e.target.checked })} />
          <span className="hint small">Generate audio</span>
        </label>
        <div className="row">
          <button className="primary small" title="Dormant stub — generation is not connected yet" onClick={() => dormantGenerate(node.id)}>
            Generate
          </button>
        </div>
        {d.status ? <div className="note">{d.status}</div> : null}
      </div>
    )
  }

  const nodesById = {}
  ;(nc.nodes || []).forEach((n) => (nodesById[n.id] = n))

  return (
    <section className="panel node-canvas-panel">
      <div className="row between">
        <h2>Node Canvas</h2>
        <span className="hint small">Right-click to add a node · drag header to move · drag socket→socket to wire · Delete to remove · scroll to zoom</span>
      </div>
      <div
        className="node-canvas"
        ref={wrapRef}
        onMouseDown={onCanvasMouseDown}
        onContextMenu={onContextMenu}
        onWheel={onWheel}
      >
        <div className="node-canvas-layer" style={{ transform: `translate(${view.panX}px, ${view.panY}px) scale(${view.zoom})` }}>
          <svg className="node-wires" style={{ overflow: 'visible', width: 1, height: 1 }}>
            {(nc.connections || []).map((conn) => {
              const a = nodesById[conn.from_node]
              const b = nodesById[conn.to_node]
              if (!a || !b) return null
              const s = socketCenter(a, 'output', socketIndex(a.type, 'output', conn.from_socket))
              const t = socketCenter(b, 'input', socketIndex(b.type, 'input', conn.to_socket))
              return (
                <g key={conn.id} className="wire" onClick={() => onChange((c) => removeConnection(c, conn.id))}>
                  <path d={bezier(s.cx, s.cy, t.cx, t.cy)} className="wire-hit" />
                  <path d={bezier(s.cx, s.cy, t.cx, t.cy)} className="wire-line" />
                </g>
              )
            })}
            {wire
              ? (() => {
                  const a = nodesById[wire.fromNode]
                  if (!a) return null
                  const s = socketCenter(a, 'output', socketIndex(a.type, 'output', wire.fromSocket))
                  return <path d={bezier(s.cx, s.cy, wire.x, wire.y)} className="wire-line wire-live" />
                })()
              : null}
          </svg>

          {(nc.nodes || []).map((node) => {
            const def = NODE_DEFS[node.type] || NODE_DEFS.video_generator
            const d = node.data || {}
            const sockRegion = Math.max(def.inputs.length, def.outputs.length) * SOCK_H + SOCK_TOP * 2
            return (
              <div
                key={node.id}
                className={selected === node.id ? 'gnode selected' : 'gnode'}
                style={{ left: node.x, top: node.y, width: node.width || 280 }}
                onMouseDown={(e) => {
                  e.stopPropagation()
                  setSelected(node.id)
                }}
              >
                <div className="gnode-head" onMouseDown={(e) => startNodeDrag(e, node)}>
                  <strong>{def.title}</strong>
                  <button
                    className="gnode-del"
                    title="Delete node"
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={() => {
                      onChange((c) => removeNode(c, node.id))
                      if (selected === node.id) setSelected(null)
                    }}
                  >
                    ✕
                  </button>
                </div>

                <div className="gnode-sockets" style={{ height: sockRegion }}>
                  {def.inputs.map((s, i) => (
                    <div key={s.name} className="gsock-row in" style={{ top: SOCK_TOP + i * SOCK_H }}>
                      <span className={`gsock dot type-${s.type}`} title={`${s.label} (${s.type})`} onMouseUp={(e) => endWire(e, node, s.name)} onMouseDown={(e) => e.stopPropagation()} />
                      <span className="gsock-label">{s.label}</span>
                    </div>
                  ))}
                  {def.outputs.map((s, j) => (
                    <div key={s.name} className="gsock-row out" style={{ top: SOCK_TOP + j * SOCK_H }}>
                      <span className="gsock-label">{s.label}</span>
                      <span className={`gsock dot type-${s.type}`} title={`${s.label} (${s.type})`} onMouseDown={(e) => startWire(e, node, s.name)} />
                    </div>
                  ))}
                </div>

                {renderBody(node)}
              </div>
            )
          })}
        </div>

        {menu ? (
          <div className="node-menu" style={{ left: menu.sx, top: menu.sy }} onMouseDown={(e) => e.stopPropagation()}>
            <button className="ghost small" onClick={() => spawn('prompt')}>
              + Prompt
            </button>
            <button className="ghost small" onClick={() => spawn('upload')}>
              + Upload
            </button>
            <button className="ghost small" onClick={() => spawn('asset')}>
              + Asset
            </button>
            <button className="ghost small" onClick={() => spawn('image_generator')}>
              + Image Generator
            </button>
            <button className="ghost small" onClick={() => spawn('video_generator')}>
              + Video Generator
            </button>
          </div>
        ) : null}

        {(nc.nodes || []).length === 0 ? <div className="node-canvas-hint">Right-click anywhere to add a Prompt, Upload, Asset, Image Generator, or Video Generator node.</div> : null}
      </div>
    </section>
  )
}
