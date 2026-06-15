// Provider registry placeholder. No API connections yet — every provider is in
// manual mode (copy/paste). api_mode_future flags where APIs may be added later.

export const PROVIDERS = [
  { id: 'openai', name: 'OpenAI', category: 'LLM', manual_mode: true, api_mode_future: true, notes: 'GPT models for briefs, copy, and structured JSON. Manual paste for now.' },
  { id: 'anthropic', name: 'Anthropic Claude', category: 'LLM', manual_mode: true, api_mode_future: true, notes: 'Claude models for structured ad JSON and reasoning. Manual paste for now.' },
  { id: 'gemini', name: 'Google Gemini', category: 'LLM', manual_mode: true, api_mode_future: true, notes: 'Gemini models for multimodal briefs. Manual paste for now.' },
  { id: 'openrouter', name: 'OpenRouter', category: 'LLM gateway', manual_mode: true, api_mode_future: true, notes: 'Unified gateway to many LLMs. Manual for now.' },
  { id: 'groq', name: 'Groq', category: 'LLM', manual_mode: true, api_mode_future: false, notes: 'Connected text and JSON generation through the local backend.' },
  { id: 'pollinations', name: 'Pollinations', category: 'Image generation', manual_mode: true, api_mode_future: false, notes: 'Connected Flux image generation saved to local disk by the backend.' },
  { id: 'fal', name: 'fal.ai', category: 'Image/Video generation', manual_mode: true, api_mode_future: true, notes: 'Fast image/video model hosting. Manual for now.' },
  { id: 'replicate', name: 'Replicate', category: 'Model hosting', manual_mode: true, api_mode_future: true, notes: 'Runs hosted image/video models. Manual for now.' },
  { id: 'kling', name: 'Kling', category: 'Video generation', manual_mode: true, api_mode_future: true, notes: 'Image-to-video and motion. Manual for now.' },
  { id: 'seedance', name: 'Seedance', category: 'Video generation', manual_mode: true, api_mode_future: true, notes: 'Video generation. Manual for now.' },
  { id: 'google_flow', name: 'Google Flow', category: 'Video tool', manual_mode: true, api_mode_future: true, notes: 'Agent Mode keyframe-to-video. Manual for now.' }
]

const BY_ID = Object.fromEntries(PROVIDERS.map((p) => [p.id, p]))

export function getProvider(id) {
  return BY_ID[id] || null
}

export function providerName(id) {
  const p = BY_ID[id]
  return p ? p.name : id
}
