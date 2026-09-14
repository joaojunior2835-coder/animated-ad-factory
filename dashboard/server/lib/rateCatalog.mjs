// Provider/model rate catalog — the single source of truth for pricing a
// production plan. Every number here is either read directly from the real
// provider code (never re-derived or duplicated) or explicitly reported as
// unconfigured. Nothing in this file invents a price.

import { REPLICATE_VIDEO_MODELS, estimateVideoCost } from '../providers/replicateVideoProvider.mjs'
import { FAL_SEEDANCE_RATES_USD_PER_SECOND } from '../providers/falProvider.mjs'

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
      pollinations: {
        costPerImageMinor: null,
        currency: 'USD',
        configured: isConfigured('POLLINATIONS_API_KEY'),
      },
    },
    video: {
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
    return { unknown: false, costMinor: Math.round(qty * entry.costPerSecondMinor), currency: entry.currency }
  }
  return { unknown: true, reason: `unpriceable_capability:${capability}` }
}
