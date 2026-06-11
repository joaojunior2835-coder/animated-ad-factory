import LinesField from './LinesField.jsx'

// One editable clip. `onChange(index, patch)` merges a partial update.
export default function ClipCard({ clip, index, onChange, onRemove }) {
  const set = (patch) => onChange(index, patch)

  return (
    <div className="clip-card">
      <div className="clip-head">
        <h4>Clip {index + 1}</h4>
        <div className="clip-head-right">
          <label className="dur">
            <span>Duration (s)</span>
            <input
              type="number"
              min="1"
              value={clip.duration_seconds}
              onChange={(e) => set({ duration_seconds: e.target.value === '' ? '' : Number(e.target.value) })}
            />
          </label>
          <button className="ghost small" onClick={() => onRemove(index)}>
            Remove
          </button>
        </div>
      </div>

      <label className="field">
        <span className="field-label">Purpose</span>
        <input type="text" value={clip.scene_purpose} onChange={(e) => set({ scene_purpose: e.target.value })} />
      </label>

      <div className="two">
        <label className="field">
          <span className="field-label">Start state</span>
          <textarea rows={2} value={clip.start_state} onChange={(e) => set({ start_state: e.target.value })} />
        </label>
        <label className="field">
          <span className="field-label">End state</span>
          <textarea rows={2} value={clip.end_state} onChange={(e) => set({ end_state: e.target.value })} />
        </label>
      </div>

      <label className="field">
        <span className="field-label">Start frame prompt</span>
        <textarea
          className="mono"
          rows={4}
          value={clip.start_frame_prompt}
          onChange={(e) => set({ start_frame_prompt: e.target.value })}
        />
      </label>

      <label className="field">
        <span className="field-label">End frame prompt</span>
        <textarea
          className="mono"
          rows={4}
          value={clip.end_frame_prompt}
          onChange={(e) => set({ end_frame_prompt: e.target.value })}
        />
      </label>

      <label className="field">
        <span className="field-label">Flow Agent Mode prompt</span>
        <textarea
          className="mono"
          rows={5}
          value={clip.flow_agent_prompt}
          onChange={(e) => set({ flow_agent_prompt: e.target.value })}
        />
      </label>

      <label className="field">
        <span className="field-label">Attach instructions (blank = auto-generate)</span>
        <textarea
          className="mono"
          rows={2}
          value={clip.attach_instructions}
          placeholder={`Attach:\n- Clip ${index + 1} start frame image\n- Clip ${index + 1} end frame image`}
          onChange={(e) => set({ attach_instructions: e.target.value })}
        />
      </label>

      <label className="field">
        <span className="field-label">Bridge check</span>
        <textarea rows={2} value={clip.bridge_check} onChange={(e) => set({ bridge_check: e.target.value })} />
      </label>

      <div className="two">
        <LinesField
          label="Continuity references (one per line)"
          value={clip.continuity_references}
          onChange={(v) => set({ continuity_references: v })}
        />
        <LinesField
          label="Negative constraints (one per line)"
          value={clip.negative_constraints}
          onChange={(v) => set({ negative_constraints: v })}
        />
      </div>
    </div>
  )
}
