// Provider/model rate catalog — the single source of truth for pricing a
// production plan. Every number here is either read directly from the real
// provider code (never re-derived or duplicated) or explicitly reported as
// unconfigured. Nothing in this file invents a price.

import { REPLICATE_VIDEO_MODELS, estimateVideoCost } from '../providers/replicateVideoProvider.mjs'
import { FAL_SEEDANCE_RATES_USD_PER_SECOND } from '../providers/falProvider.mjs'
import { referenceInputs } from './referenceRemix.mjs'
import { FAL_IMAGE_MODEL, IMAGE_SIZES } from '../providers/falImageModel.mjs'

// Official model page, verified 2026-09-15. Each output rounds up megapixels.
export const FAL_IMAGE_RATE = Object.freeze({ usdPerMegapixel: 0.003, source: 'https://fal.ai/models/fal-ai/flux/schnell', verifiedAt: '2026-09-15', billingUnit: 'rounded_up_megapixel_per_image' })

// Verified 2026-09-14 via GET api.fal.ai/v1/models/pricing for this endpoint.
// Formula: fal.ai/models/bytedance/seedance-2.0/fast/reference-to-video
// Output geometry is a nominal resolution-area estimate, not an invoice.
export const REFERENCE_RATE = Object.freeze({ usdPer1000Tokens:0.0112, videoMultiplier:0.6, fps:24, pixelsPerToken:1024, nominalPixels:{'480p':480*854,'720p':720*1280} })

const isConfigured = (envName) => Boolean(process.env[envName] && String(process.env[envName]).trim())

/**
 * Every capability this system can currently execute, with its real
 * configured rate (or an explicit absence of one).
 *
 * Currency note: Replicate and fal.ai bill in USD; costPerSecondMinor here is USD
 * cents, tagged with currency: 'USD'. Only Mock is guaranteed free.
 * Pollinations now uses Pollen credits; no verified rate/accounting is wired
 * here, so it must remain unpriceable. Planning and M5 use persisted FX rates.
 */
export function getConfiguredRates() {
  // Replicate rates remain sourced from its provider implementation. Seedance
  // rates are sourced from falProvider's documented per-second constants.
  const ltxPerSecond = estimateVideoCost(1, 'ltx')
  const wanPerSecond = estimateVideoCost(1, 'wan-720p')

  return {
    image: {
      [FAL_IMAGE_MODEL]: { currency: 'USD', configured: isConfigured('FAL_API_KEY'), ...FAL_IMAGE_RATE },
      pollinations: {
        costPerImageMinor: null,
        currency: 'USD',
        configured: isConfigured('POLLINATIONS_API_KEY'),
      },
    },
    video: {
      'seedance-2.0-fast-reference': { currency:'USD', configured:isConfigured('FAL_API_KEY'), costPerSecondMinor:null, usdPer1000Tokens:REFERENCE_RATE.usdPer1000Tokens, label:'Seedance 2.0 Fast Reference', requiresReferenceInputs:true },
      ltx: {
        costPerSecondMinor: Math.round(ltxPerSecond.costPerSecond * 100),
        currency: 'USD',
        configured: isConfigured('REPLICATE_API_TOKEN'),
        quality: 'cheap',
        label: REPLICATE_VIDEO_MODELS.ltx.label,
      },
      'wan-720p': {
        costPerSecondMinor: Math.round(wanPerSecond.costPerSecond * 100),
        currency: 'USD',
        configured: isConfigured('REPLICATE_API_TOKEN'),
        quality: 'higher',
        label: REPLICATE_VIDEO_MODELS['wan-720p'].label,
      },
      'seedance-2.0-fast-480p': {
        costPerSecondMinor: FAL_SEEDANCE_RATES_USD_PER_SECOND['480p'] * 100,
        currency: 'USD',
        configured: isConfigured('FAL_API_KEY'),
        quality: 'fast',
        label: 'Seedance 2.0 Fast · 480p',
      },
      'seedance-2.0-fast-720p': {
        costPerSecondMinor: FAL_SEEDANCE_RATES_USD_PER_SECOND['720p'] * 100,
        currency: 'USD',
        configured: isConfigured('FAL_API_KEY'),
        quality: 'fast-hd',
        label: 'Seedance 2.0 Fast · 720p',
      },
      mock: {
        costPerSecondMinor: 0,
        currency: 'ANY',
        configured: true,
        quality: 'placeholder',
        label: 'Mock Video',
      },
    },
    // No voice provider is wired anywhere in this codebase yet (confirmed by
    // reading every file in server/providers/) — reported as empty, plainly,
    // rather than inventing a placeholder rate. Any plan requiring voice
    // must resolve to COST_UNKNOWN downstream.
    voice: {},
  }
}

