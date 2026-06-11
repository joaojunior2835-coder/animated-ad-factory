import { useRef, useState } from 'react'
import { extractFromFile } from '../lib/extractText.js'
import TagPicker from './TagPicker.jsx'

export default function AddDocumentModal({ onAdd, onClose }) {
  const [tab, setTab] = useState('paste')

  const [pTitle, setPTitle] = useState('')
  const [pSource, setPSource] = useState('')
  const [pContent, setPContent] = useState('')
  const [pTags, setPTags] = useState([])

  const [gTitle, setGTitle] = useState('')
  const [gUrl, setGUrl] = useState('')
  const [gContent, setGContent] = useState('')
  const [gTags, setGTags] = useState([])

  const [items, setItems] = useState([])
  const [busy, setBusy] = useState(false)
  const [uTags, setUTags] = useState([])
  const fileRef = useRef(null)

  function addPaste() {
    if (!pTitle.trim() && !pContent.trim()) return
    onAdd({ title: pTitle.trim() || 'Untitled doc', content: pContent, source_type: 'paste', notes: pSource, tags: pTags })
    onClose()
  }

  function addGoogle() {
    if (!gTitle.trim() && !gContent.trim()) return
    onAdd({ title: gTitle.trim() || 'Untitled Google Doc', content: gContent, source_type: 'google_docs', source_url: gUrl, tags: gTags })
    onClose()
  }

  async function onFiles(e) {
    const files = Array.from(e.target.files || [])
    e.target.value = ''
    if (!files.length) return
    setBusy(true)
    const results = []
    for (const f of files) {
      const r = await extractFromFile(f)
      results.push({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        fileName: f.name,
        title: f.name.replace(/\.[^.]+$/, ''),
        source_type: r.source_type,
        text: r.text,
        status: r.status,
        message: r.message
      })
    }
    setItems((prev) => [...prev, ...results])
    setBusy(false)
  }

  const updateItem = (id, patch) => setItems((its) => its.map((it) => (it.id === id ? { ...it, ...patch } : it)))
  const removeItem = (id) => setItems((its) => its.filter((it) => it.id !== id))

  function addUploads() {
    const ready = items.filter((it) => (it.text || '').trim())
    ready.forEach((it) => onAdd({ title: it.title.trim() || it.fileName, content: it.text, source_type: it.source_type, tags: uTags }))
    onClose()
  }

  const readyCount = items.filter((it) => (it.text || '').trim()).length

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>Add Document</h3>
          <button className="ghost small" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="modal-tabs">
          <button className={tab === 'paste' ? 'tab on' : 'tab'} onClick={() => setTab('paste')}>
            Paste Text
          </button>
          <button className={tab === 'upload' ? 'tab on' : 'tab'} onClick={() => setTab('upload')}>
            Upload Files
          </button>
          <button className={tab === 'google' ? 'tab on' : 'tab'} onClick={() => setTab('google')}>
            Google Docs
          </button>
        </div>

        <div className="modal-body">
          {tab === 'paste' ? (
            <>
              <label className="field">
                <span className="field-label">Title</span>
                <input value={pTitle} onChange={(e) => setPTitle(e.target.value)} placeholder="Document title" />
              </label>
              <label className="field">
                <span className="field-label">Source label (optional)</span>
                <input value={pSource} onChange={(e) => setPSource(e.target.value)} placeholder="e.g. 2024 brand guide" />
              </label>
              <label className="field">
                <span className="field-label">Content</span>
                <textarea className="stage-text" value={pContent} onChange={(e) => setPContent(e.target.value)} placeholder="Paste document text..." />
              </label>
              <span className="field-label">Tags</span>
              <TagPicker value={pTags} onChange={setPTags} />
              <div className="row">
                <button className="primary" onClick={addPaste}>
                  Add to Library
                </button>
              </div>
            </>
          ) : null}

          {tab === 'upload' ? (
            <>
              <div className="note">
                Supported: <b>.txt, .md, .json</b> (instant), <b>.pdf, .docx</b> (auto-extracted). If a file can’t be
                read, paste its text into the box below — the upload is still accepted.
              </div>
              <div className="row">
                <button className="ghost" onClick={() => fileRef.current && fileRef.current.click()}>
                  Choose files
                </button>
                <input ref={fileRef} type="file" multiple accept=".txt,.md,.markdown,.json,.pdf,.docx" style={{ display: 'none' }} onChange={onFiles} />
                {busy ? <span className="status">Extracting…</span> : null}
              </div>
              <span className="field-label">Tags applied to all uploads</span>
              <TagPicker value={uTags} onChange={setUTags} />
              <div className="upload-list">
                {items.map((it) => (
                  <div key={it.id} className="upload-item">
                    <div className="doc-head">
                      <span className="badge">{it.source_type}</span>
                      <input className="doc-title" value={it.title} onChange={(e) => updateItem(it.id, { title: e.target.value })} />
                      <span className={`badge status-${it.status}`}>{it.status}</span>
                      <button className="ghost small" onClick={() => removeItem(it.id)}>
                        Remove
                      </button>
                    </div>
                    {it.message ? <div className="hint small">{it.message}</div> : null}
                    <textarea rows={4} value={it.text} placeholder="Paste extracted text here if empty..." onChange={(e) => updateItem(it.id, { text: e.target.value })} />
                  </div>
                ))}
              </div>
              {items.length > 0 ? (
                <div className="row">
                  <button className="primary" onClick={addUploads} disabled={readyCount === 0}>
                    Add {readyCount} document(s) to Library
                  </button>
                </div>
              ) : null}
            </>
          ) : null}

          {tab === 'google' ? (
            <>
              <div className="note">Paste the Google Doc text here for now. Direct Google Docs import will come later.</div>
              <label className="field">
                <span className="field-label">Google Doc title</span>
                <input value={gTitle} onChange={(e) => setGTitle(e.target.value)} placeholder="Document title" />
              </label>
              <label className="field">
                <span className="field-label">Google Doc URL (optional)</span>
                <input value={gUrl} onChange={(e) => setGUrl(e.target.value)} placeholder="https://docs.google.com/..." />
              </label>
              <label className="field">
                <span className="field-label">Pasted content</span>
                <textarea className="stage-text" value={gContent} onChange={(e) => setGContent(e.target.value)} placeholder="Paste the Google Doc text..." />
              </label>
              <span className="field-label">Tags</span>
              <TagPicker value={gTags} onChange={setGTags} />
              <div className="row">
                <button className="primary" onClick={addGoogle}>
                  Add to Library
                </button>
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  )
}
