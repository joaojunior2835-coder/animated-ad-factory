// Frontend client for the LOCAL backend only. No API keys live here — keys stay
// in the backend process (dashboard/server). This client only talks to the local
// server at 127.0.0.1 and never to any provider directly.

// Resolve the local backend base URL at call time so it can be overridden:
//  1) a localStorage override (used ONLY by the QA harness for port isolation),
//  2) a build-time env (VITE_API_BASE_URL or legacy VITE_LOCAL_API_BASE),
//  3) the default local backend.
// No API key is ever involved — this is just a localhost URL.
function resolveBase() {
  try {
    if (typeof localStorage !== 'undefined') {
      const o = localStorage.getItem('API_BASE_URL')
      if (o && /^https?:\/\//i.test(o)) return o.replace(/\/$/, '')
    }
  } catch {
    /* ignore */
  }
  const env = (typeof import.meta !== 'undefined' && import.meta.env) || {}
  return (env.VITE_API_BASE_URL || env.VITE_LOCAL_API_BASE || 'http://127.0.0.1:8787').replace(/\/$/, '')
}

export function apiBase() {
  return resolveBase()
}

export async function getApiHealth() {
  try {
    const res = await fetch(resolveBase() + '/health', { method: 'GET' })
    if (!res.ok) return { connected: false, providers: {}, error: `HTTP ${res.status}` }
    const data = await res.json()
    return {
      connected: true,
      status: data.status || '',
      provider_connected: !!data.provider_connected,
      providers: data.providers_configured || {},
      openai_model: data.openai_model || '',
      openrouter_model: data.openrouter_model || '',
      groq_model: data.groq_model || '',
      openai_image_model: data.openai_image_model || '',
      openai_image_configured: !!data.openai_image_configured,
      pollinations_image_configured: !!data.pollinations_image_configured,
      error: ''
    }
  } catch (e) {
    return { connected: false, providers: {}, error: e && e.message ? e.message : 'fetch failed' }
  }
}

// Save an uploaded data URL to the LOCAL media library (local disk only, no cloud).
// Returns { success, local_url (absolute), file_name, mime_type, file_size, storage }.
// No API key is involved.
export async function saveMediaToLocal(payload) {
  try {
    const res = await fetch(resolveBase() + '/api/media/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload || {}) })
    const data = await res.json().catch(() => ({}))
    if (data && data.success && data.local_url && !/^https?:/i.test(data.local_url)) {
      // Store an absolute URL so previews load directly from the local backend.
      data.local_url = resolveBase() + data.local_url
    }
    return { ok: res.ok, ...data }
  } catch (e) {
    return { ok: false, success: false, error: 'Local media backend not reachable: ' + (e && e.message ? e.message : 'fetch failed') }
  }
}

// Read-only orphan scan: which local-media variation files are no longer referenced.
// Pass the referenced filenames/urls from the live canvas. No API key involved.
export async function getMediaOrphans(payload) {
  try {
    const res = await fetch(resolveBase() + '/api/media/orphans', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload || {}) })
    const data = await res.json().catch(() => ({}))
    return { ok: res.ok, ...data }
  } catch (e) {
    return { ok: false, error: 'Local media backend not reachable: ' + (e && e.message ? e.message : 'fetch failed') }
  }
}

// Explicit cleanup: delete the listed orphan files. The server re-verifies each is
// unreferenced and inside the variations dir before deleting. No API key involved.
export async function cleanupMedia(payload) {
  try {
    const res = await fetch(resolveBase() + '/api/media/cleanup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload || {}) })
    const data = await res.json().catch(() => ({}))
    return { ok: res.ok, ...data }
  } catch (e) {
    return { ok: false, error: 'Local media backend not reachable: ' + (e && e.message ? e.message : 'fetch failed') }
  }
}

// Start an asynchronous video job on the local backend. No provider key is sent.
export async function generateVideo(prompt, startFrameUrl, aspectRatio, duration, provider = 'mock', confirmed = false, replicateModel = 'ltx') {
  try {
    const res = await fetch(resolveBase() + '/api/video/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider,
        prompt: String(prompt || ''),
        start_frame: String(startFrameUrl || ''),
        aspect_ratio: String(aspectRatio || ''),
        duration: Number(duration) || 5,
        confirmed: confirmed === true,
        replicate_model: String(replicateModel || 'ltx')
      })
    })
    const data = await res.json().catch(() => ({}))
    return { ok: res.ok, ...data }
  } catch (e) {
    return { ok: false, status: 'error', error: 'Local video backend not reachable: ' + (e && e.message ? e.message : 'fetch failed') }
  }
}

// Poll one asynchronous video job. Local result paths become absolute so video
// previews work even when the frontend and backend use different local ports.
export async function pollVideoStatus(jobId) {
  try {
    const res = await fetch(resolveBase() + '/api/video/status/' + encodeURIComponent(String(jobId || '')), { method: 'GET' })
    const data = await res.json().catch(() => ({}))
    if (data && data.result && data.result.local_url && !/^https?:/i.test(data.result.local_url)) {
      data.result.local_url = resolveBase() + data.result.local_url
    }
    return { ok: res.ok, ...data }
  } catch (e) {
    return { ok: false, status: 'error', error: 'Local video backend not reachable: ' + (e && e.message ? e.message : 'fetch failed') }
  }
}

// Calls the placeholder LLM endpoint. Returns the backend message; no provider
// call happens yet (Part 2). Never sends or receives API keys.
export async function callPlaceholderLlmAction(payload) {
  try {
    const res = await fetch(resolveBase() + '/api/llm', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload || {}) })
    const data = await res.json().catch(() => ({}))
    if (data && data.local_url && !/^https?:/i.test(data.local_url)) data.local_url = resolveBase() + data.local_url
    return { ok: res.ok, ...data }
  } catch (e) {
    return { ok: false, connected: false, message: 'Local API not reachable: ' + (e && e.message ? e.message : 'fetch failed') }
  }
}
