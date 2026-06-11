import { useState } from 'react'
import { normalizeProject } from '../lib/projectModel.js'
import { validateProject, exportBlockReason } from '../lib/validation.js'
import DurationStatus from './DurationStatus.jsx'
import ImportButton from './ImportButton.jsx'

export default function JsonPreview({ project, onExport, onExportJson, onSaveSnapshot, snapshotDirty, onImport, onLoadExample, onReset }) {
  const [copied, setCopied] = useState(false)
  const json = JSON.stringify(normalizeProject(project), null, 2)
  const v = validateProject(project)
  const blockReason = exportBlockReason(project)

  async function copy() {
    try {
      await navigator.clipboard.writeText(json)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard may be blocked; ignore.
    }
  }

  return (
    <aside className="sidebar-right">
      {snapshotDirty ? <div className="note bad">Unsaved project changes. Export a Project Snapshot before closing.</div> : null}

      <h3>Duration Check</h3>
      <DurationStatus project={project} />

      <div className={`readiness compact ${v.ready ? 'ok' : 'bad'}`}>
        {v.ready ? 'Export readiness: Ready' : `Export readiness: ${v.failed.length} issue(s)`}
      </div>

      <div className="row between section-gap">
        <h3>Project JSON</h3>
        <button className="ghost small" onClick={copy}>
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="json">{json}</pre>

      <div className="export-block">
        <h3>Save &amp; Restore</h3>
        <p className="hint small">Project Snapshot saves the full working state for restoring later. Restore replaces the dashboard state (a backup is kept).</p>
        <button className="primary full" onClick={onSaveSnapshot}>
          Save Project Snapshot
        </button>
        <ImportButton onImport={onImport} label="Restore Project Snapshot" className="ghost full gap" />
      </div>

      <div className="export-block">
        <h3>Export &amp; Project Files</h3>
        <p className="hint small">
          Flow package = full ad Markdown. Project JSON = save/move/reload the whole project.
        </p>
        {blockReason ? <div className="note bad">{blockReason}</div> : null}
        <button className="primary full" onClick={onExport} disabled={!!blockReason}>
          Export Flow Package
        </button>
        <button className="ghost full gap" onClick={onExportJson}>
          Export Project JSON
        </button>
        <button className="ghost full gap" onClick={onLoadExample}>
          Load French Craving-Control Claymation Example
        </button>
        <button className="ghost full gap" onClick={onReset}>
          Reset
        </button>
      </div>
    </aside>
  )
}
