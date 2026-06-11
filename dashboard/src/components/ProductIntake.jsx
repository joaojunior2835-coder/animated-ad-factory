import { useState } from 'react'
import { INTAKE_FIELDS } from '../data/stages.js'
import { activeProjectDocs } from '../lib/masterPrompt.js'
import { buildBriefPrompt } from '../lib/briefPrompt.js'

export default function ProductIntake({ intake, onChange, project, onApplyBrief }) {
  const [copied, setCopied] = useState(false)
  const [showPreview, setShowPreview] = useState(false)
  const [paste, setPaste] = useState('')
  const [review, setReview] = useState(null)
  const [error, setError] = useState('')
  const [applied, setApplied] = useState('')

  const activeCount = activeProjectDocs(project).length
  const prompt = buildBriefPrompt(project)

  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(prompt)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      /* ignore */
    }
  }

  function doReview() {
    setApplied('')
    let parsed
    try {
      parsed = JSON.parse(paste)
    } catch (e) {
      setError('Invalid JSON: ' + e.message)
      setReview(null)
      return
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      setError('JSON must be a single object.')
      setReview(null)
      return
    }
    const pi = parsed.product_intake && typeof parsed.product_intake === 'object' ? parsed.product_intake : null
    if (!pi) {
      setError('JSON is missing a "product_intake" object.')
      setReview(null)
      return
    }
    setError('')
    setReview({
      intake: pi,
      confidence: parsed.confidence_notes && typeof parsed.confidence_notes === 'object' ? parsed.confidence_notes : {},
      missing: Array.isArray(parsed.missing_info) ? parsed.missing_info : []
    })
  }

  function importReplace() {
    const anyFilled = INTAKE_FIELDS.some((f) => String(intake[f.key] || '').trim())
    if (anyFilled && !window.confirm('Replace existing brief fields with the imported values?')) return
    onApplyBrief(review.intake, 'replace')
    setApplied('Brief imported — existing fields replaced.')
    setReview(null)
    setPaste('')
  }

  function importEmpty() {
    onApplyBrief(review.intake, 'empty')
    setApplied('Brief imported into empty fields only.')
    setReview(null)
    setPaste('')
  }

  function cancel() {
    setReview(null)
    setError('')
  }

  const confidenceFields = INTAKE_FIELDS.filter((f) => review && String(review.confidence[f.key] || '').trim())

  return (
    <section className="panel">
      <h2>Product / Offer Brief</h2>
      <p className="hint">Auto-extract this from active brand docs, or edit manually.</p>

      <div className="subpanel">
        <h3>Auto-Brief from docs</h3>
        {activeCount === 0 ? (
          <div className="note">Add brand docs to the project and mark them Active to auto-extract the brief.</div>
        ) : (
          <p className="hint small">
            {activeCount} active doc(s). Generate a prompt, run it in any AI, then paste the JSON back below.
          </p>
        )}
        <div className="row">
          <button className="primary" onClick={copyPrompt} disabled={activeCount === 0}>
            {copied ? 'Copied ✓' : 'Extract Brief From Active Docs'}
          </button>
          <button className="ghost" onClick={() => setShowPreview((s) => !s)} disabled={activeCount === 0}>
            {showPreview ? 'Hide preview' : 'Preview prompt'}
          </button>
        </div>
        {showPreview && activeCount > 0 ? <pre className="prompt-preview">{prompt}</pre> : null}

        <label className="field" style={{ marginTop: 12 }}>
          <span className="field-label">Paste Auto-Brief JSON</span>
          <textarea
            className="stage-text short"
            value={paste}
            placeholder="Paste the AI JSON here..."
            onChange={(e) => {
              setPaste(e.target.value)
              setError('')
              setApplied('')
            }}
          />
        </label>
        {error ? <div className="note bad">{error}</div> : null}
        {applied ? <div className="note ok">{applied}</div> : null}

        {!review ? (
          <div className="row">
            <button className="primary" onClick={doReview} disabled={!paste.trim()}>
              Review Auto-Brief
            </button>
          </div>
        ) : (
          <div className="import-preview">
            <div className="check-group">
              <h4>Missing info</h4>
              {review.missing.length > 0 ? (
                <ul>
                  {review.missing.map((m, i) => (
                    <li key={i} className="warn">
                      <b>! {m}</b>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="hint small">None reported.</p>
              )}
            </div>

            <div className="check-group">
              <h4>Confidence notes</h4>
              {confidenceFields.length > 0 ? (
                <ul>
                  {confidenceFields.map((f) => (
                    <li key={f.key} className="pass">
                      <b>{f.label}</b>
                      <span>{review.confidence[f.key]}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="hint small">None provided.</p>
              )}
            </div>

            <div className="note">
              <b>Import and replace</b> overwrites all brief fields. <b>Import only empty fields</b> keeps anything you
              already filled.
            </div>
            <div className="row">
              <button className="ghost" onClick={cancel}>
                Cancel
              </button>
              <button className="primary" onClick={importReplace}>
                Import and replace brief
              </button>
              <button className="primary" onClick={importEmpty}>
                Import only empty fields
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="fields">
        {INTAKE_FIELDS.map((f) => (
          <label key={f.key} className="field">
            <span className="field-label">{f.label}</span>
            {f.type === 'textarea' ? (
              <textarea value={intake[f.key] || ''} placeholder={f.placeholder} rows={3} onChange={(e) => onChange(f.key, e.target.value)} />
            ) : (
              <input type="text" value={intake[f.key] || ''} placeholder={f.placeholder} onChange={(e) => onChange(f.key, e.target.value)} />
            )}
          </label>
        ))}
      </div>

      <details className="optional-block">
        <summary>Optional Compliance Notes</summary>
        <p className="hint small">
          Optional and not required. Auto-filled from active docs if they mention restrictions. Leave blank to let
          the AI infer compliance from the docs.
        </p>
        <textarea
          value={intake.optional_compliance_notes || ''}
          rows={3}
          placeholder="Inferred from docs — fill only to override."
          onChange={(e) => onChange('optional_compliance_notes', e.target.value)}
        />
      </details>
    </section>
  )
}
