// Groq provider - BACKEND ONLY. The API key stays in this process and is
// never logged or returned to the client. Groq exposes an OpenAI-compatible
// Chat Completions API, so the existing OpenAI SDK can be reused.

import OpenAI from 'openai'

const GROQ_BASE_URL = 'https://api.groq.com/openai/v1'
const DEFAULT_GROQ_MODEL = 'llama-3.3-70b-versatile'
const TEXT_ACTIONS = ['generate_text', 'generate_json', 'repair_json']
const TEXT_PROMPT_ALIASES = ['generate_image_prompt', 'generate_video_prompt']
const JSON_ACTIONS = ['generate_json', 'repair_json']
const IMAGE_VIDEO_ACTIONS = ['generate_image', 'generate_video']

export function groqModel() {
  return (process.env.GROQ_MODEL && process.env.GROQ_MODEL.trim()) || DEFAULT_GROQ_MODEL
}

export function isSupportedGroqAction(actionType) {
  return TEXT_ACTIONS.includes(actionType) || TEXT_PROMPT_ALIASES.includes(actionType)
}

function retryAfterFromError(error) {
  const headers = error && error.headers
  if (headers && typeof headers.get === 'function') return headers.get('retry-after') || ''
  return (headers && (headers['retry-after'] || headers['Retry-After'])) || ''
}

export async function runGroq({ action_type, input_prompt, context } = {}) {
  const apiKey = process.env.GROQ_API_KEY
  if (!apiKey || !String(apiKey).trim()) {
    return { success: false, error: 'Groq API key is not configured. Add GROQ_API_KEY to .env.local and restart the backend.' }
  }

  if (IMAGE_VIDEO_ACTIONS.includes(action_type)) {
    return { success: false, error: 'Groq image/video generation is not connected.' }
  }
  if (!isSupportedGroqAction(action_type)) {
    return {
      success: false,
      error: `Groq provider does not support "${action_type || '(none)'}". Supported: generate_text, generate_json, repair_json.`
    }
  }

  const model = groqModel()
  const wantJson = JSON_ACTIONS.includes(action_type)
  const system = wantJson
    ? 'You are a helpful assistant for a local creative tool. Respond with VALID JSON only - no prose, no markdown code fences.'
    : 'You are a helpful assistant for a local creative tool. Respond concisely and directly.'

  const userParts = []
  if (context) userParts.push(`Context:\n${typeof context === 'string' ? context : JSON.stringify(context, null, 2)}`)
  userParts.push(String(input_prompt || ''))

  const client = new OpenAI({ apiKey, baseURL: GROQ_BASE_URL })

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
  } catch (error) {
    if (Number(error && (error.status || error.statusCode)) === 429) {
      const retryAfter = retryAfterFromError(error)
      return {
        success: false,
        connected: true,
        provider: 'groq',
        action_type,
        status: 'rate_limited',
        retry_after: retryAfter,
        error: retryAfter
          ? `Groq rate limit reached. Retry after ${retryAfter}.`
          : 'Groq rate limit reached. Please retry shortly.'
      }
    }
    return { success: false, error: `Groq request failed: ${error && error.message ? error.message : 'unknown error'}` }
  }

  const out = { success: true, connected: true, mode: 'api', provider: 'groq', action_type, model, output_text: raw_text, raw_text }
  if (wantJson) {
    try {
      out.parsed_json = JSON.parse(raw_text)
    } catch (error) {
      out.parse_error = error && error.message ? error.message : 'JSON parse failed'
    }
  }

  return out
}
