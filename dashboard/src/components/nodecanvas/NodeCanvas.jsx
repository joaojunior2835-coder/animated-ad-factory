import { useEffect, useRef, useState } from 'react'
import {
  NODE_DEFS,
  RESOLUTIONS,
  IMAGE_ASPECT_RATIOS,
  ASPECT_RATIOS,
  REF_TYPES,
  VIDEO_DURATIONS,
  UPSCALE_FACTORS,
  modelsForType,
  modelById,
  creditEstimateForModel,
  effectivePromptText,
  newNode,
  addNode,
  moveNode,
  updateNodeData,
  removeNode,
  addConnection,
  removeConnection,
  socketType
} from '../../lib/nodeCanvasModel.js'
import { classifyMedia } from '../../lib/canvasModel.js'
import { normalizeMediaResult } from '../../lib/ai/mediaResultContract.js'
import { saveMediaToLocal } from '../../lib/ai/apiClient.js'
import { nodeColor, nodeIcon } from './nodeTheme.js'

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

// Production Node Canvas — Higgsfield-inspired infinite pan/zoom board with typed
// socket wiring, multi-select, minimap, and per-type node UI. Graph mutations come
// from nodeCanvasModel (pure); generation requests go UP through onGenerateNode —
// this component never calls a provider itself.

const HEADER = 34
const SOCK_TOP = 10
const SOCK_H = 26
const ZOOM_MIN = 0.2
const ZOOM_MAX = 3
const EST_NODE_HEIGHT = 260 // fallback when a node hasn't been measured yet

const socketCenter = (node, side, index) => {
  const def = NODE_DEFS[node.type]
  const cy = node.y + HEADER + SOCK_TOP + index * SOCK_H + SOCK_H / 2
  const cx = side === 'input' ? node.x : node.x + (node.width || 280)
  return { cx, cy, def }
}

function socketIndex(nodeType, side, name) {
  const def = NODE_DEFS[nodeType]
  if (!def) return -1
  const list = side === 'input' ? def.inputs : def.outputs
  return (list || []).findIndex((s) => s.name === name)
}

