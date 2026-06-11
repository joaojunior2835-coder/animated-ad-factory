import { useRef, useState } from 'react'
import MediaPreview from './MediaPreview.jsx'
import { normalizeMediaResult, mediaResultToVariation } from '../lib/ai/mediaResultContract.js'
import { saveMediaToLocal } from '../lib/ai/apiClient.js'
import { uid } from '../lib/brandDocs.js'

// Fast import of images generated externally in Google Flow. ZERO API providers,
// ZERO paid calls. Each file becomes a normalized media result (Media Result
// Contract), is previewed, and only persists when the user explicitly saves —
// which reuses the existing local-media save endpoint and attaches a variation.

const ACCEPT = ['image/png', 'image/jpeg', 'image/webp']
// Tolerant: scene<NN>_v<NN>, case-insensitive, extra suffix text allowed.
const SCENE_RE = /scene0*(\d+)_v0*(\d+)/i

function readImage(file) {
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

export default function FlowImport({ scenes, onAttach }) {
  const [items, setItems] = useState([])
  const [drag, setDrag] = useState(false)
  const [savingAll, setSavingAll] = useState(false)
  const [batchRunning, setBatchRunning] = useState(false)
  const [batchMsg, setBatchMsg] = useState('')
  const fileRef = useRef(null)

  const sceneByNumber = (n) => (scenes || []).find((s) => Number(s.scene_number) === Number(n))
  const setItem = (id, patch) => setItems((arr) => arr.map((it) => (it.id === id ? { ...it, ...patch } : it)))

  async function addFiles(fileList) {
    const files = Array.from(fileList || []).filter((f) => ACCEPT.includes(f.type) || /\.(png|jpe?g|webp)$/i.test(f.name))
    for (const file of files) {
      const meta = await readImage(file)
      const m = SCENE_RE.exec(file.name)
      const parsedScene = m ? Number(m[1]) : null
      const target = parsedScene != null ? sceneByNumber(parsedScene) : null
      // Normalized via the EXISTING contract — no parallel shape, no auto-save.
      const result = normalizeMediaResult({
        provider_id: 'manual', source_type: 'flow_import', media_type: 'image',
        data_url: meta.dataUrl, mime_type: file.type || 'image/png', file_name: file.name,
        file_size: file.size || 0, status: 'success'
      })
      setItems((arr) => [
        ...arr,
        {
          id: uid(),
          result,
          file_name: file.name,
          mime_type: file.type || 'image/png',
          file_size: file.size || 0,
          dataUrl: meta.dataUrl,
          width: meta.width,
          height: meta.height,
          parsedScene,
          targetSceneId: target ? target.id : '',
          saved: false,
          error: ''
        }
      ])
    }
  }

  function onPick(e) {
    // Snapshot to an array BEFORE clearing the input — e.target.files is live and
    // resetting value would empty it.
    const files = Array.from(e.target.files || [])
    e.target.value = ''
    addFiles(files)
  }
  function onDrop(e) {
    e.preventDefault()
    setDrag(false)
    if (e.dataTransfer && e.dataTransfer.files) addFiles(e.dataTransfer.files)
  }

  // Shared save+attach core: persist via the EXISTING media endpoint, then attach a
  // variation via the EXISTING addGeneratedVariation path. Returns {ok, error}.
  async function attachCore(item) {
    if (!item.targetSceneId) return { ok: false, error: 'No target scene.' }
    setItem(item.id, { saving: true, error: '' })
    const res = await saveMediaToLocal({ file_name: item.file_name, mime_type: item.mime_type, data_url: item.dataUrl, category: 'variation', scene_id: item.targetSceneId })
    if (!res || !res.success) {
      const error = (res && res.error) || 'Save failed (is the local backend running?).'
      setItem(item.id, { saving: false, error })
      return { ok: false, error }
    }
    const result = normalizeMediaResult({
      provider_id: 'manual', source_type: 'flow_import', media_type: 'image',
      file_name: res.file_name, mime_type: res.mime_type, file_size: res.file_size,
      local_url: res.local_url, storage: 'local_disk', status: 'success'
    })
    const fields = mediaResultToVariation(result)
    fields.notes = `Flow import ${item.file_name}${item.width ? ` (${item.width}×${item.height})` : ''}`
    onAttach(item.targetSceneId, fields)
    setItem(item.id, { saving: false, saved: true })
    return { ok: true }
  }

  // Explicit per-image save (keeps the saved item visible in the list).
  async function saveAndAttach(item) {
    if (!item.targetSceneId || item.saved) return
    await attachCore(item)
  }

  async function saveAll() {
    setSavingAll(true)
    for (const it of items) {
      if (it.targetSceneId && !it.saved) await attachCore(it)
    }
    setSavingAll(false)
  }

  // Batch: every MATCHED image with a target scene, sequentially. Failures don't
  // abort the rest; successfully-saved items are removed from the pending list.
  async function saveAttachAllMatched() {
    setBatchRunning(true)
    setBatchMsg('')
    const targets = items.filter((it) => it.parsedScene != null && sceneByNumber(it.parsedScene) && it.targetSceneId && !it.saved)
    let ok = 0
    const savedIds = []
    const failed = []
    for (const it of targets) {
      // eslint-disable-next-line no-await-in-loop
      const r = await attachCore(it)
      if (r.ok) {
        ok++
        savedIds.push(it.id)
      } else {
        failed.push(it.file_name)
      }
    }
    // Remove only the images this batch saved; failed ones stay for retry.
    if (savedIds.length) setItems((arr) => arr.filter((it) => !savedIds.includes(it.id)))
    setBatchRunning(false)
    setBatchMsg(`Saved & attached ${ok}.${failed.length ? ` Failed (left for retry): ${failed.join(', ')}` : ''}`)
  }

  const matched = items.filter((it) => it.parsedScene != null && sceneByNumber(it.parsedScene))
  const unsorted = items.filter((it) => !(it.parsedScene != null && sceneByNumber(it.parsedScene)))
  const pendingCount = items.filter((it) => it.targetSceneId && !it.saved).length
  const matchedReady = matched.filter((it) => it.targetSceneId && !it.saved).length

  const renderItem = (it) => (
    <div key={it.id} className={it.saved ? 'flow-item saved' : 'flow-item'}>
      {it.dataUrl ? <MediaPreview preview={it.dataUrl} /> : null}
      <div className="bn-meta">
        <span>{it.file_name}</span>
        <span>{it.width && it.height ? `${it.width}×${it.height}` : 'dimensions unknown'}</span>
        <span>{it.mime_type}</span>
        {it.parsedScene != null ? <span>filename → scene {it.parsedScene}</span> : <span>unsorted</span>}
      </div>
      <label className="field inline">
        <span className="field-label">Target scene</span>
        <select value={it.targetSceneId} onChange={(e) => setItem(it.id, { targetSceneId: e.target.value })} disabled={it.saved}>
          <option value="">(choose scene)</option>
          {(scenes || []).map((s) => (
            <option key={s.id} value={s.id}>
              Scene {s.scene_number}
            </option>
          ))}
        </select>
      </label>
      {it.saved ? (
        <span className="media-health health-ok">Saved &amp; attached (flow_import)</span>
      ) : (
        <button className="primary small" onClick={() => saveAndAttach(it)} disabled={!it.targetSceneId || it.saving}>
          {it.saving ? 'Saving…' : 'Save & Attach'}
        </button>
      )}
      {it.error ? <div className="note bad">{it.error}</div> : null}
    </div>
  )

  return (
    <div className="subpanel">
      <div className="row between">
        <h3>Import from Flow</h3>
        {items.length ? (
          <button className="ghost small" onClick={saveAll} disabled={savingAll || pendingCount === 0}>
            {savingAll ? 'Saving…' : `Save all (${pendingCount})`}
          </button>
        ) : null}
      </div>
      <p className="hint small">
        Images come from Google Flow via manual import — no image API is called. Drop or pick PNG/JPG/WebP (one or many). Files named{' '}
        <code>scene&lt;NN&gt;_v&lt;NN&gt;</code> auto-suggest a target scene. Nothing is saved until you click Save &amp; Attach.
      </p>
      <div
        className={drag ? 'flow-drop drag' : 'flow-drop'}
        data-testid="flow-dropzone"
        style={{ border: '2px dashed var(--border)', borderRadius: '8px', padding: '16px', textAlign: 'center', cursor: 'pointer', background: drag ? 'var(--panel)' : 'transparent' }}
        onDragOver={(e) => {
          e.preventDefault()
          setDrag(true)
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={onDrop}
        onClick={() => fileRef.current && fileRef.current.click()}
      >
        Drag images here, or click to choose files
        <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" multiple style={{ display: 'none' }} onChange={onPick} />
      </div>
      {items.length === 0 ? (
        <p className="hint">No imports yet.</p>
      ) : (
        <>
          {matched.length ? (
            <>
              <div className="row between">
                <p className="hint small">Matched to scenes ({matched.length})</p>
                <button className="primary small" onClick={saveAttachAllMatched} disabled={batchRunning || matchedReady === 0}>
                  {batchRunning ? 'Saving…' : `Save & Attach all matched (${matchedReady})`}
                </button>
              </div>
              {batchMsg ? <div className="note ok">{batchMsg}</div> : null}
              <div className="flow-list">{matched.map(renderItem)}</div>
            </>
          ) : null}
          {unsorted.length ? (
            <>
              <p className="hint small">Unsorted ({unsorted.length})</p>
              <div className="flow-list">{unsorted.map(renderItem)}</div>
            </>
          ) : null}
        </>
      )}
    </div>
  )
}
