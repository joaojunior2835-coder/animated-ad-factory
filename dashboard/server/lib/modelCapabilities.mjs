// Backend-authoritative application subset. Prices remain in rateCatalog.
import { getConfiguredRates, FAL_IMAGE_RATE } from './rateCatalog.mjs'
import { IMAGE_SIZES, imageJobInput } from '../providers/falImageModel.mjs'

export function modelCapabilities() {
  const rates = getConfiguredRates(), configured = rates.image['flux-schnell'].configured
  const image = { capability:'generate_image', modes:['text-to-image'], aspects:[...new Set(IMAGE_SIZES.map(s=>s.aspect))], imageSizes:IMAGE_SIZES, outputFormats:['png','jpeg'], resolutions:[], durations:[], audio:false, references:{image:0,video:0,audio:0}, quantity:{min:1,max:4}, qualityOptions:[], implemented:true, priced:true }
  const video = { capability:'generate_video', modes:['text-to-video','image-to-video','reference-to-video'], aspects:['9:16','16:9','1:1'], referenceAspects:['9:16','auto'], resolutions:['480p','720p'], durations:Array.from({length:12},(_,i)=>i+4), audio:true, references:{image:9,video:1,audio:1}, quantity:{min:1,max:4}, qualityOptions:[], implemented:true, priced:true }
  return [
    { ...image, id:'fal-flux-schnell',provider:'fal',model:'flux-schnell',label:'FLUX Schnell',configured,pricing:{...FAL_IMAGE_RATE,currency:'USD',basis:'catalog_estimate'},schemaSource:'https://fal.ai/models/fal-ai/flux/schnell/api',verifiedAt:'2026-09-15' },
    { ...video, id:'fal-seedance-fast',provider:'fal',model:'seedance-2.0-fast',label:'Seedance 2.0 Fast',configured,pricing:{currency:'USD',basis:'catalog_estimate',perSecondMinor:{'480p':rates.video['seedance-2.0-fast-480p'].costPerSecondMinor,'720p':rates.video['seedance-2.0-fast-720p'].costPerSecondMinor},referenceRate:rates.video['seedance-2.0-fast-reference'].usdPer1000Tokens,source:'https://fal.ai/models/bytedance/seedance-2.0/fast/text-to-video',verifiedAt:'2026-09-14'} },
    { ...image,id:'mock-image',provider:'mock',model:'mock-image',label:'Mock Image · local fixture',configured:true,pricing:{currency:'EUR',amount:0,basis:'local_mock'} },
    { ...video,id:'mock-video',provider:'mock',model:'mock-video',label:'Mock Video · local fixture',configured:true,pricing:{currency:'EUR',amount:0,basis:'local_mock'} },
  ]
}

export function validateModelStep(step, { requireConfigured = true } = {}) {
  const model = modelCapabilities().find(m => m.id === step.modelId || (m.provider === step.provider && m.model === step.model && m.capability === step.capability))
  if (!model || model.capability !== step.capability) throw new Error('PROVIDER_MODEL_MISMATCH')
  if ((step.provider && step.provider!==model.provider)||(step.model && step.model!==model.model)||(step.modelId && step.modelId!==model.id)) throw new Error('Conflicting provider/model identity.')
  if (requireConfigured && !model.configured) throw new Error('PROVIDER_NOT_CONFIGURED')
  const p = step.params || {}, prompt = String(step.prompt || p.prompt || '').trim()
  if (!prompt || prompt.length > 6000) throw new Error('A prompt of 1–6000 characters is required.')
  if (model.capability === 'generate_image') {
    if (p.quality || p.duration || p.seconds || p.generate_audio !== undefined) throw new Error('Image model does not accept quality, duration or audio controls.')
    imageJobInput({...p,prompt})
  } else {
    const seconds = Number(p.seconds ?? p.duration), mode = p.generation_mode === 'reference_to_video' ? 'reference-to-video' : p.needs_start_frame || p.start_frame ? 'image-to-video' : 'text-to-video'
    if (!model.durations.includes(seconds)) throw new Error('Choose a supported duration (4–15 seconds).')
    if (!model.resolutions.includes(p.resolution)) throw new Error('Choose a supported resolution.')
    if (!(mode === 'reference-to-video' ? model.referenceAspects : model.aspects).includes(p.aspect_ratio)) throw new Error('Choose a supported aspect ratio.')
    if (typeof p.generate_audio !== 'boolean') throw new Error('Audio choice must be a boolean.')
    if (p.quality) throw new Error('This model has no quality parameter.')
  }
  return { model, prompt }
}
