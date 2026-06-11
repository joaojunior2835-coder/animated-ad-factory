import { USEFUL_TAGS } from '../lib/brandDocs.js'

export default function TagPicker({ value, onChange, options = USEFUL_TAGS }) {
  const v = value || []
  const toggle = (t) => onChange(v.includes(t) ? v.filter((x) => x !== t) : [...v, t])
  return (
    <div className="tag-picker">
      {options.map((t) => (
        <button key={t} type="button" className={v.includes(t) ? 'tag-chip on' : 'tag-chip'} onClick={() => toggle(t)}>
          {t}
        </button>
      ))}
    </div>
  )
}
