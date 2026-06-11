import { validateProject } from '../lib/validation.js'

export default function ValidationPanel({ project }) {
  const v = validateProject(project)

  return (
    <div className="validation">
      <div className={`readiness ${v.ready ? 'ok' : 'bad'}`}>
        <strong>{v.ready ? 'Ready to export — all blocking checks passed.' : `Not ready — ${v.failed.length} blocking issue(s).`}</strong>
        <span className="counts">
          {v.passed.length} passed · {v.failed.length} failed · {v.warnings.length} warnings
        </span>
      </div>

      {v.failed.length > 0 ? (
        <div className="check-group">
          <h4>Failed</h4>
          <ul>
            {v.failed.map((c) => (
              <li key={c.id} className="fail">
                <b>✗ {c.label}</b>
                <span>{c.detail}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {v.warnings.length > 0 ? (
        <div className="check-group">
          <h4>Warnings</h4>
          <ul>
            {v.warnings.map((c) => (
              <li key={c.id} className="warn">
                <b>! {c.label}</b>
                <span>{c.detail}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="check-group">
        <h4>Passed ({v.passed.length})</h4>
        <ul>
          {v.passed.map((c) => (
            <li key={c.id} className="pass">
              <b>✓ {c.label}</b>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
