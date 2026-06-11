import { useRef, useState } from 'react'
import { PROVIDERS, providerName } from '../data/providers.js'
import { VARIATION_TYPES, mediaSource } from '../lib/canvasModel.js'
import MediaPreview from './MediaPreview.jsx'

const COLS = [
  { type: 'reference', label: 'Competitor Reference' },
  { type: 'adaptation', label: 'Adaptation' },
  { type: 'prompt', label: 'Prompt' },
  { type: 'output', label: 'Output' },
  { type: 'final', label: 'Final Selection' }
]

function ProviderSelect({ value, onChange }) {
  return (
    <select value={value || ''} onChange={(e) => onChange(e.target.value)}>
      <option value="">(provider)</option>
      {PROVIDERS.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name}
        </option>
      ))}
    </select>
  )
}

function NodeCard({ node, scene, assets, onUpdateNode, onGenerate }) {
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  if (!node) return <div className="board-node empty">—</div>

  const d = node.data || {}
  const prompt = d.prompt || ''
  const variations = (scene && scene.variations) || []
  const selected = variations.find((v) => v.status === 'selected')
  const linkedAssets = (assets || []).filter((a) => a.linked_scene_id === node.scene_id && (a.type === 'competitor_reference' || a.type === 'product_asset'))

  async function copy() {
    try {
      await navigator.clipboard.writeText(prompt)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* ignore */
    }
  }
  const gen = (actionType) => () => onGenerate && onGenerate(node, actionType)

  return (
    <div className={`board-node status-${node.status}`}>
      <div className="bn-head">
        <strong>{node.title}</strong>
        <span className={`badge status-${node.status}`}>{node.status}</span>
      </div>
      {node.subtitle ? <div className="bn-sub">{node.subtitle}</div> : null}
      <div className="bn-meta">
        {d.scene_number ? <span>Scene {d.scene_number}</span> : null}
        {d.timestamp_start || d.timestamp_end ? (
          <span>
            {d.timestamp_start || '?'}–{d.timestamp_end || '?'}
          </span>
        ) : null}
        {d.provider ? <span>{providerName(d.provider)}</span> : null}
      </div>

      {node.type === 'reference' && linkedAssets.length ? <div className="bn-sub">Assets: {linkedAssets.map((a) => a.title).join(', ')}</div> : null}
      {node.type === 'output' ? <div className="bn-sub">Variations: {variations.length ? variations.map((v) => v.label).join(', ') : 'none'}</div> : null}
      {node.type === 'final' ? <div className="bn-sub">Selected: {selected ? `${selected.label}${selected.provider ? ' · ' + providerName(selected.provider) : ''}` : '—'}</div> : null}

      <div className="bn-actions">
        <button className="ghost small" onClick={() => setOpen((o) => !o)}>
          {open ? 'Hide details' : 'View details'}
        </button>
        {prompt ? (
          <button className="ghost small" onClick={copy}>
            {copied ? 'Copied ✓' : 'Copy prompt'}
          </button>
        ) : null}
        <button className="ghost small" onClick={() => onUpdateNode(node.id, { status: 'selected' })}>
          Mark selected
        </button>
        <button className="ghost small" onClick={() => onUpdateNode(node.id, { status: 'rejected' })}>
          Mark rejected
        </button>
      </div>
      {node.type === 'output' ? (
        <div className="bn-actions">
          <button className="ghost small" onClick={gen('generate_image')}>
            Regenerate Image
          </button>
          <button className="ghost small" onClick={gen('generate_video')}>
            Regenerate Video
          </button>
          <button className="ghost small" onClick={gen('generate_image')}>
            Generate Variation
          </button>
        </div>
      ) : null}
      {node.type === 'prompt' ? (
        <div className="bn-actions">
          <button className="ghost small" onClick={gen('generate_image')}>
            Generate Variation
          </button>
        </div>
      ) : null}
      {open ? <pre className="bn-details">{prompt || d.text || d.what_happens || '(no details)'}</pre> : null}
    </div>
  )
}

