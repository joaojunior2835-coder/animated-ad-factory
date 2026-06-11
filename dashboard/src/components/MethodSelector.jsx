import { METHODS, recommendedToolNames } from '../data/adMethods.js'
import { PROVIDERS } from '../data/providers.js'

export default function MethodSelector({ selectedMethod, onSelect }) {
  return (
    <section className="panel">
      <h2>Ad Methods</h2>
      <p className="hint">
        Choose how this project will be produced. The AI Handoff prompt and the export adapt to the selected method.
      </p>

      <div className="method-grid">
        {METHODS.map((m) => {
          const sel = m.id === selectedMethod
          return (
            <div key={m.id} className={sel ? 'method-card selected' : 'method-card'}>
              <div className="row between">
                <h3>{m.name}</h3>
                {sel ? <span className="label label-active">Selected</span> : null}
              </div>
              <p className="hint small">{m.description}</p>
              <div className="method-meta">
                <div>
                  <b>Creates:</b> {m.outputs.join(', ')}
                </div>
                <div>
                  <b>Needs:</b> {m.required_inputs.join(', ')}
                </div>
                <div>
                  <b>Outputs:</b> {m.outputs.join(', ')}
                </div>
                <div>
                  <b>Best for:</b> {m.best_for}
                </div>
                <div>
                  <b>Tools (manual for now):</b> {recommendedToolNames(m)}
                </div>
              </div>
              <div className="row">
                <button className={sel ? 'ghost small' : 'primary small'} onClick={() => onSelect(m.id)} disabled={sel}>
                  {sel ? 'Selected' : 'Select this method'}
                </button>
              </div>
            </div>
          )
        })}
      </div>

      <div className="subpanel">
        <h3>Providers (manual for now)</h3>
        <p className="hint small">No API keys or connections yet — these are the tools each method will eventually use.</p>
        <ul className="provider-list">
          {PROVIDERS.map((p) => (
            <li key={p.id}>
              <b>{p.name}</b> <span className="badge">{p.category}</span> <span className="hint small">{p.notes}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
