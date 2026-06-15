// Provider action types, selectors, and local-backend action helpers.
// Provider keys never enter this frontend module.

import { generateVideo, pollVideoStatus } from './apiClient.js'

export const ACTION_TYPES = ['generate_text', 'generate_json', 'generate_image_prompt', 'generate_video_prompt', 'generate_image', 'generate_video', 'repair_json']
export const TEXT_API_PROVIDERS = ['openai', 'openrouter', 'groq']
export const IMAGE_API_PROVIDERS = ['openai', 'pollinations']
export const VIDEO_API_PROVIDERS = ['mock', 'replicate']
export const DEFAULT_TEXT_API_PROVIDER = 'groq'
export const DEFAULT_IMAGE_API_PROVIDER = 'pollinations'
export const DEFAULT_VIDEO_API_PROVIDER = 'mock'

export function selectedTextProvider(canvas = {}) {
  const id = canvas.api_text_provider_id
  return TEXT_API_PROVIDERS.includes(id) ? id : DEFAULT_TEXT_API_PROVIDER
}

export function selectedImageProvider(canvas = {}) {
  return IMAGE_API_PROVIDERS.includes(canvas.api_image_provider_id) ? canvas.api_image_provider_id : DEFAULT_IMAGE_API_PROVIDER
}

export function selectedVideoProvider(canvas = {}) {
  return VIDEO_API_PROVIDERS.includes(canvas.api_video_provider_id) ? canvas.api_video_provider_id : DEFAULT_VIDEO_API_PROVIDER
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// Run the local async video pipeline. The backend owns provider interaction; the
// browser only starts a job and polls its status.
export async function runVideoGeneration({ prompt, startFrameUrl = '', aspectRatio = '9:16', duration = 5, provider = DEFAULT_VIDEO_API_PROVIDER, pollIntervalMs = 10_000, maxWaitMs = 5 * 60_000 } = {}) {
  const started = await generateVideo(prompt, startFrameUrl, aspectRatio, duration, provider)
  if (!started || started.status === 'error' || !started.jobId) {
    return { success: false, status: 'error', error: (started && started.error) || 'Video generation did not return a job id.' }
  }

  const deadline = Date.now() + maxWaitMs
  while (Date.now() < deadline) {
    await wait(pollIntervalMs)
    const polled = await pollVideoStatus(started.jobId)
    if (polled && polled.status === 'done' && polled.result) return polled.result
    if (!polled || polled.status === 'error') {
      return { success: false, status: 'error', error: (polled && polled.error) || 'Video generation failed.' }
    }
  }
  return { success: false, status: 'error', error: 'Video generation timed out after 5 minutes.' }
}

// Map an action type to the variation type it produces.
export function variationTypeForAction(actionType) {
  if (actionType === 'generate_image' || actionType === 'generate_image_prompt') return 'image'
  if (actionType === 'generate_video' || actionType === 'generate_video_prompt') return 'video'
  return 'prompt'
}

export function makeResult(partial) {
  return {
    success: partial.success !== false,
    mode: partial.mode || 'manual',
    provider_id: partial.provider_id || '',
    action_type: partial.action_type || '',
    prompt_used: partial.prompt_used || '',
    output_text: partial.output_text || '',
    output_url: partial.output_url || '',
    errors: Array.isArray(partial.errors) ? partial.errors : [],
    message: partial.message || ''
  }
}
