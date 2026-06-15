// Provider action types and the standard result shape. No API calls anywhere in
// this folder — everything is manual or mock for now.

export const ACTION_TYPES = ['generate_text', 'generate_json', 'generate_image_prompt', 'generate_video_prompt', 'generate_image', 'generate_video', 'repair_json']
export const TEXT_API_PROVIDERS = ['openai', 'openrouter', 'groq']
export const IMAGE_API_PROVIDERS = ['openai', 'pollinations']
export const DEFAULT_TEXT_API_PROVIDER = 'groq'
export const DEFAULT_IMAGE_API_PROVIDER = 'pollinations'

export function selectedTextProvider(canvas = {}) {
  const id = canvas.api_text_provider_id
  return TEXT_API_PROVIDERS.includes(id) ? id : DEFAULT_TEXT_API_PROVIDER
}

export function selectedImageProvider(canvas = {}) {
  return IMAGE_API_PROVIDERS.includes(canvas.api_image_provider_id) ? canvas.api_image_provider_id : DEFAULT_IMAGE_API_PROVIDER
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