function bezier(x1, y1, x2, y2) {
  const dx = Math.max(40, Math.abs(x2 - x1) / 2)
  return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`
}

// Does this node carry a generated/uploaded result worth a delete confirmation?
function nodeHasResult(node) {
  const d = (node && node.data) || {}
  if (d.result_external_url || d.result_local_url) return true
  if (d.local_url) return true
  if (Array.isArray(d.variations) && d.variations.length) return true
  if (d.output_image_url) return true
  return false
}

const STATUS_LABELS = { idle: 'idle', queued: 'queued', generating: 'generating…', done: 'done', error: 'error' }

export default function NodeCanvas({ nodeCanvas, onChange, savedMedia = [], onGenerateNode, onAttachResultToScene, onExportNodeToTimeline, sceneOptions = [], toolbarExtras = null, sidePanel = null, registerApi }) {
  const nc = nodeCanvas || { nodes: [], connections: [], pan_x: 0, pan_y: 0, zoom: 1 }
  // Session-only previews keyed by node id (data_url). NEVER persisted — node.data
  // keeps only local_url + metadata, so localStorage isn't bloated with base64.
  const [previews, setPreviews] = useState({})
  const [uploadBusy, setUploadBusy] = useState('')
  const wrapRef = useRef(null)
  const nodeEls = useRef({}) // id -> element, for real heights (fit, minimap)
  // Local view (pan/zoom) for smooth interaction; committed to store on gesture end.
  const [view, setView] = useState({ panX: nc.pan_x || 0, panY: nc.pan_y || 0, zoom: nc.zoom || 1 })
  const [selected, setSelected] = useState([]) // node ids (multi-select)
  const [selectedWire, setSelectedWire] = useState(null)
  const [menu, setMenu] = useState(null) // { sx, sy, cx, cy }
  const [drag, setDrag] = useState(null) // { moves: [{id, offX, offY}] } in canvas coords
  const [pan, setPan] = useState(null) // { startX, startY, panX, panY }
  const [wire, setWire] = useState(null) // { fromNode, fromSocket, fromType, x, y } live
  const [editingLabel, setEditingLabel] = useState(null) // node id
  const [attachPicker, setAttachPicker] = useState(null) // node id (scene picker open)
  const spaceDown = useRef(false)
  const commitTimer = useRef(null)
  const viewRef = useRef(view)
  viewRef.current = view
  // One re-render after mount so the minimap (which needs the measured wrapper)
  // appears without requiring an interaction first.
  const [, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  const isSelected = (id) => selected.includes(id)

  // Convert a screen event to canvas coordinates (accounting for pan + zoom).
  const toCanvas = (clientX, clientY) => {
    const r = wrapRef.current.getBoundingClientRect()
    const v = viewRef.current
    return { x: (clientX - r.left - v.panX) / v.zoom, y: (clientY - r.top - v.panY) / v.zoom }
  }

  const commitView = (next) => {
    if (commitTimer.current) clearTimeout(commitTimer.current)
    commitTimer.current = setTimeout(() => {
      onChange((c) => ({ ...c, pan_x: next.panX, pan_y: next.panY, zoom: next.zoom }))
    }, 250)
  }

  const setData = (id, patch) => onChange((c) => updateNodeData(c, id, patch))

  // ---- viewport helpers (fit-to-screen, minimap, spawn-at-center) ----
  const nodeHeight = (n) => {
    const el = nodeEls.current[n.id]
    return el ? el.offsetHeight : EST_NODE_HEIGHT
  }

  const nodesBounds = () => {
    const nodes = nc.nodes || []
    if (!nodes.length) return null
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const n of nodes) {
      minX = Math.min(minX, n.x)
      minY = Math.min(minY, n.y)
      maxX = Math.max(maxX, n.x + (n.width || 280))
      maxY = Math.max(maxY, n.y + nodeHeight(n))
    }
    return { minX, minY, maxX, maxY }
  }

  const fitToScreen = () => {
    const b = nodesBounds()
    if (!b || !wrapRef.current) return
    const r = wrapRef.current.getBoundingClientRect()
    const pad = 60
    const w = Math.max(1, b.maxX - b.minX)
    const h = Math.max(1, b.maxY - b.minY)
    const zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.min((r.width - pad * 2) / w, (r.height - pad * 2) / h)))
    const panX = (r.width - w * zoom) / 2 - b.minX * zoom
    const panY = (r.height - h * zoom) / 2 - b.minY * zoom
    const next = { panX, panY, zoom }
    setView(next)
    commitView(next)
  }

  // Board point currently at the viewport center (for click-to-spawn placement).
  const viewportCenter = () => {
    if (!wrapRef.current) return { x: 0, y: 0 }
    const r = wrapRef.current.getBoundingClientRect()
    const v = viewRef.current
    return { x: (r.width / 2 - v.panX) / v.zoom, y: (r.height / 2 - v.panY) / v.zoom }
  }

  const spawnAt = (type, cx, cy) => {
    const n = newNode(type, cx, cy)
    onChange((c) => addNode(c, n))
    setSelected([n.id])
    setSelectedWire(null)
    setMenu(null)
    return n
  }

  // Expose a tiny imperative API for the toolbar/sidebar (fit, spawn at center).
  useEffect(() => {
    if (!registerApi) return
    registerApi({ fitToScreen, spawnAtCenter: (type) => { const p = viewportCenter(); return spawnAt(type, p.x - 140, p.y - 100) }, viewportCenter, toCanvas })
  })

  // ---- pan (left-drag empty space, middle-drag anywhere, space+drag) ----
  const beginPan = (e) => setPan({ startX: e.clientX, startY: e.clientY, panX: viewRef.current.panX, panY: viewRef.current.panY })

  const onCanvasMouseDown = (e) => {
    if (e.button === 1) {
      e.preventDefault()
      beginPan(e)
      return
    }
    if (e.button !== 0) return
    setMenu(null)
    if (!e.shiftKey) {
      setSelected([])
      setSelectedWire(null)
    }
    beginPan(e)
  }

  // ---- global mouse move/up for pan, node drag, wiring ----
  useEffect(() => {
    function move(e) {
      if (pan) {
        setView((v) => ({ ...v, panX: pan.panX + (e.clientX - pan.startX), panY: pan.panY + (e.clientY - pan.startY) }))
      } else if (drag) {
        const p = toCanvas(e.clientX, e.clientY)
        onChange((c) => drag.moves.reduce((acc, mv) => moveNode(acc, mv.id, p.x - mv.offX, p.y - mv.offY), c))
      } else if (wire) {
        const p = toCanvas(e.clientX, e.clientY)
        setWire((w) => (w ? { ...w, x: p.x, y: p.y } : w))
      }
    }
    function up() {
      if (pan) {
        setPan(null)
        commitView(viewRef.current)
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

  // ---- keyboard: delete selection/wire, escape, space-pan ----
  useEffect(() => {
    function isTyping() {
      const tag = (document.activeElement && document.activeElement.tagName) || ''
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
    }
    function down(e) {
      if (e.code === 'Space' && !isTyping()) {
        spaceDown.current = true
        return
      }
      if (e.key === 'Escape') {
        setWire(null)
        setMenu(null)
        setAttachPicker(null)
        setEditingLabel(null)
        setSelected([])
        setSelectedWire(null)
        return
      }
      if (e.key !== 'Delete' && e.key !== 'Backspace') return
      if (isTyping()) return
      if (selectedWire) {
        onChange((c) => removeConnection(c, selectedWire))
        setSelectedWire(null)
        return
      }
      if (selected.length) {
        const withResults = (nc.nodes || []).filter((n) => selected.includes(n.id) && nodeHasResult(n))
        if (withResults.length && !window.confirm(`Delete ${selected.length} node(s)? ${withResults.length} of them have results attached.`)) return
        onChange((c) => selected.reduce((acc, id) => removeNode(acc, id), c))
        setSelected([])
      }
    }
    function up(e) {
      if (e.code === 'Space') spaceDown.current = false
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  })

  // ---- context menu: spawn node ----
  const onContextMenu = (e) => {
    e.preventDefault()
    const r = wrapRef.current.getBoundingClientRect()
    const p = toCanvas(e.clientX, e.clientY)
    setMenu({ sx: e.clientX - r.left, sy: e.clientY - r.top, cx: p.x, cy: p.y })
  }

  // ---- node select + drag (by header) ----
  const onNodeMouseDown = (e, node) => {
    e.stopPropagation()
    if (e.button === 1) {
      e.preventDefault()
      beginPan(e)
      return
    }
    if (spaceDown.current) {
      beginPan(e)
      return
    }
    setSelectedWire(null)
    if (e.shiftKey) {
      setSelected((s) => (s.includes(node.id) ? s.filter((x) => x !== node.id) : [...s, node.id]))
    } else if (!isSelected(node.id)) {
      setSelected([node.id])
    }
  }

  const startNodeDrag = (e, node) => {
    e.stopPropagation()
    if (e.button !== 0 || spaceDown.current) {
      onNodeMouseDown(e, node)
      return
    }
    const p = toCanvas(e.clientX, e.clientY)
    setSelectedWire(null)
    const ids = e.shiftKey || isSelected(node.id) ? Array.from(new Set([...selected, node.id])) : [node.id]
    if (!e.shiftKey && !isSelected(node.id)) setSelected([node.id])
    else if (e.shiftKey && !isSelected(node.id)) setSelected((s) => [...s, node.id])
    const byId = {}
    ;(nc.nodes || []).forEach((n) => (byId[n.id] = n))
    setDrag({ moves: ids.filter((id) => byId[id]).map((id) => ({ id, offX: p.x - byId[id].x, offY: p.y - byId[id].y })) })
  }

  // ---- wiring ----
  const startWire = (e, node, socketName) => {
    e.stopPropagation()
    const idx = socketIndex(node.type, 'output', socketName)
    const c = socketCenter(node, 'output', idx)
    setWire({ fromNode: node.id, fromSocket: socketName, fromType: socketType(node.type, 'output', socketName), x: c.cx, y: c.cy })
  }
  const endWire = (e, node, socketName) => {
    e.stopPropagation()
    if (!wire) return
    onChange((c) => addConnection(c, { from_node: wire.fromNode, from_socket: wire.fromSocket, to_node: node.id, to_socket: socketName }))
    setWire(null)
  }
  // Live compatibility hint while a wire is being dragged.
  const wireSockClass = (node, s) => {
    if (!wire) return ''
    if (node.id === wire.fromNode) return ' gsock-bad'
    return socketType(node.type, 'input', s.name) === wire.fromType ? ' gsock-ok' : ' gsock-bad'
  }

  // ---- upload-to-library plumbing (Upload / Reference / Character / Style) ----
  async function pickImageFile(node, file, extraPatch = {}) {
    if (!file || !/^image\//.test(file.type || '')) {
      setData(node.id, { status_message: 'Please choose an image file.' })
      return
    }
    const meta = await readImageFile(file)
    setPreviews((p) => ({ ...p, [node.id]: meta.dataUrl }))
    setData(node.id, {
      file_name: file.name,
      mime_type: file.type || 'image/png',
      ...(node.type === 'upload' || node.type === 'reference' ? { width: meta.width, height: meta.height, file_size: file.size || 0 } : {}),
      local_url: '',
      storage: 'session',
      status_message: '',
      ...extraPatch
    })
  }

  // Explicit: persist the session preview via the EXISTING media save endpoint,
  // normalized through the Media Result Contract. Stores local_url (not data_url).
  async function saveNodeImageToLibrary(node) {
    const dataUrl = previews[node.id]
    const d = node.data || {}
    if (!dataUrl) {
      setData(node.id, { status_message: 'Choose an image first.' })
      return
    }
    setUploadBusy(node.id)
    const res = await saveMediaToLocal({ file_name: d.file_name || 'upload', mime_type: d.mime_type || 'image/png', data_url: dataUrl, category: 'asset', scene_id: '' })
    setUploadBusy('')
    if (!res || !res.success) {
      setData(node.id, { status_message: (res && res.error) || 'Save failed (is the local backend running?).' })
      return
    }
    const result = normalizeMediaResult({ provider_id: 'manual', source_type: 'upload', media_type: 'image', local_url: res.local_url, file_name: res.file_name, mime_type: res.mime_type, file_size: res.file_size, storage: 'local_disk', status: 'success' })
    setData(node.id, { local_url: result.local_url, storage: 'local_disk', file_name: result.file_name, mime_type: result.mime_type, status_message: 'Saved to Local Media Library' })
  }

  // Save a generator node's RESULT (session data-url from the engine) to disk.
  async function saveResultToLibrary(node) {
    const d = node.data || {}
    const dataUrl = previews['result:' + node.id]
    if (!dataUrl && !d.result_external_url) {
      setData(node.id, { status_message: 'No result to save yet.' })
      return
    }
    if (!dataUrl) {
      setData(node.id, { status_message: 'Result is an external URL — already addressable; nothing to save.' })
      return
    }
    setUploadBusy(node.id)
    const res = await saveMediaToLocal({ file_name: d.result_file_name || `${node.type}-result.png`, mime_type: d.result_mime_type || 'image/png', data_url: dataUrl, category: 'variation', scene_id: '' })
    setUploadBusy('')
    if (!res || !res.success) {
      setData(node.id, { status_message: (res && res.error) || 'Save failed (is the local backend running?).' })
      return
    }
    setData(node.id, { result_local_url: res.local_url, result_file_name: res.file_name, result_mime_type: res.mime_type, result_saved: true, status_message: 'Saved ✓' })
  }

  // ---- generation ----
  const generate = (node) => {
    if (!onGenerateNode) return
    const action = node.type === 'video_generator' ? 'generate_video' : 'generate_image'
    onGenerateNode(node.id, action)
  }

  const generateDisabledReason = (node) => {
    const d = node.data || {}
    if (!d.model_id) return 'Select a model first'
    if (d.status === 'queued' || d.status === 'generating') return 'Generation in progress'
    const m = modelById(d.model_id)
    if (m && m.id !== 'manual' && !effectivePromptText(nc, node.id).trim()) return 'Connect or type a prompt first'
    return ''
  }

  // ---- shared render bits ----
  const renderThumb = (url, alt) => {
    if (!url) return null
    const kind = classifyMedia(url)
    if (kind === 'mock') return <div className="media-mock">Mock result: {url}</div>
    if (kind === 'video') return <a className="media-link" href={url} target="_blank" rel="noreferrer">▶ {url.split('/').pop()}</a>
    return <img src={url} alt={alt || 'preview'} style={{ maxWidth: '100%', maxHeight: 120, borderRadius: 6 }} />
  }

  const renderResultBlock = (node) => {
    const d = node.data || {}
    const url = d.result_local_url || d.result_external_url || previews['result:' + node.id] || ''
    if (d.status !== 'done' || !url) return null
    return (
      <div className="gnode-result">
        {renderThumb(url, 'result')}
        <div className="row" style={{ marginTop: 6 }}>
          {previews['result:' + node.id] && !d.result_saved ? (
            <button className="ghost small" onClick={() => saveResultToLibrary(node)} disabled={uploadBusy === node.id} aria-label="Save result to Media Library">
              {uploadBusy === node.id ? 'Saving…' : 'Save to Media Library'}
            </button>
          ) : null}
          {d.result_saved ? <span className="media-health health-ok">Saved ✓</span> : null}
          {onAttachResultToScene && sceneOptions.length ? (
            <button className="ghost small" onClick={() => setAttachPicker(node.id)} aria-label="Attach result to a scene">
              Attach to Scene
            </button>
          ) : null}
        </div>
        {attachPicker === node.id ? (
          <div className="gnode-attach" onMouseDown={(e) => e.stopPropagation()}>
            <span className="field-label">Attach to scene:</span>
            <select
              aria-label="Scene to attach this result to"
              defaultValue=""
              onChange={(e) => {
                const num = Number(e.target.value)
                if (Number.isFinite(num) && e.target.value !== '') {
                  onAttachResultToScene(node.id, num)
                  setAttachPicker(null)
                }
              }}
            >
              <option value="">(choose scene)</option>
              {sceneOptions.map((s) => (
                <option key={s.scene_number} value={s.scene_number}>
                  Scene {s.scene_number}{s.summary ? ` — ${s.summary}` : ''}
                </option>
              ))}
            </select>
            <button className="ghost small" onClick={() => setAttachPicker(null)}>Cancel</button>
          </div>
        ) : null}
      </div>
    )
  }

  const renderGenFooter = (node) => {
    const d = node.data || {}
    const reason = generateDisabledReason(node)
    const busy = d.status === 'queued' || d.status === 'generating'
    return (
      <div className="gnode-footer">
        <span className={`badge gen-status status-${d.status || 'idle'}`}>{STATUS_LABELS[d.status] || 'idle'}</span>
        <button
          className="primary small"
          disabled={!!reason}
          title={reason || 'Run this node'}
          aria-label={`Generate ${NODE_DEFS[node.type] ? NODE_DEFS[node.type].title : node.type}`}
          onClick={() => generate(node)}
        >
          {busy ? '⏳ Generating…' : 'Generate'}
        </button>
        <span className="gnode-credit">{creditEstimateForModel(d.model_id)}</span>
        {d.status === 'error' && d.status_message ? <div className="gnode-error">{d.status_message}</div> : null}
      </div>
    )
  }

  const modelSelect = (node, type) => {
    const d = node.data || {}
    const models = modelsForType(type)
    const current = modelById(d.model_id)
    return (
      <label className="field">
        <span className="field-label">Model</span>
        <select value={d.model_id || ''} onChange={(e) => setData(node.id, { model_id: e.target.value })} aria-label="Generation model">
          <option value="">(choose model)</option>
          {models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}{m.category === 'Premium' ? ' 💳' : ''}
            </option>
          ))}
          {d.model_id && !current ? <option value={d.model_id}>{d.model_id} (missing)</option> : null}
        </select>
      </label>
    )
  }

  const uploadZone = (node, currentThumb) => (
    <div
      className="flow-drop gnode-drop"
      onMouseDown={(e) => e.stopPropagation()}
      onDragOver={(e) => {
        e.preventDefault()
        e.stopPropagation()
      }}
      onDrop={(e) => {
        e.preventDefault()
        e.stopPropagation()
        const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]
        if (f) pickImageFile(node, f)
      }}
      onClick={() => {
        const el = document.getElementById(`nc-file-${node.id}`)
        if (el) el.click()
      }}
      role="button"
      aria-label="Upload an image"
    >
      {currentThumb ? renderThumb(currentThumb, (node.data && node.data.file_name) || 'preview') : 'Drop an image, or click to choose'}
      <input
        id={`nc-file-${node.id}`}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files && e.target.files[0]
          e.target.value = ''
          if (f) pickImageFile(node, f)
        }}
      />
    </div>
  )

  const saveToLibraryRow = (node) => {
    const d = node.data || {}
    if (d.local_url || !previews[node.id]) return null
    return (
      <div className="row">
        <button className="primary small" onClick={() => saveNodeImageToLibrary(node)} disabled={uploadBusy === node.id}>
          {uploadBusy === node.id ? 'Saving…' : 'Save to Library'}
        </button>
        <span className="media-health health-warn">Session preview</span>
      </div>
    )
  }

  // Per-type properties area.
  const renderBody = (node) => {
    const d = node.data || {}
    if (node.type === 'upload') {
      const thumb = previews[node.id] || d.local_url || ''
      return (
        <div className="gnode-body">
          {uploadZone(node, thumb)}
          {d.file_name ? (
            <div className="bn-meta">
              <span>{d.file_name}</span>
              {d.width ? <span>{d.width}×{d.height}</span> : null}
              <span className={d.local_url ? 'media-health health-ok' : 'media-health health-warn'}>{d.local_url ? 'Local file saved' : 'Session preview'}</span>
            </div>
          ) : null}
          {saveToLibraryRow(node)}
          {d.status_message || d.status ? <div className="note">{d.status_message || d.status}</div> : null}
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
                aria-label="Saved media item"
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
          {d.local_url ? renderThumb(d.local_url, d.file_name || 'asset') : null}
          {d.local_url ? <div className="bn-meta"><span>{d.file_name}</span><span className="media-health health-ok">Local file saved</span></div> : null}
        </div>
      )
    }
    if (node.type === 'prompt') {
      return (
        <div className="gnode-body">
          <label className="field">
            <span className="field-label">Prompt text</span>
            <textarea rows={4} value={d.text || ''} onChange={(e) => setData(node.id, { text: e.target.value })} aria-label="Prompt text" />
          </label>
          {d.output_text ? <div className="bn-sub">→ {String(d.output_text).slice(0, 80)}{String(d.output_text).length > 80 ? '…' : ''}</div> : null}
        </div>
      )
    }
    if (node.type === 'reference') {
      const thumb = previews[node.id] || d.local_url || d.file_url || ''
      return (
        <div className="gnode-body">
          <label className="field">
            <span className="field-label">Reference type</span>
            <select value={d.ref_type || 'product'} onChange={(e) => setData(node.id, { ref_type: e.target.value })} aria-label="Reference type">
              {REF_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          {uploadZone(node, thumb)}
          <label className="field">
            <span className="field-label">Or paste a URL</span>
            <input type="text" value={d.file_url || ''} placeholder="https://… or /media/…" onChange={(e) => setData(node.id, { file_url: e.target.value })} aria-label="Reference URL" />
          </label>
          {d.file_name ? (
            <div className="bn-meta">
              <span>{d.file_name}</span>
              <span className={d.local_url ? 'media-health health-ok' : 'media-health health-warn'}>{d.local_url ? 'Local file saved' : 'Session preview'}</span>
            </div>
          ) : null}
          {saveToLibraryRow(node)}
          {d.status_message ? <div className="note">{d.status_message}</div> : null}
        </div>
      )
    }
    if (node.type === 'character') {
      const thumb = previews[node.id] || d.local_url || d.ref_image_url || ''
      return (
        <div className="gnode-body">
          <label className="field">
            <span className="field-label">Character name</span>
            <input type="text" value={d.character_name || ''} onChange={(e) => setData(node.id, { character_name: e.target.value })} aria-label="Character name" />
          </label>
          <label className="field">
            <span className="field-label">Description</span>
            <textarea rows={2} value={d.description || ''} onChange={(e) => setData(node.id, { description: e.target.value })} aria-label="Character description" />
          </label>
          {uploadZone(node, thumb)}
          {saveToLibraryRow(node)}
          <label className="row" style={{ alignItems: 'center', gap: '6px' }}>
            <input type="checkbox" checked={!!d.locked} onChange={(e) => setData(node.id, { locked: e.target.checked })} aria-label="Lock character" />
            <span className="hint small">{d.locked ? '🔒 Locked (identity must not drift)' : 'Lock character identity'}</span>
          </label>
          {d.status_message ? <div className="note">{d.status_message}</div> : null}
        </div>
      )
    }
    if (node.type === 'style') {
      const thumb = previews[node.id] || d.local_url || d.ref_image_url || ''
      return (
        <div className="gnode-body">
          <label className="field">
            <span className="field-label">Style description</span>
            <textarea rows={3} value={d.style_description || ''} onChange={(e) => setData(node.id, { style_description: e.target.value })} aria-label="Style description" />
          </label>
          {uploadZone(node, thumb)}
          {saveToLibraryRow(node)}
          {d.status_message ? <div className="note">{d.status_message}</div> : null}
        </div>
      )
    }
    if (node.type === 'output') {
      const variations = Array.isArray(d.variations) ? d.variations : []
      const sel = d.selected_variation_index
      const finalUrl = d.final_local_path || d.final_media_url || ''
      return (
        <div className="gnode-body">
          <label className="field">
            <span className="field-label">Scene number</span>
            <input
              type="number"
              min="1"
              value={d.scene_number || 1}
              onChange={(e) => setData(node.id, { scene_number: Number(e.target.value) || 1 })}
              aria-label="Scene number"
            />
          </label>
          {variations.length === 0 ? (
            <div className="hint small">No variations yet — wire generator results in, or generate upstream.</div>
          ) : (
            <div className="gnode-variations" role="list" aria-label="Scene variations">
              {variations.map((v, i) => (
                <label key={v.id || i} className={`gnode-variation${sel === i ? ' on' : ''}`} onMouseDown={(e) => e.stopPropagation()}>
                  <input
                    type="radio"
                    name={`var-${node.id}`}
                    checked={sel === i}
                    onChange={() =>
                      setData(node.id, {
                        selected_variation_index: i,
                        final_media_url: v.url || v.external_url || '',
                        final_local_path: v.local_url || ''
                      })
                    }
                    aria-label={`Select variation ${v.label || i + 1}`}
                  />
                  <span>{v.label || `v${i + 1}`}</span>
                  <span className="hint small">{v.media_type || 'image'}</span>
                </label>
              ))}
            </div>
          )}
          {finalUrl ? renderThumb(finalUrl, 'final media') : null}
          <div className="row">
            <button
              className="primary small"
              aria-label="Export this output to the final timeline"
              onClick={() => {
                if (!finalUrl) {
                  setData(node.id, { status_message: 'No result to export yet.' })
                  return
                }
                if (onExportNodeToTimeline) onExportNodeToTimeline(node.id)
                else setData(node.id, { status_message: 'Timeline export connects in the integration phase.' })
              }}
            >
              Export to Final Timeline
            </button>
          </div>
          {d.status_message ? <div className="note">{d.status_message}</div> : null}
        </div>
      )
    }
    if (node.type === 'upscale') {
      return (
        <div className="gnode-body">
          <label className="field">
            <span className="field-label">Scale factor</span>
            <select value={d.scale_factor || 2} onChange={(e) => setData(node.id, { scale_factor: Number(e.target.value) || 2 })} aria-label="Upscale factor">
              {UPSCALE_FACTORS.map((f) => (
                <option key={f} value={f}>
                  {f}×
                </option>
              ))}
            </select>
          </label>
          <div className="two">
            <div>
              <span className="field-label">Input</span>
              {d.input_image_url ? renderThumb(d.input_image_url, 'input') : <div className="hint small">Wire an image in.</div>}
            </div>
            <div>
              <span className="field-label">Output</span>
              {d.output_image_url ? renderThumb(d.output_image_url, 'output') : <div className="hint small">Not upscaled yet.</div>}
            </div>
          </div>
          <div className="hint small">Upscale backend is not connected yet — this node is a placeholder seam.</div>
          {d.status_message ? <div className="note">{d.status_message}</div> : null}
        </div>
      )
    }
    if (node.type === 'image_generator') {
      return (
        <div className="gnode-body">
          <label className="field">
            <span className="field-label">User prompt</span>
            <textarea rows={2} value={d.user_prompt || ''} onChange={(e) => setData(node.id, { user_prompt: e.target.value })} aria-label="Image prompt" />
          </label>
          {modelSelect(node, 'image')}
          <div className="two">
            <label className="field">
              <span className="field-label">Aspect ratio</span>
              <select value={d.aspect_ratio || '1:1'} onChange={(e) => setData(node.id, { aspect_ratio: e.target.value })} aria-label="Aspect ratio">
                {IMAGE_ASPECT_RATIOS.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="field-label">Seed (optional)</span>
              <input type="number" value={d.seed === '' || d.seed == null ? '' : d.seed} onChange={(e) => setData(node.id, { seed: e.target.value === '' ? '' : Number(e.target.value) })} aria-label="Seed" />
            </label>
          </div>
          {renderResultBlock(node)}
          {renderGenFooter(node)}
          {d.status !== 'error' && d.status_message ? <div className="note">{d.status_message}</div> : null}
        </div>
      )
    }
    if (node.type === 'video_generator') {
      const dur = Number(d.duration_seconds) || 5
      const durations = VIDEO_DURATIONS.includes(dur) ? VIDEO_DURATIONS : [dur, ...VIDEO_DURATIONS]
      return (
        <div className="gnode-body">
          <label className="field">
            <span className="field-label">User prompt</span>
            <textarea rows={2} value={d.user_prompt || ''} onChange={(e) => setData(node.id, { user_prompt: e.target.value })} aria-label="Video prompt" />
          </label>
          {modelSelect(node, 'video')}
          <div className="two">
            <label className="field">
              <span className="field-label">Duration</span>
              <select value={dur} onChange={(e) => setData(node.id, { duration_seconds: Number(e.target.value) || 5 })} aria-label="Duration in seconds">
                {durations.map((s) => (
                  <option key={s} value={s}>
                    {s}s
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="field-label">Aspect ratio</span>
              <select value={d.aspect_ratio || '9:16'} onChange={(e) => setData(node.id, { aspect_ratio: e.target.value })} aria-label="Aspect ratio">
                {ASPECT_RATIOS.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="two">
            <label className="field">
              <span className="field-label">Resolution</span>
              <select value={d.resolution || '1080p'} onChange={(e) => setData(node.id, { resolution: e.target.value })} aria-label="Resolution">
                {RESOLUTIONS.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="field-label">Seed (optional)</span>
              <input type="number" value={d.seed === '' || d.seed == null ? '' : d.seed} onChange={(e) => setData(node.id, { seed: e.target.value === '' ? '' : Number(e.target.value) })} aria-label="Seed" />
            </label>
          </div>
          {renderResultBlock(node)}
          {renderGenFooter(node)}
          {d.status !== 'error' && d.status_message ? <div className="note">{d.status_message}</div> : null}
        </div>
      )
    }
    // Unknown node type (preserved by normalize): inert generic body.
    return (
      <div className="gnode-body">
        <div className="note">Unknown node type “{node.type}” — preserved as-is (newer snapshot?). Fields are read-only here.</div>
      </div>
    )
  }

  const nodesById = {}
  ;(nc.nodes || []).forEach((n) => (nodesById[n.id] = n))

  // ---- minimap ----
  const renderMiniMap = () => {
    const b = nodesBounds()
    if (!b || !wrapRef.current) return null
    const MW = 160
    const MH = 100
    const pad = 10
    const w = Math.max(1, b.maxX - b.minX)
    const h = Math.max(1, b.maxY - b.minY)
    const scale = Math.min((MW - pad * 2) / w, (MH - pad * 2) / h)
    const ox = (MW - w * scale) / 2 - b.minX * scale
    const oy = (MH - h * scale) / 2 - b.minY * scale
    const r = wrapRef.current.getBoundingClientRect()
    // viewport rectangle in board space
    const vx = -view.panX / view.zoom
    const vy = -view.panY / view.zoom
    const vw = r.width / view.zoom
    const vh = r.height / view.zoom
    return (
      <div
        className="nc-minimap"
        role="button"
        aria-label="Canvas overview — click to pan"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          const mr = e.currentTarget.getBoundingClientRect()
          const bx = (e.clientX - mr.left - ox) / scale
          const by = (e.clientY - mr.top - oy) / scale
          const next = { panX: r.width / 2 - bx * view.zoom, panY: r.height / 2 - by * view.zoom, zoom: view.zoom }
          setView(next)
          commitView(next)
        }}
      >
        <svg width={MW} height={MH}>
          {(nc.nodes || []).map((n) => (
            <rect
              key={n.id}
              x={n.x * scale + ox}
              y={n.y * scale + oy}
              width={Math.max(3, (n.width || 280) * scale)}
              height={Math.max(2, nodeHeight(n) * scale)}
              rx={1.5}
              fill={nodeColor(n.type)}
              opacity={isSelected(n.id) ? 1 : 0.7}
            />
          ))}
          <rect x={vx * scale + ox} y={vy * scale + oy} width={Math.max(4, vw * scale)} height={Math.max(4, vh * scale)} className="nc-minimap-view" />
        </svg>
      </div>
    )
  }

  const SPAWNABLE = ['prompt', 'image_generator', 'video_generator', 'reference', 'character', 'style', 'output', 'upscale', 'upload', 'asset']

  return (
    <section className="panel node-canvas-panel">
      <div className="row between">
        <h2>Node Canvas</h2>
        <span className="hint small">
          Right-click or use the palette to add nodes · drag header to move · shift+click multi-select · drag socket→socket to wire · click a wire then Delete · middle-mouse or space+drag to pan · scroll to zoom
        </span>
      </div>
      {toolbarExtras}
      <div className="node-canvas-row">
        {sidePanel}
        <div
          className="node-canvas"
          ref={wrapRef}
          onMouseDown={onCanvasMouseDown}
          onContextMenu={onContextMenu}
          onWheel={onWheel}
          onDragOver={(e) => {
            // allow palette card drops
            if (e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('application/x-aaf-node-type')) e.preventDefault()
          }}
          onDrop={(e) => {
            const type = e.dataTransfer && e.dataTransfer.getData('application/x-aaf-node-type')
            if (!type) return
            e.preventDefault()
            const p = toCanvas(e.clientX, e.clientY)
            spawnAt(type, p.x - 140, p.y - 20)
          }}
          role="application"
          aria-label="Production node canvas"
        >
          <div className="node-canvas-layer" style={{ transform: `translate(${view.panX}px, ${view.panY}px) scale(${view.zoom})` }}>
            <svg className="node-wires" style={{ overflow: 'visible', width: 1, height: 1 }}>
              {(nc.connections || []).map((conn) => {
                const a = nodesById[conn.from_node]
                const b = nodesById[conn.to_node]
                if (!a || !b) return null
                const si = socketIndex(a.type, 'output', conn.from_socket)
                const ti = socketIndex(b.type, 'input', conn.to_socket)
                if (si < 0 || ti < 0) return null
                const s = socketCenter(a, 'output', si)
                const t = socketCenter(b, 'input', ti)
                return (
                  <g
                    key={conn.id}
                    className={selectedWire === conn.id ? 'wire wire-selected' : 'wire'}
                    onClick={(e) => {
                      e.stopPropagation()
                      setSelectedWire((w) => (w === conn.id ? null : conn.id))
                      setSelected([])
                    }}
                  >
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
              const def = NODE_DEFS[node.type]
              const inputs = (def && def.inputs) || []
              const outputs = (def && def.outputs) || []
              const d = node.data || {}
              const sockRegion = Math.max(inputs.length, outputs.length) * SOCK_H + (inputs.length || outputs.length ? SOCK_TOP * 2 : 0)
              const title = (d.label || '').trim() || (def ? def.title : node.type)
              return (
                <div
                  key={node.id}
                  ref={(el) => {
                    if (el) nodeEls.current[node.id] = el
                    else delete nodeEls.current[node.id]
                  }}
                  className={`gnode${isSelected(node.id) ? ' selected' : ''}${d.status === 'error' ? ' has-error' : ''}`}
                  style={{ left: node.x, top: node.y, width: node.width || 280, borderLeft: `3px solid ${nodeColor(node.type)}` }}
                  onMouseDown={(e) => onNodeMouseDown(e, node)}
                  aria-label={`${def ? def.title : node.type} node: ${title}`}
                >
                  <div className="gnode-head" onMouseDown={(e) => startNodeDrag(e, node)} onDoubleClick={() => setEditingLabel(node.id)}>
                    <span className="gnode-icon" aria-hidden="true">{nodeIcon(node.type)}</span>
                    {editingLabel === node.id ? (
                      <input
                        className="gnode-label-input"
                        autoFocus
                        defaultValue={d.label || ''}
                        placeholder={def ? def.title : node.type}
                        onMouseDown={(e) => e.stopPropagation()}
                        onBlur={(e) => {
                          setData(node.id, { label: e.target.value })
                          setEditingLabel(null)
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') e.currentTarget.blur()
                          if (e.key === 'Escape') setEditingLabel(null)
                        }}
                        aria-label="Node label"
                      />
                    ) : (
                      <strong title="Double-click to rename">{title}</strong>
                    )}
                    <button
                      className="gnode-del"
                      title="Delete node"
                      aria-label={`Delete ${title}`}
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={() => {
                        if (nodeHasResult(node) && !window.confirm(`Delete "${title}"? It has a result attached.`)) return
                        onChange((c) => removeNode(c, node.id))
                        setSelected((s) => s.filter((x) => x !== node.id))
                      }}
                    >
                      ✕
                    </button>
                  </div>

                  {sockRegion > 0 ? (
                    <div className="gnode-sockets" style={{ height: sockRegion }}>
                      {inputs.map((s, i) => (
                        <div key={s.name} className="gsock-row in" style={{ top: SOCK_TOP + i * SOCK_H }}>
                          <span
                            className={`gsock dot type-${s.type}${wireSockClass(node, s)}`}
                            title={`${s.label} (${s.type})`}
                            onMouseUp={(e) => endWire(e, node, s.name)}
                            onMouseDown={(e) => e.stopPropagation()}
                          />
                          <span className="gsock-label">{s.label}</span>
                        </div>
                      ))}
                      {outputs.map((s, j) => (
                        <div key={s.name} className="gsock-row out" style={{ top: SOCK_TOP + j * SOCK_H }}>
                          <span className="gsock-label">{s.label}</span>
                          <span className={`gsock dot type-${s.type}`} title={`${s.label} (${s.type})`} onMouseDown={(e) => startWire(e, node, s.name)} />
                        </div>
                      ))}
                    </div>
                  ) : null}

                  {renderBody(node)}
                </div>
              )
            })}
          </div>

          {menu ? (
            <div className="node-menu" style={{ left: menu.sx, top: menu.sy }} onMouseDown={(e) => e.stopPropagation()} role="menu" aria-label="Add node">
              {SPAWNABLE.map((t) => (
                <button key={t} className="ghost small" onClick={() => spawnAt(t, menu.cx, menu.cy)} role="menuitem">
                  <span aria-hidden="true">{nodeIcon(t)}</span> + {NODE_DEFS[t].title}
                </button>
              ))}
            </div>
          ) : null}

          <button className="ghost small nc-fit" onClick={(e) => { e.stopPropagation() ; fitToScreen() }} onMouseDown={(e) => e.stopPropagation()} title="Fit all nodes in view" aria-label="Fit to screen">
            ⛶ Fit
          </button>
          {renderMiniMap()}

          {(nc.nodes || []).length === 0 ? <div className="node-canvas-hint">Right-click anywhere (or use the palette) to add a node: Prompt, Image/Video Generator, Reference, Character, Style, Output, Upscale, Upload, Asset.</div> : null}
        </div>
      </div>
    </section>
  )
}
