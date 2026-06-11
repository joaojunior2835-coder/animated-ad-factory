import { useRef, useState } from 'react'
import { buildMasterPrompt, activeDocsWarning, briefInferenceNote } from '../lib/masterPrompt.js'
import { getMethod } from '../data/adMethods.js'
import { validateAiJson } from '../lib/aiImportValidation.js'
import { buildRepairPrompt } from '../lib/repairPrompt.js'

export default function AiHandoff({ project, onCommitImport, onRestoreBackup, backupExists }) {
  const [copied, setCopied] = useState(false)
  const [showPreview, setShowPreview] = useState(false)
  const [paste, setPaste] = useState('')
  const fileRef = useRef(null)

  // Import-safety state
  const [parseError, setParseError] = useState('')
  const [validation, setValidation] = useState(null)
  const [pending, setPending] = useState(null)
  const [raw, setRaw] = useState('')
  const [imported, setImported] = useState(false)
  const [repairCopied, setRepairCopied] = useState(false)
  const [restored, setRestored] = useState(false)

  const prompt = buildMasterPrompt(project)
  const docsWarning = activeDocsWarning(project)
  const briefNote = briefInferenceNote(project)
  const method = getMethod(project.selected_method)

  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(prompt)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      /* ignore */
    }
  }

  async function pasteFromClipboard() {
    try {
      const t = await navigator.clipboard.readText()
      setPaste(t)
      resetPreview()
    } catch {
      setParseError('Clipboard read was blocked — paste manually into the box.')
    }
  }

  function pickFile(e) {
    const f = e.target.files && e.target.files[0]
    if (f) {
      const r = new FileReader()
      r.onload = () => {
        setPaste(String(r.result))
        resetPreview()
      }
      r.readAsText(f)
    }
    e.target.value = ''
  }

  function resetPreview() {
    setParseError('')
    setValidation(null)
    setPending(null)
    setImported(false)
    setRepairCopied(false)
  }

  // Step 1: parse + validate, then show the preview (does NOT replace yet).
  function runValidate() {
    setImported(false)
    setRestored(false)
    setRaw(paste)
    let parsed
    try {
      parsed = JSON.parse(paste)
    } catch (e) {
      setParseError('Invalid JSON: ' + e.message)
      setValidation(null)
      setPending(null)
      return
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      setParseError('JSON must be a single object describing the project.')
      setValidation(null)
      setPending(null)
      return
    }
    setParseError('')
    setValidation(validateAiJson(parsed, project))
    setPending(parsed)
  }

  // Step 2: commit (after preview). Backup happens in the parent.
  function commit() {
    if (!pending) return
    onCommitImport(pending)
    setImported(true)
    setPending(null)
    setValidation(null)
    setPaste('')
  }

  function cancel() {
    resetPreview()
  }

  async function copyRepair() {
    const errors = parseError
      ? [parseError]
      : validation
      ? validation.failed.map((c) => `${c.label}: ${c.detail}`)
      : []
    try {
      await navigator.clipboard.writeText(buildRepairPrompt(raw, errors))
      setRepairCopied(true)
      setTimeout(() => setRepairCopied(false), 1800)
    } catch {
      /* ignore */
    }
  }

  function restore() {
    if (onRestoreBackup()) {
      setRestored(true)
      resetPreview()
      setPaste('')
    }
  }

  const showRepair = !!parseError || (validation && !validation.ok)

  return (
    <section className="panel">
      <h2>AI Handoff</h2>
      <div className="note">Selected method: <b>{method.name}</b> — the prompt and the returned JSON schema match this method.</div>
      <p className="hint">
        One prompt instead of nine. Generate a master prompt, run it in any AI, and import the JSON it returns —
        validated and backed up before it replaces anything.
      </p>
      {briefNote ? <div className="note">{briefNote}</div> : null}

      <div className="subpanel">
        <h3>How to use</h3>
        <ol className="steps">
          <li>Copy this prompt.</li>
          <li>Paste it into Claude / ChatGPT / Gemini.</li>
          <li>Ask it to return JSON only (no commentary).</li>
          <li>Paste the JSON below, Validate &amp; Preview, then Import.</li>
        </ol>
        {docsWarning ? <div className="note bad">{docsWarning}</div> : null}
        <div className="row">
          <button className="primary" onClick={copyPrompt}>
            {copied ? 'Copied ✓' : 'Copy Full Project Prompt'}
          </button>
          <button className="ghost" onClick={() => setShowPreview((s) => !s)}>
            {showPreview ? 'Hide preview' : 'Preview prompt'}
          </button>
        </div>
        {showPreview ? <pre className="prompt-preview">{prompt}</pre> : null}
      </div>

      <div className="subpanel">
        <h3>Import AI JSON</h3>
        <p className="hint small">
          Paste the JSON the AI returned (or upload a .json file). It is validated and a backup is saved before
          anything is replaced. Your brief, imported script, and brand docs are preserved if omitted.
        </p>
        <div className="row">
          <button className="ghost small" onClick={pasteFromClipboard}>
            Paste from clipboard
          </button>
          <button className="ghost small" onClick={() => fileRef.current && fileRef.current.click()}>
            Upload .json
          </button>
          {backupExists ? (
            <button className="ghost small" onClick={restore}>
              Restore Last Backup
            </button>
          ) : null}
          <input ref={fileRef} type="file" accept="application/json,.json" style={{ display: 'none' }} onChange={pickFile} />
        </div>
        <textarea
          className="stage-text"
          value={paste}
          placeholder="Paste AI JSON here..."
          onChange={(e) => {
            setPaste(e.target.value)
            resetPreview()
          }}
        />
        {restored ? <div className="note ok">Restored the last backup.</div> : null}
        {imported ? <div className="note ok">Imported — the project was updated. (Previous project saved as a backup.)</div> : null}
        <div className="row">
          <button className="primary" onClick={runValidate} disabled={!paste.trim()}>
            Import AI JSON
          </button>
        </div>

        {parseError ? (
          <div className="import-preview">
            <div className="note bad">{parseError}</div>
            <div className="row">
              <button className="ghost" onClick={cancel}>
                Cancel
              </button>
              {showRepair ? (
                <button className="ghost" onClick={copyRepair}>
                  {repairCopied ? 'Repair prompt copied ✓' : 'Copy Repair Prompt'}
                </button>
              ) : null}
            </div>
          </div>
        ) : null}

        {validation ? (
          <div className="import-preview validation">
            <h4 className="ip-title">Import Preview</h4>
            <div className={`readiness ${validation.ok ? 'ok' : 'bad'}`}>
              <strong>{validation.ok ? 'Valid — safe to import.' : `Not valid — ${validation.failed.length} blocking issue(s).`}</strong>
              <span className="counts">
                {validation.passed.length} passed · {validation.failed.length} failed · {validation.warnings.length} warnings
              </span>
            </div>

            <div className="ip-stats">
              Clips detected: <b>{validation.stats.clipCount}</b> · Declared:{' '}
              <b>{validation.stats.declared == null ? '—' : validation.stats.declared + 's'}</b> · Sum:{' '}
              <b>{validation.stats.sum}s</b> · Diff:{' '}
              <b>{validation.stats.difference == null ? '—' : (validation.stats.difference > 0 ? '+' : '') + validation.stats.difference + 's'}</b>
            </div>

            {validation.failed.length > 0 ? (
              <div className="check-group">
                <h4>Failed / missing fields</h4>
                <ul>
                  {validation.failed.map((c) => (
                    <li key={c.id} className="fail">
                      <b>✗ {c.label}</b>
                      <span>{c.detail}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {validation.warnings.length > 0 ? (
              <div className="check-group">
                <h4>Warnings</h4>
                <ul>
                  {validation.warnings.map((c) => (
                    <li key={c.id} className="warn">
                      <b>! {c.label}</b>
                      <span>{c.detail}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div className="check-group">
              <h4>Passed ({validation.passed.length})</h4>
              <ul>
                {validation.passed.map((c) => (
                  <li key={c.id} className="pass">
                    <b>✓ {c.label}</b>
                  </li>
                ))}
              </ul>
            </div>

            <div className="note">
              <b>What will be replaced:</b> the authoring content (audience, visual concept, story beats, continuity
              bible, clips, voiceover timing, music, edit plan, negatives). Your brief, imported script, and brand
              docs are preserved if the JSON omits them. A backup of the current project is saved first.
            </div>

            <div className="row">
              <button className="ghost" onClick={cancel}>
                Cancel
              </button>
              <button className="primary" onClick={commit}>
                Import Anyway
              </button>
              <button className="primary" onClick={commit} disabled={!validation.ok} title={validation.ok ? '' : 'Resolve failed checks first'}>
                Import Only If Valid
              </button>
              {showRepair ? (
                <button className="ghost" onClick={copyRepair}>
                  {repairCopied ? 'Repair prompt copied ✓' : 'Copy Repair Prompt'}
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </section>
  )
}
