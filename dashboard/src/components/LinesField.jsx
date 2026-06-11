// Edits an array of strings as a textarea, one item per line. Empty lines are
// preserved while editing and trimmed at export/preview time.
export default function LinesField({ label, value, onChange, rows = 4, placeholder }) {
  const text = (value || []).join('\n')
  return (
    <label className="field">
      {label ? <span className="field-label">{label}</span> : null}
      <textarea
        rows={rows}
        value={text}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value.split('\n'))}
      />
    </label>
  )
}
