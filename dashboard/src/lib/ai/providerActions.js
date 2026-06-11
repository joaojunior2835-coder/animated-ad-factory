// Provider action types and the standard result shape. No API calls anywhere in
// this folder — everything is manual or mock for now.

export const ACTION_TYPES = ['generate_text', 'generate_json', 'generate_image_prompt', 'generate_video_prompt', 'generate_image', 'generate_video', 'repair_json']

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
