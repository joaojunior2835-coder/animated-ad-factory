export default function ScriptImport({ script, onChange, onCreateSkeleton }) {
  const hasScript = (script.script || '').trim().length > 0

  return (
    <section className="panel">
      <h2>Script Import</h2>
      <p className="hint">
        Paste the final script from the Nick Launch Project. When a script is present it is the{' '}
        <b>source of truth</b> for the voiceover/script — stage prompts will adapt the visuals around it instead
        of inventing a new script.
      </p>
      <div className={hasScript ? 'note ok' : 'note'}>
        {hasScript ? 'Script imported — treated as source of truth.' : 'No script imported yet.'}
      </div>

      <label className="field">
        <span className="field-label">Hook line (optional)</span>
        <input type="text" value={script.hook} placeholder="The opening hook line" onChange={(e) => onChange({ hook: e.target.value })} />
      </label>

      <label className="field">
        <span className="field-label">Imported script</span>
        <textarea
          className="stage-text"
          value={script.script}
          placeholder="Paste the final approved script here..."
          onChange={(e) => onChange({ script: e.target.value })}
        />
      </label>

      <label className="field">
        <span className="field-label">CTA / slogan (optional)</span>
        <input type="text" value={script.cta} placeholder="Closing CTA or slogan" onChange={(e) => onChange({ cta: e.target.value })} />
      </label>

      <label className="field">
        <span className="field-label">Script notes (optional)</span>
        <textarea rows={3} value={script.notes} placeholder="Context, version, anything the production should know" onChange={(e) => onChange({ notes: e.target.value })} />
      </label>

      <div className="subpanel">
        <h3>Clip skeleton</h3>
        <p className="hint small">
          No AI needed. Split the script into rough clip rows (durations distributed across the ad length) so you
          start from a timeline, not a blank page. Edit the clips afterward in Frame Prompts.
        </p>
        <button className="ghost" onClick={onCreateSkeleton}>
          Create Clip Skeleton From Script
        </button>
      </div>
    </section>
  )
}
