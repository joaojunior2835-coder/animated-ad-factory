// Provider/model rate catalog — the single source of truth for pricing a
// production plan. Every number here is either read directly from the real
// provider code (never re-derived or duplicated) or explicitly reported as
// unconfigured. Nothing in this file invents a price.

import { REPLICATE_VIDEO_MODELS, estimateVideoCost } from '../providers/replicateVideoProvider.mjs'

const isConfigured = (envName) => Boolean(process.env[envName] && String(process.env[envName]).trim())

/**
 * Every capability this system can currently execute, with its real
 * configured rate (or an explicit absence of one).
 *
 * Currency note: Replicate bills in USD; costPerSecondMinor here is USD
 * cents, tagged with currency: 'USD'. Pollinations and mock are both $0, so
 * their currency is irrelevant (tagged 'ANY'). Nothing downstream converts
 * USD to a ProductTest's own currency (typically EUR) — there is no fx-rate
 * source wired for planning-stage estimates, unlike the Cost ledger's
 * fx_rate columns, which exist for real settled spend. priceProductionPlan
 * compares the USD estimate against the EUR-denominated policy ceiling at
 * face value (1 minor unit ~ 1 minor unit) as a clearly-flagged
 * simplification for THIS milestone, not a real exchange rate. Worth a real
 * decision once cross-currency planning actually matters.
 */
export function getConfiguredRates() {
  // Video rates come straight from estimateVideoCost(1, key) — the SAME
  // function Replicate's own dispatch path uses to quote a price — never a
  // hand-copied constant, so a future change to REPLICATE_VIDEO_MODELS is
  // reflected here automatically.
  const ltxPerSecond = estimateVideoCost(1, 'ltx')
  const wanPerSecond = estimateVideoCost(1, 'wan-720p')

  return {
    image: {
      pollinations: {
        costPerImageMinor: 0,
        currency: 'ANY',
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
    return { unknown: false, costMinor: Math.round(qty * entry.costPerImageMinor), currency: entry.currency }
  }
  if (capability === 'video') {
    return { unknown: false, costMinor: Math.round(qty * entry.costPerSecondMinor), currency: entry.currency }
  }
  return { unknown: true, reason: `unpriceable_capability:${capability}` }
}
