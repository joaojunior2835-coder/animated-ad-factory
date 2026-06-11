import { useRef, useState } from 'react'
import { PROVIDERS } from '../data/providers.js'
import { VARIATION_TYPES, VARIATION_STATUSES } from '../lib/canvasModel.js'

export default function AddResultModal({ sceneNumber, onSave, onClose }) {
  const [label, setLabel] = useState('')
  const [type, setType] = useState('image')
  const [provider, setProvider] = useState('')
  const [url, setUrl] = useState('')
  const [prompt, setPrompt] = useState('')
  const [notes, setNotes] = useState('')
  const [status, setStatus] = useState('generated')
  const [file, setFile] = useState(null)
  const [fileName, setFileName] = useState('')
  const [saveLocal, setSaveLocal] = useState(true)
  const fileRef = useRef(null)

  function pick(e) {
    const f = e.target.files && e.target.files[0]
    e.target.value = ''
    if (f) {
      setFile(f)
      setFileName(f.name)
    }
  }

  function save() {
    onSave({ label, type, provider, external_url: url.trim(), prompt, notes, status }, file, saveLocal)
    onClose()
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>Add Existing Result — Scene {sceneNumber}</h3>
          <button className="ghost small" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="modal-body">
          <p className="hint small">Paste a result from Kling / Seedance / Flow / Higgsfield, or upload a local file. Save it to the Local Media Library so the preview survives reloads.</p>
          <input type="text" placeholder="Label (e.g. A)" value={label} onChange={(e) => setLabel(e.target.value)} />
          <div className="two">
            <label className="field">
              <span className="field-label">Type</span>
              <select value={type} onChange={(e) => setType(e.target.value)}>
                {VARIATION_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="field-label">Provider</span>
              <select value={provider} onChange={(e) => setProvider(e.target.value)}>
                <option value="">(provider)</option>
                {PROVIDERS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <input type="text" placeholder="External URL" value={url} onChange={(e) => setUrl(e.target.value)} />
          <textarea rows={2} placeholder="Prompt (optional)" value={prompt} onChange={(e) => setPrompt(e.target.value)} />
          <input type="text" placeholder="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
          <label className="field">
            <span className="field-label">Status</span>
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              {VARIATION_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <div className="row">
            <button className="ghost small" onClick={() => fileRef.current && fileRef.current.click()}>
              Upload file{fileName ? ' ✓' : ''}
            </button>
            <input ref={fileRef} type="file" accept="image/*,video/*" style={{ display: 'none' }} onChange={pick} />
          </div>
          {fileName ? <div className="hint small">Selected: {fileName}</div> : null}
          {fileName ? (
            <label className="row" style={{ alignItems: 'center', gap: '6px' }}>
              <input type="checkbox" checked={saveLocal} onChange={(e) => setSaveLocal(e.target.checked)} />
              <span className="hint small">Save To Local Media Library (survives reload)</span>
            </label>
          ) : null}
          <div className="row">
            <button className="primary" onClick={save}>
              Save Result
            </button>
            <button className="ghost" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
