// fal.ai provider - BACKEND ONLY. FAL_API_KEY never leaves this process: not
// logged, not returned in a response, not committed. Generated media is
// always downloaded and persisted to local-media/temp before a result is
// returned — the fal-hosted URL and any base64 payload never cross the
// backend/frontend (or backend/MCP-client) boundary.
//
// Every exported function resolves to { ok: true, ... } or
// { ok: false, reason: <string> } — it never throws. A caller (HTTP route or
// MCP tool) can always show a clear message instead of crashing.

import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { fal } from '@fal-ai/client'

const FLUX_SCHNELL_MODEL = 'fal-ai/flux/schnell'
const WAN_I2V_MODEL = 'fal-ai/wan-i2v'
const MAX_MEDIA_BYTES = 100 * 1024 * 1024

// Same aspect-ratio -> size mapping as pollinationsProvider, so a prompt asks
// for the same visual shape regardless of which image provider serves it.
const SIZE_BY_ASPECT = {
  '9:16': { width: 768, height: 1344 },
  '16:9': { width: 1344, height: 768 },
  '1:1': { width: 1024, height: 1024 },
  '4:3': { width: 1152, height: 896 },
}

const IMAGE_MIME_EXTENSIONS = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/webp': '.webp',
}
const VIDEO_MIME_EXTENSIONS = {
  'video/mp4': '.mp4',
  'video/webm': '.webm',
  'video/quicktime': '.mov',
}

function apiKey() {
  const key = process.env.FAL_API_KEY
  return key && String(key).trim() ? String(key).trim() : null
}

/** Every real fal.subscribe() call goes through this so the key is configured fresh each time — never cached across a key rotation without a restart, matching every other provider in this app. */
function configuredClient() {
  const key = apiKey()
  if (!key) return null
  fal.config({ credentials: key })
  return fal
}

function imageSize(aspectRatio, width, height) {
  if (SIZE_BY_ASPECT[aspectRatio]) return SIZE_BY_ASPECT[aspectRatio]
  const w = Number(width)
  const h = Number(height)
  if (Number.isFinite(w) && w > 0 && Number.isFinite(h) && h > 0) return { width: w, height: h }
  return SIZE_BY_ASPECT['1:1']
}

async function downloadToBuffer(url) {
  const parsed = new URL(url)
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('fal.ai returned an unsupported media URL.')
  const response = await fetch(parsed, { redirect: 'follow' })
  if (!response.ok) throw new Error(`fal.ai media download failed (${response.status}).`)
  const declaredLength = Number(response.headers.get('content-length') || 0)
  if (declaredLength > MAX_MEDIA_BYTES) throw new Error('fal.ai media exceeded the local download size limit.')
  const buffer = Buffer.from(await response.arrayBuffer())
  if (!buffer.length) throw new Error('fal.ai returned empty media.')
  if (buffer.length > MAX_MEDIA_BYTES) throw new Error('fal.ai media exceeded the local download size limit.')
  return { buffer, mime: (response.headers.get('content-type') || '').split(';')[0].trim() }
}

function saveTemp(mediaRoot, buffer, mime, prefix, mimeExtensions, fallbackMime) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw new Error('fal.ai returned empty media.')
  if (buffer.length > MAX_MEDIA_BYTES) throw new Error('fal.ai media exceeded the local save size limit.')

  const safeMime = mimeExtensions[mime] ? mime : fallbackMime
  const fileName = `${prefix}-${Date.now()}-${randomUUID()}${mimeExtensions[safeMime]}`
  const tempDir = path.resolve(mediaRoot, 'temp')
  const destination = path.resolve(tempDir, fileName)
  const tempPrefix = tempDir.endsWith(path.sep) ? tempDir : tempDir + path.sep
  if (!destination.startsWith(tempPrefix)) throw new Error('Refused to write outside local-media/temp.')

  fs.mkdirSync(tempDir, { recursive: true })
  fs.writeFileSync(destination, buffer)

  return { localUrl: `/media/temp/${fileName}`, filePath: destination, fileName, mimeType: safeMime, fileSize: buffer.length }
}

/** The fal image-generation response shape has moved before; try the field names actually documented for flux/schnell, then fail with a clear reason rather than guessing. */
function firstImageFrom(data) {
  const candidates = [data?.images?.[0], data?.image]
  for (const c of candidates) {
    if (c && typeof c.url === 'string' && c.url) return c
  }
  return null
}

function videoFrom(data) {
  const candidates = [data?.video, data?.videos?.[0]]
  for (const c of candidates) {
    if (c && typeof c.url === 'string' && c.url) return c
  }
  return null
}

