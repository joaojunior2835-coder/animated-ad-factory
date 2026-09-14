// Cost-gated Replicate image-to-video provider. Predictions are created only
// after the route has verified confirmed === true. Completed videos are copied
// to local-media/temp so expiring Replicate output URLs never reach the browser.

import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import Replicate from 'replicate'

export const REPLICATE_VIDEO_MODELS = {
  ltx: {
    key: 'ltx',
    label: 'LTX-Video',
    fullName: 'lightricks/ltx-video:8c47da666861d081eeb4d1261853087de23923a268a69b63febdf5dc1dee08e4',
    costPerSecond: 0.03,
    filePrefix: 'replicate-ltx-video'
  },
  'wan-720p': {
    key: 'wan-720p',
    label: 'WAN 2.1 i2v 720p',
    fullName: 'wavespeedai/wan-2.1-i2v-720p:1f0a7fa066689a087b597a314f60ef74d1a720fa1fb9a7083487c4b01db3395f',
    costPerSecond: 0.09,
    filePrefix: 'replicate-wan-i2v'
  },
  'seedance-2.0-fast': {
    key: 'seedance-2.0-fast',
    label: 'Seedance 2.0 Fast',
    fullName: 'bytedance/seedance-2.0-fast',
    costPerSecond: 0.07,
    costPerSecondByResolution: { '480p': 0.07, '720p': 0.15 },
    costPerSecondWithVideoInput: { '480p': 0.08, '720p': 0.17 },
    filePrefix: 'replicate-seedance-2-fast'
  }
}
export const DEFAULT_REPLICATE_VIDEO_MODEL = 'ltx'
export const REPLICATE_VIDEO_MODEL = REPLICATE_VIDEO_MODELS[DEFAULT_REPLICATE_VIDEO_MODEL].fullName
const MAX_VIDEO_BYTES = 100 * 1024 * 1024
const VALID_ASPECT_RATIOS = new Set(['9:16', '16:9', '1:1', '4:3'])
const jobs = new Map()

export function resolveReplicateVideoModel(modelId) {
  const key = String(modelId || DEFAULT_REPLICATE_VIDEO_MODEL).trim()
  return REPLICATE_VIDEO_MODELS[key] || REPLICATE_VIDEO_MODELS[DEFAULT_REPLICATE_VIDEO_MODEL]
}

export function estimateVideoCost(durationSeconds, modelId, { resolution = '480p', hasVideoInput = false } = {}) {
  const model = resolveReplicateVideoModel(modelId)
  const seconds = Number.isFinite(Number(durationSeconds)) && Number(durationSeconds) > 0 ? Number(durationSeconds) : 5
  const rateTable = hasVideoInput ? model.costPerSecondWithVideoInput : model.costPerSecondByResolution
  const costPerSecond = rateTable ? rateTable[resolution] || rateTable['480p'] : model.costPerSecond
  return {
    seconds,
    estimatedCost: Number((seconds * costPerSecond).toFixed(2)),
    costPerSecond,
    replicateModel: model.key,
    model: model.fullName,
    modelLabel: model.label
  }
}

function client() {
  if (replicateClientOverride) return replicateClientOverride
  const token = String(process.env.REPLICATE_API_TOKEN || '').trim()
  if (!token) throw new Error('Replicate API token is not configured.')
  return new Replicate({ auth: token })
}

let replicateClientOverride = null
export function setReplicateClientForTests(value) {
  replicateClientOverride = value || null
}

