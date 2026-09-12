// Private, local-only backend.
//
// - Binds to 127.0.0.1 only (not exposed on the network).
// - Reads API keys from dashboard/.env.local into the server process ONLY.
// - NEVER returns key values to any client (health reports booleans only).
// - /api/llm calls a real provider for text/JSON (OpenAI only, Part 3).
//   No image/video, no cloud storage, no login.
// - Owns the local SQLite database (server/data/factory.db); schema migrations
//   run on startup and the server refuses to start if they fail.

import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID, createHash } from 'node:crypto'
import { runOpenAi } from './providers/openaiProvider.mjs'
import { runOpenRouter } from './providers/openrouterProvider.mjs'
import { groqModel, runGroq } from './providers/groqProvider.mjs'
import { runPollinations } from './providers/pollinationsProvider.mjs'
import { createMockVideoJob, getMockVideoJob } from './providers/mockVideoProvider.mjs'
import { createReplicateVideoJob, estimateVideoCost, getReplicateVideoJob } from './providers/replicateVideoProvider.mjs'
import { runMigrations } from './db/migrate.mjs'
import {
  upsertMarketingStudioSession,
  listMarketingStudioSessions,
  getMarketingStudioSession,
  deleteMarketingStudioSession,
  upsertNodeCanvasProject,
  listNodeCanvasProjects,
  getNodeCanvasProject,
  deleteNodeCanvasProject,
  importLegacyData,
  checkDbConnectivity,
  createProduct,
  getOrCreateAsset,
  setProductionRunFinalAsset
} from './db/repository.mjs'
import { backupState, inspectBackup, restoreFromBackup, listBackups } from './db/backup.mjs'
import * as ptRepo from './db/productTestRepository.mjs'
import { seedDefaultTestPolicy } from './db/productTestRepository.mjs'
import { fetchProductPageText } from './lib/safeFetch.mjs'
import { generateResearchDraft, generateStrategyDraft, validateResearchDraft } from './lib/organicStrategy.mjs'
import { generateBatchProductionPlan, priceProductionPlan } from './lib/productionPlanner.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ENV_PATH = path.resolve(__dirname, '..', '.env.local')
const PUBLIC_ROOT = path.resolve(__dirname, '..', 'public')
const MOCK_VIDEO_PATH = path.resolve(PUBLIC_ROOT, 'mock-video-output.mp4')
// Local media library root (gitignored). Files live ONLY on this machine.
const MEDIA_ROOT = path.resolve(__dirname, '..', 'local-media')
const PORT = Number(process.env.PORT) || 8787

// Minimal .env.local loader. Values stay in process.env only.
function loadEnvLocal() {
  try {
    const raw = fs.readFileSync(ENV_PATH, 'utf8')
    for (const line of raw.split(/\r?\n/)) {
      const t = line.trim()
      if (!t || t.startsWith('#')) continue
      const eq = t.indexOf('=')
      if (eq === -1) continue
      const key = t.slice(0, eq).trim()
      let val = t.slice(eq + 1).trim()
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1)
      if (key && process.env[key] === undefined) process.env[key] = val
    }
  } catch {
    // No .env.local yet — fine; providers just stay unconfigured.
  }
}
loadEnvLocal()

const KEY_NAMES = {
  openai: 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  gemini: 'GEMINI_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
  groq: 'GROQ_API_KEY',
  pollinations: 'POLLINATIONS_API_KEY',
  replicate: 'REPLICATE_API_TOKEN'
}

// The configured OpenAI model name (not a secret). Safe to expose for display.
function openaiModel() {
  return (process.env.OPENAI_MODEL && process.env.OPENAI_MODEL.trim()) || 'gpt-5.5'
}

// The configured OpenRouter model id (not a secret). Empty if unset — no default,
// since OpenRouter requires an explicit model.
function openrouterModel() {
  return (process.env.OPENROUTER_MODEL && process.env.OPENROUTER_MODEL.trim()) || ''
}

// The configured OpenAI image model id (not a secret). Empty if unset.
function openaiImageModel() {
  return (process.env.OPENAI_IMAGE_MODEL && process.env.OPENAI_IMAGE_MODEL.trim()) || ''
}

// Returns booleans only — never the key values.
function providersConfigured() {
  const out = {}
  for (const [id, envName] of Object.entries(KEY_NAMES)) {
    out[id] = Boolean(process.env[envName] && String(process.env[envName]).trim())
  }
  return out
}

// Collect and parse a JSON request body, then hand it to `onJson`.
function readJsonBody(req, res, onJson) {
  let body = ''
  req.on('data', (c) => {
    body += c
    if (body.length > 2e7) req.destroy()
  })
  req.on('end', () => {
    let payload
    try {
      payload = body ? JSON.parse(body) : {}
    } catch {
      return send(res, 400, { ok: false, error: 'Invalid JSON body.' })
    }
    onJson(payload)
  })
}

function send(res, status, obj) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*', // local-only tool
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  })
  res.end(JSON.stringify(obj))
}

// ---- Local media library helpers (local disk only — no cloud) ----

const EXT_BY_MIME = {
  'image/png': '.png', 'image/jpeg': '.jpg', 'image/jpg': '.jpg', 'image/webp': '.webp',
  'image/gif': '.gif', 'video/mp4': '.mp4', 'video/webm': '.webm', 'video/quicktime': '.mov'
}
const MIME_BY_EXT = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.gif': 'image/gif', '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime'
}

