import { STAGES } from '../data/stages.js'

export const PRIMARY_WORKSPACES = [
  { key: 'image', label: 'Image' },
  { key: 'video', label: 'Video' },
  { key: 'remix', label: 'Remix' },
  { key: 'marketing_studio', label: 'Marketing Studio' },
  { key: 'node_canvas', label: 'Canvas' },
  { key: 'assets', label: 'Assets' },
]

// Keep legacy keys and labels: existing saved projects and QA distinguish
// the scene Canvas (`canvas`) from the node board (`node_canvas`).
export const SUPPORTING_WORKSPACES = [
  { key: 'create_ad', label: 'Legacy Create Ad' },
  { key: 'product_tests', label: 'Product Tests' },
  { key: 'methods', label: 'Ad Methods' },
  { key: 'brand', label: 'Brand Library' },
  { key: 'intake', label: 'Product / Offer Brief' },
  { key: 'script', label: 'Script Import' },
  { key: 'handoff', label: 'AI Handoff' },
  { key: 'canvas', label: 'Canvas' },
  ...STAGES.map(({ key, label, kind }) => ({ key, label, kind })),
]

const workspaceKeys = new Set([...PRIMARY_WORKSPACES, ...SUPPORTING_WORKSPACES].map(item => item.key))

export function isWorkspaceKey(value) {
  return typeof value === 'string' && workspaceKeys.has(value)
}

export function workspaceLabel(key) {
  return [...PRIMARY_WORKSPACES, ...SUPPORTING_WORKSPACES].find(item => item.key === key)?.label || 'Create Ad'
}
