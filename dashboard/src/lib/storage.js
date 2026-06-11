// Local persistence via localStorage. Not a database — it just keeps your work
// between reloads on this machine. v2 holds the structured project; if only v1
// (the old free-text format) exists, its content is migrated forward.

import { normalizeIntake } from './projectModel.js'
import { normalizeNodeCanvas } from './nodeCanvasModel.js'

const KEY = 'animated-ad-factory:project:v2'
const KEY_V1 = 'animated-ad-factory:project:v1'
const BACKUP_KEY = 'animated-ad-factory:backup:v1'

export function loadProject(fallback) {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return mergeLoaded(fallback, JSON.parse(raw))

    const v1 = localStorage.getItem(KEY_V1)
    if (v1) return migrateV1(fallback, JSON.parse(v1))

    return fallback
  } catch {
    return fallback
  }
}

function mergeLoaded(fallback, parsed) {
  return {
    ...fallback,
    ...parsed,
    selected_method: parsed.selected_method || fallback.selected_method,
    method_data: parsed.method_data && typeof parsed.method_data === 'object' ? parsed.method_data : fallback.method_data,
    canvas: parsed.canvas && typeof parsed.canvas === 'object' ? parsed.canvas : fallback.canvas,
    // Migrate: old projects without node_canvas load as an empty node canvas.
    node_canvas: normalizeNodeCanvas(parsed.node_canvas || fallback.node_canvas),
    brand_docs: Array.isArray(parsed.brand_docs) ? parsed.brand_docs : fallback.brand_docs,
    product_intake: normalizeIntake({ ...fallback.product_intake, ...(parsed.product_intake || {}) }),
    script_import: { ...fallback.script_import, ...(parsed.script_import || {}) },
    clips: Array.isArray(parsed.clips) ? parsed.clips : fallback.clips,
    negative_constraints: Array.isArray(parsed.negative_constraints)
      ? parsed.negative_constraints
      : fallback.negative_constraints,
    notes: { ...fallback.notes, ...(parsed.notes || {}) }
  }
}

function migrateV1(fallback, v1) {
  const stages = (v1 && v1.stages) || {}
  return {
    ...fallback,
    product_intake: normalizeIntake({ ...fallback.product_intake, ...((v1 && v1.product_intake) || {}) }),
    audience_psychology: stages.audience_psychology || '',
    ad_concept: stages.ad_concept || '',
    story_beats: stages.story_beats || '',
    voiceover_script: stages.voiceover_script || '',
    music_direction: stages.music_direction || '',
    edit_plan: stages.edit_plan || ''
  }
}

export function saveProject(project) {
  try {
    localStorage.setItem(KEY, JSON.stringify(project))
  } catch {
    // Storage may be unavailable (private mode, quota). Non-fatal.
  }
}

export function clearProject() {
  try {
    localStorage.removeItem(KEY)
    localStorage.removeItem(KEY_V1)
  } catch {
    // Non-fatal.
  }
}

// Backup snapshot taken before an import replaces the project.
export function saveBackup(project) {
  try {
    localStorage.setItem(BACKUP_KEY, JSON.stringify(project))
  } catch {
    // Non-fatal.
  }
}

export function loadBackup() {
  try {
    const raw = localStorage.getItem(BACKUP_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function hasBackup() {
  try {
    return localStorage.getItem(BACKUP_KEY) != null
  } catch {
    return false
  }
}
