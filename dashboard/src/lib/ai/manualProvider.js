// Manual provider: never calls an API. Returns the built prompt so the user can
// copy it into their chosen tool.

import { makeResult } from './providerActions.js'

export function runManual(req) {
  return makeResult({
    success: true,
    mode: 'manual',
    provider_id: req.provider_id,
    action_type: req.action_type,
    prompt_used: req.prompt_used,
    output_text: req.prompt_used,
    message: 'Manual mode: copy this prompt into the selected tool.'
  })
}
