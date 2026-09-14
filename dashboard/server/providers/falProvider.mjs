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
export const FAL_SEEDANCE_ENDPOINTS = Object.freeze({
  t2v: 'bytedance/seedance-2.0/fast/text-to-video',
  i2v: 'bytedance/seedance-2.0/fast/image-to-video',
})
export const FAL_SEEDANCE_RATES_USD_PER_SECOND = Object.freeze({ '480p': 0.1076, '720p': 0.2419 })
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
  if (falClientOverride) return falClientOverride
  const key = apiKey()
  if (!key) return null
  fal.config({ credentials: key })
  return fal
}

let falClientOverride = null
export function setFalClientForTests(value) {
  falClientOverride = value || null
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

function seedanceExternalId(mode, requestId) {
  return `fal-seedance:${mode}:${encodeURIComponent(String(requestId))}`
}

function parseSeedanceExternalId(value) {
  const match = /^fal-seedance:(t2v|i2v):(.+)$/.exec(String(value || ''))
  if (!match) throw new Error('Unknown fal Seedance request id.')
  return { mode: match[1], endpoint: FAL_SEEDANCE_ENDPOINTS[match[1]], requestId: decodeURIComponent(match[2]) }
}

function localMediaFile(value, mediaRoot) {
  const raw = String(value || '').trim()
  if (!raw.startsWith('/media/')) return null
  const root = path.resolve(mediaRoot)
  const filePath = path.resolve(root, decodeURIComponent(raw.slice('/media/'.length)))
  const prefix = root.endsWith(path.sep) ? root : root + path.sep
  if (!filePath.startsWith(prefix)) throw new Error('Refused to read outside local media.')
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) throw new Error('Seedance start frame was not found in local media.')
  return filePath
}

function imageMime(filePath) {
  const extension = path.extname(filePath).toLowerCase()
  return extension === '.jpg' || extension === '.jpeg' ? 'image/jpeg'
    : extension === '.webp' ? 'image/webp'
      : extension === '.gif' ? 'image/gif' : 'image/png'
}

async function seedanceImageUrl(client, value, mediaRoot) {
  const localFile = localMediaFile(value, mediaRoot)
  if (localFile) {
    const bytes = fs.readFileSync(localFile)
    return client.storage.upload(new Blob([bytes], { type: imageMime(localFile) }))
  }
  const parsed = new URL(String(value || '').trim())
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Seedance start frame must be a local media path or an HTTP(S) URL.')
  if (['localhost', '127.0.0.1', '::1'].includes(parsed.hostname.toLowerCase())) throw new Error('Localhost URLs cannot be sent to fal.ai.')
  return parsed.toString()
}

/** Durable M5 Seedance submission. Unlike the direct MCP helpers below, this deliberately does not wait for completion. */
export async function createFalSeedanceVideoJob({ prompt, start_frame, image, resolution = '480p', duration = 5, aspect_ratio, aspectRatio, generate_audio, generateAudio, media_root, confirmed } = {}) {
  if (confirmed !== true) throw new Error('confirmation_required')
  const client = configuredClient()
  if (!client) throw new Error('FAL_API_KEY_NOT_CONFIGURED')
  const cleanPrompt = String(prompt || '').trim()
  if (!cleanPrompt) throw new Error('Seedance video prompt is required.')
  const seconds = Number(duration)
  if (!Number.isFinite(seconds) || seconds < 4 || seconds > 15) throw new Error('Seedance duration must be between 4 and 15 seconds.')
  if (!['480p', '720p'].includes(resolution)) throw new Error('Seedance resolution must be 480p or 720p.')

  const frame = start_frame || image
  const mode = frame ? 'i2v' : 't2v'
  const input = {
    prompt: cleanPrompt,
    resolution,
    duration: seconds,
    aspect_ratio: aspect_ratio || aspectRatio || '9:16',
    generate_audio: generate_audio ?? generateAudio ?? true,
  }
  if (frame) input.image_url = await seedanceImageUrl(client, frame, media_root || path.resolve(process.cwd(), 'local-media'))
  const submitted = await client.queue.submit(FAL_SEEDANCE_ENDPOINTS[mode], { input })
  if (!submitted?.request_id) throw new Error('fal.ai did not return a Seedance request id.')
  return { jobId: seedanceExternalId(mode, submitted.request_id), status: submitted.status || 'IN_QUEUE' }
}

/** Restart-safe M5 status/result lookup using only the durable external request id. */
export async function getFalSeedanceVideoJob(externalRequestId, { media_root } = {}) {
  const client = configuredClient()
  if (!client) throw new Error('FAL_API_KEY_NOT_CONFIGURED')
  const request = parseSeedanceExternalId(externalRequestId)
  const status = await client.queue.status(request.endpoint, { requestId: request.requestId })
  if (status?.status !== 'COMPLETED') return { status: status?.status || 'IN_QUEUE' }

  const completed = await client.queue.result(request.endpoint, { requestId: request.requestId })
  const video = videoFrom(completed?.data)
  if (!video) throw new Error('fal.ai returned no Seedance video in its response.')
  const downloaded = await downloadToBuffer(video.url)
  const saved = saveTemp(media_root || path.resolve(process.cwd(), 'local-media'), downloaded.buffer, downloaded.mime, 'fal-seedance-2-fast', VIDEO_MIME_EXTENSIONS, 'video/mp4')
  return {
    status: 'COMPLETED',
    result: {
      local_url: saved.localUrl,
      mime_type: saved.mimeType,
      file_size: saved.fileSize,
      provider: 'fal',
      provider_id: 'fal',
      model: request.endpoint,
      request_id: request.requestId,
    },
  }
}

/**
 * Generate an image with FLUX Schnell via fal.ai and save it to
 * local-media/temp/. Never throws.
 */
export async function generateImage({ prompt, width, height, aspectRatio, mediaRoot, confirmed } = {}) {
  if (confirmed !== true) return { ok: false, reason: 'confirmation_required' }
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
export async function generateVideo({ prompt, imageUrl, duration, aspectRatio, mediaRoot, confirmed } = {}) {
  if (confirmed !== true) return { ok: false, reason: 'confirmation_required' }
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
