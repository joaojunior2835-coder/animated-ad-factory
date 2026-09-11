// Node Canvas persistence — backend database, not the whole-project
// localStorage blob.
//
// There is exactly one canvas today, stored under the fixed id 'default'. If
// multiple named canvases are ever built, migrating this single row into a real
// collection is an ordinary future step; it is not solved speculatively here.
//
// SCOPE: only the node_canvas slice moves to the database. Every other section
// of the whole-project blob (Ad Methods, Brand Library, Product/Offer Brief,
// Script Import, Competitor Canvas, …) keeps persisting exactly as it does
// today, untouched by anything in this module.

import { apiBase } from './ai/apiClient.js'

export const NODE_CANVAS_ID = 'default'
export const NODE_CANVAS_NAME = 'Node Canvas'

const canvasUrl = () => `${apiBase()}/api/canvas/projects/${NODE_CANVAS_ID}`

/** The stored canvas, or null when the database has no copy yet (404). */
export async function fetchNodeCanvas() {
  const res = await fetch(canvasUrl(), { method: 'GET' })
  if (res.status === 404) return null
  if (!res.ok) {
    let detail = `HTTP ${res.status}`
    try {
      const body = await res.json()
      if (body && body.error) detail = body.error
    } catch {
      /* keep the status-code detail */
    }
    throw new Error(`Could not load the Node Canvas: ${detail}`)
  }
  const json = await res.json()
  return json && json.item ? json.item.canvasJson : null
}

/** Create or replace the stored canvas. */
export async function saveNodeCanvas(canvas) {
  const res = await fetch(canvasUrl(), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: NODE_CANVAS_NAME, canvas }),
  })
  if (!res.ok) {
    let detail = `HTTP ${res.status}`
    try {
      const body = await res.json()
      if (body && body.error) detail = body.error
    } catch {
      /* keep the status-code detail */
    }
    throw new Error(`Could not save the Node Canvas: ${detail}`)
  }
  return (await res.json()).item
}

/** Hand the legacy browser canvas to the idempotent backend importer. */
export async function importLegacyNodeCanvas(canvas) {
  const res = await fetch(`${apiBase()}/api/migrate/import-local`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      marketingStudioSessions: [],
      nodeCanvasProjects: [{ id: NODE_CANVAS_ID, name: NODE_CANVAS_NAME, canvas }],
    }),
  })
  const json = await res.json().catch(() => null)
  if (!res.ok || !json) throw new Error((json && json.error) || 'Import failed.')
  return json
}

/** Does this stored canvas hold anything worth migrating? */
export function hasCanvasContent(canvas) {
  return !!(canvas && Array.isArray(canvas.nodes) && canvas.nodes.length > 0)
}