// Keep only a safe base filename: strip any directory parts and unsafe chars.
function sanitizeFileName(name) {
  const base = path.basename(String(name || '').replace(/\\/g, '/')) // drop path segments
  const cleaned = base.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^\.+/, '').slice(0, 120)
  return cleaned || 'file'
}

// Sanitize a project id used as a folder name.
function sanitizeId(id) {
  const cleaned = String(id || 'default').replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^\.+/, '').slice(0, 80)
  return cleaned || 'default'
}

// Resolve a request path under MEDIA_ROOT, rejecting any traversal outside it.
function resolveWithinMedia(relPath) {
  const safe = path.normalize(relPath).replace(/^([/\\])+/, '')
  const resolved = path.resolve(MEDIA_ROOT, safe)
  const rootWithSep = MEDIA_ROOT.endsWith(path.sep) ? MEDIA_ROOT : MEDIA_ROOT + path.sep
  if (resolved !== MEDIA_ROOT && !resolved.startsWith(rootWithSep)) return null
  return resolved
}

function sendBinary(res, status, buffer, contentType) {
  res.writeHead(status, {
    'Content-Type': contentType || 'application/octet-stream',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-store'
  })
  res.end(buffer)
}

// Decode + save a data URL into the local media library. Returns a descriptor.
function saveDataUrl({ data_url, file_name, mime_type, category, project_id }) {
  const m = /^data:([^;,]*)(;base64)?,(.*)$/s.exec(String(data_url || ''))
  if (!m) return { error: 'Invalid or missing data_url.' }
  const mime = (mime_type && String(mime_type).trim()) || m[1] || 'application/octet-stream'
  const isBase64 = !!m[2]
  const raw = m[3] || ''
  const buffer = isBase64 ? Buffer.from(raw, 'base64') : Buffer.from(decodeURIComponent(raw), 'utf8')
  if (!buffer.length) return { error: 'Empty media payload.' }

  const folder = category === 'asset' ? 'assets' : 'variations'
  const projectId = sanitizeId(project_id)
  let base = sanitizeFileName(file_name)
  if (!path.extname(base)) base += EXT_BY_MIME[mime] || ''
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${base}`

  const dir = path.resolve(MEDIA_ROOT, 'projects', projectId, folder)
  const dest = resolveWithinMedia(path.relative(MEDIA_ROOT, path.join(dir, unique)))
  if (!dest) return { error: 'Refused to write outside the media library.' }

  fs.mkdirSync(path.dirname(dest), { recursive: true })
  fs.writeFileSync(dest, buffer)

  const relUrl = '/media/' + path.relative(MEDIA_ROOT, dest).split(path.sep).join('/')
  return { success: true, local_url: relUrl, file_name: unique, mime_type: mime, file_size: buffer.length, storage: 'local_disk' }
}

// Copy the checked-in mock video into the Local Media Library only after the
// user explicitly asks to save it. No remote URLs or arbitrary local paths.
function saveMockVideo({ local_url, file_name, category, project_id }) {
  let pathname = ''
  try {
    pathname = new URL(String(local_url || ''), `http://127.0.0.1:${PORT}`).pathname
  } catch {
    return { error: 'Invalid local media URL.' }
  }
  if (pathname !== '/mock-video-output.mp4') return { error: 'Only the local mock video can be copied by URL.' }

  const buffer = fs.readFileSync(MOCK_VIDEO_PATH)
  const folder = category === 'asset' ? 'assets' : 'variations'
  const projectId = sanitizeId(project_id)
  const base = sanitizeFileName(file_name || 'mock-video-output.mp4')
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${base.endsWith('.mp4') ? base : base + '.mp4'}`
  const dest = resolveWithinMedia(path.join('projects', projectId, folder, unique))
  if (!dest) return { error: 'Refused to write outside the media library.' }

  fs.mkdirSync(path.dirname(dest), { recursive: true })
  fs.writeFileSync(dest, buffer)
  return {
    success: true,
    local_url: '/media/' + path.relative(MEDIA_ROOT, dest).split(path.sep).join('/'),
    file_name: unique,
    mime_type: 'video/mp4',
    file_size: buffer.length,
    storage: 'local_disk'
  }
}

// The variations directory for a project (where saved variation media lives).
function variationsDir(projectId) {
  return path.resolve(MEDIA_ROOT, 'projects', sanitizeId(projectId), 'variations')
}

// Build a Set of referenced base filenames from a client-supplied list (which may
// contain file_names and/or local_urls). Comparison-only — never used for fs ops.
function referencedSet(referenced) {
  const set = new Set()
  for (const r of Array.isArray(referenced) ? referenced : []) {
    if (!r) continue
    const base = String(r).split('?')[0].split('#')[0].replace(/\\/g, '/').split('/').pop()
    if (base) {
      try {
        set.add(decodeURIComponent(base))
      } catch {
        set.add(base)
      }
    }
  }
  return set
}

// Read-only: list files in the project's variations dir not in the referenced set.
function listOrphans(projectId, referenced) {
  const dir = variationsDir(projectId)
  const ref = referencedSet(referenced)
  let names = []
  try {
    names = fs.readdirSync(dir)
  } catch {
    return [] // no dir yet → no orphans
  }
  const out = []
  for (const name of names) {
    if (ref.has(name)) continue // referenced → live, skip
    const full = path.join(dir, name)
    let stat
    try {
      stat = fs.statSync(full)
    } catch {
      continue
    }
    if (!stat.isFile()) continue
    out.push({ file_name: name, file_size: stat.size, local_url: '/media/' + path.relative(MEDIA_ROOT, full).split(path.sep).join('/') })
  }
  return out
}

// Delete ONLY explicitly-listed files, re-verifying each is (a) not referenced and
// (b) strictly inside the project's variations dir. Never deletes anything else.
function cleanupMediaFiles(projectId, fileNames, referenced) {
  const dir = variationsDir(projectId)
  const dirWithSep = dir.endsWith(path.sep) ? dir : dir + path.sep
  const ref = referencedSet(referenced)
  const deleted = []
  const skipped = []
  const errors = []
  for (const raw of Array.isArray(fileNames) ? fileNames : []) {
    const rawBase = String(raw || '').replace(/\\/g, '/').split('/').pop()
    const name = sanitizeFileName(rawBase) // strips path segments + unsafe chars
    // Defense in depth: never delete a referenced file even if asked.
    if (ref.has(name) || ref.has(String(raw))) {
      skipped.push(name)
      continue
    }
    const dest = path.resolve(dir, name)
    if (dest !== dir && !dest.startsWith(dirWithSep)) {
      errors.push({ file_name: name, error: 'refused: outside variations directory' })
      continue
    }
    try {
      const st = fs.statSync(dest)
      if (!st.isFile()) {
        errors.push({ file_name: name, error: 'not a file' })
        continue
      }
      fs.unlinkSync(dest)
      deleted.push(name)
    } catch (e) {
      errors.push({ file_name: name, error: e && e.code === 'ENOENT' ? 'not found' : (e && e.message) || 'delete failed' })
    }
  }
  return { deleted, skipped, errors }
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204, {})

  const url = new URL(req.url, `http://127.0.0.1:${PORT}`)

  if (req.method === 'GET' && url.pathname === '/health') {
    const cfg = providersConfigured()
    return send(res, 200, {
      ok: true,
      status: 'API backend is running',
      provider_connected: Boolean(cfg.openai || cfg.openrouter || cfg.groq), // wired text/JSON providers
      providers_configured: cfg,
      openai_model: openaiModel(), // model name only — never a key
      openrouter_model: openrouterModel(), // model id only — never a key
      groq_model: groqModel(), // model id only — never a key
      openai_image_model: openaiImageModel(), // image model id only — never a key
      openai_image_configured: Boolean(cfg.openai && openaiImageModel()), // key + image model present
      pollinations_image_configured: Boolean(cfg.pollinations),
      mock_video: true,
      replicate: Boolean(cfg.replicate),
      db: checkDbConnectivity() // real query against factory.db, not a file-exists check
    })
  }

  // Serve the shared local mock output. It never contains provider output or user data.
  if (req.method === 'GET' && url.pathname === '/mock-video-output.mp4') {
    fs.readFile(MOCK_VIDEO_PATH, (err, data) => {
      if (err) return send(res, 404, { ok: false, error: 'Mock video placeholder not found.' })
      sendBinary(res, 200, data, 'video/mp4')
    })
    return
  }

  // Serve a saved media file (local disk only, traversal-guarded).
  if (req.method === 'GET' && url.pathname.startsWith('/media/')) {
    const rel = decodeURIComponent(url.pathname.slice('/media/'.length))
    const resolved = resolveWithinMedia(rel)
    if (!resolved) return send(res, 403, { ok: false, error: 'Forbidden path.' })
    fs.readFile(resolved, (err, data) => {
      if (err) return send(res, 404, { ok: false, error: 'Not found.' })
      sendBinary(res, 200, data, MIME_BY_EXT[path.extname(resolved).toLowerCase()] || 'application/octet-stream')
    })
    return
  }

  // Orphan scan (read-only) + explicit cleanup. Both carry the referenced set in the
  // body so the server knows what's live; cleanup re-verifies before deleting.
  if (req.method === 'POST' && (url.pathname === '/api/media/orphans' || url.pathname === '/api/media/cleanup')) {
    let body = ''
    req.on('data', (c) => {
      body += c
      if (body.length > 5e6) req.destroy()
    })
    req.on('end', () => {
      let payload = {}
      try {
        payload = body ? JSON.parse(body) : {}
      } catch {
        return send(res, 400, { error: 'Invalid JSON body.' })
      }
      try {
        if (url.pathname === '/api/media/orphans') {
          return send(res, 200, { orphans: listOrphans(payload.project, payload.referenced) })
        }
        return send(res, 200, cleanupMediaFiles(payload.project, payload.file_names, payload.referenced))
      } catch (e) {
        return send(res, 200, { error: `Media cleanup failed: ${e && e.message ? e.message : 'unknown error'}` })
      }
    })
    return
  }

  // Save an uploaded data URL into the local media library.
  if (req.method === 'POST' && url.pathname === '/api/media/save') {
    let body = ''
    req.on('data', (c) => {
      body += c
      if (body.length > 60e6) req.destroy() // ~60MB cap for local media
    })
    req.on('end', () => {
      let payload = {}
      try {
        payload = body ? JSON.parse(body) : {}
      } catch {
        return send(res, 400, { success: false, error: 'Invalid JSON body.' })
      }
      try {
        const result = payload.local_url ? saveMockVideo(payload) : saveDataUrl(payload)
        if (result.error) return send(res, 400, { success: false, error: result.error })
        return send(res, 200, result)
      } catch (e) {
        return send(res, 200, { success: false, error: `Media save failed: ${e && e.message ? e.message : 'unknown error'}` })
      }
    })
    return
  }

  if (req.method === 'POST' && url.pathname === '/api/video/generate') {
    let body = ''
    req.on('data', (c) => {
      body += c
      if (body.length > 1e6) req.destroy()
    })
    req.on('end', async () => {
      let payload = {}
      try {
        payload = body ? JSON.parse(body) : {}
      } catch {
        return send(res, 400, { status: 'error', error: 'Invalid JSON body.' })
      }

      const provider = String(payload.provider || payload.provider_id || 'mock').toLowerCase()
      if (provider === 'replicate') {
        const replicateModel = payload.replicate_model || payload.replicateModel || payload.model_id || payload.model
        const estimate = estimateVideoCost(payload.duration, replicateModel)
        if (payload.confirmed !== true) {
          return send(res, 200, {
            status: 'error',
            error: 'confirmation_required',
            ...estimate,
            message: `Replicate video generation is estimated to cost $${estimate.estimatedCost.toFixed(2)} for ${estimate.seconds} seconds. Send confirmed: true to create a paid prediction.`
          })
        }
        try {
          const job = await createReplicateVideoJob({
            prompt: payload.prompt || payload.input_prompt,
            start_frame: payload.start_frame || payload.startFrame || payload.start_frame_image,
            aspect_ratio: payload.aspect_ratio || payload.aspectRatio,
            duration: payload.duration,
            media_root: MEDIA_ROOT,
            confirmed: payload.confirmed,
            model_id: replicateModel
          })
          return send(res, 202, job)
        } catch (e) {
          return send(res, 200, { status: 'error', error: `Replicate video generation failed: ${e && e.message ? e.message : 'unknown error'}` })
        }
      }
      if (provider !== 'mock') {
        return send(res, 400, { status: 'error', error: `Unsupported video provider "${provider}". Use "mock" or "replicate".` })
      }

      let stat
      try {
        stat = fs.statSync(MOCK_VIDEO_PATH)
      } catch {
        return send(res, 200, {
          status: 'error',
          error: 'Mock video placeholder is missing at public/mock-video-output.mp4.'
        })
      }

      try {
        const job = createMockVideoJob({
          prompt: payload.prompt || payload.input_prompt,
          start_frame: payload.start_frame || payload.startFrame || payload.start_frame_image,
          aspect_ratio: payload.aspect_ratio || payload.aspectRatio,
          duration: payload.duration,
          file_size: stat.size
        })
        return send(res, 202, job)
      } catch (e) {
        return send(res, 200, { status: 'error', error: `Mock video generation failed: ${e && e.message ? e.message : 'unknown error'}` })
      }
    })
    return
  }

  const videoStatusMatch = req.method === 'GET' && /^\/api\/video\/status\/([^/]+)$/.exec(url.pathname)
  if (videoStatusMatch) {
    let jobId
    try {
      jobId = decodeURIComponent(videoStatusMatch[1])
    } catch {
      return send(res, 400, { status: 'error', error: 'Invalid video job id.' })
    }
    const status = jobId.startsWith('replicate-video-') ? await getReplicateVideoJob(jobId) : getMockVideoJob(jobId)
    return send(res, status.status === 'error' ? 404 : 200, status)
  }

  if (req.method === 'POST' && url.pathname === '/api/llm') {
    let body = ''
    req.on('data', (c) => {
      body += c
      if (body.length > 1e6) req.destroy()
    })
    req.on('end', async () => {
      // Per-request id for traceability (logs/debug). Not a secret.
      const request_id = randomUUID()

      let payload = {}
      try {
        payload = body ? JSON.parse(body) : {}
      } catch {
        return send(res, 400, { success: false, error: 'Invalid JSON body.', request_id })
      }

      const provider_id = String(payload.provider_id || payload.provider || '').toLowerCase()
      const action_type = payload.action_type || ''
      const input_prompt = payload.input_prompt || payload.prompt || ''
      const context = payload.context
      const aspect_ratio = typeof (payload.aspect_ratio || payload.aspectRatio) === 'string'
        ? String(payload.aspect_ratio || payload.aspectRatio).slice(0, 8)
        : ''
      // Optional image size hint (generate_image only) — validated in the provider
      // against an allowlist; anything unexpected falls back to the env default.
      const size = typeof payload.size === 'string' ? payload.size.slice(0, 16) : ''

      // Text/JSON providers: OpenAI, OpenRouter, and Groq. Everything else stays disconnected.
      const runner = provider_id === 'openai' ? runOpenAi : provider_id === 'openrouter' ? runOpenRouter : provider_id === 'groq' ? runGroq : provider_id === 'pollinations' ? runPollinations : null
      if (!runner) {
        return send(res, 200, {
          success: false,
          request_id,
          error: provider_id
            ? `Provider "${provider_id}" is not connected. Use "openai", "openrouter", "groq", or "pollinations".`
            : 'No provider_id provided. Use "openai", "openrouter", "groq", or "pollinations".'
        })
      }

      try {
        const result = await runner({ action_type, input_prompt, context, aspect_ratio, size, media_root: MEDIA_ROOT })
        return send(res, 200, { ...result, request_id })
      } catch (e) {
        // Never leak the key; report a generic backend error.
        return send(res, 200, { success: false, request_id, error: `Backend error: ${e && e.message ? e.message : 'unknown error'}` })
      }
    })
    return
  }

  // ---- Workspace persistence (backend-owned copies of Studio/Canvas state) ----
  // Additive only: the live frontend still reads and writes localStorage and
  // does not call any of these yet.
  const workspaceRoutes = [
    {
      prefix: '/api/studio/sessions',
      label: 'session',
      bodyField: 'studio',
      jsonKey: 'studioJson',
      list: listMarketingStudioSessions,
      get: getMarketingStudioSession,
      upsert: upsertMarketingStudioSession,
      remove: deleteMarketingStudioSession
    },
    {
      prefix: '/api/canvas/projects',
      label: 'project',
      bodyField: 'canvas',
      jsonKey: 'canvasJson',
      list: listNodeCanvasProjects,
      get: getNodeCanvasProject,
      upsert: upsertNodeCanvasProject,
      remove: deleteNodeCanvasProject
    }
  ]

  for (const route of workspaceRoutes) {
    if (url.pathname === route.prefix && req.method === 'GET') {
      try {
        return send(res, 200, { ok: true, items: route.list() })
      } catch (e) {
        return send(res, 500, { ok: false, error: `Database error: ${e && e.message ? e.message : 'unknown'}` })
      }
    }

    const idMatch = new RegExp(`^${route.prefix}/([^/]+)$`).exec(url.pathname)
    if (!idMatch) continue
    const id = decodeURIComponent(idMatch[1])

    if (req.method === 'GET') {
      try {
        const row = route.get(id)
        if (!row) return send(res, 404, { ok: false, error: `No ${route.label} with id ${id}` })
        return send(res, 200, { ok: true, item: row })
      } catch (e) {
        return send(res, 500, { ok: false, error: `Database error: ${e && e.message ? e.message : 'unknown'}` })
      }
    }

    if (req.method === 'DELETE') {
      try {
        const result = route.remove(id)
        if (!result.deleted) return send(res, 404, { ok: false, error: `No ${route.label} with id ${id}` })
        return send(res, 200, { ok: true, deleted: true, id })
      } catch (e) {
        return send(res, 500, { ok: false, error: `Database error: ${e && e.message ? e.message : 'unknown'}` })
      }
    }

    if (req.method === 'PUT') {
      return readJsonBody(req, res, (payload) => {
        const content = payload[route.bodyField]
        if (content === undefined || content === null) {
          return send(res, 400, { ok: false, error: `Body must include "${route.bodyField}".` })
        }
        try {
          // The URL param is the source of truth for the id — a mismatched id
          // in the body is ignored rather than silently writing elsewhere.
          const row = route.upsert({ id, name: payload.name || id, [route.jsonKey]: content })
          return send(res, 200, { ok: true, item: row })
        } catch (e) {
          return send(res, 500, { ok: false, error: `Database error: ${e && e.message ? e.message : 'unknown'}` })
        }
      })
    }
  }

  if (req.method === 'POST' && url.pathname === '/api/migrate/import-local') {
    return readJsonBody(req, res, (payload) => {
      try {
        return send(res, 200, { ok: true, ...importLegacyData(payload) })
      } catch (e) {
        return send(res, 500, { ok: false, error: `Import failed: ${e && e.message ? e.message : 'unknown'}` })
      }
    })
  }

  // ---- Backup / restore ----
  if (req.method === 'GET' && url.pathname === '/api/backup/list') {
    try {
      return send(res, 200, { ok: true, backups: listBackups() })
    } catch (e) {
      return send(res, 500, { ok: false, error: `Could not list backups: ${e && e.message ? e.message : 'unknown'}` })
    }
  }

  if (req.method === 'POST' && url.pathname === '/api/backup/create') {
    return readJsonBody(req, res, (payload) => {
      try {
        return send(res, 200, { ok: true, ...backupState({ includeMedia: !!payload.includeMedia }) })
      } catch (e) {
        return send(res, 500, { ok: false, error: `Backup failed: ${e && e.message ? e.message : 'unknown'}` })
      }
    })
  }

  // Read-only: never mutates the live database or media.
  if (req.method === 'POST' && url.pathname === '/api/backup/inspect') {
    return readJsonBody(req, res, (payload) => {
      try {
        return send(res, 200, inspectBackup(payload.archivePath))
      } catch (e) {
        return send(res, 500, { ok: false, error: `Inspect failed: ${e && e.message ? e.message : 'unknown'}` })
      }
    })
  }

  // Destructive, and gated on confirmed:true. On success the process stops
  // rather than hot-swapping the database under an open connection.
  if (req.method === 'POST' && url.pathname === '/api/backup/restore') {
    return readJsonBody(req, res, (payload) => {
      let result
      try {
        result = restoreFromBackup(payload.archivePath, { confirmed: payload.confirmed === true })
      } catch (e) {
        return send(res, 500, { ok: false, error: `Restore failed: ${e && e.message ? e.message : 'unknown'}` })
      }
      send(res, 200, { ok: true, ...result })
      if (result.restoreStarted) {
        // Respond first, then shut down so the restored file is only ever
        // opened by a fresh process.
        res.on('finish', () => {
          console.log('[api] restore complete — stopping. Restart with npm run dev:all.')
          setTimeout(() => process.exit(0), 50)
        })
      }
      return undefined
    })
  }

  // ---- Product Test lineage (M1) ----
  // Thin REST over productTestRepository; no business logic lives here.
  {
    const ptMatch = (pattern) => {
      const rx = new RegExp('^' + pattern.replace(/:id/g, '([^/]+)') + '$')
      const found = rx.exec(url.pathname)
      return found ? found.slice(1).map(decodeURIComponent) : null
    }
    const ok = (payload) => send(res, 200, { ok: true, ...payload })
    const fail = (status, error) => send(res, status, { ok: false, error })
    const guard = (fn) => {
      try {
        return fn()
      } catch (e) {
        return fail(400, e && e.message ? e.message : 'Request failed.')
      }
    }
    const idNum = (v) => Number(v)

    let m
    if (req.method === 'GET' && url.pathname === '/api/products') {
      return guard(() => ok({ items: ptRepo.listProducts() }))
    }
    if ((m = ptMatch('/api/products/:id')) && req.method === 'GET') {
      const row = ptRepo.getProduct(idNum(m[0]))
      return row ? ok({ item: row }) : fail(404, `No product with id ${m[0]}`)
    }
    if ((m = ptMatch('/api/products/:id')) && req.method === 'PUT') {
      const productId = idNum(m[0])
      return readJsonBody(req, res, (body) =>
        guard(() => {
          const row = ptRepo.updateProduct(productId, body)
          return row ? ok({ item: row }) : fail(404, `No product with id ${productId}`)
        })
      )
    }

    if (req.method === 'POST' && url.pathname === '/api/product-tests') {
      return readJsonBody(req, res, (body) =>
        guard(() => {
          let productId = body.productId
          if (!productId && body.newProduct) {
            productId = createProduct({
              name: body.newProduct.name,
              productUrl: body.newProduct.productUrl || null,
              supplierUrl: body.newProduct.supplierUrl || null,
              notes: body.newProduct.notes || null
            })
          }
          if (!productId) return fail(400, 'Provide either productId or newProduct.')
          return ok({ item: ptRepo.createProductTestForProduct({ ...body, productId }) })
        })
      )
    }
    if (req.method === 'GET' && url.pathname === '/api/product-tests') {
      return guard(() => ok({ items: ptRepo.listProductTests() }))
    }
    if ((m = ptMatch('/api/product-tests/:id')) && req.method === 'GET') {
      const row = ptRepo.getProductTestWithLineage(idNum(m[0]))
      return row ? ok({ item: row }) : fail(404, `No product test with id ${m[0]}`)
    }
    if ((m = ptMatch('/api/product-tests/:id/status')) && req.method === 'PATCH') {
      const testId = idNum(m[0])
      return readJsonBody(req, res, (body) =>
        guard(() => {
          const row = ptRepo.updateProductTestStatus(testId, body.status)
          return row ? ok({ item: row }) : fail(404, `No product test with id ${testId}`)
        })
      )
    }
    // Pure calculation for live typing feedback — never writes.
    if ((m = ptMatch('/api/product-tests/:id/margin-preview')) && req.method === 'POST') {
      const testId = m[0]
      return readJsonBody(req, res, (body) =>
        guard(() => {
          const test = testId === 'new' ? null : ptRepo.getProductTestWithLineage(idNum(testId))
          return ok({ margin: ptRepo.computeContributionMargin({ ...body, policy: test ? test.policy : null }) })
        })
      )
    }

    if ((m = ptMatch('/api/product-tests/:id/iterations')) && req.method === 'POST') {
      const testId = idNum(m[0])
      return readJsonBody(req, res, (body) =>
        guard(() => {
          const newId = ptRepo.createIterationForTest({ productTestId: testId, ...body })
          return ok({ item: ptRepo.getIterationWithLineage(newId) })
        })
      )
    }
    if ((m = ptMatch('/api/product-tests/:id/iterations')) && req.method === 'GET') {
      return guard(() => ok({ items: ptRepo.listIterationsForTest(idNum(m[0])) }))
    }
    if ((m = ptMatch('/api/iterations/:id')) && req.method === 'GET') {
      const row = ptRepo.getIterationWithLineage(idNum(m[0]))
      return row ? ok({ item: row }) : fail(404, `No iteration with id ${m[0]}`)
    }

    if ((m = ptMatch('/api/iterations/:id/creatives')) && req.method === 'POST') {
      const iterationId = idNum(m[0])
      return readJsonBody(req, res, (body) =>
        guard(() => {
          const newId = ptRepo.createCreativeForIteration({ iterationId, ...body })
          return ok({ item: ptRepo.getCreativeWithLineage(newId) })
        })
      )
    }
    if ((m = ptMatch('/api/iterations/:id/creatives')) && req.method === 'GET') {
      return guard(() => ok({ items: ptRepo.listCreativesForIteration(idNum(m[0])) }))
    }
    if ((m = ptMatch('/api/creatives/:id')) && req.method === 'GET') {
      const row = ptRepo.getCreativeWithLineage(idNum(m[0]))
      return row ? ok({ item: row }) : fail(404, `No creative with id ${m[0]}`)
    }

    if ((m = ptMatch('/api/creatives/:id/production-runs')) && req.method === 'POST') {
      const creativeId = idNum(m[0])
      return readJsonBody(req, res, (body) =>
        guard(() => {
          const newId = ptRepo.createProductionRunForCreative({ creativeId, productionMethod: body.productionMethod })
          return ok({ item: ptRepo.getProductionRunWithLineage(newId) })
        })
      )
    }
    if ((m = ptMatch('/api/creatives/:id/production-runs')) && req.method === 'GET') {
      return guard(() => ok({ items: ptRepo.listProductionRunsForCreative(idNum(m[0])) }))
    }
    if ((m = ptMatch('/api/production-runs/:id')) && req.method === 'GET') {
      const row = ptRepo.getProductionRunWithLineage(idNum(m[0]))
      return row ? ok({ item: row }) : fail(404, `No production run with id ${m[0]}`)
    }
    if ((m = ptMatch('/api/production-runs/:id/final-asset')) && req.method === 'POST') {
      const runId = idNum(m[0])
      return readJsonBody(req, res, (body) =>
        guard(() => {
          setProductionRunFinalAsset(runId, Number(body.assetId))
          return ok({ item: ptRepo.getProductionRunWithLineage(runId) })
        })
      )
    }

    // Manual-entry convenience: register a file already on disk under
    // local-media/ as an Asset. Hashes the real bytes when the file is there,
    // and accepts a supplied hash when it is not.
    if (req.method === 'POST' && url.pathname === '/api/assets/register-external') {
      return readJsonBody(req, res, (body) =>
        guard(() => {
          const rel = String(body.relativePath || '').replace(/^\/+/, '')
          if (!rel) return fail(400, 'relativePath is required.')
          const abs = resolveWithinMedia(rel)
          let contentHash = body.contentHash || null
          let fileSize = null
          if (abs && fs.existsSync(abs) && fs.statSync(abs).isFile()) {
            const buf = fs.readFileSync(abs)
            contentHash = createHash('sha256').update(buf).digest('hex')
            fileSize = buf.length
          }
          if (!contentHash) {
            // Nothing on disk and no hash supplied: derive a stable placeholder
            // from the path so the row stays unique and traceable.
            contentHash = createHash('sha256').update('external:' + rel).digest('hex')
          }
          const asset = getOrCreateAsset({
            contentHash,
            relativePath: rel,
            mimeType: body.mimeType || 'application/octet-stream',
            fileSize,
            source: body.source || 'uploaded'
          })
          return ok({ item: { ...asset, relativePath: rel, contentHash, fileSize, fileFoundOnDisk: fileSize !== null } })
        })
      )
    }

    if (req.method === 'GET' && url.pathname === '/api/accounts') {
      return guard(() => ok({ items: ptRepo.listAccounts() }))
    }
    if (req.method === 'POST' && url.pathname === '/api/accounts') {
      return readJsonBody(req, res, (body) => guard(() => ok({ item: ptRepo.createAccountIfNotExists(body) })))
    }

    if ((m = ptMatch('/api/creatives/:id/publications')) && req.method === 'POST') {
      const creativeId = idNum(m[0])
      return readJsonBody(req, res, (body) =>
        guard(() => ok({ item: ptRepo.createPublicationForCreative({ creativeId, ...body }) }))
      )
    }
    if ((m = ptMatch('/api/creatives/:id/publications')) && req.method === 'GET') {
      return guard(() => ok({ items: ptRepo.listPublicationsForCreative(idNum(m[0])) }))
    }

    if ((m = ptMatch('/api/publications/:id/metrics')) && req.method === 'POST') {
      const publicationId = idNum(m[0])
      return readJsonBody(req, res, (body) =>
        guard(() => ok({ item: ptRepo.addMetricSnapshot({ publicationId, ...body }) }))
      )
    }
    if ((m = ptMatch('/api/publications/:id/metrics')) && req.method === 'GET') {
      return guard(() => ok({ items: ptRepo.listMetricSnapshotsForPublication(idNum(m[0])) }))
    }

    if ((m = ptMatch('/api/creatives/:id/review-events')) && req.method === 'POST') {
      const creativeId = idNum(m[0])
      return readJsonBody(req, res, (body) => guard(() => ok({ item: ptRepo.addReviewEvent({ creativeId, ...body }) })))
    }
    if ((m = ptMatch('/api/creatives/:id/review-events')) && req.method === 'GET') {
      return guard(() => ok({ items: ptRepo.listReviewEventsForCreative(idNum(m[0])) }))
    }

    // ---- M2: AI-assisted research + strategy generation ----
    // Nothing in this block writes to the database except approve-strategy,
    // and that one writes atomically or not at all.
    if ((m = ptMatch('/api/product-tests/:id/research/generate')) && req.method === 'POST') {
      const testId = idNum(m[0])
      return readJsonBody(req, res, async (body) => {
        try {
          const productTest = ptRepo.getProductTestWithLineage(testId)
          if (!productTest) return fail(404, `No product test with id ${testId}`)

          let fetchResult = null
          if (body.useSourcePage) {
            const url = body.productUrl || productTest.product_url || productTest.supplier_url
            if (url) fetchResult = await fetchProductPageText(url)
          }

          const result = await generateResearchDraft({ productTest, fetchResult })
          if (!result.ok) return fail(502, result.error || 'Research generation failed.')
          // sourceFetch carries the attempt's outcome for UI display — never the
          // extracted page text itself, which already served its purpose and has
          // no reason to round-trip back to the client a second time.
          return ok({
            draft: result.draft,
            sourceFetch: {
              attempted: !!fetchResult,
              ok: !!(fetchResult && fetchResult.ok),
              reason: fetchResult && !fetchResult.ok ? fetchResult.reason : null,
              finalUrl: fetchResult && fetchResult.ok ? fetchResult.finalUrl : null,
              fetchedAt: fetchResult && fetchResult.ok ? fetchResult.fetchedAt : null
            }
          })
        } catch (e) {
          return fail(500, `Research generation failed: ${e && e.message ? e.message : 'unknown error'}`)
        }
      })
    }

    if ((m = ptMatch('/api/product-tests/:id/strategy/generate')) && req.method === 'POST') {
      return readJsonBody(req, res, async (body) => {
        try {
          const targetCount = Number.isFinite(Number(body.targetCount)) ? Number(body.targetCount) : 12
          const result = await generateStrategyDraft({
            researchDraft: body.researchDraft,
            targetCount,
            mode: body.mode || 'exploratory'
          })
          if (!result.ok) return fail(502, result.error || 'Strategy generation failed.')
          return ok({ draft: result.draft, duplicateWarnings: result.duplicateWarnings })
        } catch (e) {
          return fail(500, `Strategy generation failed: ${e && e.message ? e.message : 'unknown error'}`)
        }
      })
    }

    if ((m = ptMatch('/api/product-tests/:id/approve-strategy')) && req.method === 'POST') {
      const testId = idNum(m[0])
      return readJsonBody(req, res, (body) =>
        guard(() => {
          const researchCheck = validateResearchDraft(body.researchDraft)
          if (!researchCheck.valid) return fail(400, `researchDraft is invalid: ${researchCheck.errors.join('; ')}`)
          if (!Array.isArray(body.strategyRows) || body.strategyRows.length === 0) {
            return fail(400, 'strategyRows must be a non-empty array.')
          }
          const iterationId = ptRepo.approveStrategyForProductTest({
            productTestId: testId,
            mode: body.mode,
            researchDraft: body.researchDraft,
            strategyRows: body.strategyRows,
            policyOverrides: body.policyOverrides || {},
            targetCount: body.targetCount
          })
          const iteration = ptRepo.getIterationWithLineage(iterationId)
          const creatives = ptRepo.listCreativesForIteration(iterationId)
          return ok({ item: { iteration, creatives } })
        })
      )
    }

    // ---- M4: Production planning ----
    // Planning is not spending: /generate writes nothing; /approve creates
    // ProductionRuns in status 'planned' only — zero Jobs, zero
    // BudgetReservations, zero Cost rows.
    if ((m = ptMatch('/api/iterations/:id/production-plan/generate')) && req.method === 'POST') {
      const iterationId = idNum(m[0])
      return readJsonBody(req, res, async (body) => {
        try {
          const result = await generateBatchProductionPlan(iterationId, body.availabilityByCreativeId || {})
          return ok(result)
        } catch (e) {
          return fail(500, `Production plan generation failed: ${e && e.message ? e.message : 'unknown error'}`)
        }
      })
    }

    // Cheap re-price: pure computation over an already-generated (and
    // possibly hand-edited) draft. Never calls Groq — a pure number/model
    // change should never cost an AI call. Not creative/iteration-scoped:
    // knownInventory is passed through unchanged from the original generate
    // response, since editing a draft never changes what's linked in the DB.
    if (req.method === 'POST' && url.pathname === '/api/production-plan/reprice') {
      return readJsonBody(req, res, (body) =>
        guard(() => ok(priceProductionPlan(body.draft, body.availabilityDeclarations || {}, body.knownInventory || {})))
      )
    }

    if ((m = ptMatch('/api/iterations/:id/production-plan/approve')) && req.method === 'POST') {
      return readJsonBody(req, res, (body) =>
        guard(() => {
          if (!Array.isArray(body.plans) || body.plans.length === 0) {
            return fail(400, 'plans must be a non-empty array.')
          }
          const runIds = ptRepo.approveProductionPlan({ plans: body.plans })
          const items = runIds.map((id) => ptRepo.getProductionRunWithLineage(id))
          return ok({ items })
        })
      )
    }
  }

  send(res, 404, { ok: false, error: 'Not found' })
})

