import { useEffect, useRef, useState } from 'react'
import { STAGES, INTAKE_FIELDS } from './data/stages.js'
import { emptyProject, newClip, newBrandDoc, fromImported } from './lib/projectModel.js'
import { loadProject, saveProject, clearProject, saveBackup, loadBackup, hasBackup } from './lib/storage.js'
import { loadLibrary, saveLibrary, newLibraryDoc } from './lib/brandLibrary.js'
import { nowIso, isActive } from './lib/brandDocs.js'
import { downloadFlowPackage, downloadProjectJson, downloadProjectSnapshot } from './lib/exportFlowPackage.js'
import { validateProject, missingSections, exportBlockReason } from './lib/validation.js'
import { isCompetitorMethod, canvasToMethodData, buildSceneSkeletonPrompt, assessExportReadiness } from './lib/canvasModel.js'
import { getApiHealth, apiBase } from './lib/ai/apiClient.js'

function nonEmptyStr(v) {
  return String(v == null ? '' : v).trim().length > 0
}
import { buildClipSkeleton } from './lib/scriptSkeleton.js'
import { exampleProject } from './data/example.js'
import { getMethod } from './data/adMethods.js'
import MethodSelector from './components/MethodSelector.jsx'
import CanvasWorkspace from './components/CanvasWorkspace.jsx'
import BrandLibrary from './components/BrandLibrary.jsx'
import { competitorCanvasExample } from './data/canvasExample.js'
import ProductIntake from './components/ProductIntake.jsx'
import ScriptImport from './components/ScriptImport.jsx'
import AiHandoff from './components/AiHandoff.jsx'
import TextStage from './components/TextStage.jsx'
import ClipBuilder from './components/ClipBuilder.jsx'
import LinesField from './components/LinesField.jsx'
import DurationStatus from './components/DurationStatus.jsx'
import ValidationPanel from './components/ValidationPanel.jsx'
import CopyStagePrompt from './components/CopyStagePrompt.jsx'
import JsonPreview from './components/JsonPreview.jsx'
import NodeCanvas from './components/nodecanvas/NodeCanvas.jsx'
import { emptyNodeCanvas, normalizeNodeCanvas, updateNodeData } from './lib/nodeCanvasModel.js'

const SPECIAL_NAV = [
  { key: 'methods', label: 'Ad Methods' },
  { key: 'brand', label: 'Brand Library' },
  { key: 'intake', label: 'Product / Offer Brief' },
  { key: 'script', label: 'Script Import' },
  { key: 'handoff', label: 'AI Handoff' },
  { key: 'canvas', label: 'Canvas' },
  { key: 'node_canvas', label: 'Node Canvas' }
]

// Signature of the export-relevant Canvas data, for stale-sync detection.
function canvasSignature(project) {
  return JSON.stringify(project.canvas || {})
}

// Merge Canvas → method_data for Competitor Video Recreation. Returns the SAME
// project reference when nothing changed (so it never marks the project dirty).
function syncedProject(project) {
  if (!isCompetitorMethod(project.selected_method)) return project
  const patch = canvasToMethodData(project)
  const cur = project.method_data || {}
  const changed = Object.keys(patch).some((k) => JSON.stringify(cur[k]) !== JSON.stringify(patch[k]))
  if (!changed) return project
  return { ...project, method_data: { ...cur, ...patch } }
}

