import { useRef, useState } from 'react'
import { ASSET_TYPES, newAsset } from '../lib/canvasModel.js'
import { saveMediaToLocal } from '../lib/ai/apiClient.js'

export default function AssetTray({ assets, scenes, previews, onAdd, onUpdate, onRemove, onUploadPreview }) {
  const [title, setTitle] = useState('')
  const [type, setType] = useState('competitor_reference')
  const [url, setUrl] = useState('')
  const [notes, setNotes] = useState('')
  const [linked, setLinked] = useState('')
  const [savingId, setSavingId] = useState('')
  const [saveError, setSaveError] = useState({})
  const fileRef = useRef(null)

  // Persist an uploaded asset's session preview to the local media library (local disk).
  async function saveLocal(asset) {
    const dataUrl = previews[asset.id]
    if (!dataUrl) return
    setSavingId(asset.id)
    setSaveError((m) => ({ ...m, [asset.id]: '' }))
    const res = await saveMediaToLocal({ file_name: asset.file_name || asset.title, mime_type: '', data_url: dataUrl, category: 'asset' })
    setSavingId('')
    if (res && res.success) {
      onUpdate(asset.id, { local_url: res.local_url, storage: 'local_disk', file_name: res.file_name, mime_type: res.mime_type, file_size: res.file_size })
    } else {
      setSaveError((m) => ({ ...m, [asset.id]: (res && res.error) || 'Save failed.' }))
    }
  }

  function reset() {
    setTitle('')
    setUrl('')
    setNotes('')
    setLinked('')
  }

  function add() {
    if (!title.trim() && !url.trim()) return
    onAdd(newAsset({ title: title.trim() || 'Untitled asset', type, external_url: url.trim(), notes, linked_scene_id: linked, source: url.trim() ? 'external_url' : 'manual' }))
    reset()
  }

  function pick(e) {
    const f = e.target.files && e.target.files[0]
    e.target.value = ''
    if (!f) return
    const a = newAsset({ title: title.trim() || f.name, type, notes, linked_scene_id: linked, source: 'upload', file_name: f.name })
    onAdd(a)
    const r = new FileReader()
    r.onload = () => onUploadPreview(a.id, String(r.result))
    r.readAsDataURL(f)
    reset()
  }

  const sceneLabel = (id) => {
    const s = scenes.find((x) => x.id === id)
    return s ? `Scene ${s.scene_number}` : ''
  }

  return (
    <div className="subpanel">
      <h3>Asset Tray ({assets.length})</h3>
      <p className="hint small">Competitor references, product assets, generated outputs, scripts. Uploads preview this session only; the filename is kept.</p>

      <div className="add-doc">
        <input type="text" placeholder="Asset title" value={title} onChange={(e) => setTitle(e.target.value)} />
        <div className="two">
          <label className="field">
            <span className="field-label">Type</span>
            <select value={type} onChange={(e) => setType(e.target.value)}>
              {ASSET_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field-label">Linked scene</span>
            <select value={linked} onChange={(e) => setLinked(e.target.value)}>
              <option value="">(none)</option>
              {scenes.map((s) => (
                <option key={s.id} value={s.id}>
                  Scene {s.scene_number}
                </option>
              ))}
            </select>
          </label>
        </div>
        <input type="text" placeholder="External URL (optional)" value={url} onChange={(e) => setUrl(e.target.value)} />
        <textarea rows={2} placeholder="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
        <div className="row">
          <button className="primary small" onClick={add}>
            Add Asset
          </button>
          <button className="ghost small" onClick={() => fileRef.current && fileRef.current.click()}>
            Upload image (session preview)
          </button>
          <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={pick} />
        </div>
      </div>

      <div className="doc-list">
        {assets.length === 0 ? (
          <p className="hint">No assets yet.</p>
        ) : (
          assets.map((a) => (
            <div key={a.id} className={`asset-card status-${a.status}`}>
              <div className="doc-head">
                <span className="badge">{a.type}</span>
                <input className="doc-title" value={a.title} onChange={(e) => onUpdate(a.id, { title: e.target.value })} />
                <span className={`badge status-${a.status}`}>{a.status}</span>
                <button className="ghost small" onClick={() => onRemove(a.id)}>
                  Delete
                </button>
              </div>
              {a.local_url ? (
                <img className="asset-preview" src={a.local_url} alt={a.title} />
              ) : previews[a.id] ? (
                <img className="asset-preview" src={previews[a.id]} alt={a.title} />
              ) : null}
              <div className="bn-meta">
                {a.linked_scene_id ? <span>{sceneLabel(a.linked_scene_id)}</span> : null}
                {a.file_name ? <span>{a.file_name}</span> : null}
                {a.local_url ? <span className="media-health health-ok">Local file saved</span> : null}
                {a.external_url ? (
                  <a href={a.external_url} target="_blank" rel="noreferrer">
                    link
                  </a>
                ) : null}
              </div>
              {!a.local_url && previews[a.id] ? <div className="hint small">Preview is session-only until saved.</div> : null}
              {saveError[a.id] ? <div className="note bad">{saveError[a.id]}</div> : null}
              {a.notes ? <div className="hint small">{a.notes}</div> : null}
              <div className="bn-actions">
                {!a.local_url && previews[a.id] ? (
                  <button className="ghost small" onClick={() => saveLocal(a)} disabled={savingId === a.id}>
                    {savingId === a.id ? 'Saving…' : 'Save To Local Media Library'}
                  </button>
                ) : null}
                <button className="ghost small" onClick={() => onUpdate(a.id, { status: 'selected' })}>
                  Mark selected
                </button>
                <button className="ghost small" onClick={() => onUpdate(a.id, { status: 'rejected' })}>
                  Mark rejected
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
