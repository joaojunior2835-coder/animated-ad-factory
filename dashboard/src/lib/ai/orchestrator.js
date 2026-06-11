// Provider orchestrator. Dispatches an action to the manual or mock provider.
// IMPORTANT: this layer never makes real API calls. It exists so generation
// buttons have a stable interface to wire real providers into later.
//
// Request: { project, canvas, scene, variation?, provider_id, action_type, input_prompt, context?, mode }
// Result:  { success, mode, provider_id, action_type, prompt_used, output_text, output_url, errors[], message }

import { ACTION_TYPES } from './providerActions.js'
import { runManual } from './manualProvider.js'
import { runMock } from './mockProvider.js'

export function runAction(req = {}) {
  const mode = req.mode === 'mock' ? 'mock' : 'manual'
  const prompt_used = String(req.input_prompt || (req.scene && (req.scene.output_prompt || req.scene.what_happens)) || '').trim()
  const errors = []
  if (!ACTION_TYPES.includes(req.action_type)) errors.push(`Unknown action_type: ${req.action_type}`)

  if (errors.length) {
    return { success: false, mode, provider_id: req.provider_id || '', action_type: req.action_type || '', prompt_used, output_text: '', output_url: '', errors, message: '' }
  }

  const payload = { ...req, mode, prompt_used }
  return mode === 'mock' ? runMock(payload) : runManual(payload)
}
