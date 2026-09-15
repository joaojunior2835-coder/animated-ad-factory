import { useEffect, useMemo, useRef, useState } from 'react'
import {
  NODE_DEFS,
  RESOLUTIONS,
  IMAGE_ASPECT_RATIOS,
  ASPECT_RATIOS,
  REF_TYPES,
  VIDEO_DURATIONS,
  UPSCALE_FACTORS,
  MODEL_REGISTRY,
  GENERATOR_TYPES,
  loadCustomModels,
  saveCustomModels,
  topologicalNodeOrder,
  addSceneNodesToCanvas,
  propagateResultToOutputs,
  modelUsesCredits,
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
  socketType,
  wouldCreateCycle, duplicateNodes, restoreCanvasGraph, NODE_INPUT_FIELDS, addStarterGraph
} from '../../lib/nodeCanvasModel.js'
import { compileCanvasExecution } from '../../lib/nodeCanvasExecution.js'
import { classifyMedia } from '../../lib/canvasModel.js'
import { normalizeMediaResult } from '../../lib/ai/mediaResultContract.js'
import { apiBase, saveMediaToLocal } from '../../lib/ai/apiClient.js'
import { nodeColor, nodeIcon } from './nodeTheme.js'
import CanvasSidebar from './CanvasSidebar.jsx'
import CanvasToolbar from './CanvasToolbar.jsx'
import { isEditableTarget } from '../../lib/editableTarget.js'
import './nodeCanvas.css'

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

async function registerSavedAsset(saved) {
  const parsed = new URL(saved.local_url, window.location.href)
  if (!parsed.pathname.startsWith('/media/')) throw new Error('The saved file is not in the local media library.')
  const relativePath = decodeURIComponent(parsed.pathname.replace(/^\/media\//, ''))
  const response = await fetch(`${apiBase()}/api/assets/register-external`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ relativePath, mimeType: saved.mime_type || 'image/png', source: 'uploaded' }) })
  const result = await response.json().catch(() => ({}))
  if (!response.ok || !result.item?.id || result.item.fileFoundOnDisk === false) throw new Error(result.error || 'The local file could not be registered as an Asset. Retry registration.')
  return result.item
}

// Production Node Canvas — Higgsfield-inspired infinite pan/zoom board with typed
// socket wiring, multi-select, minimap, and per-type node UI. Graph mutations come
// from nodeCanvasModel (pure); generation requests go UP through onGenerateNode —
// this component never calls a provider itself.

const HEADER = 34
const SOCK_TOP = 10
const SOCK_H = 26
const ZOOM_MIN = 0.08
const ZOOM_MAX = 3
const EST_NODE_HEIGHT = 260 // fallback when a node hasn't been measured yet

