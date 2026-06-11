// Local, no-API script auto-segmentation. Splits the imported script into chunks
// and creates empty clip rows with rough purposes and distributed durations.

import { newClip, parseDeclaredDuration } from './projectModel.js'

function parseChunks(text) {
  const t = String(text || '').trim()
  if (!t) return []
  const lines = t.split(/\n+/).map((s) => s.trim()).filter(Boolean)
  if (lines.length >= 2) return lines
  // Single block: split into sentences.
  return t.split(/(?<=[.!?…»])\s+/).map((s) => s.trim()).filter(Boolean)
}

// Distribute `total` seconds across `count` clips as whole numbers summing to total.
function distribute(total, count) {
  const base = Math.floor(total / count)
  const rem = total - base * count
  return Array.from({ length: count }, (_, i) => base + (i >= count - rem ? 1 : 0))
}

export function buildClipSkeleton(project) {
  const intake = project.product_intake || {}
  const declared = parseDeclaredDuration(intake) || 30
  const chunks = parseChunks(project.script_import && project.script_import.script)

  // One clip per script chunk; otherwise ~6s per clip (5 clips for 30s).
  let count = chunks.length > 0 ? chunks.length : Math.max(1, Math.round(declared / 6))
  count = Math.min(Math.max(count, 1), 12)

  const durations = distribute(Math.round(declared), count)
  const clips = []
  for (let i = 0; i < count; i++) {
    const c = newClip(i + 1)
    c.duration_seconds = durations[i]
    const chunk = chunks[i]
    c.scene_purpose = chunk ? `Beat ${i + 1}: ${chunk.slice(0, 90)}` : `Beat ${i + 1}`
    clips.push(c)
  }
  return clips
}