/** Raw fractional USD cents; do not round to zero before the reserve boundary. */
export function estimateImageJobCost(model, params = {}) {
  const size = IMAGE_SIZES.find(s => s.id === (params.image_size || params.imageSize || 'square_hd'))
  if (!size) return { unknown: true, reason: 'Unsupported image size.' }
  if (model === 'mock-image') return { unknown: false, costMinor: 0, sourceUsd: 0, currency: 'EUR', pricingBasis: 'local_mock' }
  if (model !== FAL_IMAGE_MODEL || !isConfigured('FAL_API_KEY')) return { unknown: true, reason: 'Image provider not configured or model price unavailable.' }
  const megapixels = Math.ceil(size.width * size.height / 1_000_000)
  const sourceUsd = megapixels * FAL_IMAGE_RATE.usdPerMegapixel
  return { unknown: false, costMinor: sourceUsd * 100, sourceUsd, currency: 'USD', megapixels, pricingBasis: 'catalog_estimate', pricingSource: FAL_IMAGE_RATE.source }
}

/**
 * Price one component of a generation plan against the catalog.
 * Pure, deterministic, no AI call.
 *
 * @param {'image'|'video'|'voice'} capability
 * @param {string} providerModel — a key within that capability's catalog section
 * @param {number} quantity — images: image count; video: seconds
 * @returns {{unknown:false, costMinor:number, currency:string} | {unknown:true, reason:string}}
 */
export function estimateComponentCost(capability, providerModel, quantity) {
  const rates = getConfiguredRates()
  const section = rates[capability]
  if (!section) return { unknown: true, reason: `unknown_capability:${capability}` }

  const entry = section[providerModel]
  if (!entry) return { unknown: true, reason: `unknown_provider_model:${capability}/${providerModel}` }
  if (!entry.configured) return { unknown: true, reason: `not_configured:${capability}/${providerModel}` }

  const qty = Number(quantity)
  if (!Number.isFinite(qty) || qty < 0) return { unknown: true, reason: 'invalid_quantity' }

  if (capability === 'image') {
    if (!Number.isFinite(entry.costPerImageMinor)) return { unknown: true, reason: `price_not_configured:${capability}/${providerModel}` }
    return { unknown: false, costMinor: Math.round(qty * entry.costPerImageMinor), currency: entry.currency }
  }
  if (capability === 'video') {
    if (!Number.isFinite(entry.costPerSecondMinor)) return {unknown:true,reason:'Reference input duration is required for pricing.'}
    return { unknown: false, costMinor: Math.round(qty * entry.costPerSecondMinor), currency: entry.currency }
  }
  return { unknown: true, reason: `unpriceable_capability:${capability}` }
}

/** Shared by scene quote, M5 preflight/materialization and atomic dispatch. */
export function estimateVideoJobCost(model, params) {
  if (params.generation_mode !== 'reference_to_video') return estimateComponentCost('video',model === 'seedance-2.0-fast' ? `${model}-${params.resolution === '720p' ? '720p' : '480p'}` : model === 'mock-video' ? 'mock' : model,Number(params.seconds ?? params.duration))
  try {
    const inputs=referenceInputs(params), seconds=Number(params.seconds ?? params.duration)
    if (!Number.isInteger(seconds) || seconds<4 || seconds>15 || !['9:16','auto'].includes(params.aspect_ratio) || !REFERENCE_RATE.nominalPixels[params.resolution]) throw new Error('Unpriceable reference settings.')
    if (model === 'mock' || model === 'mock-video') return {unknown:false,costMinor:0,currency:'ANY',inputSeconds:inputs.inputSeconds}
    if (model !== 'seedance-2.0-fast' || !isConfigured('FAL_API_KEY')) throw new Error('Reference provider not configured.')
    const tokens=REFERENCE_RATE.nominalPixels[params.resolution]*(inputs.inputSeconds+seconds)*REFERENCE_RATE.fps/REFERENCE_RATE.pixelsPerToken
    const sourceUsd=tokens/1000*REFERENCE_RATE.usdPer1000Tokens*REFERENCE_RATE.videoMultiplier
    return {unknown:false,costMinor:Math.ceil(sourceUsd*100),currency:'USD',sourceUsd,inputSeconds:inputs.inputSeconds,outputSeconds:seconds,pricingBasis:'catalog_estimate',geometryBasis:'nominal_resolution_area',tokens}
  } catch(error) { return {unknown:true,reason:error.message} }
}
