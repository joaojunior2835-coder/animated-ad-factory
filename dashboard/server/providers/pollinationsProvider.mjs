// Pollinations image provider - BACKEND ONLY. Generated images are always
// persisted to local-media/temp before a response is returned. Base64 and
// provider-hosted URLs never cross the backend/frontend boundary.

import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

const POLLINATIONS_IMAGE_URL = 'https://gen.pollinations.ai/v1/images/generations'
const POLLINATIONS_MODEL = 'flux'
const MAX_IMAGE_BYTES = 25 * 1024 * 1024
const SIZE_BY_ASPECT = {
  '9:16': '768x1344',
  '16:9': '1344x768',
  '1:1': '1024x1024',
  '4:3': '1152x896'
}
const MIME_EXTENSIONS = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif'
}

function errorResult(error) {
  return {
    success: false,
    connected: true,
    mode: 'api',
    provider: 'pollinations',
    provider_name: 'Pollinations',
    action_type: 'generate_image',
    media_type: 'image',
    source_type: 'api',
    status: 'error',
    error
  }
}

function imageSize(aspectRatio, requestedSize) {
  if (SIZE_BY_ASPECT[aspectRatio]) return SIZE_BY_ASPECT[aspectRatio]
  if (Object.values(SIZE_BY_ASPECT).includes(requestedSize)) return requestedSize
  return SIZE_BY_ASPECT['1:1']
}

function parseBase64Image(value) {
  const raw = String(value || '')
  const match = /^data:([^;,]+);base64,(.+)$/s.exec(raw)
  if (match) return { mime: match[1], buffer: Buffer.from(match[2], 'base64') }
  return { mime: 'image/png', buffer: Buffer.from(raw, 'base64') }
}

async function downloadImage(url, apiKey) {
  const parsed = new URL(url)
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Pollinations returned an unsupported image URL.')

  const response = await fetch(parsed, {
    redirect: 'follow',
    headers: { Authorization: `Bearer ${apiKey}` }
  })
  if (!response.ok) throw new Error(`Pollinations image download failed (${response.status}).`)

  const declaredLength = Number(response.headers.get('content-length') || 0)
  if (declaredLength > MAX_IMAGE_BYTES) throw new Error('Pollinations image exceeded the local download size limit.')

  const buffer = Buffer.from(await response.arrayBuffer())
  if (!buffer.length) throw new Error('Pollinations returned an empty image.')
  if (buffer.length > MAX_IMAGE_BYTES) throw new Error('Pollinations image exceeded the local download size limit.')
  return { buffer, mime: (response.headers.get('content-type') || 'image/png').split(';')[0].trim() }
}

function saveTempImage(mediaRoot, buffer, mime) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw new Error('Pollinations returned an empty image.')
  if (buffer.length > MAX_IMAGE_BYTES) throw new Error('Pollinations image exceeded the local save size limit.')

  const safeMime = MIME_EXTENSIONS[mime] ? mime : 'image/png'
  const fileName = `pollinations-${Date.now()}-${randomUUID()}${MIME_EXTENSIONS[safeMime]}`
  const tempDir = path.resolve(mediaRoot, 'temp')
  const destination = path.resolve(tempDir, fileName)
  const tempPrefix = tempDir.endsWith(path.sep) ? tempDir : tempDir + path.sep
  if (!destination.startsWith(tempPrefix)) throw new Error('Refused to write outside local-media/temp.')

  fs.mkdirSync(tempDir, { recursive: true })
  fs.writeFileSync(destination, buffer)

  return {
    local_url: `/media/temp/${fileName}`,
    file_name: fileName,
    mime_type: safeMime,
    file_size: buffer.length
  }
}

export async function runPollinations({ action_type, input_prompt, aspect_ratio, size, media_root } = {}) {
  if (action_type !== 'generate_image') {
    return errorResult(`Pollinations provider does not support "${action_type || '(none)'}". Supported: generate_image.`)
  }

  const apiKey = process.env.POLLINATIONS_API_KEY
  if (!apiKey || !String(apiKey).trim()) {
    return { ...errorResult('Pollinations API key is not configured. Add POLLINATIONS_API_KEY to .env.local and restart the backend.'), connected: false }
  }

  const prompt = String(input_prompt || '').trim()
  if (!prompt) return errorResult('Image prompt is empty.')
  if (!media_root) return errorResult('Local media directory is not configured.')

  try {
    const response = await fetch(POLLINATIONS_IMAGE_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: POLLINATIONS_MODEL,
        prompt,
        n: 1,
        size: imageSize(aspect_ratio, size),
        response_format: 'url'
      })
    })

    const payload = await response.json().catch(() => ({}))
    if (!response.ok) {
      const message = payload && (payload.error?.message || payload.error || payload.message)
      return errorResult(`Pollinations image request failed (${response.status}): ${typeof message === 'string' ? message : 'unknown error'}`)
    }

    const image = payload && Array.isArray(payload.data) ? payload.data[0] || {} : {}
    let saved
    if (image.url) {
      const downloaded = await downloadImage(image.url, apiKey)
      saved = saveTempImage(media_root, downloaded.buffer, downloaded.mime)
    } else if (image.b64_json) {
      const decoded = parseBase64Image(image.b64_json)
      saved = saveTempImage(media_root, decoded.buffer, decoded.mime)
    } else {
      return errorResult('Pollinations returned no image URL or image data.')
    }

    return {
      success: true,
      connected: true,
      mode: 'api',
      provider: 'pollinations',
      provider_name: 'Pollinations',
      action_type: 'generate_image',
      media_type: 'image',
      source_type: 'api',
      status: 'success',
      prompt,
      model: POLLINATIONS_MODEL,
      storage: 'local_disk',
      ...saved
    }
  } catch (error) {
    return errorResult(`Pollinations image request failed: ${error && error.message ? error.message : 'unknown error'}`)
  }
}