function resolveLocalStartFrame(startFrameUrl, mediaRoot) {
  const value = String(startFrameUrl || '').trim()
  if (!value) throw new Error('Replicate image-to-video requires a start frame image.')
  if (value.startsWith('data:image/')) return value

  let parsed
  try {
    parsed = new URL(value, 'http://127.0.0.1')
  } catch {
    throw new Error('Start frame URL is invalid.')
  }
  if (!parsed.pathname.startsWith('/media/')) return value
  if (!mediaRoot) throw new Error('Local media directory is not configured.')

  const relative = decodeURIComponent(parsed.pathname.slice('/media/'.length))
  const root = path.resolve(mediaRoot)
  const filePath = path.resolve(root, relative)
  const rootPrefix = root.endsWith(path.sep) ? root : root + path.sep
  if (!filePath.startsWith(rootPrefix)) throw new Error('Refused to read a start frame outside local-media.')

  const buffer = fs.readFileSync(filePath)
  if (!buffer.length) throw new Error('Start frame image is empty.')
  if (buffer.length > 20 * 1024 * 1024) throw new Error('Start frame image exceeds the 20MB limit.')
  return buffer
}

function outputUrl(output) {
  const value = Array.isArray(output) ? output[0] : output
  if (!value) return ''
  if (typeof value === 'string') return value
  if (typeof value.url === 'function') return String(value.url())
  if (typeof value.url === 'string') return value.url
  return String(value)
}

async function downloadResult(url, mediaRoot, model) {
  const parsed = new URL(url)
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Replicate returned an unsupported video URL.')
  const response = await fetch(parsed, { redirect: 'follow' })
  if (!response.ok) throw new Error(`Replicate video download failed (${response.status}).`)

  const declaredLength = Number(response.headers.get('content-length') || 0)
  if (declaredLength > MAX_VIDEO_BYTES) throw new Error('Replicate video exceeded the local download size limit.')
  const buffer = Buffer.from(await response.arrayBuffer())
  if (!buffer.length) throw new Error('Replicate returned an empty video.')
  if (buffer.length > MAX_VIDEO_BYTES) throw new Error('Replicate video exceeded the local download size limit.')

  const tempDir = path.resolve(mediaRoot, 'temp')
  const fileName = `${model.filePrefix}-${Date.now()}-${randomUUID()}.mp4`
  const destination = path.resolve(tempDir, fileName)
  const tempPrefix = tempDir.endsWith(path.sep) ? tempDir : tempDir + path.sep
  if (!destination.startsWith(tempPrefix)) throw new Error('Refused to write outside local-media/temp.')
  fs.mkdirSync(tempDir, { recursive: true })
  fs.writeFileSync(destination, buffer)
  return { local_url: `/media/temp/${fileName}`, file_name: fileName, mime_type: 'video/mp4', file_size: buffer.length }
}

export function buildReplicateVideoInput({ prompt, start_frame, image, aspect_ratio, aspectRatio, duration, resolution, generate_audio, generateAudio, seed, media_root, model_id } = {}) {
  const model = resolveReplicateVideoModel(model_id)
  if (model.key === 'seedance-2.0-fast') {
    const input = {
      prompt: String(prompt || '').trim(),
      duration: Number.isFinite(Number(duration)) && Number(duration) > 0 ? Number(duration) : 5,
      resolution: ['480p', '720p'].includes(resolution) ? resolution : '480p',
      aspect_ratio: String(aspect_ratio || aspectRatio || '9:16'),
      generate_audio: generate_audio === undefined && generateAudio === undefined ? true : Boolean(generate_audio ?? generateAudio),
    }
    const imageInput = start_frame || image
    if (imageInput) input.image = resolveLocalStartFrame(imageInput, media_root)
    if (Number.isInteger(Number(seed))) input.seed = Number(seed)
    return input
  }
  return {
    prompt: String(prompt || '').trim(),
    image: resolveLocalStartFrame(start_frame || image, media_root),
    aspect_ratio: VALID_ASPECT_RATIOS.has(aspect_ratio || aspectRatio) ? aspect_ratio || aspectRatio : '16:9'
  }
}