/**
 * Generate an image with FLUX Schnell via fal.ai and save it to
 * local-media/temp/. Never throws.
 */
export async function generateImage({ prompt, width, height, aspectRatio, mediaRoot } = {}) {
  const client = configuredClient()
  if (!client) return { ok: false, reason: 'FAL_API_KEY_NOT_CONFIGURED' }

  const cleanPrompt = String(prompt || '').trim()
  if (!cleanPrompt) return { ok: false, reason: 'PROMPT_EMPTY' }

  const size = imageSize(aspectRatio, width, height)

  let result
  try {
    result = await client.subscribe(FLUX_SCHNELL_MODEL, {
      input: { prompt: cleanPrompt, image_size: { width: size.width, height: size.height }, num_images: 1 },
      logs: false,
    })
  } catch (error) {
    return { ok: false, reason: `fal.ai request failed: ${error && error.message ? error.message : 'unknown error'}` }
  }

  const image = firstImageFrom(result && result.data)
  if (!image) return { ok: false, reason: 'fal.ai returned no image in its response.' }

  if (!mediaRoot) return { ok: false, reason: 'MEDIA_ROOT_NOT_CONFIGURED' }
  try {
    const downloaded = await downloadToBuffer(image.url)
    const saved = saveTemp(mediaRoot, downloaded.buffer, downloaded.mime, 'fal-flux-schnell', IMAGE_MIME_EXTENSIONS, 'image/png')
    return {
      ok: true,
      localUrl: saved.localUrl,
      filePath: saved.filePath,
      width: image.width || size.width,
      height: image.height || size.height,
      model: FLUX_SCHNELL_MODEL,
      mimeType: saved.mimeType,
      fileSize: saved.fileSize,
    }
  } catch (error) {
    return { ok: false, reason: error && error.message ? error.message : 'fal.ai image save failed.' }
  }
}

/**
 * Generate an image-to-video clip with WAN 2.1 via fal.ai and save it to
 * local-media/temp/. Never throws.
 */
export async function generateVideo({ prompt, imageUrl, duration, aspectRatio, mediaRoot } = {}) {
  const client = configuredClient()
  if (!client) return { ok: false, reason: 'FAL_API_KEY_NOT_CONFIGURED' }

  const cleanPrompt = String(prompt || '').trim()
  if (!cleanPrompt) return { ok: false, reason: 'PROMPT_EMPTY' }
  const cleanImageUrl = String(imageUrl || '').trim()
  if (!cleanImageUrl) return { ok: false, reason: 'IMAGE_URL_REQUIRED — WAN 2.1 image-to-video needs a start frame.' }

  // A locally-served /media/... path is not reachable by fal.ai's servers —
  // resolve it to this machine's loopback backend URL. A real public URL
  // (http/https, not /media/...) is passed through unchanged.
  const resolvedImageUrl = cleanImageUrl.startsWith('/media/')
    ? `http://127.0.0.1:${process.env.PORT || 8787}${cleanImageUrl}`
    : cleanImageUrl

  const input = { prompt: cleanPrompt, image_url: resolvedImageUrl }
  if (Number.isFinite(Number(duration)) && Number(duration) > 0) input.duration = Number(duration)
  if (aspectRatio) input.aspect_ratio = aspectRatio

  let result
  try {
    result = await client.subscribe(WAN_I2V_MODEL, { input, logs: false })
  } catch (error) {
    return { ok: false, reason: `fal.ai request failed: ${error && error.message ? error.message : 'unknown error'}` }
  }

  const video = videoFrom(result && result.data)
  if (!video) return { ok: false, reason: 'fal.ai returned no video in its response.' }

  if (!mediaRoot) return { ok: false, reason: 'MEDIA_ROOT_NOT_CONFIGURED' }
  try {
    const downloaded = await downloadToBuffer(video.url)
    const saved = saveTemp(mediaRoot, downloaded.buffer, downloaded.mime, 'fal-wan-i2v', VIDEO_MIME_EXTENSIONS, 'video/mp4')
    return {
      ok: true,
      localUrl: saved.localUrl,
      filePath: saved.filePath,
      duration: Number.isFinite(Number(duration)) ? Number(duration) : null,
      model: WAN_I2V_MODEL,
      mimeType: saved.mimeType,
      fileSize: saved.fileSize,
    }
  } catch (error) {
    return { ok: false, reason: error && error.message ? error.message : 'fal.ai video save failed.' }
  }
}
