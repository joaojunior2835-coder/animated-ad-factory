// A free-text stage box. `actions` renders in the header (e.g. Copy Stage Prompt).
// `children` renders structured extras underneath (e.g. global negatives editor).
export default function TextStage({ stage, value, onChange, actions, children }) {
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>{stage.label}</h2>
        {actions}
      </div>
      <pre className="instructions">{stage.instructions}</pre>
      <textarea
        className="stage-text"
        value={value || ''}
        placeholder={`Write the ${stage.label} output here...`}
        onChange={(e) => onChange(e.target.value)}
      />
      {children}
    </section>
  )
}