export async function createReplicateVideoJob({ prompt, start_frame, image, aspect_ratio, aspectRatio, duration, resolution, generate_audio, generateAudio, seed, media_root, confirmed, model_id } = {}) {
  const model = resolveReplicateVideoModel(model_id)
  if (confirmed !== true) {
    const estimate = estimateVideoCost(duration, model.key, { resolution })
    return {
      status: 'error',
      error: 'confirmation_required',
      ...estimate,
      message: `Replicate video generation is estimated to cost $${estimate.estimatedCost.toFixed(2)} for ${estimate.seconds} seconds. Send confirmed: true to create a paid prediction.`
    }
  }
  const input = buildReplicateVideoInput({ prompt, start_frame, image, aspect_ratio, aspectRatio, duration, resolution, generate_audio, generateAudio, seed, media_root, model_id })
  if (model.key === 'seedance-2.0-fast' && !input.prompt) throw new Error('Seedance video prompt is required.')
  const request = model.key === 'seedance-2.0-fast'
    ? { model: model.fullName, input }
    : { version: model.fullName.split(':')[1], input }
  const prediction = await client().predictions.create(request)
  const jobId = model.key === 'seedance-2.0-fast' ? `replicate-seedance-video-${prediction.id}` : `replicate-video-${prediction.id}`
  jobs.set(jobId, {
    jobId,
    predictionId: prediction.id,
    replicateModel: model.key,
    model: model.fullName,
    modelLabel: model.label,
    prompt: input.prompt,
    duration: estimateVideoCost(duration, model.key, { resolution }).seconds,
    status: 'generating',
    createdAt: Date.now(),
    mediaRoot: media_root
  })
  return { jobId, status: 'generating' }
}

export async function getReplicateVideoJob(jobId) {
  const requestedId = String(jobId || '')
  let job = jobs.get(requestedId)
  if (!job) {
    const seedanceMatch = /^replicate-seedance-video-(.+)$/.exec(requestedId)
    const match = seedanceMatch || /^replicate-video-(.+)$/.exec(requestedId)
    if (!match) return { status: 'error', error: 'Replicate video job not found.' }
    // The external id is durable by design: a fresh server can recover the
    // prediction from Replicate without relying on this process-local Map.
    job = {
      jobId: requestedId,
      predictionId: match[1],
      replicateModel: seedanceMatch ? 'seedance-2.0-fast' : DEFAULT_REPLICATE_VIDEO_MODEL,
      model: resolveReplicateVideoModel(seedanceMatch ? 'seedance-2.0-fast' : DEFAULT_REPLICATE_VIDEO_MODEL).fullName,
      modelLabel: resolveReplicateVideoModel(seedanceMatch ? 'seedance-2.0-fast' : DEFAULT_REPLICATE_VIDEO_MODEL).label,
      prompt: '',
      duration: 0,
      status: 'generating',
      createdAt: Date.now(),
      mediaRoot: path.resolve(process.cwd(), 'local-media')
    }
    jobs.set(requestedId, job)
  }
  if (job.status === 'done') return { status: 'done', result: job.result }
  if (job.status === 'error') return { status: 'error', error: job.error }
  if (job.status === 'saving') return { status: 'generating' }

  try {
    const prediction = await client().predictions.get(job.predictionId)
    if (prediction.status === 'failed' || prediction.status === 'canceled') {
      job.status = 'error'
      job.error = prediction.error || `Replicate prediction ${prediction.status}.`
      return { status: 'error', error: job.error }
    }
    if (prediction.status !== 'succeeded') return { status: 'generating' }

    job.status = 'saving'
    const saved = await downloadResult(outputUrl(prediction.output), job.mediaRoot, resolveReplicateVideoModel(job.replicateModel))
    job.status = 'done'
    job.result = {
      success: true,
      connected: true,
      mode: 'api',
      provider: 'replicate',
      provider_id: 'replicate',
      provider_name: 'Replicate',
      action_type: 'generate_video',
      media_type: 'video',
      source_type: 'api',
      status: 'success',
      prompt: job.prompt,
      model: job.model,
      model_label: job.modelLabel,
      storage: 'local_disk',
      created_at: new Date(job.createdAt).toISOString(),
      ...saved
    }
    return { status: 'done', result: job.result }
  } catch (error) {
    job.status = 'error'
    job.error = error && error.message ? error.message : 'Replicate video status check failed.'
    return { status: 'error', error: job.error }
  }
}
