import { useState } from 'react'
import { NODE_DEFS } from '../../lib/nodeCanvasModel.js'
import { nodeColor, nodeIcon } from './nodeTheme.js'

// Left sidebar for the Production Node Canvas: a node palette (drag or click to
// spawn) and the Model Gallery (the "marketplace" — pick which model a generation
// node uses). Pure UI — all mutations go up through props.

const PALETTE = ['prompt', 'image_generator', 'video_generator', 'reference', 'character', 'style', 'output', 'upscale', 'upload', 'asset']

const CATEGORY_ORDER = { Test: 0, Manual: 1, Premium: 2 }
const categoryRank = (c) => (c in CATEGORY_ORDER ? CATEGORY_ORDER[c] : 3)

function AddModelForm({ onAdd, onClose }) {
  const [form, setForm] = useState({ id: '', name: '', type: 'image', category: 'Custom', description: '', previewUrl: '' })
  const [error, setError] = useState('')
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  return (
    <div className="ncsb-addmodel" onMouseDown={(e) => e.stopPropagation()}>
      <h4>Add Custom Model</h4>
      <label className="field">
        <span className="field-label">Id (unique)</span>
        <input type="text" value={form.id} onChange={set('id')} placeholder="my-model" aria-label="Model id" />
      </label>
      <label className="field">
        <span className="field-label">Name</span>
        <input type="text" value={form.name} onChange={set('name')} placeholder="My Model" aria-label="Model name" />
      </label>
      <div className="two">
        <label className="field">
          <span className="field-label">Type</span>
          <select value={form.type} onChange={set('type')} aria-label="Model output type">
            <option value="image">image</option>
            <option value="video">video</option>
            <option value="any">any</option>
          </select>
        </label>
        <label className="field">
          <span className="field-label">Category</span>
          <input type="text" value={form.category} onChange={set('category')} aria-label="Model category" />
        </label>
      </div>
      <label className="field">
        <span className="field-label">Description</span>
        <textarea rows={2} value={form.description} onChange={set('description')} aria-label="Model description" />
      </label>
      <label className="field">
        <span className="field-label">Preview URL (optional)</span>
        <input type="text" value={form.previewUrl} onChange={set('previewUrl')} aria-label="Model preview URL" />
      </label>
      {error ? <div className="note bad">{error}</div> : null}
      <div className="row">
        <button
          className="primary small"
          onClick={() => {
            const err = onAdd(form)
            if (err) setError(err)
            else onClose()
          }}
        >
          Add Model
        </button>
        <button className="ghost small" onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  )
}

export default function CanvasSidebar({ open, onToggle, models, onSpawn, onUseModel, onAddCustomModel, archivedModels = [] }) {
  const [tab, setTab] = useState('palette')
  const [search, setSearch] = useState('')
  const [adding, setAdding] = useState(false)

  if (!open) {
    return (
      <button className="ncsb-toggle collapsed" onClick={onToggle} title="Open node palette" aria-label="Open sidebar">
        ▸
      </button>
    )
  }

  const q = search.trim().toLowerCase()
  const filtered = models
    .filter((m) => !q || m.name.toLowerCase().includes(q) || String(m.category || '').toLowerCase().includes(q))
    .sort((a, b) => categoryRank(a.category) - categoryRank(b.category) || a.name.localeCompare(b.name))

  return (
    <div className="ncsb" onMouseDown={(e) => e.stopPropagation()}>
      <div className="ncsb-head">
        <div className="modal-tabs ncsb-tabs" role="tablist">
          <button className={tab === 'palette' ? 'tab on' : 'tab'} onClick={() => setTab('palette')} role="tab" aria-selected={tab === 'palette'}>
            Nodes
          </button>
          <button className={tab === 'models' ? 'tab on' : 'tab'} onClick={() => setTab('models')} role="tab" aria-selected={tab === 'models'}>
            Models
          </button>
        </div>
        <button className="ncsb-toggle" onClick={onToggle} title="Collapse sidebar" aria-label="Collapse sidebar">
          ◂
        </button>
      </div>

      {tab === 'palette' ? (
        <div className="ncsb-body" role="tabpanel" aria-label="Node palette">
          <p className="hint small">Drag a card onto the board, or click to add at center.</p>
          {PALETTE.map((t) => (
            <div
              key={t}
              className="ncsb-node-card"
              style={{ borderLeft: `3px solid ${nodeColor(t)}` }}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.effectAllowed = 'copy'
                e.dataTransfer.setData('application/x-aaf-node-type', t)
              }}
              onClick={() => onSpawn(t)}
              role="button"
              tabIndex={0}
              onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSpawn(t) } }}
              aria-label={`Add ${NODE_DEFS[t].title} node`}
              title={`Add a ${NODE_DEFS[t].title} node`}
            >
              <span aria-hidden="true">{nodeIcon(t)}</span>
              <span>{NODE_DEFS[t].title}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="ncsb-body" role="tabpanel" aria-label="Model gallery">
          <input
            type="text"
            className="ncsb-search"
            placeholder="Search models…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search models"
          />
          <div className="ncsb-models">
            {filtered.length === 0 ? <p className="hint small">No models match “{search}”.</p> : null}
            {filtered.map((m) => (
              <div key={m.id} className="ncsb-model-card" title={m.description}>
                <div className="ncsb-model-preview">
                  {m.previewUrl ? <img src={m.previewUrl} alt="" /> : <span aria-hidden="true">{m.type === 'video' ? '🎬' : m.type === 'image' ? '🖼️' : '✋'}</span>}
                </div>
                <div className="ncsb-model-name">{m.name}</div>
                <div className="ncsb-model-badges">
                  <span className="badge">{m.category}</span>
                  <span className="badge">{m.type}</span>
                </div>
                <div className="ncsb-model-desc">{m.description}</div>
                <button className="primary small" onClick={() => onUseModel(m)} disabled={m.unavailable} aria-label={`Use model ${m.name}`}>
                  {m.unavailable ? 'Unavailable' : 'Use'}
                </button>
              </div>
            ))}
          </div>
          {archivedModels.length ? <details className="nc-archived-models"><summary>Saved model notes</summary><p>These legacy/custom entries are preserved. Only the configured production models above can run.</p>{archivedModels.map((model) => <div key={model.id}><strong>{model.name}</strong><p>{model.description}</p></div>)}
          {adding ? (
            <AddModelForm onAdd={onAddCustomModel} onClose={() => setAdding(false)} />
          ) : (
            <button className="ghost small full gap" onClick={() => setAdding(true)} aria-label="Add a custom model">
              + Add Custom Model
            </button>
          )}</details> : null}
        </div>
      )}
    </div>
  )
}
