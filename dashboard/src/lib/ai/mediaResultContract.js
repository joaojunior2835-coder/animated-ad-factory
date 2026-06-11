// One shared, normalized media-generation result contract. Manual, Mock, and any
// future API media provider must convert their raw output into this shape so the
// preview / attach / save / export pipeline is identical everywhere.
//
// FRONTEND ONLY. No API calls, no keys. Pure helpers.

import { uid } from '../brandDocs.js'
import { providerName } from '../../data/providers.js'
import { classifyMedia } from '../canvasModel.js'

export const MEDIA_TYPES = ['image', 'video', 'prompt', 'text', 'json', 'unknown']
export const SOURCE_TYPES = ['mock', 'manual', 'api', 'external_url', 'upload', 'local_disk', 'flow_import']
export const RESULT_STATUSES = ['success', 'error', 'pending', 'unsupported']

export function mediaTypeForAction(actionType) {
  if (actionType === 'generate_image') return 'image'
  if (actionType === 'generate_video') return 'video'
  if (actionType === 'generate_image_prompt' || actionType === 'generate_video_prompt') return 'prompt'
  if (actionType === 'generate_json' || actionType === 'repair_json') return 'json'
  if (actionType === 'generate_text') return 'text'
  return 'unknown'
}

// Convert a flexible raw result (orchestrator result, API response, or a manual
// descriptor) into the canonical normalized media result object.
export function normalizeMediaResult(input = {}) {
  const action_type = input.action_type || ''
  const provider_id = input.provider_id || input.provider || ''
  const external_url = String(input.external_url || input.output_url || '').trim()
  const local_url = String(input.local_url || '').trim()
  const data_url = String(input.data_url || '').trim()
  const output_text = input.output_text || ''
  const media_type = MEDIA_TYPES.includes(input.media_type) ? input.media_type : mediaTypeForAction(action_type)

  // Storage precedence: local disk -> external/mock url -> session data -> none.
  let storage = input.storage || ''
  if (!['mock', 'session', 'external_url', 'local_disk', 'none'].includes(storage)) {
    if (local_url) storage = 'local_disk'
    else if (external_url) storage = classifyMedia(external_url) === 'mock' ? 'mock' : 'external_url'
    else if (data_url) storage = 'session'
    else storage = 'none'
  }

  let source_type = SOURCE_TYPES.includes(input.source_type) ? input.source_type : ''
  if (!source_type) {
    if (storage === 'mock' || input.mode === 'mock') source_type = 'mock'
    else if (input.mode === 'manual') source_type = 'manual'
    else if (input.mode === 'api') source_type = 'api'
    else if (local_url) source_type = 'local_disk'
    else if (external_url) source_type = 'external_url'
    else if (data_url) source_type = 'upload'
    else source_type = 'manual'
  }

  let status = RESULT_STATUSES.includes(input.status) ? input.status : ''
  if (!status) status = input.unsupported ? 'unsupported' : input.success === false ? 'error' : 'success'

  const error = input.error || (status === 'error' || status === 'unsupported' ? input.message || '' : '')

  return {
    id: input.id || uid(),
    provider_id,
    provider_name: provider_id ? providerName(provider_id) : '',
    action_type,
    media_type,
    source_type,
    status,
    prompt: input.prompt || input.prompt_used || '',
    output_text,
    raw_output: input.raw_output || input.raw_text || '',
    external_url,
    data_url,
    local_url,
    file_name: input.file_name || '',
    mime_type: input.mime_type || '',
    file_size: typeof input.file_size === 'number' ? input.file_size : 0,
    storage,
    scene_id: input.scene_id || '',
    variation_id: input.variation_id || '',
    created_at: input.created_at || new Date().toISOString(),
    request_id: input.request_id || '',
    model: input.model || '',
    error
  }
}

// Map a normalized result to fields understood by newVariation / addGeneratedVariation.
export function mediaResultToVariation(result) {
  const r = result || {}
  const type = r.media_type === 'image' || r.media_type === 'video' ? r.media_type : r.media_type === 'prompt' ? 'prompt' : 'other'
  const hasMedia = r.external_url || r.local_url
  return {
    action_type: r.action_type || '',
    type,
    provider_id: r.provider_id || '',
    prompt: r.prompt || r.output_text || '',
    external_url: r.external_url || '',
    local_url: r.local_url || '',
    storage: r.storage && r.storage !== 'none' ? r.storage : r.external_url ? 'external_url' : '',
    file_name: r.file_name || '',
    mime_type: r.mime_type || '',
    file_size: r.file_size || 0,
    source_type: r.source_type || '',
    request_id: r.request_id || '',
    model: r.model || '',
    created_at: r.created_at || '',
    notes: !hasMedia && r.output_text ? String(r.output_text).slice(0, 200) : ''
  }
}

// Props for <MediaPreview /> (same precedence used across the app).
export function getMediaResultPreview(result) {
  const r = result || {}
  return { url: r.external_url || '', preview: r.data_url || '', local: r.local_url || '' }
}

// Health label matching the rest of the app.
export function getMediaResultHealth(result) {
  const r = result || {}
  if (r.local_url) return 'Local file saved'
  if (r.external_url) return classifyMedia(r.external_url) === 'mock' ? 'Mock result' : 'URL saved'
  if (r.data_url) return 'Session-only preview'
  return 'No media attached'
}

// Saveable to the Local Media Library only if it carries inline data not yet on disk.
export function isMediaResultSaveable(result) {
  const r = result || {}
  return !!r.data_url && r.storage !== 'local_disk'
}

// Attachable as a scene variation: a successful result we can represent.
export function isMediaResultAttachable(result) {
  const r = result || {}
  if (r.status !== 'success') return false
  return !!(r.external_url || r.local_url || r.data_url || r.output_text)
}