function VariationCard({ sceneId, v, preview, onUpdate, onSelect, onRemove, onReplace, onDragStartVar, onDropVar }) {
  const [copied, setCopied] = useState(false)
  const replaceRef = useRef(null)
  function onReplacePick(e) {
    const f = e.target.files && e.target.files[0]
    e.target.value = ''
    if (f && onReplace) onReplace(sceneId, v.id, f)
  }
  function confirmDelete() {
    if (window.confirm(`Delete variation ${v.label}? This removes it from the scene (the file on disk is kept).`)) onRemove(sceneId, v.id)
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(v.prompt || '')
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* ignore */
    }
  }
  return (
    <div
      className={`variation-card status-${v.status}`}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault()
        onDropVar(sceneId, v.id)
      }}
    >
      <div className="bn-head">
        <span
          className="drag-handle"
          draggable
          title="Drag to reorder within this scene"
          style={{ cursor: 'grab', userSelect: 'none', marginRight: '6px' }}
          onDragStart={(e) => {
            e.dataTransfer.effectAllowed = 'move'
            try {
              e.dataTransfer.setData('text/plain', v.id)
            } catch {
              /* some browsers restrict setData; not required */
            }
            onDragStartVar(sceneId, v.id)
          }}
        >
          ⠿
        </span>
        <strong>Variation {v.label}</strong>
        <span className={`badge status-${v.status}`}>{v.status}</span>
      </div>
      <div className="two">
        <label className="field">
          <span className="field-label">Type</span>
          <select value={v.type} onChange={(e) => onUpdate(sceneId, v.id, { type: e.target.value })}>
            {VARIATION_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field-label">Provider</span>
          <ProviderSelect value={v.provider} onChange={(val) => onUpdate(sceneId, v.id, { provider: val })} />
        </label>
      </div>
      <label className="field">
        <span className="field-label">Prompt</span>
        <textarea rows={2} value={v.prompt} onChange={(e) => onUpdate(sceneId, v.id, { prompt: e.target.value })} />
      </label>
      <label className="field">
        <span className="field-label">External URL</span>
        <input type="text" value={v.external_url} onChange={(e) => onUpdate(sceneId, v.id, { external_url: e.target.value })} />
      </label>
      {preview || v.external_url || v.local_url ? <MediaPreview url={v.external_url} preview={preview} local={v.local_url} /> : null}
      {(() => {
        const src = mediaSource(v, !!preview)
        const cls = src.storage === 'local_disk' || src.storage === 'external_url' ? 'health-ok' : src.storage === 'none' ? 'health-none' : 'health-warn'
        return <div className={`media-health ${cls}`}>{src.label}</div>
      })()}
      {mediaSource(v, !!preview).storage === 'session' ? <div className="hint small">Preview is session-only. Save to Local Media Library or a real URL, or re-upload after reload.{v.file_name ? ` (${v.file_name})` : ''}</div> : null}
      <div className="bn-actions">
        <button className="ghost small" onClick={() => onSelect(sceneId, v.id)}>
          Mark selected
        </button>
        <button className="ghost small" onClick={() => onUpdate(sceneId, v.id, { status: 'rejected' })}>
          Mark rejected
        </button>
        {v.prompt ? (
          <button className="ghost small" onClick={copy}>
            {copied ? 'Copied ✓' : 'Copy variation prompt'}
          </button>
        ) : null}
        <button className="ghost small" title="Replace image (saves to Local Media Library)" onClick={() => replaceRef.current && replaceRef.current.click()}>
          Replace
        </button>
        <input ref={replaceRef} type="file" accept="image/png,image/jpeg,image/webp" style={{ display: 'none' }} onChange={onReplacePick} />
        <button className="ghost small" title="Delete variation" onClick={confirmDelete}>
          🗑
        </button>
      </div>
    </div>
  )
}

export default function CanvasBoard({ board, scenes, assets, previews, onUpdateNode, onAddVariation, onUpdateVariation, onSelectVariation, onRemoveVariation, onReplaceVariation, onReorderVariation, onGenerate, onAddExistingResult }) {
  // Within-scene drag-to-reorder state. Holds the variation being dragged so the
  // drop target can reorder — and only within the SAME scene (no cross-scene moves).
  const dragRef = useRef(null)
  const handleVarDragStart = (sceneId, varId) => {
    dragRef.current = { sceneId, varId }
  }
  const handleVarDrop = (sceneId, varId) => {
    const d = dragRef.current
    dragRef.current = null
    if (d && d.sceneId === sceneId && d.varId && d.varId !== varId && onReorderVariation) onReorderVariation(sceneId, d.varId, varId)
  }
  const nodes = (board && board.nodes) || []
  const scenesById = {}
  ;(scenes || []).forEach((s) => (scenesById[s.id] = s))

  const groups = {}
  nodes.forEach((n) => {
    const k = n.scene_id || n.id
    groups[k] = groups[k] || { __scene_id: k }
    groups[k][n.type] = n
  })
  const rows = Object.values(groups).sort((a, b) => ((a.reference && a.reference.data && a.reference.data.scene_number) || 0) - ((b.reference && b.reference.data && b.reference.data.scene_number) || 0))

  return (
    <div className="board-wrap">
      <div className="board-cols">
        {COLS.map((c) => (
          <div key={c.type} className="board-col-head">
            {c.label}
          </div>
        ))}
      </div>
      {rows.map((g, ri) => {
        const scene = scenesById[g.__scene_id]
        return (
          <div key={ri} className="board-row-wrap">
            <div className="board-row">
              {COLS.map((c, ci) => (
                <div key={c.type} className="board-cell">
                  <NodeCard node={g[c.type]} scene={scene} assets={assets} onUpdateNode={onUpdateNode} onGenerate={onGenerate} />
                  {ci < COLS.length - 1 ? <span className="board-arrow">→</span> : null}
                </div>
              ))}
            </div>
            {scene ? (
              <div className="variation-strip">
                <div className="row between">
                  <span className="field-label">Variations — Scene {scene.scene_number}</span>
                  <div className="row">
                    <button className="ghost small" onClick={() => onAddVariation(scene.id)}>
                      Add Variation
                    </button>
                    <button className="ghost small" onClick={() => onAddExistingResult(scene.id)}>
                      Add Existing Result
                    </button>
                  </div>
                </div>
                <div className="variation-list">
                  {(scene.variations || []).length === 0 ? (
                    <span className="hint small">No variations yet.</span>
                  ) : (
                    (scene.variations || []).map((v) => (
                      <VariationCard key={v.id} sceneId={scene.id} v={v} preview={(previews || {})[v.id]} onUpdate={onUpdateVariation} onSelect={onSelectVariation} onRemove={onRemoveVariation} onReplace={onReplaceVariation} onDragStartVar={handleVarDragStart} onDropVar={handleVarDrop} />
                    ))
                  )}
                </div>
              </div>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}
