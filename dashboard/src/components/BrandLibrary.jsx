import { useState } from 'react'
import { SOURCE_TYPES, USEFUL_TAGS, isActive } from '../lib/brandDocs.js'
import AddDocumentModal from './AddDocumentModal.jsx'
import TagPicker from './TagPicker.jsx'

export default function BrandLibrary({
  library,
  projectDocs,
  onAddLibraryDoc,
  onUpdateLibraryDoc,
  onRemoveLibraryDoc,
  onAddToProject,
  onRemoveFromProject,
  onUpdateProjectDoc,
  onRemoveProjectDoc,
  onToggleProjectActive
}) {
  const [modalOpen, setModalOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [tagFilter, setTagFilter] = useState('all')
  const [sourceFilter, setSourceFilter] = useState('all')

  const tagOptions = Array.from(new Set([...USEFUL_TAGS, ...library.flatMap((d) => d.tags || [])]))

  const isInProject = (lib) => projectDocs.some((d) => d.from_library_id === lib.id)
  const boundActive = (lib) => projectDocs.some((d) => d.from_library_id === lib.id && isActive(d))

  const filtered = library.filter((d) => {
    if (sourceFilter !== 'all' && d.source_type !== sourceFilter) return false
    if (tagFilter !== 'all' && !(d.tags || []).includes(tagFilter)) return false
    if (search.trim()) {
      const q = search.toLowerCase()
      if (!(String(d.title || '').toLowerCase().includes(q) || String(d.content || '').toLowerCase().includes(q))) return false
    }
    return true
  })

  return (
    <section className="panel">
      <h2>Brand Library</h2>

      <div className="subpanel">
        <h3>Doc-first workflow</h3>
        <ol className="steps">
          <li>Add brand docs.</li>
          <li>Add docs to current project.</li>
          <li>Mark active.</li>
          <li>Extract Product / Offer Brief from docs (on the brief page).</li>
          <li>Import the brief JSON.</li>
          <li>Add or import script.</li>
          <li>Use AI Handoff to generate the full ad package.</li>
        </ol>
      </div>

      <div className="subpanel">
        <div className="row between">
          <h3>Global Brand Library</h3>
          <button className="primary small" onClick={() => setModalOpen(true)}>
            Add Document
          </button>
        </div>
        <p className="hint small">
          Reusable across all projects. Stored separately and kept when you Reset a project. {library.length} doc(s),
          showing {filtered.length}.
        </p>

        <div className="filters">
          <input className="search" type="text" placeholder="Search title / content..." value={search} onChange={(e) => setSearch(e.target.value)} />
          <select value={tagFilter} onChange={(e) => setTagFilter(e.target.value)}>
            <option value="all">All tags</option>
            {tagOptions.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <select value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)}>
            <option value="all">All sources</option>
            {SOURCE_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>

        <div className="doc-list">
          {filtered.length === 0 ? (
            <p className="hint">No matching docs.</p>
          ) : (
            filtered.map((d) => {
              const inProject = isInProject(d)
              return (
                <div key={d.id} className="doc-card">
                  <div className="doc-head">
                    <span className="badge">{d.source_type}</span>
                    <input className="doc-title" value={d.title} onChange={(e) => onUpdateLibraryDoc(d.id, { title: e.target.value })} />
                    <button className="ghost small" onClick={() => onRemoveLibraryDoc(d.id)}>
                      Delete
                    </button>
                  </div>
                  <div className="labels">
                    <span className="label label-global">Global</span>
                    {inProject ? <span className="label label-project">In Current Project</span> : null}
                    {boundActive(d) ? <span className="label label-active">Active in AI Prompt</span> : null}
                  </div>
                  <TagPicker value={d.tags} onChange={(tags) => onUpdateLibraryDoc(d.id, { tags })} />
                  <textarea rows={4} value={d.content} onChange={(e) => onUpdateLibraryDoc(d.id, { content: e.target.value })} />
                  <div className="row">
                    {inProject ? (
                      <button className="ghost small" onClick={() => onRemoveFromProject(d)}>
                        Remove from Project
                      </button>
                    ) : (
                      <button className="primary small" onClick={() => onAddToProject(d)}>
                        Add to Project
                      </button>
                    )}
                  </div>
                </div>
              )
            })
          )}
        </div>
      </div>

      <div className="subpanel">
        <h3>Current Project Docs</h3>
        <p className="hint small">
          Bound to this project. Toggle <b>Active</b> to include a doc in the AI Handoff prompt and the export.{' '}
          {projectDocs.length} doc(s), {projectDocs.filter((d) => isActive(d)).length} active.
        </p>
        <div className="doc-list">
          {projectDocs.length === 0 ? (
            <p className="hint">No project docs yet. Add one from the Global Brand Library above.</p>
          ) : (
            projectDocs.map((d) => (
              <div key={d.id} className={isActive(d) ? 'doc-card active' : 'doc-card'}>
                <div className="doc-head">
                  <label className="active-toggle">
                    <input type="checkbox" checked={isActive(d)} onChange={() => onToggleProjectActive(d.id)} /> Active
                  </label>
                  <span className="badge">{d.source_type}</span>
                  <input className="doc-title" value={d.title} onChange={(e) => onUpdateProjectDoc(d.id, { title: e.target.value })} />
                  <button className="ghost small" onClick={() => onRemoveProjectDoc(d.id)}>
                    Remove from Project
                  </button>
                </div>
                <div className="labels">
                  <span className="label label-project">In Current Project</span>
                  {isActive(d) ? <span className="label label-active">Active in AI Prompt</span> : null}
                </div>
                <TagPicker value={d.tags} onChange={(tags) => onUpdateProjectDoc(d.id, { tags })} />
                <textarea rows={4} value={d.content} onChange={(e) => onUpdateProjectDoc(d.id, { content: e.target.value })} />
              </div>
            ))
          )}
        </div>
      </div>

      {modalOpen ? <AddDocumentModal onAdd={onAddLibraryDoc} onClose={() => setModalOpen(false)} /> : null}
    </section>
  )
}