const defaultSocketCenter = (node, side, index) => {
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

const STATUS_LABELS = { idle: 'Draft', queued: 'Queued', generating: 'Generating', downloading: 'Downloading', reconciliation_required: 'Reconciliation required', done: 'Complete', error: 'Failed' }
const REPLICATE_VIDEO_MODEL_OPTIONS = [
  { id: 'ltx', label: 'Cheap test — LTX ($0.03/s)' },
  { id: 'wan-720p', label: 'Quality — WAN 720p ($0.09/s)' }
]

export default function NodeCanvas({ nodeCanvas, onChange, savedMedia = [], onGenerateNode, onRequestProduction, capabilities = [], onUseInCreative, onAttachResultToScene, onExportNodeToTimeline, scenes = [], providerMode = 'manual', videoProviderId = 'mock', toolbarExtras = null, registerApi }) {
  const nc = nodeCanvas || { nodes: [], connections: [], pan_x: 0, pan_y: 0, zoom: 1 }
  // Session-only previews keyed by node id (data_url). NEVER persisted — node.data
  // keeps only local_url + metadata, so localStorage isn't bloated with base64.
  const [previews, setPreviews] = useState({})
  const [uploadBusy, setUploadBusy] = useState('')
  const savingNodesRef = useRef(new Set())
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
  const [sidebarOpen, setSidebarOpen] = useState(() => typeof window === 'undefined' || window.innerWidth > 720)
  const [propertiesOpen, setPropertiesOpen] = useState(false)
  const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && window.innerWidth <= 720)
  const [boardNotice, setBoardNotice] = useState('')
  const [runReview, setRunReview] = useState(null)
  const [productionBusy, setProductionBusy] = useState(false)
  const [customModels, setCustomModels] = useState(() => loadCustomModels())
  const [runningAll, setRunningAll] = useState(false)
  const [resultModalNodeId, setResultModalNodeId] = useState('')
  const spaceDown = useRef(false)
  const commitTimer = useRef(null)
  const pendingViewRef = useRef(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const viewRef = useRef(view)
  viewRef.current = view
  const ncRef = useRef(nc)
  ncRef.current = nc
  const savedViewRef = useRef({ panX: nc.pan_x || 0, panY: nc.pan_y || 0, zoom: nc.zoom || 1 })
  const editGroupRef = useRef('')
  const pendingFitRef = useRef(false)
  const initialFitRef = useRef(false)
  const [, refreshLayout] = useState(0)
  const socketOffsets = useRef(new Map())
  const socketCenter = (node, side, index) => {
    const offset = socketOffsets.current.get(`${node.id}:${side}:${index}`)
    return offset ? { cx: node.x + offset.x, cy: node.y + offset.y } : defaultSocketCenter(node, side, index)
  }
  // One re-render after mount so the minimap (which needs the measured wrapper)
  // appears without requiring an interaction first.
  const [, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  useEffect(() => {
    const media = window.matchMedia('(max-width: 720px)')
    const update = () => { setNarrow(media.matches); if (media.matches) setSidebarOpen(false) }
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])
  useEffect(() => {
    const measure = () => {
      let changed = false
      for (const [id, element] of Object.entries(nodeEls.current)) {
        const box = element.getBoundingClientRect()
        for (const side of ['input', 'output']) Array.from(element.querySelectorAll(`[data-port-direction="${side}"]`)).forEach((port, index) => {
          const rect = port.getBoundingClientRect(), key = `${id}:${side}:${index}`
          const offset = { x: (rect.left + rect.width / 2 - box.left) / viewRef.current.zoom, y: (rect.top + rect.height / 2 - box.top) / viewRef.current.zoom }
          const old = socketOffsets.current.get(key)
          if (!old || Math.abs(old.x - offset.x) > 0.1 || Math.abs(old.y - offset.y) > 0.1) { socketOffsets.current.set(key, offset); changed = true }
        })
      }
      if (changed) refreshLayout((value) => value + 1)
    }
    const observer = new ResizeObserver(measure)
    for (const element of Object.values(nodeEls.current)) observer.observe(element)
    if (wrapRef.current) observer.observe(wrapRef.current)
    measure()
    return () => observer.disconnect()
  }, [nc.nodes.length, selected.join(','), propertiesOpen, narrow])

  // ---- undo (Ctrl+Z): 20-step stack of graph snapshots, session-only ----
  // Pushed before structural mutations (add/delete/move/wire/clear/load/import),
  // NOT on field edits — text inputs keep native undo.
  const history = useRef([])
  const future = useRef([])
  const [, refreshHistory] = useState(0)
  const pushHistory = () => {
    history.current.push(ncRef.current)
    if (history.current.length > 20) history.current.shift()
    future.current = []
    editGroupRef.current = ''
    refreshHistory((value) => value + 1)
  }
  const undo = () => {
    const prev = history.current.pop()
    if (prev) {
      if (commitTimer.current) clearTimeout(commitTimer.current)
      pendingViewRef.current = null
      future.current.push(ncRef.current)
      onChange((current) => restoreCanvasGraph(current, prev))
      setView({ panX: prev.pan_x || 0, panY: prev.pan_y || 0, zoom: prev.zoom || 1 })
      setSelected([]); setSelectedWire(null); setRunReview(null)
      refreshHistory((value) => value + 1)
    }
  }
  const redo = () => {
    const next = future.current.pop()
    if (next) {
      if (commitTimer.current) clearTimeout(commitTimer.current)
      pendingViewRef.current = null
      history.current.push(ncRef.current)
      onChange((current) => restoreCanvasGraph(current, next))
      setView({ panX: next.pan_x || 0, panY: next.pan_y || 0, zoom: next.zoom || 1 })
      setSelected([]); setSelectedWire(null); setRunReview(null)
      refreshHistory((value) => value + 1)
    }
  }
  const duplicateSelection = () => {
    if (!selected.length) return
    const copied = duplicateNodes(ncRef.current, selected)
    pushHistory(); onChange(() => copied.canvas); setSelected(copied.nodeIds)
    setBoardNotice(`Duplicated ${copied.nodeIds.length} draft node(s). Existing outputs stay with their original nodes.`)
  }

  // JSON import, undo and asynchronous server load restore the actual viewport.
  // A local drag/zoom owns its view until the gesture is committed.
  useEffect(() => {
    const next = { panX: nc.pan_x || 0, panY: nc.pan_y || 0, zoom: nc.zoom || 1 }
    const previous = savedViewRef.current
    savedViewRef.current = next
    if (!pan && !drag && (previous.panX !== next.panX || previous.panY !== next.panY || previous.zoom !== next.zoom)) {
      if (commitTimer.current) clearTimeout(commitTimer.current)
      pendingViewRef.current = null
      setView(next)
    }
  }, [nc.pan_x, nc.pan_y, nc.zoom, pan, drag])
  useEffect(() => () => {
    if (commitTimer.current) clearTimeout(commitTimer.current)
    const pending = pendingViewRef.current
    if (pending) onChangeRef.current((current) => ({ ...current, pan_x: pending.panX, pan_y: pending.panY, zoom: pending.zoom }))
  }, [])

  const isSelected = (id) => selected.includes(id)

  // Canvas scenes available for attach/import (number + short summary).
  const sceneOptions = (scenes || []).map((s) => ({
    scene_number: Number(s.scene_number),
    summary: String(s.what_happens || s.scene_type || '').slice(0, 40)
  }))

  // Convert a screen event to canvas coordinates (accounting for pan + zoom).
  const toCanvas = (clientX, clientY) => {
    const r = wrapRef.current.getBoundingClientRect()
    const v = viewRef.current
    return { x: (clientX - r.left - v.panX) / v.zoom, y: (clientY - r.top - v.panY) / v.zoom }
  }

  const commitView = (next) => {
    if (commitTimer.current) clearTimeout(commitTimer.current)
    pendingViewRef.current = next
    commitTimer.current = setTimeout(() => {
      pendingViewRef.current = null
      onChange((c) => ({ ...c, pan_x: next.panX, pan_y: next.panY, zoom: next.zoom }))
    }, 250)
  }

  const setData = (id, patch) => {
    const keys = Object.keys(patch).filter((key) => NODE_INPUT_FIELDS.has(key))
    if (keys.length) {
      const group = `${id}:${keys.join(',')}`
      if (editGroupRef.current !== group) { pushHistory(); editGroupRef.current = group }
      setRunReview(null)
    }
    onChange((c) => updateNodeData(c, id, patch))
  }

  const availableModels = useMemo(() => capabilities.filter((model) => model.configured && model.priced), [capabilities])
  const capabilityPatch = (node, model) => {
    const d = node.data || {}, patch = { model_id: model.id, stale: true }
    if (model.aspects?.length && !model.aspects.includes(d.aspect_ratio)) patch.aspect_ratio = model.aspects[0]
    if (model.resolutions?.length && !model.resolutions.includes(d.resolution)) patch.resolution = model.resolutions[0]
    if (model.durations?.length && !model.durations.includes(Number(d.duration_seconds))) patch.duration_seconds = model.durations[0]
    if (model.imageSizes?.length && !model.imageSizes.some((size) => size.id === d.image_size)) {
      const [width, height] = (patch.aspect_ratio || d.aspect_ratio || '1:1').split(':').map(Number)
      const size = model.imageSizes.find((entry) => Math.abs(entry.width / entry.height - width / height) < 0.035) || model.imageSizes[0]
      patch.image_size = size.id
      const aspect = model.aspects?.find((value) => { const [w, h] = value.split(':').map(Number); return Math.abs(size.width / size.height - w / h) < 0.035 })
      if (aspect) patch.aspect_ratio = aspect
    }
    if (model.modes?.length && d.mode && !model.modes.includes(d.mode)) patch.mode = model.modes[0]
    patch.count = Math.max(model.quantity?.min || 1, Math.min(model.quantity?.max || 1, Number(d.count) || 1))
    if (!model.audio) patch.generate_audio = false
    return patch
  }
  const applyCapability = (node, model) => {
    const patch = capabilityPatch(node, model)
    setData(node.id, patch)
    const reset = Object.keys(patch).filter((key) => !['model_id', 'stale', 'count'].includes(key))
    setBoardNotice(reset.length ? `Model changed. Compatible inputs kept; ${reset.map((key) => key.replaceAll('_', ' ')).join(', ')} updated to supported settings. Review a new quote before running.` : 'Model changed. Review a new quote before running.')
  }
  const setImageSize = (node, model, sizeId) => {
    const size = model?.imageSizes?.find((entry) => entry.id === sizeId)
    const aspect = size && model.aspects?.find((value) => { const [width, height] = value.split(':').map(Number); return Math.abs(size.width / size.height - width / height) < 0.035 })
    setData(node.id, { image_size: sizeId, ...(aspect ? { aspect_ratio: aspect } : {}) })
  }
  const setImageAspect = (node, model, aspect) => {
    const [width, height] = aspect.split(':').map(Number)
    const size = model?.imageSizes?.find((entry) => Math.abs(entry.width / entry.height - width / height) < 0.035)
    setData(node.id, { aspect_ratio: aspect, ...(size ? { image_size: size.id } : {}) })
  }

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

  const spawnAt = (type, cx, cy, selectedModel) => {
    const n = newNode(type, cx, cy)
    const capability = type === 'image_generator' ? 'generate_image' : type === 'video_generator' ? 'generate_video' : ''
    const model = selectedModel || availableModels.find(entry => entry.capability === capability && entry.provider === 'mock') || availableModels.find(entry => entry.capability === capability)
    if (model) n.data = {...n.data, ...(model.capability ? capabilityPatch(n, model) : {model_id:model.id})}
    pushHistory()
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
    const touchMove = (event) => { if (event.pointerType === 'touch') move(event) }
    const touchUp = (event) => { if (event.pointerType === 'touch') up() }
    window.addEventListener('pointermove', touchMove)
    window.addEventListener('pointerup', touchUp)
    window.addEventListener('pointercancel', touchUp)
    return () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      window.removeEventListener('pointermove', touchMove)
      window.removeEventListener('pointerup', touchUp)
      window.removeEventListener('pointercancel', touchUp)
    }
  })

  // ---- zoom (wheel) around cursor ----
  const onWheel = (e) => {
    if (e.target.closest('textarea, select, .node-menu')) return
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
    function isTyping(event) {
      return isEditableTarget(event?.target) || isEditableTarget(document.activeElement)
    }
    function down(e) {
      if (runReview || (narrow && propertiesOpen) || resultModalNodeId) return
      if (e.code === 'Space' && !isTyping(e)) {
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
      if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z') && !isTyping(e)) {
        e.preventDefault()
        if (e.shiftKey) redo(); else undo()
        return
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y' && !isTyping(e)) {
        e.preventDefault(); redo()
        return
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd' && !isTyping(e)) {
        e.preventDefault(); duplicateSelection()
        return
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'a' || e.key === 'A') && !isTyping(e)) {
        e.preventDefault()
        setSelected((nc.nodes || []).map((n) => n.id))
        return
      }
      if (e.key !== 'Delete' && e.key !== 'Backspace') return
      if (isTyping(e)) return
      if (selectedWire) {
        pushHistory()
        onChange((c) => removeConnection(c, selectedWire))
        setSelectedWire(null)
        return
      }
      if (selected.length) {
        const withResults = (nc.nodes || []).filter((n) => selected.includes(n.id) && nodeHasResult(n))
        if (withResults.length && !window.confirm(`Delete ${selected.length} node(s)? ${withResults.length} of them have results attached.`)) return
        pushHistory()
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
    setMenu({ sx: Math.max(8, Math.min(e.clientX - r.left, r.width - 208)), sy: Math.max(8, Math.min(e.clientY - r.top, r.height - 360)), cx: p.x, cy: p.y })
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
    pushHistory() // undo restores pre-drag positions
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
    if (wouldCreateCycle(ncRef.current, wire.fromNode, node.id)) {
      setBoardNotice('Connection rejected: this would create a circular dependency.')
      setWire(null); return
    }
    if (socketType(node.type, 'input', socketName) !== wire.fromType) {
      setBoardNotice('Connection rejected: connect ports with the same media type.')
      setWire(null); return
    }
    pushHistory()
    onChange((c) => addConnection(c, { from_node: wire.fromNode, from_socket: wire.fromSocket, to_node: node.id, to_socket: socketName }))
    setWire(null)
    setBoardNotice('Connected. Changed downstream outputs are marked stale; nothing runs automatically.')
  }
  // Live compatibility hint while a wire is being dragged.
  const wireSockClass = (node, s) => {
    if (!wire) return ''
    if (wouldCreateCycle(nc, wire.fromNode, node.id)) return ' gsock-bad'
    return socketType(node.type, 'input', s.name) === wire.fromType ? ' gsock-ok' : ' gsock-bad'
  }

  // ---- upload-to-library plumbing (Upload / Reference / Character / Style) ----
  async function pickImageFile(node, file, extraPatch = {}) {
    if (!file || !['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 15 * 1024 * 1024) {
      setData(node.id, { status_message: 'Choose a PNG, JPEG or WebP image under 15 MB.' })
      return
    }
    const meta = await readImageFile(file)
    setPreviews((p) => ({ ...p, [node.id]: meta.dataUrl }))
    setData(node.id, {
      file_name: file.name,
      mime_type: file.type || 'image/png',
      ...(node.type === 'upload' || node.type === 'reference' ? { width: meta.width, height: meta.height, file_size: file.size || 0 } : {}),
      local_url: '',
      asset_id: null,
      storage: 'session',
      status_message: '',
      ...extraPatch
    })
  }

  // Explicit: persist the session preview via the EXISTING media save endpoint,
  // normalized through the Media Result Contract. Stores local_url (not data_url).
  async function saveNodeImageToLibrary(node) {
    if (savingNodesRef.current.has(node.id)) return
    const dataUrl = previews[node.id]
    const d = node.data || {}
    if (!dataUrl && !d.local_url) {
      setData(node.id, { status_message: 'Choose an image first.' })
      return
    }
    savingNodesRef.current.add(node.id)
    setUploadBusy(node.id)
    const res = d.local_url ? { success: true, local_url: d.local_url, file_name: d.file_name, mime_type: d.mime_type } : await saveMediaToLocal({ file_name: d.file_name || 'upload', mime_type: d.mime_type || 'image/png', data_url: dataUrl, category: 'asset', scene_id: '' })
    if (!res || !res.success) {
      setData(node.id, { status_message: (res && res.error) || 'Save failed (is the local backend running?).' })
      setUploadBusy('')
      savingNodesRef.current.delete(node.id)
      return
    }
    const result = normalizeMediaResult({ provider_id: 'manual', source_type: 'upload', media_type: 'image', local_url: res.local_url, file_name: res.file_name, mime_type: res.mime_type, file_size: res.file_size, storage: 'local_disk', status: 'success' })
    setData(node.id, { local_url: result.local_url, storage: 'local_disk', file_name: result.file_name, mime_type: result.mime_type, status_message: 'Registering local Asset…' })
    try {
      const asset = await registerSavedAsset(result)
      setData(node.id, { asset_id: asset.id, status_message: 'Saved to the shared Asset library.' })
    } catch (error) {
      setData(node.id, { status_message: `File saved. ${error.message}` })
    } finally { setUploadBusy(''); savingNodesRef.current.delete(node.id) }
  }

  // Save a generator node's RESULT (session data-url from the engine) to disk.
  async function saveResultToLibrary(node) {
    if (savingNodesRef.current.has(node.id)) return
    const d = node.data || {}
    const dataUrl = previews['result:' + node.id]
    if (!dataUrl && !d.result_external_url && !d.result_local_url) {
      setData(node.id, { status_message: 'No result to save yet.' })
      return
    }
    if (!dataUrl && !d.result_local_url) {
      setData(node.id, { status_message: 'Result is an external URL — already addressable; nothing to save.' })
      return
    }
    savingNodesRef.current.add(node.id)
    setUploadBusy(node.id)
    const res = d.result_local_url && !dataUrl ? { success: true, local_url: d.result_local_url, file_name: d.result_file_name, mime_type: d.result_mime_type } : await saveMediaToLocal({
      file_name: d.result_file_name || `${node.type}-result.${node.type === 'video_generator' ? 'mp4' : 'png'}`,
      mime_type: d.result_mime_type || (node.type === 'video_generator' ? 'video/mp4' : 'image/png'),
      ...(dataUrl ? { data_url: dataUrl } : { local_url: d.result_local_url }),
      category: 'variation',
      scene_id: ''
    })
    if (!res || !res.success) {
      setUploadBusy('')
      savingNodesRef.current.delete(node.id)
      setData(node.id, { status_message: (res && res.error) || 'Save failed (is the local backend running?).' })
      return
    }
    setData(node.id, { result_local_url: res.local_url, result_file_name: res.file_name, result_mime_type: res.mime_type, status_message: 'Registering local Asset…' })
    try {
      const asset = await registerSavedAsset(res)
      setData(node.id, { result_asset_id: asset.id, result_saved: true, status_message: 'Saved to the shared Asset library.' })
    } catch (error) { setData(node.id, { status_message: `File saved. ${error.message}` }) }
    finally { setUploadBusy(''); savingNodesRef.current.delete(node.id) }
  }

  // ---- generation ----
  const [manualEntry, setManualEntry] = useState(null) // node id with the URL-paste form open

  const runNode = async (node, opts = {}) => {
    if (!onGenerateNode) return
    const action = node.type === 'video_generator' ? 'generate_video' : 'generate_image'
    const result = await onGenerateNode(node.id, action, opts)
    // A data_url result stays a SESSION preview only — never persisted on the node.
    if (result && result.data_url) {
      setPreviews((p) => ({ ...p, ['result:' + node.id]: result.data_url }))
    }
    if (result && result.status === 'success') setResultModalNodeId(node.id)
    return result
  }

  const generate = (node) => {
    if (onRequestProduction) {
      setRunReview({ nodeIds: [node.id], scope: 'node' })
      return
    }
    const m = modelById((node.data || {}).model_id)
    if (m && m.id === 'manual') {
      setManualEntry(node.id)
      return
    }
    if (!['mock-image', 'mock-video'].includes(node.data?.model_id)) {
      setBoardNotice('This saved model is unavailable. Choose a configured model in the production picker.'); return
    }
    // The legacy path is retained only for local, free fixtures. Configuring a
    // legacy provider never authorizes a paid request from this board.
    if (node.data?.model_id === 'mock-video' && providerMode === 'api' && videoProviderId !== 'mock') {
      setBoardNotice('Use the shared production model picker for paid video.'); return
    }
    runNode(node)
  }

  const generateDisabledReason = (node) => {
    const d = node.data || {}
    if (!d.model_id) return 'Select a model first'
    if (['queued', 'generating', 'downloading', 'reconciliation_required'].includes(d.status)) return 'Existing production is active or requires reconciliation'
    if (onRequestProduction && !availableModels.some((model) => model.id === d.model_id)) return 'Choose a configured, priced model'
    if (!onRequestProduction && !['mock-image', 'mock-video', 'manual'].includes(d.model_id)) return 'This model needs the shared production connection'
    const m = modelById(d.model_id)
    if (m && m.id !== 'manual' && !effectivePromptText(nc, node.id).trim()) return 'Connect or type a prompt first'
    return ''
  }

  // ---- shared render bits ----
  const renderThumb = (url, alt) => {
    if (!url) return null
    if (url.startsWith('/media/') || url === '/mock-video-output.mp4') url = apiBase() + url
    const kind = classifyMedia(url)
    if (kind === 'mock') return <div className="media-mock">Mock result: {url}</div>
    if (kind === 'video') return <video className="nc-media" src={url} controls muted playsInline preload="metadata" aria-label={alt || 'video preview'} onPointerDown={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()} onError={() => setBoardNotice('This media file is unavailable. The saved Asset reference has been preserved.')} />
    return <img className="nc-media" src={url} alt={alt || 'preview'} loading="lazy" draggable={false} onError={(event) => { event.currentTarget.dataset.missing = 'true' }} />
  }

  const renderResultBlock = (node) => {
    const d = node.data || {}
    const url = d.result_local_url || d.result_external_url || previews['result:' + node.id] || ''
    if (!url) return null
    return (
      <div className="gnode-result">
        {renderThumb(url, 'result')}
        {d.stale ? <span className="nc-stale">Previous output · inputs changed</span> : null}
        <div className="row" style={{ marginTop: 6 }}>
          {onUseInCreative && (d.selected_asset_id || d.result_asset_id) ? <button className="primary small" onClick={() => Promise.resolve(onUseInCreative(node.id)).catch((error) => setBoardNotice(error.message || 'Could not link this Asset to the Creative.'))}>Use in Creative</button> : null}
          {(previews['result:' + node.id] || d.result_local_url) && !d.result_saved ? (
            <button className="ghost small" onClick={() => saveResultToLibrary(node)} disabled={uploadBusy === node.id} aria-label="Save result to Media Library">
              {uploadBusy === node.id ? 'Saving…' : 'Save to Media Library'}
            </button>
          ) : null}
          {d.result_saved ? <span className="media-health health-ok">Saved ✓</span> : null}
          {d.result_local_url && d.result_saved ? <button className="ghost small" disabled>Saved to Local Media Library</button> : null}
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

  // Manual model: paste a URL as the node's result (no generation, no credits).
  const renderManualEntry = (node) => {
    if (manualEntry !== node.id) return null
    const apply = () => {
      const el = document.getElementById(`manual-url-${node.id}`)
      const url = el ? el.value.trim() : ''
      if (!url) {
        setData(node.id, { status_message: 'Paste a URL first.' })
        return
      }
      setData(node.id, { status: 'done', status_message: '', result_external_url: url, result_local_url: '', result_saved: false })
      // Manual results feed wired Output nodes too, like generated ones.
      onChange((c) => propagateResultToOutputs(c, node.id, { url, media_type: node.type === 'video_generator' ? 'video' : 'image' }))
      setManualEntry(null)
    }
    return (
      <div className="gnode-attach" onMouseDown={(e) => e.stopPropagation()}>
        <span className="field-label">Result URL:</span>
        <input
          id={`manual-url-${node.id}`}
          type="text"
          placeholder="https://…"
          aria-label="Manual result URL"
          onKeyDown={(e) => {
            if (e.key === 'Enter') apply()
          }}
        />
        <button className="primary small" onClick={apply}>
          Apply
        </button>
        <button className="ghost small" onClick={() => setManualEntry(null)}>
          Cancel
        </button>
      </div>
    )
  }

  const renderGenFooter = (node) => {
    const d = node.data || {}
    const reason = generateDisabledReason(node)
    const busy = ['queued', 'generating', 'downloading'].includes(d.status)
    return (
      <div className="gnode-footer">
        <span className={`badge gen-status status-${d.status || 'idle'}`}>{d.stale && d.status === 'done' ? 'Stale' : STATUS_LABELS[d.status] || 'Draft'}</span>
        <button
          className="primary small"
          disabled={!!reason}
          title={reason || 'Run this node'}
          aria-label={`Generate ${NODE_DEFS[node.type] ? NODE_DEFS[node.type].title : node.type}`}
          onClick={() => generate(node)}
        >
          {busy ? 'Working…' : onRequestProduction ? 'Run Node' : 'Generate'}
        </button>
        <span className="gnode-credit">{onRequestProduction ? 'Quote before run' : creditEstimateForModel(d.model_id)}</span>
        {reason ? <small className="nc-input-warning">{reason}</small> : null}
        {d.status === 'error' && d.status_message ? <div className="gnode-error">{d.status_message}</div> : null}
      </div>
    )
  }

  const modelSelect = (node, type) => {
    const d = node.data || {}
    const shared = capabilities.filter((model) => model.capability === (type === 'image' ? 'generate_image' : 'generate_video'))
    const models = shared.length ? shared : modelsForType(type).filter((model) => ['mock-image', 'mock-video', 'manual'].includes(model.id))
    const current = models.find((model) => model.id === d.model_id)
    return (
      <label className="field">
        <span className="field-label">Model</span>
        <select value={d.model_id || ''} onChange={(e) => {
          const model = shared.find((entry) => entry.id === e.target.value)
          if (model) applyCapability(node, model); else setData(node.id, { model_id: e.target.value })
        }} aria-label="Generation model">
          <option value="">(choose model)</option>
          {models.map((m) => (
            <option key={m.id} value={m.id} disabled={m.capability ? !m.configured || !m.priced : false}>
              {m.label || m.name}{m.capability && (!m.configured || !m.priced) ? ' · unavailable' : ''}
            </option>
          ))}
          {d.model_id && !current ? <option value={d.model_id} disabled>{d.model_id} (unavailable saved model)</option> : null}
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
    if (d.asset_id || (!d.local_url && !previews[node.id])) return null
    return (
      <div className="row">
        <button className="primary small" onClick={() => saveNodeImageToLibrary(node)} disabled={uploadBusy === node.id}>
          {uploadBusy === node.id ? 'Saving…' : d.local_url ? 'Register saved Asset' : 'Save to Library'}
        </button>
        <span className="media-health health-warn">{d.local_url ? 'File saved · registration needed' : 'Session preview'}</span>
      </div>
    )
  }

  const libraryPicker = (node, mediaType = 'image') => {
    const items = (savedMedia || []).map((asset) => ({ ...asset, local_url: asset.local_url || (asset.relative_path ? `/media/${asset.relative_path.replaceAll('\\', '/')}` : '') })).filter((asset) => asset.local_url && (!asset.mime_type || asset.mime_type.startsWith(`${mediaType}/`)))
    if (!items.length) return <small className="hint">No saved {mediaType} Assets available.</small>
    return <label className="field"><span className="field-label">Use existing {mediaType}</span><select aria-label={`Existing ${mediaType} Asset`} value={node.data?.local_url || ''} onChange={(event) => {
      const item = items.find((asset) => asset.local_url === event.target.value)
      if (!item) return
      setData(node.id, { asset_id: item.id || item.asset_id || null, local_url: item.local_url, file_name: item.file_name || item.relative_path?.split('/').at(-1) || '', mime_type: item.mime_type || '', media_type: mediaType, storage: 'local_disk' })
    }}><option value="">Choose an Asset</option>{items.map((asset) => <option key={asset.id || asset.local_url} value={asset.local_url}>{asset.file_name || asset.relative_path?.split('/').at(-1) || asset.local_url}</option>)}</select></label>
  }

  // Per-type properties area.
  const renderBody = (node) => {
    const d = node.data || {}
    const connectedPrompt = (nc.connections || []).some((connection) => connection.to_node === node.id && connection.to_socket === 'prompt')
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
      const items = (savedMedia || []).map((item) => ({ ...item, local_url: item.local_url || (item.relative_path ? `/media/${item.relative_path.replaceAll('\\', '/')}` : '') })).filter((item) => !item.mime_type || item.mime_type.startsWith('image/'))
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
                  setData(node.id, { local_url: url, asset_id: item?.id || item?.asset_id || null, file_name: (item && item.file_name) || '', width: (item && item.width) || 0, height: (item && item.height) || 0 })
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
          <label className="field"><span className="field-label">Media type</span><select aria-label="Reference media type" value={d.media_type || 'image'} onChange={(event) => setData(node.id, { media_type: event.target.value, local_url: '', file_url: '', asset_id: null, mime_type: '' })}><option value="image">Image</option><option value="video">Video</option></select></label>
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
          {d.frame_prompt ? (
            <label className="field">
              <span className="field-label">Frame prompt</span>
              <textarea rows={4} value={d.frame_prompt} onChange={(e) => setData(node.id, { frame_prompt: e.target.value })} aria-label="Frame prompt" />
            </label>
          ) : null}
          {d.media_type === 'video' ? renderThumb(thumb, 'Reference video') : uploadZone(node, thumb)}
          {libraryPicker(node, d.media_type === 'video' ? 'video' : 'image')}
          {d.media_type === 'video' ? <p className="hint small">For Reference-to-video: prepare the original in Video → Remix, then choose its prepared reference.mp4 here. Add product images in Remix to validate them first. Preparation is local and free.</p> : null}
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
          {libraryPicker(node)}
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
          {libraryPicker(node)}
          {saveToLibraryRow(node)}
          {d.status_message ? <div className="note">{d.status_message}</div> : null}
        </div>
      )
    }
    if (node.type === 'output') {
      const variations = Array.isArray(d.variations) ? d.variations : []
      const sel = d.selected_variation_id ? variations.findIndex((variation) => variation.id === d.selected_variation_id) : d.selected_asset_id ? variations.findIndex((variation) => Number(variation.asset_id) === Number(d.selected_asset_id)) : d.selected_variation_index
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
                        selected_variation_id: v.id,
                        selected_asset_id: v.asset_id || null,
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
            {onUseInCreative && d.selected_asset_id ? <button className="primary small" onClick={() => Promise.resolve(onUseInCreative(node.id)).catch((error) => setBoardNotice(error.message || 'Could not link this Asset to the Creative.'))}>Use in Creative</button> : null}
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
      const capability = capabilities.find((model) => model.id === d.model_id)
      const aspects = capability?.aspects?.length ? capability.aspects : IMAGE_ASPECT_RATIOS
      return (
        <div className="gnode-body">
          <label className="field">
            <span className="field-label">User prompt</span>
            <textarea rows={2} value={d.user_prompt || ''} onChange={(e) => setData(node.id, { user_prompt: e.target.value })} aria-label="Image prompt" />
          </label>
          {connectedPrompt ? <small className="hint">Using the connected Prompt. This field is the fallback when it is disconnected.</small> : null}
          {modelSelect(node, 'image')}
          {capability?.imageSizes?.length ? <label className="field"><span className="field-label">Image size</span><select aria-label="Image size" value={d.image_size || ''} onChange={(event) => setImageSize(node, capability, event.target.value)}><option value="" disabled>Choose size</option>{capability.imageSizes.map((size) => <option key={size.id} value={size.id}>{size.label || `${size.width} × ${size.height}`}</option>)}</select></label> : null}
          <div className="two">
            <label className="field">
              <span className="field-label">Aspect ratio</span>
              <select value={d.aspect_ratio || '1:1'} onChange={(e) => setImageAspect(node, capability, e.target.value)} aria-label="Aspect ratio">
                {!aspects.includes(d.aspect_ratio) ? <option value={d.aspect_ratio} disabled>{d.aspect_ratio} · choose supported shape</option> : null}
                {aspects.map((a) => (
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
          {capability ? <label className="field"><span className="field-label">Outputs</span><select aria-label="Image outputs" value={d.count || 1} onChange={(event) => setData(node.id, { count: Number(event.target.value) })}>{Array.from({ length: capability.quantity?.max || 1 }, (_, i) => i + 1).map((count) => <option key={count} value={count}>Outputs: {count}</option>)}</select></label> : null}
          {renderResultBlock(node)}
          {renderManualEntry(node)}
          {renderGenFooter(node)}
          {d.status !== 'error' && d.status_message ? <div className="note">{d.status_message}</div> : null}
        </div>
      )
    }
    if (node.type === 'video_generator') {
      const capability = capabilities.find((model) => model.id === d.model_id)
      const dur = Number(d.duration_seconds) || 5
      const durations = capability?.durations?.length ? capability.durations : VIDEO_DURATIONS.includes(dur) ? VIDEO_DURATIONS : [dur, ...VIDEO_DURATIONS]
      const referenceMode = d.mode === 'reference-to-video' || (nc.connections || []).some((connection) => connection.to_node === node.id && connection.to_socket === 'reference_video')
      const aspects = referenceMode && capability?.referenceAspects?.length ? capability.referenceAspects : capability?.aspects?.length ? capability.aspects : ASPECT_RATIOS
      const resolutions = capability?.resolutions?.length ? capability.resolutions : RESOLUTIONS
      return (
        <div className="gnode-body">
          <label className="field">
            <span className="field-label">User prompt</span>
            <textarea rows={2} value={d.user_prompt || ''} onChange={(e) => setData(node.id, { user_prompt: e.target.value })} aria-label="Video prompt" />
          </label>
          {connectedPrompt ? <small className="hint">Using the connected Prompt. This field is the fallback when it is disconnected.</small> : null}
          {modelSelect(node, 'video')}
          {providerMode === 'api' && videoProviderId === 'replicate' ? (
            <label className="field">
              <span className="field-label">Replicate model</span>
              <select value={d.replicate_model || 'ltx'} onChange={(e) => setData(node.id, { replicate_model: e.target.value })} aria-label="Replicate video model">
                {REPLICATE_VIDEO_MODEL_OPTIONS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <div className="two">
            <label className="field">
              <span className="field-label">Duration</span>
              <select value={dur} onChange={(e) => setData(node.id, { duration_seconds: Number(e.target.value) || 5 })} aria-label="Duration in seconds">
                {!durations.includes(dur) ? <option value={dur} disabled>{dur}s · choose supported duration</option> : null}
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
                {!aspects.includes(d.aspect_ratio) ? <option value={d.aspect_ratio} disabled>{d.aspect_ratio} · choose supported shape</option> : null}
                {aspects.map((a) => (
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
                {!resolutions.includes(d.resolution) ? <option value={d.resolution} disabled>{d.resolution} · choose supported resolution</option> : null}
                {resolutions.map((r) => (
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
          {capability ? <div className="two"><label className="field"><span className="field-label">Outputs</span><select aria-label="Video outputs" value={d.count || 1} onChange={(event) => setData(node.id, { count: Number(event.target.value) })}>{Array.from({ length: capability.quantity?.max || 1 }, (_, i) => i + 1).map((count) => <option key={count} value={count}>Outputs: {count}</option>)}</select></label>{capability.audio ? <label className="nc-audio"><input type="checkbox" checked={!!d.generate_audio} onChange={(event) => setData(node.id, { generate_audio: event.target.checked })} />Generate audio</label> : null}</div> : null}
          {renderResultBlock(node)}
          {renderManualEntry(node)}
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

  // ---- sidebar: palette spawn + model gallery ----
  const spawnAtCenter = (type, selectedModel) => {
    const p = viewportCenter()
    const candidates = [[0, 0], [320, 0], [-320, 0], [0, 360], [0, -360], [320, 360], [-320, 360], [640, 0], [-640, 0]]
    const free = candidates.map(([dx, dy]) => ({ x: p.x - 140 + dx, y: p.y - 100 + dy })).find((candidate) => !(nc.nodes || []).some((node) => candidate.x < node.x + (node.width || 280) + 24 && candidate.x + 304 > node.x && candidate.y < node.y + nodeHeight(node) + 24 && candidate.y + EST_NODE_HEIGHT + 24 > node.y)) || { x: p.x - 140, y: Math.max(p.y - 100, ...(nc.nodes || []).map((node) => node.y + nodeHeight(node) + 40)) }
    const created = spawnAt(type, free.x, free.y, selectedModel)
    const rect = wrapRef.current?.getBoundingClientRect(), v = viewRef.current
    if (rect && (free.x * v.zoom + v.panX < 0 || (free.x + 280) * v.zoom + v.panX > rect.width || free.y * v.zoom + v.panY < 0 || (free.y + EST_NODE_HEIGHT) * v.zoom + v.panY > rect.height)) {
      const next = { ...v, panX: rect.width / 2 - (free.x + 140) * v.zoom, panY: rect.height / 2 - (free.y + EST_NODE_HEIGHT / 2) * v.zoom }
      setView(next); commitView(next)
    }
    return created
  }

  const builtinIds = new Set(MODEL_REGISTRY.map((m) => m.id))
  const galleryModels = capabilities.length ? capabilities.map((model) => ({ ...model, name: model.label, type: model.capability === 'generate_image' ? 'image' : 'video', category: model.configured && model.priced ? 'Available' : 'Unavailable', description: `${model.provider} · ${model.model}`, unavailable: !model.configured || !model.priced })) : MODEL_REGISTRY.filter((model) => ['mock-image', 'mock-video', 'manual'].includes(model.id))

  // "Use" a gallery model: applies to the selected generator if compatible,
  // otherwise creates a new generator node at center with the model pre-selected.
  const useModel = (m) => {
    const selNode = selected.length === 1 ? (nc.nodes || []).find((n) => n.id === selected[0]) : null
    const compatible = (node) =>
      node && ((node.type === 'image_generator' && (m.type === 'image' || m.type === 'any')) || (node.type === 'video_generator' && (m.type === 'video' || m.type === 'any')))
    if (compatible(selNode)) {
      if (m.capability) applyCapability(selNode, m); else setData(selNode.id, { model_id: m.id })
      return
    }
    const type = m.type === 'video' ? 'video_generator' : 'image_generator'
    spawnAtCenter(type, m)
  }

  // ---- Run All: every idle/error generator, upstream first ----
  const anyGenerating = (nc.nodes || []).some((n) => ['queued', 'generating', 'downloading'].includes(n.data?.status))
  const runnableNodes = () => {
    const byId = {}
    ;(nc.nodes || []).forEach((n) => (byId[n.id] = n))
    return topologicalNodeOrder(nc)
      .map((id) => byId[id])
      .filter((n) => n && GENERATOR_TYPES.includes(n.type))
      .filter((n) => !n.data || !n.data.status || n.data.status === 'idle' || n.data.status === 'error')
      .filter((n) => n.data && n.data.model_id && n.data.model_id !== 'manual') // manual nodes need user input — skip in batch
  }

  async function runAll() {
    if (onRequestProduction) { setRunReview({ nodeIds: [], scope: 'workflow' }); return }
    if (!onGenerateNode || runningAll || anyGenerating) return
    const nodes = runnableNodes().filter((node) => ['mock-image', 'mock-video'].includes(node.data?.model_id))
    if (providerMode === 'api' && videoProviderId !== 'mock' && nodes.some((node) => node.type === 'video_generator')) {
      setBoardNotice('Legacy video routing is unavailable. Choose a configured shared production model.'); return
    }
    if (!nodes.length) {
      window.alert('Nothing to run — no idle image/video generator with a non-manual model.')
      return
    }
    let msg = `This will generate ${nodes.length} node(s). Continue?`
    const paid = nodes.filter((n) => modelUsesCredits(n.data.model_id))
    if (paid.length) msg += `\n\nWarning: ${paid.length} node(s) use real API models and will use credits.`
    if (!window.confirm(msg)) return
    setRunningAll(true)
    try {
      for (const n of nodes) {
        // Sequential, upstream first, so downstream nodes can consume fresh
        // results. The batch confirm above already covered the credit warning.
        // eslint-disable-next-line no-await-in-loop
        const result = await runNode(n)
        if (!result || result.status === 'error' || result.success === false) {
          setBoardNotice('Workflow stopped after a failed local fixture. Downstream nodes were not run.'); break
        }
      }
    } finally {
      setRunningAll(false)
    }
  }
  useEffect(() => {
    if (!(nc.nodes || []).length || !wrapRef.current) return
    let fit = pendingFitRef.current
    if (!initialFitRef.current) {
      initialFitRef.current = true
      const rect = wrapRef.current.getBoundingClientRect()
      const defaultView = !nc.pan_x && !nc.pan_y && (!nc.zoom || nc.zoom === 1)
      if (defaultView && !(nc.nodes || []).some((node) => node.x + (node.width || 280) > 0 && node.y + EST_NODE_HEIGHT > 0 && node.x < rect.width && node.y < rect.height)) fit = true
    }
    pendingFitRef.current = false
    if (fit) { const frame = requestAnimationFrame(fitToScreen); return () => cancelAnimationFrame(frame) }
  }, [nc.nodes.length])
  const zoomAtCenter = (factor) => {
    if (!wrapRef.current) return
    const rect = wrapRef.current.getBoundingClientRect(), v = viewRef.current
    const zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, v.zoom * factor))
    const next = { zoom, panX: rect.width / 2 - (rect.width / 2 - v.panX) * zoom / v.zoom, panY: rect.height / 2 - (rect.height / 2 - v.panY) * zoom / v.zoom }
    setView(next); commitView(next)
  }
  useEffect(() => {
    const element = wrapRef.current
    if (!element) return
    element.addEventListener('wheel', onWheel, { passive: false })
    return () => element.removeEventListener('wheel', onWheel)
  })

  const startTemplate = (template) => {
    const result = addStarterGraph(ncRef.current, template)
    const added = new Set(result.nodeIds)
    result.canvas = {...result.canvas, nodes: result.canvas.nodes.map(node => {
      if (!added.has(node.id)) return node
      const capability = node.type === 'image_generator' ? 'generate_image' : node.type === 'video_generator' ? 'generate_video' : ''
      const model = availableModels.find(entry => entry.capability === capability && entry.provider === 'mock') || availableModels.find(entry => entry.capability === capability)
      return model ? {...node, data: {...node.data, ...capabilityPatch(node, model)}} : node
    })}
    pendingFitRef.current = true
    pushHistory(); onChange(() => result.canvas); setSelected(result.nodeIds)
    setBoardNotice(template === 'scenes' ? 'Added editable scene drafts. Link approved outputs to a Creative for ordered assembly.' : 'Added an editable starter graph. Choose inputs and review a quote when ready.')
  }

  const review = runReview ? compileCanvasExecution(nc, { ...runReview, capabilities }) : null
  const selectedNode = selected.length === 1 ? (nc.nodes || []).find((node) => node.id === selected[0]) : null
  const selectedNodeTitle = selectedNode ? (selectedNode.data?.label || NODE_DEFS[selectedNode.type]?.title || 'Node') : ''
  useEffect(() => {
    if (!runReview && !(narrow && propertiesOpen && selectedNode)) return
    const previous = document.activeElement
    const dialog = document.querySelector(runReview ? '.nc-run-review' : '.nc-properties')
    if (!dialog) return
    const focusable = () => [...dialog.querySelectorAll('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex="0"]')].filter((element) => element.getClientRects().length)
    focusable()[0]?.focus()
    const keyboard = (event) => {
      if (event.key === 'Escape' && !productionBusy) { event.preventDefault(); setRunReview(null); setPropertiesOpen(false) }
      if (event.key !== 'Tab') return
      const elements = focusable(), first = elements[0], last = elements.at(-1)
      if (!first) { event.preventDefault(); return }
      if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) { event.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', keyboard)
    return () => { document.removeEventListener('keydown', keyboard); if (previous?.isConnected) previous.focus() }
  }, [Boolean(runReview), narrow && propertiesOpen && selectedNode?.id, productionBusy])

  // Import the existing Canvas scenes as Prompt → Image Gen → Output rows.
  const importScenes = () => {
    if (!scenes.length) {
      window.alert('No Canvas scenes to import — create scenes in Canvas first.')
      return
    }
    if (!window.confirm(`Add ${scenes.length} scene(s) as nodes? Existing nodes will not be changed.`)) return
    pushHistory()
    onChange((c) => addSceneNodesToCanvas(c, scenes))
  }

  const addCustomModel = (form) => {
    const id = String(form.id || '').trim()
    const name = String(form.name || '').trim()
    if (!id) return 'Id is required.'
    if (!name) return 'Name is required.'
    if (galleryModels.some((m) => m.id === id)) return `A model with id "${id}" already exists.`
    const entry = {
      id,
      name,
      type: ['image', 'video', 'any'].includes(form.type) ? form.type : 'any',
      category: String(form.category || 'Custom').trim() || 'Custom',
      previewUrl: String(form.previewUrl || '').trim() || null,
      description: String(form.description || ''),
      custom: true
    }
    const next = [...loadCustomModels(), entry]
    if (!saveCustomModels(next)) return 'Could not persist the model (localStorage unavailable).'
    setCustomModels(next)
    return ''
  }

  return (
    <section className="panel node-canvas-panel">
      <div className="row between">
        <h2>Canvas</h2>
        <span className="hint small">
          Build with nodes. Select one to edit its settings.
        </span>
      </div>
      <CanvasToolbar
        nc={nc}
        onChange={(fn) => {
          pushHistory() // clear / load snapshot / rename are all undoable
          if (commitTimer.current) clearTimeout(commitTimer.current)
          pendingViewRef.current = null
          const draft = fn(ncRef.current)
          setView({ panX: draft.pan_x || 0, panY: draft.pan_y || 0, zoom: draft.zoom || 1 })
          onChange((current) => restoreCanvasGraph(current, draft))
        }}
        onFit={fitToScreen}
        providerMode={providerMode}
        onRunAll={runAll}
        runAllDisabled={runningAll || productionBusy || (!onGenerateNode && !onRequestProduction)}
        runAllLabel={runningAll ? 'Running…' : onRequestProduction ? 'Run Workflow' : 'Run All'}
        onImportScenes={importScenes}
        importScenesDisabled={!scenes.length}
        onUndo={undo} onRedo={redo} canUndo={history.current.length > 0} canRedo={future.current.length > 0}
        onDuplicate={duplicateSelection} canDuplicate={selected.length > 0}
        onRunSelected={onRequestProduction && selected.length ? () => setRunReview({ nodeIds: selected, scope: 'selection' }) : null}
        onTemplate={startTemplate}
      />
      {boardNotice ? <div className="nc-notice" role="status"><span>{boardNotice}</span><button className="ghost small" aria-label="Dismiss canvas notice" onClick={() => setBoardNotice('')}>×</button></div> : null}
      {narrow && nc.nodes.length ? <select className="nc-mobile-node-picker" aria-label="Edit a canvas node" value="" onChange={(event) => { if (event.target.value) { setSelected([event.target.value]); setPropertiesOpen(true) } }}><option value="">Edit a node…</option>{nc.nodes.map((node) => <option key={node.id} value={node.id}>{node.data?.label || NODE_DEFS[node.type]?.title || node.type}</option>)}</select> : null}
      {toolbarExtras}
      <div className="node-canvas-row">
        <CanvasSidebar
          open={sidebarOpen}
          onToggle={() => setSidebarOpen((o) => !o)}
          models={galleryModels}
          onSpawn={spawnAtCenter}
          onUseModel={useModel}
          onAddCustomModel={addCustomModel}
          archivedModels={[...MODEL_REGISTRY.filter((model) => !['mock-image', 'mock-video', 'manual'].includes(model.id)), ...customModels.filter((model) => !builtinIds.has(model.id))]}
        />
        <div
          className="node-canvas"
          ref={wrapRef}
          onMouseDown={onCanvasMouseDown}
          onPointerDown={(event) => { if (event.pointerType === 'touch' && !event.target.closest('.gnode, button, .nc-minimap')) onCanvasMouseDown(event) }}
          onContextMenu={onContextMenu}
          onDragOver={(e) => {
            // allow palette card drops
            if (e.dataTransfer && (Array.from(e.dataTransfer.types || []).includes('application/x-aaf-node-type') || Array.from(e.dataTransfer.types || []).includes('Files'))) e.preventDefault()
          }}
          onDrop={(e) => {
            const type = e.dataTransfer && e.dataTransfer.getData('application/x-aaf-node-type')
            e.preventDefault()
            const p = toCanvas(e.clientX, e.clientY)
            if (type) spawnAt(type, p.x - 140, p.y - 20)
            else {
              const files = Array.from(e.dataTransfer?.files || []).filter((file) => file.type.startsWith('image/')).slice(0, 8)
              files.forEach((file, index) => { const node = spawnAt('upload', p.x + index * 310, p.y); pickImageFile(node, file) })
              setBoardNotice(files.length ? 'Images added as previews. Save each to the local library before production.' : 'Drop image files here, or link an existing reference Asset.')
            }
          }}
          role="application"
          aria-label="Production node canvas"
          tabIndex={0}
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
                    className={`${selectedWire === conn.id ? 'wire wire-selected' : 'wire'} wire-type-${socketType(a.type, 'output', conn.from_socket)}`}
                    onClick={(e) => {
                      e.stopPropagation()
                      setSelectedWire((w) => (w === conn.id ? null : conn.id))
                      setSelected([])
                    }}
                  >
                    <path d={bezier(s.cx, s.cy, t.cx, t.cy)} className="wire-hit" vectorEffect="non-scaling-stroke" />
                    <path d={bezier(s.cx, s.cy, t.cx, t.cy)} className="wire-line" vectorEffect="non-scaling-stroke" />
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
                  style={{ left: node.x, top: node.y, width: node.width || 248, borderLeft: `3px solid ${nodeColor(node.type)}` }}
                  onMouseDown={(e) => onNodeMouseDown(e, node)}
                  aria-label={`${def ? def.title : node.type} node: ${title}`}
                  data-node-id={node.id}
                >
                  <div className="gnode-head" onMouseDown={(e) => startNodeDrag(e, node)} onPointerDown={(event) => { if (event.pointerType === 'touch') startNodeDrag(event, node) }} onDoubleClick={() => setEditingLabel(node.id)}>
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
                    <button className="gnode-del nc-node-edit" title="Edit node properties" aria-label={`Edit ${title}`} onMouseDown={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()} onClick={() => { setSelected([node.id]); setPropertiesOpen(true) }}>⋯</button>
                    <button
                      className="gnode-del"
                      title="Delete node"
                      aria-label={`Delete ${title}`}
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={() => {
                        if (nodeHasResult(node) && !window.confirm(`Delete "${title}"? It has a result attached.`)) return
                        pushHistory()
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
                            data-port-direction="input" data-port-name={s.name}
                            role="button" tabIndex={0} aria-label={`${title} input ${s.label} (${s.type})`}
                            onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); endWire(event, node, s.name) } }}
                          />
                          <span className="gsock-label">{s.label}</span>
                        </div>
                      ))}
                      {outputs.map((s, j) => (
                        <div key={s.name} className="gsock-row out" style={{ top: SOCK_TOP + j * SOCK_H }}>
                          <span className="gsock-label">{s.label}</span>
                          <span className={`gsock dot type-${s.type}`} title={`${s.label} (${s.type})`} onMouseDown={(e) => startWire(e, node, s.name)} data-port-direction="output" data-port-name={s.name} role="button" tabIndex={0} aria-label={`${title} output ${s.label} (${s.type})`} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); startWire(event, node, s.name) } }} />
                        </div>
                      ))}
                    </div>
                  ) : null}

                  <div className="nc-node-summary" onMouseDown={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()}>
                    {renderThumb(d.result_local_url || d.result_external_url || d.final_local_path || d.final_media_url || d.local_url || d.file_url || d.ref_image_url || '', title)}
                    {d.text || d.user_prompt ? <p>{d.text || d.user_prompt}</p> : null}
                    <div className="nc-node-chips">{d.model_id ? <span>{capabilities.find((model) => model.id === d.model_id)?.label || modelById(d.model_id)?.name || d.model_id}</span> : null}{d.aspect_ratio ? <span>{d.aspect_ratio}</span> : null}{node.type === 'video_generator' ? <span>{d.duration_seconds}s</span> : null}</div>
                    {GENERATOR_TYPES.includes(node.type) ? renderGenFooter(node) : null}
                    {onUseInCreative && (d.selected_asset_id || d.result_asset_id) ? <button className="primary small" onClick={() => Promise.resolve(onUseInCreative(node.id)).catch((error) => setBoardNotice(error.message || 'Could not link this Asset to the Creative.'))}>Use in Creative</button> : null}
                    <button className="ghost small" onClick={() => { setSelected([node.id]); setPropertiesOpen(true) }}>Edit properties</button>
                  </div>
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
          <div className="nc-zoom" onMouseDown={(event) => event.stopPropagation()}><button className="ghost small" aria-label="Zoom out" onClick={() => zoomAtCenter(1 / 1.2)}>−</button><span aria-label="Canvas zoom">{Math.round(view.zoom * 100)}%</span><button className="ghost small" aria-label="Zoom in" onClick={() => zoomAtCenter(1.2)}>+</button></div>
          {renderMiniMap()}

          {(nc.nodes || []).length === 0 ? <div className="node-canvas-hint"><h3>Start a workflow</h3><p>Choose a starter or add a node from the palette.</p><div className="nc-starter-buttons"><button className="primary small" onClick={(event) => { event.stopPropagation(); startTemplate('image-video') }}>Image to Video</button><button className="ghost small" onClick={(event) => { event.stopPropagation(); spawnAt('prompt', 0, 0) }}>Prompt</button><button className="ghost small" onClick={(event) => { event.stopPropagation(); spawnAt('upload', 0, 0) }}>Media</button></div></div> : null}
        </div>
        {!narrow && selectedNode ? <aside className="nc-properties nc-properties-side" aria-label="Selected node inspector"><header><h3>{selectedNodeTitle}</h3><button className="ghost small" onClick={() => { setSelected([]); setPropertiesOpen(false) }}>Close</button></header>{renderBody(selectedNode)}</aside> : null}
      </div>
      {narrow && propertiesOpen && selectedNode ? <div className="nc-properties-backdrop" onClick={() => setPropertiesOpen(false)}><section className="nc-properties" role="dialog" aria-modal="true" aria-label="Node properties" onClick={(event) => event.stopPropagation()}><header><h3>{selectedNode.data?.label || NODE_DEFS[selectedNode.type]?.title || 'Node'}</h3><button className="ghost" autoFocus onClick={() => setPropertiesOpen(false)}>Close</button></header>{renderBody(selectedNode)}</section></div> : null}
      {review ? <div className="modal-overlay" onClick={() => !productionBusy && setRunReview(null)}><section className="modal nc-run-review" role="dialog" aria-modal="true" aria-label="Review Canvas execution" onClick={(event) => event.stopPropagation()}><div className="modal-head"><h3>{runReview.scope === 'node' ? 'Run node and required inputs' : runReview.scope === 'selection' ? 'Run selected path' : 'Run workflow'}</h3><button className="ghost" autoFocus disabled={productionBusy} onClick={() => setRunReview(null)}>Close</button></div><div className="modal-body"><p>{review.closureNodeIds.length} nodes in scope · {review.steps.length} generation steps · {review.outputCount} requested outputs</p><p>Current outputs are reused. Missing or stale steps receive a fresh quote and confirmation.</p>{review.blockers.length ? <ul className="note bad">{review.blockers.map((blocker, index) => <li key={`${blocker.nodeId}-${index}`}>{nc.nodes.find((node) => node.id === blocker.nodeId)?.data?.label || 'Graph'}: {blocker.message}</li>)}</ul> : null}<ol>{review.steps.map((step) => <li key={step.nodeId}><strong>{step.provenance.label}</strong> · {capabilities.find((model) => model.id === step.modelId)?.label || step.modelId} · {step.params.quantity} output(s){step.params.seconds ? ` · ${step.params.seconds}s` : ''}{step.params.resolution ? ` · ${step.params.resolution}` : ''}</li>)}</ol>{!review.steps.length && !review.blockers.length ? <p>All outputs in this path are current. Edit inputs to create a new draft.</p> : null}<button className="primary" disabled={productionBusy || review.blockers.length > 0 || !review.steps.length} onClick={async () => { setProductionBusy(true); try { await onRequestProduction({ ...runReview, graphFingerprint: review.graphFingerprint }); setRunReview(null) } catch (error) { setBoardNotice(error.message || 'Could not prepare the execution quote.') } finally { setProductionBusy(false) } }}>{productionBusy ? 'Preparing quote…' : 'Review total cost'}</button><small>Connecting nodes and preparing this scope do not generate media.</small></div></section></div> : null}
      {resultModalNodeId ? (() => {
        const resultNode = (nc.nodes || []).find((n) => n.id === resultModalNodeId)
        if (!resultNode) return null
        const d = resultNode.data || {}
        const url = d.result_local_url || d.result_external_url || previews['result:' + resultNode.id] || ''
        return (
          <div className="modal-overlay" onClick={() => setResultModalNodeId('')}>
            <div className="modal" onClick={(e) => e.stopPropagation()}>
              <div className="modal-head">
                <h3>{resultNode.type === 'video_generator' ? 'Video Generator Result' : 'Image Generator Result'}</h3>
                <button className="ghost small" onClick={() => setResultModalNodeId('')}>Close</button>
              </div>
              <div className="modal-body">
                {renderThumb(url, resultNode.type === 'video_generator' ? 'generated video' : 'generated image')}
                <div className="media-health">{d.result_saved ? 'Local file saved' : 'Result ready'}</div>
                <div className="row">
                  {d.result_local_url && !d.result_saved ? (
                    <button className="ghost" onClick={() => saveResultToLibrary(resultNode)} disabled={uploadBusy === resultNode.id}>
                      {uploadBusy === resultNode.id ? 'Saving…' : 'Save to Local Media Library'}
                    </button>
                  ) : null}
                  {d.result_saved ? <button className="ghost" disabled>Saved to Local Media Library</button> : null}
                  {onAttachResultToScene && sceneOptions.length ? (
                    <button className="primary" onClick={() => { setAttachPicker(resultNode.id); setResultModalNodeId('') }}>Attach as Variation</button>
                  ) : null}
                  <button className="ghost" onClick={() => setResultModalNodeId('')}>Close</button>
                </div>
              </div>
            </div>
          </div>
        )
      })() : null}
    </section>
  )
}
