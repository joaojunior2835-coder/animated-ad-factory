// Global, cross-project Brand Library. Stored under its own localStorage key so
// it persists independently of any single project (and survives project Reset).

import { makeDoc, normalizeDoc } from './brandDocs.js'

export const TEXT_EXTS = ['txt', 'md', 'markdown', 'json', 'pdf', 'docx']

const KEY = 'animated-ad-factory:brand-library:v1'

export function newLibraryDoc(partial = {}) {
  // Back-compat: allow newLibraryDoc(title, content) as well as a partial object.
  if (typeof partial === 'string') {
    return makeDoc({ title: partial, content: arguments[1] || '', global: true })
  }
  return makeDoc({ ...partial, global: true })
}

export function loadLibrary() {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? arr.map((d) => normalizeDoc(d, { global: true })) : []
  } catch {
    return []
  }
}

export function saveLibrary(docs) {
  try {
    localStorage.setItem(KEY, JSON.stringify(docs))
  } catch {
    // Non-fatal.
  }
}
