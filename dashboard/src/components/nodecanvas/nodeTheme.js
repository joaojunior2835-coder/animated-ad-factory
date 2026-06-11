// Presentation constants for the Production Node Canvas: per-type accent colors
// and icons, shared by the board, the palette sidebar, and the minimap.

export const NODE_COLORS = {
  prompt: '#7c3aed',
  image_generator: '#2563eb',
  video_generator: '#0d9488',
  upload: '#d97706',
  asset: '#65a30d',
  reference: '#ea580c',
  character: '#db2777',
  style: '#ca8a04',
  output: '#16a34a',
  upscale: '#6b7280'
}

export const NODE_ICONS = {
  prompt: '📝',
  image_generator: '🖼️',
  video_generator: '🎬',
  upload: '⬆️',
  asset: '🗂️',
  reference: '📌',
  character: '👤',
  style: '🎨',
  output: '🎯',
  upscale: '🔍'
}

export const FALLBACK_COLOR = '#6b7280'

export function nodeColor(type) {
  return NODE_COLORS[type] || FALLBACK_COLOR
}

export function nodeIcon(type) {
  return NODE_ICONS[type] || '⬡'
}
