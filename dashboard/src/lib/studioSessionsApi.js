// Marketing Studio session persistence — backend database, not localStorage.
//
// As of Phase 4 the Studio reads and writes sessions exclusively through the
// local backend. The old `aaf_marketing_studio_sessions` key is READ in exactly
// one place (readLegacySessions, for the one-time import flow) and is never
// written again.
//
// Every function here returns rather than throws on transport failure, so a
// backend that is down produces a visible error state in the UI instead of an
// unhandled rejection that loses the user's in-progress work.

import { apiBase } from './ai/apiClient.js'
import { normalizeStudio, sessionAutoName } from './marketingStudioModel.js'

export const LEGACY_SESSION_STORAGE_KEY = 'aaf_marketing_studio_sessions'

const SESSIONS_URL = () => `${apiBase()}/api/studio/sessions`
const sessionUrl = (id) => `${SESSIONS_URL()}/${encodeURIComponent(id)}`

// SQLite stores datetime('now') as UTC "YYYY-MM-DD HH:MM:SS" with no zone
// marker, which Date.parse would read as local time. Append the Z so session
// ordering does not shift by the machine's UTC offset.
function sqlTimeToMs(value) {
  if (!value) return Date.now()
  const ms = Date.parse(String(value).replace(' ', 'T') + 'Z')
  return Number.isFinite(ms) ? ms : Date.now()
}

// The database keeps id, name and the studio payload. `name_custom` is derived
// rather than stored: a name that no longer matches what sessionAutoName would
// generate is one the user set deliberately. That keeps the auto-rename
// behaviour working without adding a column for it.
function toSession(row, studio) {
  const normalized = normalizeStudio(studio)
  return {
    id: row.id,
    name: row.name,
    name_custom: row.name !== sessionAutoName(normalized),
    createdAt: sqlTimeToMs(row.created_at),
    updatedAt: sqlTimeToMs(row.updated_at),
    studio: normalized,
  }
}

async function request(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  let json = null
  try {
    json = await res.json()
  } catch {
    json = null
  }
  return { ok: res.ok, status: res.status, json }
}

/**
 * All sessions, newest first.
 *
 * The list endpoint deliberately omits the studio payload, but Session Home
 * renders a format badge and scene count per row, so each session is hydrated
 * with a parallel detail fetch. That is one request per session against a
 * local SQLite backend — fine for the handful of sessions this is used with,
 * and the place to revisit first if that number ever grows large.
 */
export async function fetchSessions() {
  const { ok, json } = await request('GET', SESSIONS_URL())
  if (!ok || !json || !Array.isArray(json.items)) {
    throw new Error((json && json.error) || 'Could not load sessions from the backend.')
  }
  const full = await Promise.all(json.items.map((item) => fetchSession(item.id)))
  return full.filter(Boolean)
}

/** One session with its full studio payload, or null if it does not exist. */
export async function fetchSession(id) {
  const { ok, status, json } = await request('GET', sessionUrl(id))
  if (status === 404) return null
  if (!ok || !json || !json.item) {
    throw new Error((json && json.error) || `Could not load session ${id}.`)
  }
  return toSession(json.item, json.item.studioJson)
}

/** Create or update a session. The id is the caller's, and is stable. */
export async function saveSession(id, name, studio) {
  const { ok, json } = await request('PUT', sessionUrl(id), { name, studio })
  if (!ok || !json || !json.item) {
    throw new Error((json && json.error) || `Could not save session ${id}.`)
  }
  return json.item
}

/** Delete a session. A session that is already gone counts as deleted. */
export async function removeSession(id) {
  const { ok, status, json } = await request('DELETE', sessionUrl(id))
  if (status === 404) return { deleted: false }
  if (!ok) throw new Error((json && json.error) || `Could not delete session ${id}.`)
  return { deleted: true }
}

/**
 * Read the pre-Phase-4 browser copy, if any. This is the ONLY read of that
 * key, and nothing writes it any more.
 */
export function readLegacySessions() {
  try {
    const raw = localStorage.getItem(LEGACY_SESSION_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((s) => s && s.id) : []
  } catch {
    return []
  }
}

/** Hand the legacy sessions to the idempotent backend importer. */
export async function importLegacySessions(sessions) {
  const { ok, json } = await request('POST', `${apiBase()}/api/migrate/import-local`, {
    marketingStudioSessions: sessions,
    nodeCanvasProjects: [], // Node Canvas is Phase 5
  })
  if (!ok || !json) throw new Error((json && json.error) || 'Import failed.')
  return json
}

/** Drop the legacy browser copy. Only ever called from an explicit click. */
export function removeLegacyBrowserCopy() {
  try {
    localStorage.removeItem(LEGACY_SESSION_STORAGE_KEY)
    return true
  } catch {
    return false
  }
}
