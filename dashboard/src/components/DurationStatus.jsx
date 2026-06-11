import { durationStatus } from '../lib/projectModel.js'

export default function DurationStatus({ project, compact }) {
  const s = durationStatus(project)
  const cls = s.state === 'ok' ? 'ok' : s.state === 'mismatch' ? 'bad' : 'unset'
  const badge =
    s.state === 'ok' ? 'Valid' : s.state === 'mismatch' ? 'Mismatch' : s.state === 'empty' ? 'No clips' : 'Not validated'

  return (
    <div className={`duration ${cls}`}>
      <div className="duration-badges">
        <span>
          Declared: <b>{s.declared == null ? '—' : s.declared + 's'}</b>
        </span>
        <span>
          Clips: <b>{s.sum}s</b>
        </span>
        <span>
          Diff: <b>{s.difference == null ? '—' : (s.difference > 0 ? '+' : '') + s.difference + 's'}</b>
        </span>
        <span className="badge">{badge}</span>
      </div>
      {!compact ? <div className="duration-msg">{s.message}</div> : null}
    </div>
  )
}
