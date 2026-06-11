// Mock provider: fabricates outputs for testing the workflow. No API calls.

import { makeResult } from './providerActions.js'

export function runMock(req) {
  const { action_type, provider_id, prompt_used, scene } = req
  const n = (scene && scene.scene_number) || 1
  const base = { success: true, mode: 'mock', provider_id, action_type, prompt_used }

  switch (action_type) {
    case 'generate_image':
      return makeResult({ ...base, output_text: `Mock image generated for scene ${n}`, output_url: `mock://generated-image/scene-${n}` })
    case 'generate_image_prompt':
      return makeResult({ ...base, output_text: `Mock image prompt for scene ${n}: ${prompt_used || '(no prompt)'}` })
    case 'generate_video':
      return makeResult({ ...base, output_text: `Mock video generated for scene ${n}`, output_url: `mock://generated-video/scene-${n}` })
    case 'generate_video_prompt':
      return makeResult({ ...base, output_text: `Mock video prompt for scene ${n}: ${prompt_used || '(no prompt)'}` })
    case 'generate_json':
      return makeResult({ ...base, output_text: JSON.stringify({ scene_number: n, mock: true, prompt: prompt_used || '' }, null, 2) })
    case 'repair_json':
      return makeResult({ ...base, output_text: JSON.stringify({ repaired: true, mock: true, note: 'mock corrected JSON' }, null, 2) })
    case 'generate_text':
    default:
      return makeResult({ ...base, output_text: `Mock text output for scene ${n}` })
  }
}
