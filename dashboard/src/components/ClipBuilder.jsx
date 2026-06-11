import ClipCard from './ClipCard.jsx'
import DurationStatus from './DurationStatus.jsx'

export default function ClipBuilder({ project, onAddClip, onUpdateClip, onRemoveClip }) {
  const clips = project.clips || []
  return (
    <div className="clip-builder">
      <div className="row between">
        <h3>Clip Builder ({clips.length})</h3>
        <button className="primary small" onClick={onAddClip}>
          + Add Clip
        </button>
      </div>

      <DurationStatus project={project} />

      {clips.length === 0 ? (
        <p className="hint">No clips yet. Add a clip to start building the visual timeline.</p>
      ) : (
        clips.map((clip, i) => (
          <ClipCard key={i} clip={clip} index={i} onChange={onUpdateClip} onRemove={onRemoveClip} />
        ))
      )}
    </div>
  )
}