export default function App() {
  const [project, setProject] = useState(() => loadProject(emptyProject()))
  const [library, setLibrary] = useState(() => loadLibrary())
  const [active, setActive] = useState('brand')
  const [backupExists, setBackupExists] = useState(() => hasBackup())
  const [canvasPreviews, setCanvasPreviews] = useState({})
  const [snapshotDirty, setSnapshotDirty] = useState(false)
  const [exportedThisSession, setExportedThisSession] = useState(false)
  const [lastSyncSig, setLastSyncSig] = useState(null)
  const [syncedNote, setSyncedNote] = useState(false)
  const [apiBadge, setApiBadge] = useState({ loading: true, connected: false, openai: false, openrouter: false, url: '' })
  const firstRenderRef = useRef(true)

  useEffect(() => {
    saveProject(project)
  }, [project])

  // Mark the project dirty (snapshot recommended) after the first render.
  useEffect(() => {
    if (firstRenderRef.current) {
      firstRenderRef.current = false
      return
    }
    setSnapshotDirty(true)
  }, [project])

  function saveSnapshot() {
    downloadProjectSnapshot(project)
    setSnapshotDirty(false)
  }
  useEffect(() => {
    saveLibrary(library)
  }, [library])

  // --- Global Local API status badge (uses /health; never exposes keys) ---
  async function refreshApiBadge() {
    setApiBadge((b) => ({ ...b, loading: true }))
    const r = await getApiHealth()
    setApiBadge({
      loading: false,
      connected: !!r.connected,
      openai: !!(r.providers && r.providers.openai),
      openrouter: !!(r.providers && r.providers.openrouter),
      url: apiBase()
    })
  }
  useEffect(() => {
    refreshApiBadge()
  }, [])
  const providerMode = project.canvas && project.canvas.provider_mode
  useEffect(() => {
    if (providerMode === 'api') refreshApiBadge()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [providerMode])

  // --- Auto-sync Canvas → export data when opening Final Export (competitor) ---
  useEffect(() => {
    const st = STAGES.find((s) => s.key === active)
    if (st && st.kind === 'export' && isCompetitorMethod(project.selected_method)) {
      setProject((p) => syncedProject(p))
      setLastSyncSig(canvasSignature(project))
      setSyncedNote(true)
    } else {
      setSyncedNote(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])

  // --- brief / stage mutations ---
  const setIntake = (key, value) =>
    setProject((p) => ({ ...p, product_intake: { ...p.product_intake, [key]: value } }))
  const setField = (key, value) => setProject((p) => ({ ...p, [key]: value }))
  const setNote = (key, value) => setProject((p) => ({ ...p, notes: { ...p.notes, [key]: value } }))
  const setNegatives = (arr) => setProject((p) => ({ ...p, negative_constraints: arr }))
  const setScript = (patch) => setProject((p) => ({ ...p, script_import: { ...p.script_import, ...patch } }))
  const setSelectedMethod = (id) => setProject((p) => ({ ...p, selected_method: id }))

  // --- canvas ---
  const updateCanvas = (fn) => setProject((p) => ({ ...p, canvas: fn(p.canvas) }))
  // Node Canvas (separate surface) — routes through the same setProject/saveProject path.
  const updateNodeCanvas = (fn) => setProject((p) => ({ ...p, node_canvas: fn(p.node_canvas || emptyNodeCanvas()) }))
  // Node Canvas → backend generation routing. The component never calls the
  // backend itself; it asks App via this callback. The full engine (mock /
  // OpenAI image / manual) replaces this body in the generation-engine phase.
  async function generateForNode(nodeId) {
    updateNodeCanvas((c) => updateNodeData(c, nodeId, { status: 'error', status_message: 'Generation engine not connected yet.' }))
  }
  const setCanvasPreview = (id, dataUrl) => setCanvasPreviews((m) => ({ ...m, [id]: dataUrl }))
  const selectCompetitor = () => setSelectedMethod('competitor_recreation')

  function applyCanvasImport(scenes, parsed) {
    setProject((p) => {
      const method_data = { ...(p.method_data || {}) }
      const src = parsed.method_data && typeof parsed.method_data === 'object' ? parsed.method_data : {}
      ;['competitor_structure', 'adapted_structure', 'visual_style_transfer_notes'].forEach((k) => {
        if (parsed[k] != null) method_data[k] = parsed[k]
        else if (src[k] != null) method_data[k] = src[k]
      })
      method_data.shot_by_shot_plan = scenes.map((s) => ({
        shot: s.scene_number,
        competitor_beat: s.what_happens,
        adapted_shot: s.adaptation_instruction_for_our_product,
        frame_prompt: s.output_prompt,
        brand_safe_change: ''
      }))
      const edit_plan = parsed.edit_plan != null && String(parsed.edit_plan).trim() ? parsed.edit_plan : p.edit_plan
      return { ...p, canvas: { ...p.canvas, scenes }, method_data, edit_plan }
    })
  }

  const syncCanvasExportData = (patch) => {
    setProject((p) => ({ ...p, method_data: { ...p.method_data, ...patch } }))
    setLastSyncSig(canvasSignature(project))
    setSyncedNote(true)
  }

  // Fill empty output prompts with no-AI skeletons (mirrors the Canvas action).
  function fillCanvasSkeletons() {
    setProject((p) => {
      const c = p.canvas || {}
      const defs = c.model_defaults || {}
      return {
        ...p,
        canvas: {
          ...c,
          scenes: (c.scenes || []).map((s) =>
            nonEmptyStr(s.output_prompt) ? s : { ...s, output_prompt: buildSceneSkeletonPrompt(s, s.video_provider || defs.default_video_provider || '') }
          )
        }
      }
    })
  }

  function loadCanvasExample() {
    if (!window.confirm('Load the Competitor Canvas example? This replaces current content.')) return
    setProject(competitorCanvasExample())
    setCanvasPreviews({})
    setActive('canvas')
  }

  // Apply an auto-extracted brief. mode 'replace' overwrites; 'empty' fills blanks only.
  function applyBrief(intakeObj, mode) {
    setProject((p) => {
      const cur = p.product_intake
      const next = { ...cur }
      const keys = [...INTAKE_FIELDS.map((f) => f.key), 'optional_compliance_notes']
      keys.forEach((key) => {
        const val = intakeObj[key]
        if (val == null) return
        const s = String(val)
        if (mode === 'replace') next[key] = s
        else if (!String(cur[key] || '').trim()) next[key] = s
      })
      return { ...p, product_intake: next }
    })
  }

  // --- global library ---
  const addLibraryDoc = (partial) => setLibrary((l) => [...l, newLibraryDoc(partial)])
  const updateLibraryDoc = (id, patch) =>
    setLibrary((l) => l.map((d) => (d.id === id ? { ...d, ...patch, updated_at: nowIso() } : d)))
  const removeLibraryDoc = (id) => setLibrary((l) => l.filter((d) => d.id !== id))

  // --- project brand docs (bound from the library) ---
  const addDocToProject = (libDoc) =>
    setProject((p) => ({
      ...p,
      brand_docs: [
        ...p.brand_docs,
        newBrandDoc(libDoc.title, libDoc.content, {
          source_type: libDoc.source_type,
          source_url: libDoc.source_url,
          tags: libDoc.tags,
          notes: libDoc.notes,
          from_library_id: libDoc.id
        })
      ]
    }))
  const removeDocFromProjectByLib = (libDoc) =>
    setProject((p) => ({ ...p, brand_docs: p.brand_docs.filter((d) => d.from_library_id !== libDoc.id) }))
  const updateProjectDoc = (id, patch) =>
    setProject((p) => ({ ...p, brand_docs: p.brand_docs.map((d) => (d.id === id ? { ...d, ...patch, updated_at: nowIso() } : d)) }))
  const removeProjectDoc = (id) =>
    setProject((p) => ({ ...p, brand_docs: p.brand_docs.filter((d) => d.id !== id) }))
  const toggleProjectActive = (id) =>
    setProject((p) => ({ ...p, brand_docs: p.brand_docs.map((d) => (d.id === id ? { ...d, active_for_project: !isActive(d), updated_at: nowIso() } : d)) }))

  // --- clips ---
  const addClip = () => setProject((p) => ({ ...p, clips: [...p.clips, newClip(p.clips.length + 1)] }))
  const updateClip = (i, patch) =>
    setProject((p) => {
      const clips = [...p.clips]
      clips[i] = { ...clips[i], ...patch }
      return { ...p, clips }
    })
  const removeClip = (i) =>
    setProject((p) => {
      const clips = p.clips.filter((_, idx) => idx !== i).map((c, idx) => ({ ...c, clip_number: idx + 1 }))
      return { ...p, clips }
    })

  function handleCreateSkeleton() {
    const clips = buildClipSkeleton(project)
    if (project.clips.length > 0 && !window.confirm(`Replace the current ${project.clips.length} clip(s) with a ${clips.length}-clip skeleton?`)) return
    setProject((p) => ({ ...p, clips }))
    setActive('frame_prompts')
  }

  // --- export / import ---
  function handleExport() {
    if (exportBlockReason(project)) return
    // Always export from the Canvas source of truth: auto-sync first.
    const synced = syncedProject(project)
    if (synced !== project) setProject(synced)
    setLastSyncSig(canvasSignature(synced))
    setSyncedNote(true)
    // Readiness gate. Competitor uses the consolidated canvas assessment; other
    // methods keep the method validator. Both let the user see issues and force it.
    if (isCompetitorMethod(synced.selected_method)) {
      const r = assessExportReadiness(synced)
      if (r.blockers.length) {
        const msg =
          `Export readiness: ${r.blockers.length} blocker(s) — the package will be incomplete:\n\n` +
          r.blockers.map((b) => `• ${b.message}`).join('\n') +
          (r.warnings.length ? '\n\nWarnings:\n' + r.warnings.map((w) => `• ${w.message}`).join('\n') : '') +
          '\n\nExport anyway?'
        if (!window.confirm(msg)) return
      } else if (r.warnings.length) {
        const msg = `Export readiness: ${r.warnings.length} warning(s):\n\n` + r.warnings.map((w) => `• ${w.message}`).join('\n') + '\n\nProceed with export?'
        if (!window.confirm(msg)) return
      }
    } else {
      const v = validateProject(synced)
      if (!v.ready) {
        const msg =
          `Validation found ${v.failed.length} blocking issue(s):\n\n` +
          v.failed.map((c) => `• ${c.label}`).join('\n') +
          '\n\nThe exported package will be incomplete. Export anyway?'
        if (!window.confirm(msg)) return
      }
    }
    downloadFlowPackage(synced)
    setExportedThisSession(true)
  }

  const handleExportJson = () => downloadProjectJson(project)

  // Replace the project with imported data, after saving a backup snapshot of the
  // current project. Used by the AI Handoff preview and by file import.
  function commitImport(parsed) {
    saveBackup(project)
    setBackupExists(true)
    setProject((p) => fromImported(parsed, p))
  }

  function restoreBackup() {
    const b = loadBackup()
    if (!b) {
      window.alert('No backup found.')
      return false
    }
    if (!window.confirm('Restore the last backup? This replaces the current project.')) return false
    setProject(fromImported(b))
    return true
  }

  // File import (right panel) — trusted saved project; confirm, then commit.
  function handleImportFile(file) {
    const reader = new FileReader()
    reader.onload = () => {
      let parsed
      try {
        parsed = JSON.parse(String(reader.result))
      } catch (e) {
        window.alert('Invalid JSON: ' + e.message)
        return
      }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        window.alert('JSON must be a single object describing the project.')
        return
      }
      if (!window.confirm('Import this JSON? It replaces the current project (Brand Library + a backup are kept).')) return
      commitImport(parsed)
    }
    reader.readAsText(file)
  }

  function handleLoadExample() {
    if (!window.confirm('Load the French Craving-Control Claymation example? This replaces current content.')) return
    setProject(exampleProject())
    setActive('brand')
  }

  function handleReset() {
    if (!window.confirm('Clear the current project on this machine? (The global Brand Library is kept.)')) return
    clearProject()
    setProject(emptyProject())
    setActive('brand')
  }

  const stage = STAGES.find((s) => s.key === active)

  function renderMain() {
    if (active === 'methods') {
      return <MethodSelector selectedMethod={project.selected_method} onSelect={setSelectedMethod} />
    }
    if (active === 'brand') {
      return (
        <BrandLibrary
          library={library}
          projectDocs={project.brand_docs}
          onAddLibraryDoc={addLibraryDoc}
          onUpdateLibraryDoc={updateLibraryDoc}
          onRemoveLibraryDoc={removeLibraryDoc}
          onAddToProject={addDocToProject}
          onRemoveFromProject={removeDocFromProjectByLib}
          onUpdateProjectDoc={updateProjectDoc}
          onRemoveProjectDoc={removeProjectDoc}
          onToggleProjectActive={toggleProjectActive}
        />
      )
    }
    if (active === 'intake') {
      return <ProductIntake intake={project.product_intake} onChange={setIntake} project={project} onApplyBrief={applyBrief} />
    }
    if (active === 'script') {
      return <ScriptImport script={project.script_import} onChange={setScript} onCreateSkeleton={handleCreateSkeleton} />
    }
    if (active === 'canvas') {
      return (
        <CanvasWorkspace
          project={project}
          onCanvas={updateCanvas}
          previews={canvasPreviews}
          onSetPreview={setCanvasPreview}
          onApplyCanvasImport={applyCanvasImport}
          onSyncExportData={syncCanvasExportData}
          onLoadExample={loadCanvasExample}
          onSelectCompetitor={selectCompetitor}
        />
      )
    }
    if (active === 'node_canvas') {
      // Saved Local Media Library images the project already references (no new endpoint).
      const savedMedia = []
      const seen = new Set()
      const pushMedia = (url, name) => {
        if (url && !seen.has(url)) {
          seen.add(url)
          savedMedia.push({ local_url: url, file_name: name || String(url).split('/').pop() })
        }
      }
      ;(project.canvas && project.canvas.scenes ? project.canvas.scenes : []).forEach((s) => (s.variations || []).forEach((v) => { if (v.local_url) pushMedia(v.local_url, v.file_name) }))
      ;(project.canvas && project.canvas.assets ? project.canvas.assets : []).forEach((a) => { if (a.local_url) pushMedia(a.local_url, a.file_name) })
      ;(project.node_canvas && project.node_canvas.nodes ? project.node_canvas.nodes : []).forEach((n) => { if (n.data && n.data.local_url) pushMedia(n.data.local_url, n.data.file_name) })
      return (
        <NodeCanvas
          nodeCanvas={normalizeNodeCanvas(project.node_canvas)}
          onChange={updateNodeCanvas}
          savedMedia={savedMedia}
          onGenerateNode={generateForNode}
          providerMode={(project.canvas && project.canvas.provider_mode) || 'manual'}
        />
      )
    }
    if (active === 'handoff') {
      return (
        <AiHandoff
          project={project}
          onCommitImport={commitImport}
          onRestoreBackup={restoreBackup}
          backupExists={backupExists}
        />
      )
    }

    if (stage.kind === 'text') {
      return (
        <TextStage
          stage={stage}
          value={project[stage.key]}
          onChange={(v) => setField(stage.key, v)}
          actions={<CopyStagePrompt project={project} stageKey={stage.key} />}
        >
          {stage.showNegatives ? (
            <div className="extras">
              <h3>Global Negative Constraints</h3>
              <p className="hint small">Applied to every clip and listed in the export.</p>
              <LinesField
                value={project.negative_constraints}
                onChange={setNegatives}
                rows={8}
                placeholder={'no medical claims\nno weight-loss claims\nno appetite-suppressant claims'}
              />
            </div>
          ) : null}
        </TextStage>
      )
    }

    if (stage.kind === 'clips') {
      return (
        <section className="panel">
          <div className="panel-head">
            <h2>{stage.label}</h2>
            <CopyStagePrompt project={project} stageKey={stage.key} />
          </div>
          <pre className="instructions">{stage.instructions}</pre>
          <label className="field">
            <span className="field-label">Notes (free text, scratch)</span>
            <textarea
              className="stage-text short"
              rows={4}
              value={project.notes[stage.key] || ''}
              placeholder="Optional working notes for this stage..."
              onChange={(e) => setNote(stage.key, e.target.value)}
            />
          </label>
          <ClipBuilder project={project} onAddClip={addClip} onUpdateClip={updateClip} onRemoveClip={removeClip} />
        </section>
      )
    }

    const missing = missingSections(project)
    return (
      <section className="panel">
        <h2>{stage.label}</h2>
        <pre className="instructions">{stage.instructions}</pre>

        <div className="note">Selected method: <b>{getMethod(project.selected_method).name}</b> — validation and export sections match this method.</div>

        {isCompetitorMethod(project.selected_method) ? (() => {
          const stale = lastSyncSig !== null && lastSyncSig !== canvasSignature(project)
          return (
            <>
              {syncedNote && !stale ? <div className="note ok">Canvas data synced to export.</div> : null}
              {stale ? <div className="note">Canvas changed since last export sync. Export will auto-sync before download.</div> : null}
            </>
          )
        })() : null}

        <h3>Duration</h3>
        <DurationStatus project={project} />

        <h3 className="section-gap">Validation</h3>
        <ValidationPanel project={project} />

        <h3 className="section-gap">Missing Sections</h3>
        {missing.length === 0 ? (
          <p className="hint small">None — every section has content.</p>
        ) : (
          <ul className="missing-list">
            {missing.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        )}

        <h3 className="section-gap">Export Bundle Checklist</h3>
        {(() => {
          const canvas = project.canvas || {}
          const scenes = canvas.scenes || []
          const ref = canvas.competitor_reference || {}
          const anyVar = scenes.some((s) => (s.variations || []).length)
          const sel = scenes.map((s) => (s.variations || []).find((v) => v.status === 'selected')).filter(Boolean)
          const stale = lastSyncSig !== null && lastSyncSig !== canvasSignature(project)
          const hollow = scenes.filter((s) => !nonEmptyStr(s.output_prompt) && !nonEmptyStr(s.adaptation_instruction_for_our_product)).length
          const items = [
            { label: 'Project snapshot saved this session', ok: !snapshotDirty },
            { label: 'Final package exported this session', ok: exportedThisSession }
          ]
          if (isCompetitorMethod(project.selected_method)) {
            const sessionOnly = sel.filter((v) => !v.external_url && !v.local_url).length
            items.push({ label: 'Canvas synced to export (not stale)', ok: lastSyncSig !== null && !stale })
            items.push({ label: 'Competitor reference present', ok: nonEmptyStr(ref.competitor_ad_name) || nonEmptyStr(ref.competitor_brand) })
            items.push({ label: 'Scene board has scenes', ok: scenes.length > 0 })
            items.push({ label: hollow ? `Prompts/adaptation content present (${hollow} scene(s) empty)` : 'Prompts/adaptation content present', ok: scenes.length > 0 && hollow === 0 })
            if (anyVar) {
              items.push({ label: 'Selected outputs present', ok: sel.length > 0 })
              items.push({ label: sessionOnly ? `${sessionOnly} selected output(s) are session-only previews` : 'Media URLs saved (no session-only previews)', ok: sessionOnly === 0 })
            }
          }
          return (
            <ul className="bundle-checklist readiness-list">
              {items.map((it) => (
                <li key={it.label} className={it.ok ? 'ready-ok' : 'ready-missing'}>
                  {it.ok ? '✓' : '•'} {it.label}
                </li>
              ))}
            </ul>
          )
        })()}

        <h3 className="section-gap">Export</h3>
        {isCompetitorMethod(project.selected_method) ? (() => {
          const scenes = (project.canvas || {}).scenes || []
          const hollow = scenes.filter((s) => !nonEmptyStr(s.output_prompt) && !nonEmptyStr(s.adaptation_instruction_for_our_product)).length
          if (!hollow) return null
          return (
            <div className="note">
              Some scenes have no prompt/adaptation content. Export will include empty sections.
              <div className="row" style={{ marginTop: '8px' }}>
                <button className="ghost small" onClick={fillCanvasSkeletons}>
                  Generate Scene Prompt Skeletons
                </button>
              </div>
            </div>
          )
        })() : null}
        {isCompetitorMethod(project.selected_method) ? (() => {
          const r = assessExportReadiness(project)
          const cls = r.blockers.length ? 'api-badge off' : r.warnings.length ? 'api-badge warn' : 'api-badge ok'
          const label = r.blockers.length
            ? `${r.blockers.length} blocker(s) — not export-ready`
            : r.warnings.length
              ? `Ready with ${r.warnings.length} warning(s)`
              : 'Ready to export'
          return (
            <div style={{ marginBottom: '8px' }}>
              <span className={cls} data-testid="export-readiness" title="Consolidated export readiness (read-only)">
                {label}
              </span>
            </div>
          )
        })() : null}
        {exportBlockReason(project) ? <div className="note bad">{exportBlockReason(project)}</div> : null}
        <div className="row">
          <button className="primary" onClick={handleExport} disabled={!!exportBlockReason(project)}>
            Export Flow Package Markdown
          </button>
          <button className="ghost" onClick={handleExportJson}>
            Export Project JSON
          </button>
        </div>
      </section>
    )
  }

  const navItems = [
    ...SPECIAL_NAV.map((s) => ({ ...s, special: true })),
    ...STAGES.map((s) => ({ key: s.key, label: s.label, kind: s.kind, special: false }))
  ]

  function hasContent(item) {
    if (item.key === 'methods') return false
    if (item.key === 'brand') return project.brand_docs.length > 0
    if (item.key === 'intake') return (project.product_intake.product_name || '').trim().length > 0
    if (item.key === 'script') return (project.script_import.script || '').trim().length > 0
    if (item.key === 'handoff') return false
    if (item.key === 'canvas') return (project.canvas && project.canvas.scenes && project.canvas.scenes.length > 0) || false
    if (item.key === 'node_canvas') return (project.node_canvas && project.node_canvas.nodes && project.node_canvas.nodes.length > 0) || false
    if (item.kind === 'clips') return project.clips.length > 0
    if (item.kind === 'export') return false
    return (project[item.key] || '').trim().length > 0
  }

  return (
    <div className="app">
      <header className="topbar">
        <h1>Animated Ad Factory</h1>
        <span className="tag">Visual Production Layer</span>
        {(() => {
          const b = apiBadge
          const yn = (v) => (v ? '✓' : '✗')
          const label = b.loading
            ? 'Local API: checking…'
            : !b.connected
              ? 'Local backend offline — run npm run dev:server or npm run dev:all from dashboard/.'
              : `Backend online · OpenAI ${yn(b.openai)} · OpenRouter ${yn(b.openrouter)}`
          const cls = b.loading ? 'api-badge' : !b.connected ? 'api-badge off' : b.openai || b.openrouter ? 'api-badge ok' : 'api-badge warn'
          return (
            <span className="api-badge-wrap" data-testid="runtime-status">
              <span className={cls} title={b.url ? `Backend: ${b.url} (status from /health; no keys exposed)` : 'Local backend status from /health (no keys exposed)'}>
                {label}
              </span>
              <button className="ghost small" onClick={refreshApiBadge}>
                Refresh
              </button>
            </span>
          )
        })()}
      </header>

      <div className="layout">
        <nav className="sidebar-left">
          {navItems.map((item, i) => (
            <button
              key={item.key}
              className={active === item.key ? 'nav active' : 'nav'}
              onClick={() => setActive(item.key)}
            >
              <span className="num">{i + 1}</span>
              <span className="nav-text">{item.label}</span>
              {hasContent(item) ? <span className="dot" title="Has content" /> : null}
            </button>
          ))}
        </nav>

        <main className="main">{renderMain()}</main>

        <JsonPreview
          project={project}
          onExport={handleExport}
          onExportJson={handleExportJson}
          onSaveSnapshot={saveSnapshot}
          snapshotDirty={snapshotDirty}
          onImport={handleImportFile}
          onLoadExample={handleLoadExample}
          onReset={handleReset}
        />
      </div>
    </div>
  )
}
