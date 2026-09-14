// Documented FLUX Schnell subset. One image per durable M5 Job; quantity is Jobs.
export const FAL_IMAGE_ENDPOINT = 'fal-ai/flux/schnell'
export const FAL_IMAGE_MODEL = 'flux-schnell'
export const IMAGE_SIZES = Object.freeze([
  { id: 'square', label: 'Square · 512 × 512', width: 512, height: 512, aspect: '1:1' },
  { id: 'square_hd', label: 'Square · 1024 × 1024', width: 1024, height: 1024, aspect: '1:1' },
  { id: 'portrait_16_9', label: 'Portrait · 768 × 1344', width: 768, height: 1344, aspect: '9:16' },
  { id: 'landscape_16_9', label: 'Landscape · 1344 × 768', width: 1344, height: 768, aspect: '16:9' },
  { id: 'portrait_4_3', label: 'Portrait · 768 × 1024', width: 768, height: 1024, aspect: '3:4' },
  { id: 'landscape_4_3', label: 'Landscape · 1024 × 768', width: 1024, height: 768, aspect: '4:3' },
])
export function imageJobInput(params = {}) {
  const prompt = String(params.prompt || '').trim()
  const size = IMAGE_SIZES.find(s => s.id === (params.image_size || params.imageSize || 'square_hd'))
  if (!prompt || prompt.length > 6000) throw new Error('Image prompt must contain 1–6000 characters.')
  if (!size) throw new Error('Choose a supported image size.')
  if (params.start_frame || params.startAssetId || params.reference_image_ids?.length || params.referenceAssetIds?.length || params.image_url) throw new Error('FLUX Schnell is text-only. Product references require image-to-video or Remix; they cannot be ignored.')
  if (params.num_images !== undefined && params.num_images !== 1) throw new Error('One image per Job. Choose output quantity in the production quote.')
  const outputFormat = params.output_format || params.outputFormat || 'png'
  if (!['png','jpeg'].includes(outputFormat)) throw new Error('Choose PNG or JPEG.')
  return { prompt, image_size: { width: size.width, height: size.height }, num_images: 1, output_format: outputFormat, enable_safety_checker: true, sync_mode: false }
}
