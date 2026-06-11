// Shared brand-document model: metadata factory, normalization, and the
// active-state helper used everywhere a brand doc is read.

export const SOURCE_TYPES = ['txt', 'markdown', 'json', 'pdf', 'docx', 'google_docs', 'paste']

export const USEFUL_TAGS = [
  'brand voice',
  'offer',
  'avatar',
  'competitor',
  'compliance',
  'visual identity',
  'script',
  'landing page',
  'testimonials',
  'product research'
]

export function uid() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export function nowIso() {
  return new Date().toISOString()
}

export function makeDoc(partial = {}) {
  const ts = nowIso()
  return {
    id: partial.id || uid(),
    title: partial.title || 'Untitled doc',
    content: partial.content || '',
    source_type: partial.source_type || 'paste',
    source_url: partial.source_url || '',
    created_at: partial.created_at || ts,
    updated_at: partial.updated_at || ts,
    tags: Array.isArray(partial.tags) ? partial.tags.filter(Boolean) : [],
    active_for_project: partial.active_for_project != null ? !!partial.active_for_project : false,
    global: partial.global != null ? !!partial.global : false,
    notes: partial.notes || '',
    from_library_id: partial.from_library_id || ''
  }
}

// Backfill an arbitrary stored doc to the full shape. Migrates the old `active`
// flag to `active_for_project`.
export function normalizeDoc(d, defaults = {}) {
  const doc = makeDoc({ ...defaults, ...(d || {}) })
  if (d && d.active_for_project == null && d.active != null) doc.active_for_project = !!d.active
  return doc
}

// A doc is "active in the AI prompt" when active_for_project is true (with a
// fallback to the legacy `active` flag for old data).
export function isActive(doc) {
  if (!doc) return false
  return doc.active_for_project != null ? !!doc.active_for_project : !!doc.active
}
