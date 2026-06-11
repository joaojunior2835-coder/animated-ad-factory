import { useRef, useState } from 'react'
import { NODE_DEFS, normalizeNodeCanvas } from '../../lib/nodeCanvasModel.js'

// Top toolbar for the Production Node Canvas: canvas name, node count, fit,
// clear, snapshot save/load, provider-mode indicator and Run All. Pure UI —
// graph mutations and generation routing come in via props.

function slug(name) {
  return (
    String(name || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'node-canvas'
  )
}

export default function CanvasToolbar({ nc, onChange, onFit, providerMode, onRunAll, runAllDisabled, runAllLabel, onImportScenes, importScenesDisabled }) {
  const fileRef = useRef(null)
  const [editingName, setEditingName] = useState(false)
  const nodeCount = (nc.nodes || []).length

  function saveSnapshot() {
    const data = JSON.stringify(nc, null, 2)
    const blob = new Blob([data], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    const ts = new Date()
    const pad = (n) => String(n).padStart(2, '0')
    a.download = `${slug(nc.name)}-canvas-${ts.getFullYear()}-${pad(ts.getMonth() + 1)}-${pad(ts.getDate())}-${pad(ts.getHours())}${pad(ts.getMinutes())}.json`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  function loadSnapshot(file) {
    const r = new FileReader()
    r.onload = () => {
      let parsed
      try {
        parsed = JSON.parse(String(r.result))
      } catch (e) {
        window.alert('Invalid JSON: ' + e.message)
        return
      }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        window.alert('Snapshot must be a single JSON object with nodes/connections.')
        return
      }
      const nodes = Array.isArray(parsed.nodes) ? parsed.nodes : []
      const unknown = [...new Set(nodes.map((n) => n && n.type).filter((t) => t && !NODE_DEFS[t]))]
      let msg = `Load snapshot with ${nodes.length} node(s)? This replaces the current canvas.`
      if (unknown.length) msg += `\n\nWarning: unknown node type(s) will load as inert nodes: ${unknown.join(', ')}.`
      if (!window.confirm(msg)) return
      onChange(() => normalizeNodeCanvas(parsed))
    }
    r.readAsText(file)
  }

  function clearCanvas() {
    if (!nodeCount) return
    if (!window.confirm(`Clear the canvas? This removes all ${nodeCount} node(s) and their wires. (Saved media files on disk are kept.)`)) return
    onChange((c) => ({ ...c, nodes: [], connections: [] }))
  }

  const modeLabel = providerMode === 'api' ? 'API' : providerMode === 'mock' ? 'Mock' : 'Manual'

  return (
    <div className="nc-toolbar" role="toolbar" aria-label="Canvas toolbar">
      {editingName ? (
        <input
          className="nc-toolbar-name-input"
          autoFocus
          defaultValue={nc.name || ''}
          aria-label="Canvas name"
          onBlur={(e) => {
            onChange((c) => ({ ...c, name: e.target.value.trim() || 'Untitled Canvas' }))
            setEditingName(false)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
            if (e.key === 'Escape') setEditingName(false)
          }}
        />
      ) : (
        <button className="nc-toolbar-name" onClick={() => setEditingName(true)} title="Click to rename" aria-label={`Canvas name: ${nc.name || 'Untitled Canvas'} — click to rename`}>
          {nc.name || 'Untitled Canvas'} ✎
        </button>
      )}
      <span className="badge" aria-label={`${nodeCount} nodes on the canvas`}>{nodeCount} node{nodeCount === 1 ? '' : 's'}</span>
      <span className={`api-badge ${providerMode === 'api' ? 'warn' : 'ok'}`} title="Generation provider mode (set in Canvas → Production Board)">
        Mode: {modeLabel}
      </span>

      <span className="nc-toolbar-spacer" />

      <button className="ghost small" onClick={onFit} aria-label="Fit all nodes to screen">⛶ Fit to screen</button>
      <button className="ghost small" onClick={saveSnapshot} aria-label="Save canvas snapshot as JSON">Save snapshot</button>
      <button className="ghost small" onClick={() => fileRef.current && fileRef.current.click()} aria-label="Load canvas snapshot from JSON">
        Load snapshot
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files && e.target.files[0]
          e.target.value = ''
          if (f) loadSnapshot(f)
        }}
      />
      <button className="ghost small" onClick={clearCanvas} disabled={!nodeCount} aria-label="Clear the canvas">
        Clear canvas
      </button>
      {onImportScenes ? (
        <button className="ghost small" onClick={onImportScenes} disabled={importScenesDisabled} title={importScenesDisabled ? 'No Canvas scenes yet' : 'Add Prompt → Image Gen → Output rows from the Canvas scenes'} aria-label="Import Canvas scenes as nodes">
          Import Scenes
        </button>
      ) : null}
      <button className="primary small" onClick={onRunAll} disabled={runAllDisabled} title={runAllDisabled ? 'Generation already running, or nothing to run' : 'Generate every idle image/video node, upstream first'} aria-label="Run all generation nodes">
        {runAllLabel || '▶ Run All'}
      </button>
    </div>
  )
}
