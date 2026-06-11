// OpenRouter provider — BACKEND ONLY. The API key lives in this process (from
// .env.local) and is never logged or returned to any client. Text/JSON only:
// no image or video generation is connected here.
//
// OpenRouter exposes an OpenAI-compatible Chat Completions API, so we reuse the
// official OpenAI SDK pointed at the OpenRouter base URL. No new dependency.

import OpenAI from 'openai'

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1'

// Real text/JSON actions. The *_prompt aliases are treated as plain text (they
// only ask the model to write a prompt string), never as image/video calls.
const TEXT_ACTIONS = ['generate_text', 'generate_json', 'repair_json']
const TEXT_PROMPT_ALIASES = ['generate_image_prompt', 'generate_video_prompt']
const JSON_ACTIONS = ['generate_json', 'repair_json']
const IMAGE_VIDEO_ACTIONS = ['generate_image', 'generate_video']

export function isSupportedOpenRouterAction(actionType) {
  return TEXT_ACTIONS.includes(actionType) || TEXT_PROMPT_ALIASES.includes(actionType)
}

export async function runOpenRouter({ action_type, input_prompt, context } = {}) {
  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey || !String(apiKey).trim()) {
    return { success: false, error: 'OpenRouter API key is not configured. Add OPENROUTER_API_KEY to .env.local and restart the backend.' }
  }

  if (IMAGE_VIDEO_ACTIONS.includes(action_type)) {
    return { success: false, error: 'OpenRouter image/video generation is not connected yet.' }
  }
  if (!isSupportedOpenRouterAction(action_type)) {
    return {
      success: false,
      error: `OpenRouter provider does not support "${action_type || '(none)'}". Supported: generate_text, generate_json, repair_json. Image/video generation is not connected.`
    }
  }

  // No safe universal default — OpenRouter requires an explicit model id.
  const model = process.env.OPENROUTER_MODEL && process.env.OPENROUTER_MODEL.trim()
  if (!model) {
    return { success: false, error: 'OpenRouter model is not configured. Set OPENROUTER_MODEL in .env.local (e.g. openai/gpt-4o-mini) and restart the backend.' }
  }

  const wantJson = JSON_ACTIONS.includes(action_type)
  const system = wantJson
    ? 'You are a helpful assistant for a local creative tool. Respond with VALID JSON only — no prose, no markdown code fences.'
    : 'You are a helpful assistant for a local creative tool. Respond concisely and directly.'

  const userParts = []
  if (context) userParts.push(`Context:\n${typeof context === 'string' ? context : JSON.stringify(context, null, 2)}`)
  userParts.push(String(input_prompt || ''))

  const client = new OpenAI({
    apiKey,
    baseURL: OPENROUTER_BASE_URL,
    // Optional OpenRouter attribution headers (no secrets).
    defaultHeaders: { 'X-Title': 'Animated Ad Factory (local)' }
  })

  let raw_text = ''
  try {
    const resp = await client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: userParts.join('\n\n') }
      ],
      ...(wantJson ? { response_format: { type: 'json_object' } } : {})
    })
    raw_text = (resp.choices && resp.choices[0] && resp.choices[0].message && resp.choices[0].message.content) || ''
  } catch (e) {
    // SDK error messages do not include the key; we still avoid echoing config.
    return { success: false, error: `OpenRouter request failed: ${e && e.message ? e.message : 'unknown error'}` }
  }

  const out = { success: true, connected: true, mode: 'api', provider: 'openrouter', action_type, model, output_text: raw_text, raw_text }

  // For JSON actions: attempt to parse, but never auto-apply. Frontend previews.
  if (wantJson) {
    try {
      out.parsed_json = JSON.parse(raw_text)
    } catch (e) {
      out.parse_error = e && e.message ? e.message : 'JSON parse failed'
    }
  }

  return out
}