// Schema must be current before we accept a single request. A failed migration
// is fatal: starting with a half-known schema is worse than not starting.
try {
  runMigrations()
  // Policy defaults are data, not schema. Idempotent: never overwrites an
  // existing row, so a policy the user edits later survives restarts.
  seedDefaultTestPolicy()
} catch {
  // runMigrations already logged the specific failure.
  console.error('[api] refusing to start: database migrations failed.')
  process.exit(1)
}

server.listen(PORT, '127.0.0.1', () => {
  const cfg = providersConfigured()
  // Log booleans only — never key values.
  console.log(`[api] local backend on http://127.0.0.1:${PORT}`)
  console.log(`[api] providers configured: ${Object.entries(cfg).map(([k, v]) => `${k}=${v}`).join(', ')}`)
  console.log(`[api] OpenAI text/JSON ${cfg.openai ? 'ready' : 'not configured'} (model: ${openaiModel()}).`)
  console.log(`[api] OpenRouter text/JSON ${cfg.openrouter ? 'ready' : 'not configured'} (model: ${openrouterModel() || '(unset)'}).`)
  console.log(`[api] Groq text/JSON ${cfg.groq ? 'ready' : 'not configured'} (model: ${groqModel()}).`)
  console.log(`[api] Pollinations image ${cfg.pollinations ? 'ready' : 'not configured'} (model: flux).`)
  console.log(`[api] OpenAI image ${cfg.openai && openaiImageModel() ? 'ready' : 'not configured'} (model: ${openaiImageModel() || '(unset)'}).`)
  console.log(`[api] Mock video ready (local-only async provider). Replicate video ${cfg.replicate ? 'ready' : 'not configured'} (paid, confirmation required).`)
})
