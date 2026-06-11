// OpenAI provider — BACKEND ONLY. The API key lives in this process (from
// .env.local) and is never logged or returned to any client. Connected:
// text/JSON, and text-to-image (generate_image). Video is NOT connected.

import OpenAI from 'openai'

// Real text/JSON actions. The *_prompt aliases are treated as plain text (they
// only ask the model to write a prompt string), never as image/video calls.
const TEXT_ACTIONS = ['generate_text', 'generate_json', 'repair_json']
const TEXT_PROMPT_ALIASES = ['generate_image_prompt', 'generate_video_prompt']
const JSON_ACTIONS = ['generate_json', 'repair_json']

export function isSupportedOpenAiAction(actionType) {
  return TEXT_ACTIONS.includes(actionType) || TEXT_PROMPT_ALIASES.includes(actionType)
}

// Map an OpenAI image SDK error to a clear, key-safe message + request id.
function mapImageError(e) {
  const status = e && (e.status || e.statusCode)
  const code = (e && (e.code || (e.error && e.error.code))) || ''
  const msg = (e && e.message) || 'unknown error'
  const request_id = (e && (e.requestID || e.request_id)) || ''
  let error
  if (status === 401) error = 'OpenAI rejected the API key (401). Check OPENAI_API_KEY.'
  else if (status === 429) error = 'OpenAI image request hit a quota/rate/billing limit (429). Check your image API credits.'
  else if (code === 'moderation_blocked' || /moderation/i.test(msg)) error = 'Image request was blocked by moderation.'
  else if (/must be verified|verify your organization|organization.*verif/i.test(msg)) error = 'Your OpenAI organization must be verified to use this image model. Check your OpenAI account access.'
  else if (status === 400) error = `OpenAI image request error: ${msg}`
  else error = `OpenAI image request failed: ${msg}`
  return { success: false, provider: 'openai', provider_name: 'OpenAI', action_type: 'generate_image', media_type: 'image', source_type: 'api', status: 'error', request_id, error }
}

// Sizes the Images API accepts; a client-requested size must be one of these
// (anything else falls back to the env default). Never trusted raw.
const ALLOWED_IMAGE_SIZES = ['1024x1024', '1536x1024', '1024x1536', 'auto']

// Text-to-image via OpenAI Images API. Generates exactly ONE image and returns a
// data_url. Never auto-saves; the frontend decides whether to persist it.
async function runOpenAiImage({ apiKey, input_prompt, size: requestedSize }) {
  const model = process.env.OPENAI_IMAGE_MODEL && process.env.OPENAI_IMAGE_MODEL.trim()
  if (!model) {
    return { success: false, provider: 'openai', provider_name: 'OpenAI', action_type: 'generate_image', media_type: 'image', source_type: 'api', status: 'error', error: 'OpenAI image model is not configured. Set OPENAI_IMAGE_MODEL in .env.local (e.g. gpt-image-2) and restart the backend.' }
  }
  const prompt = String(input_prompt || '').trim()
  if (!prompt) {
    return { success: false, provider: 'openai', provider_name: 'OpenAI', action_type: 'generate_image', media_type: 'image', source_type: 'api', status: 'error', error: 'Image prompt is empty.' }
  }
  const clientSize = ALLOWED_IMAGE_SIZES.includes(requestedSize) ? requestedSize : ''
  const size = clientSize || (process.env.OPENAI_IMAGE_SIZE && process.env.OPENAI_IMAGE_SIZE.trim())
  const quality = process.env.OPENAI_IMAGE_QUALITY && process.env.OPENAI_IMAGE_QUALITY.trim()

  const client = new OpenAI({ apiKey })
  try {
    const params = { model, prompt, n: 1 }
    if (size) params.size = size
    if (quality) params.quality = quality
    const resp = await client.images.generate(params)
    const item = (resp && resp.data && resp.data[0]) || {}
    const mime = 'image/png'
    const out = {
      success: true, connected: true, mode: 'api', provider: 'openai', provider_name: 'OpenAI',
      action_type: 'generate_image', media_type: 'image', source_type: 'api', status: 'success',
      prompt, model, mime_type: mime
    }
    if (item.b64_json) out.data_url = `data:${mime};base64,${item.b64_json}`
    else if (item.url) out.external_url = item.url
    else return { success: false, provider: 'openai', provider_name: 'OpenAI', action_type: 'generate_image', media_type: 'image', source_type: 'api', status: 'error', error: 'OpenAI returned no image data.' }
    return out
  } catch (e) {
    return mapImageError(e)
  }
}

export async function runOpenAi({ action_type, input_prompt, context, size } = {}) {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey || !String(apiKey).trim()) {
    return { success: false, error: 'OpenAI API key is not configured. Add OPENAI_API_KEY to .env.local and restart the backend.' }
  }

  // Text-to-image (one image). Video stays disconnected.
  if (action_type === 'generate_image') return runOpenAiImage({ apiKey, input_prompt, size })
  if (action_type === 'generate_video') {
    return { success: false, provider: 'openai', provider_name: 'OpenAI', action_type: 'generate_video', media_type: 'video', source_type: 'api', status: 'unsupported', error: 'OpenAI video generation is not connected yet.' }
  }

  if (!isSupportedOpenAiAction(action_type)) {
    return {
      success: false,
      error: `OpenAI provider does not support "${action_type || '(none)'}". Supported: generate_text, generate_json, repair_json, generate_image. Video generation is not connected.`
    }
  }

  const model = (process.env.OPENAI_MODEL && process.env.OPENAI_MODEL.trim()) || 'gpt-5.5'
  const wantJson = JSON_ACTIONS.includes(action_type)

  const system = wantJson
    ? 'You are a helpful assistant for a local creative tool. Respond with VALID JSON only — no prose, no markdown code fences.'
    : 'You are a helpful assistant for a local creative tool. Respond concisely and directly.'

  const userParts = []
  if (context) userParts.push(`Context:\n${typeof context === 'string' ? context : JSON.stringify(context, null, 2)}`)
  userParts.push(String(input_prompt || ''))

  const client = new OpenAI({ apiKey })

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
    return { success: false, error: `OpenAI request failed: ${e && e.message ? e.message : 'unknown error'}` }
  }

  const out = { success: true, connected: true, mode: 'api', provider: 'openai', action_type, model, output_text: raw_text, raw_text }

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
