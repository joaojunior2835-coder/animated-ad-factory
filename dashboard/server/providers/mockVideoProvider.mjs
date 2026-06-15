// Local-only asynchronous video provider. It never calls a remote service and
// returns one shared placeholder MP4 after a short simulated generation delay.

import { randomUUID } from 'node:crypto'

const jobs = new Map()
const MIN_DELAY_MS = 8_000
const MAX_DELAY_MS = 20_000
const PLACEHOLDER_URL = '/mock-video-output.mp4'
const PLACEHOLDER_FILE = 'mock-video-output.mp4'
const VALID_ASPECT_RATIOS = new Set(['9:16', '16:9', '1:1', '4:3'])

function resultFor(job) {
  return {
    success: true,
    connected: true,
    mode: 'mock',
    provider: 'mock',
    provider_id: 'mock',
    provider_name: 'Mock Video',
    action_type: 'generate_video',
    media_type: 'video',
    source_type: 'mock',
    status: 'success',
    prompt: job.prompt,
    model: 'mock-video',
    local_url: PLACEHOLDER_URL,
    file_name: PLACEHOLDER_FILE,
    mime_type: 'video/mp4',
    file_size: job.fileSize,
    storage: 'local_disk',
    created_at: new Date(job.createdAt).toISOString()
  }
}

export function createMockVideoJob({ prompt, start_frame, aspect_ratio, duration, file_size } = {}) {
  const jobId = `mock-video-${randomUUID()}`
  const createdAt = Date.now()
  const delayMs = Math.floor(MIN_DELAY_MS + Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS + 1))
  const job = {
    jobId,
    status: 'generating',
    prompt: String(prompt || '').trim(),
    hasStartFrame: Boolean(start_frame),
    aspectRatio: VALID_ASPECT_RATIOS.has(aspect_ratio) ? aspect_ratio : '16:9',
    duration: Number.isFinite(Number(duration)) && Number(duration) > 0 ? Number(duration) : 5,
    fileSize: Number.isFinite(Number(file_size)) ? Number(file_size) : 0,
    createdAt,
    readyAt: createdAt + delayMs
  }
  jobs.set(jobId, job)

  const timer = setTimeout(() => {
    const current = jobs.get(jobId)
    if (!current || current.status !== 'generating') return
    current.status = 'done'
    current.result = resultFor(current)
  }, delayMs)
  timer.unref()

  return { jobId, status: 'generating' }
}

export function getMockVideoJob(jobId) {
  const job = jobs.get(String(jobId || ''))
  if (!job) return { status: 'error', error: 'Mock video job not found.' }

  // Also finish lazily so polling remains deterministic if timers were delayed.
  if (job.status === 'generating' && Date.now() >= job.readyAt) {
    job.status = 'done'
    job.result = resultFor(job)
  }

  if (job.status === 'done') return { status: 'done', result: job.result }
  if (job.status === 'error') return { status: 'error', error: job.error || 'Mock video generation failed.' }
  return { status: 'generating' }
}
