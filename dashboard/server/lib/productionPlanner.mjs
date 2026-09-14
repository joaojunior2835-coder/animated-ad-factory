// Production planning: AI proposes structure, deterministic code prices it.
//
// Nothing in this file writes to the database. generateProductionPlanDraft
// and priceProductionPlan are both pure with respect to persistence — the
// only place a plan is ever written is the approve-strategy-equivalent
// endpoint in Phase 3, and only after a human has reviewed and possibly
// edited the draft this module produces.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { runGroq } from '../providers/groqProvider.mjs'
import { getDb } from '../db/repository.mjs'
import { getCreativeWithLineage, getIterationWithLineage, listCreativesForIteration } from '../db/productTestRepository.mjs'
import { getConfiguredRates, estimateComponentCost } from './rateCatalog.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PLANNER_PROMPT = fs.readFileSync(
  path.resolve(__dirname, '..', 'prompts', 'organic-production-planner.md'),
  'utf8'
)

const isString = (v) => typeof v === 'string'
const isBool = (v) => typeof v === 'boolean'
const isNumber = (v) => typeof v === 'number' && Number.isFinite(v)
const isArrayOf = (v, pred) => Array.isArray(v) && v.every(pred)
const isStringArray = (v) => isArrayOf(v, isString)
const isNullOr = (v, pred) => v === null || v === undefined || pred(v)
const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

/**
 * Recursively reject any key that looks like a price/cost field, anywhere in
 * the object, regardless of whether its value is numeric or a string — a
 * model could just as easily write "estimatedCost": "$12" as a number, and
 * both are equally forbidden. Pricing is the deterministic backend's job.
 */
function findForbiddenPriceField(obj, pathSoFar = '') {
  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      const found = findForbiddenPriceField(obj[i], `${pathSoFar}[${i}]`)
      if (found) return found
    }
    return null
  }
  if (isPlainObject(obj)) {
    for (const [key, value] of Object.entries(obj)) {
      const keyPath = pathSoFar ? `${pathSoFar}.${key}` : key
      if (/cost|price|budget|(?:^|[^a-z])(?:usd|eur|dollar)(?:[^a-z]|$)/i.test(key)) return keyPath
      const found = findForbiddenPriceField(value, keyPath)
      if (found) return found
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// Known asset inventory — deterministic, no AI, purely descriptive.
// ---------------------------------------------------------------------------

/**
 * What's already linked for this Creative and its lineage: itself, any of
 * its own prior ProductionRuns, and the ProductTest/Product it belongs to.
 * Bucketed by mime type (video/image) and a keyword match on asset_link.role
 * for character references and product cutouts — a plain, deterministic
 * inference, never a judgment about quality or usability.
 *
 * Deliberately excludes is_shared_library=1 rows: the mission's lineage list
 * names creative -> production_run -> iteration -> product_test -> product
 * only. Whether shared-library assets should count as "known" for any
 * creative is a real product decision left open, not freelanced here.
 */
export function getKnownAssetInventory(creativeId) {
  const db = getDb()
  const lineage = db
    .prepare(
      `SELECT pt.id AS productTestId, pt.product_id AS productId
         FROM creative c
         JOIN iteration i ON i.id = c.iteration_id
         JOIN product_test pt ON pt.id = i.product_test_id
        WHERE c.id = ?`
    )
    .get(creativeId)

  if (!lineage) {
    throw new Error(`getKnownAssetInventory: no creative with id ${creativeId}`)
  }

  const rows = db
    .prepare(
      `SELECT a.id AS assetId, a.mime_type AS mimeType, al.role AS role
         FROM asset_link al
         JOIN asset a ON a.id = al.asset_id
        WHERE al.creative_id = ?
           OR al.production_run_id IN (SELECT id FROM production_run WHERE creative_id = ?)
           OR al.product_test_id = ?
           OR al.product_id = ?`
    )
    .all(creativeId, creativeId, lineage.productTestId, lineage.productId)

  let videoAssetCount = 0
  let imageAssetCount = 0
  let characterReferenceCount = 0
  let productCutoutCount = 0
  const otherByRole = new Map()

  for (const row of rows) {
    const mime = String(row.mimeType || '')
    const role = String(row.role || '')
    const isVideo = mime.startsWith('video/')
    const isImage = mime.startsWith('image/')
    const isCharacterRef = /character/i.test(role)
    const isCutout = /cutout/i.test(role)

    if (isVideo) videoAssetCount++
    if (isImage) imageAssetCount++
    if (isCharacterRef) characterReferenceCount++
    if (isCutout) productCutoutCount++
    if (!isCharacterRef && !isCutout) {
      otherByRole.set(role, (otherByRole.get(role) || 0) + 1)
    }
  }

  return {
    videoAssetCount,
    imageAssetCount,
    characterReferenceCount,
    productCutoutCount,
    other: [...otherByRole.entries()].map(([role, count]) => ({ role, count })),
  }
}

// ---------------------------------------------------------------------------
// Draft validation
// ---------------------------------------------------------------------------

function isVideoClip(c) {
  return isPlainObject(c) && isNumber(c.seconds) && c.seconds > 0 && isString(c.purpose)
}

export function validateProductionPlanDraft(obj) {
  const errors = []
  const req = (cond, msg) => {
    if (!cond) errors.push(msg)
  }

  if (!isPlainObject(obj)) return { valid: false, errors: ['root value is not an object'] }

  req(isString(obj.fineMethod) && obj.fineMethod.trim().length > 0, 'fineMethod must be a non-empty string')
  req(isString(obj.rationale), 'rationale must be a string')
  req(isStringArray(obj.requiredAssets), 'requiredAssets must be a string[]')
  req(isStringArray(obj.missingAssets), 'missingAssets must be a string[]')

  const gp = obj.generationPlan
  req(isPlainObject(gp), 'generationPlan must be an object')
  if (isPlainObject(gp)) {
    req(isNumber(gp.imageGenerations) && gp.imageGenerations >= 0, 'generationPlan.imageGenerations must be a non-negative number')
    req(isArrayOf(gp.videoClips, isVideoClip), 'generationPlan.videoClips must be an array of {seconds, purpose}')
    req(isBool(gp.voiceRequired), 'generationPlan.voiceRequired must be a boolean')
    req(isBool(gp.characterConsistencyNeeded), 'generationPlan.characterConsistencyNeeded must be a boolean')
  }

  req(isNullOr(obj.fallbackMethod, isString), 'fallbackMethod must be a string or null')
  req(isNullOr(obj.fallbackRationale, isString), 'fallbackRationale must be a string or null')

  const forbidden = findForbiddenPriceField(obj)
  if (forbidden) errors.push(`forbidden price/cost field found at "${forbidden}" — pricing is computed deterministically, never proposed by the model`)

  return errors.length ? { valid: false, errors } : { valid: true }
}

// ---------------------------------------------------------------------------
// Prompt building + generation (AI proposes structure only)
// ---------------------------------------------------------------------------

export function buildProductionPlanPrompt({ creative, knownInventory, availabilityDeclarations }) {
  const lines = []
  lines.push(PLANNER_PROMPT)
  lines.push('\n---\n')
  lines.push('Creative:')
  lines.push(`- Angle: ${creative.angle || '(unset)'}`)
  lines.push(`- Format: ${creative.format || '(unset)'}`)
  lines.push(`- Hook text: ${creative.hook_text || '(unset)'}`)
  lines.push(`- Concept summary: ${creative.concept_summary || '(unset)'}`)
  lines.push('\nknownAssetInventory (deterministic, already linked, descriptive only):')
  lines.push(JSON.stringify(knownInventory, null, 2))
  lines.push('\navailabilityDeclarations (the human\'s own statement of what they currently have):')
  lines.push(JSON.stringify(availabilityDeclarations || {}, null, 2))
  return lines.join('\n')
}

const RETRY_REMINDER =
  '\n\nIMPORTANT: Your previous response did not match the required JSON shape exactly, ' +
  'or contained a forbidden price/cost field. Return ONLY the exact JSON object described above — ' +
  'no prose, no markdown code fences, every field present with the correct type, and absolutely ' +
  'no price, cost, or currency amount anywhere in the response.'

/**
 * Generate a structural production plan draft for one Creative. Nothing is
 * written to the database — this is read (Creative + inventory) and one
 * Groq call.
 */
export async function generateProductionPlanDraft(creativeId, availabilityDeclarations = {}) {
  const creative = getCreativeWithLineage(creativeId)
  if (!creative) throw new Error(`generateProductionPlanDraft: no creative with id ${creativeId}`)
  const knownInventory = getKnownAssetInventory(creativeId)

  const prompt = buildProductionPlanPrompt({ creative, knownInventory, availabilityDeclarations })

  const attempt = async (promptText) => {
    const result = await runGroq({ action_type: 'generate_json', input_prompt: promptText, context: '' })
    if (!result.success) return { ok: false, error: result.error || 'Groq request failed.' }
    if (result.parsed_json === undefined) {
      return { ok: false, error: result.parse_error ? `Model output was not valid JSON: ${result.parse_error}` : 'Model output was not valid JSON.' }
    }
    const validation = validateProductionPlanDraft(result.parsed_json)
    if (!validation.valid) return { ok: false, error: 'shape_invalid', errors: validation.errors }
    return { ok: true, draft: result.parsed_json }
  }

  const first = await attempt(prompt)
  if (first.ok) return { ok: true, draft: first.draft, knownInventory, creative }
  if (first.error !== 'shape_invalid') return { ok: false, error: first.error }

  const second = await attempt(prompt + RETRY_REMINDER)
  if (second.ok) return { ok: true, draft: second.draft, knownInventory, creative }
  if (second.error === 'shape_invalid') {
    return { ok: false, error: `Model did not return a valid plan after one retry: ${second.errors.join('; ')}` }
  }
  return { ok: false, error: second.error }
}

// ---------------------------------------------------------------------------
// Deterministic validation against inventory + pricing from the rate catalog
// ---------------------------------------------------------------------------

/**
 * Cross-check the AI's requiredAssets/missingAssets claim against what
 * inventory and availability declarations actually show. The AI's own
 * missingAssets list is informational; this is the actual gate.
 */
function computeMissingAssetFlag(draft, availabilityDeclarations, knownInventory) {
  const method = String(draft.fineMethod || '').toLowerCase()
  const avail = availabilityDeclarations || {}

  // Only the two methods with a real, checkable asset dependency are gated
  // here — everything else (ai_generated_full, talking_head_ai, etc.) has no
  // hard external-asset precondition this deterministic check can verify.
  if (/existing_supplier_footage|supplier.*footage/.test(method)) {
    const hasFootage = knownInventory.videoAssetCount > 0 || avail.usableSupplierFootage === 'yes'
    if (!hasFootage) return true
  }
  if (/original_footage/.test(method)) {
    if (avail.canFilmOriginalFootage !== true) return true
  }
  if (/talking_head/.test(method)) {
    const hasReference = avail.talkingHeadReferenceAvailable === true || knownInventory.characterReferenceCount > 0
    if (!hasReference && avail.talkingHeadReferenceAvailable === false) return true
  }
  return false
}

/**
 * Price a validated draft's generationPlan from the Phase 1 rate catalog.
 * Pure and deterministic — no AI call.
 */
export function priceProductionPlan(draft, availabilityDeclarations, knownInventory) {
  const gp = draft.generationPlan || {}
  const componentBreakdown = []
  const unknownCostComponents = []

  // Images: Pollinations is the only configured image provider.
  if (gp.imageGenerations > 0) {
    const priced = estimateComponentCost('image', 'pollinations', gp.imageGenerations)
    componentBreakdown.push({ component: 'images', quantity: gp.imageGenerations, provider: 'pollinations', ...priced })
    if (priced.unknown) unknownCostComponents.push({ component: 'images', reason: priced.reason })
  }

  // Video: when no model is pre-selected, price BOTH configured options.
  // The higher-cost viable one is the headline "Recommended" estimate; the
  // cheaper one is the "Cheap fallback" — never the reverse, so a plan is
  // never shown as cheaper than it will actually cost if the better model
  // is used.
  let recommendedVideoMinor = 0
  let cheapFallbackVideoMinor = 0
  let recommendedVideoUnknown = false
  let cheapFallbackVideoUnknown = false
  const recommendedModel = 'wan-720p' // higher cost of the two configured video options
  const cheapModel = 'ltx' // lower cost of the two configured video options

  for (let clipIndex = 0; clipIndex < (gp.videoClips || []).length; clipIndex++) {
    const clip = gp.videoClips[clipIndex]
    const recommended = estimateComponentCost('video', recommendedModel, clip.seconds)
    const cheap = estimateComponentCost('video', cheapModel, clip.seconds)
    const seedance480 = estimateComponentCost('video', 'seedance-2.0-fast-480p', clip.seconds || 5)
    const seedance720 = estimateComponentCost('video', 'seedance-2.0-fast-720p', clip.seconds || 5)
    componentBreakdown.push({ component: 'video', clipIndex, purpose: clip.purpose, seconds: clip.seconds, provider: recommendedModel, role: 'recommended', ...recommended })
    componentBreakdown.push({ component: 'video', clipIndex, purpose: clip.purpose, seconds: clip.seconds, provider: cheapModel, role: 'cheap_fallback', ...cheap })
    componentBreakdown.push({ component: 'video', clipIndex, purpose: clip.purpose, seconds: clip.seconds || 5, provider: 'fal', model: 'seedance-2.0-fast', resolution: '480p', role: 'seedance_480p', ...seedance480 })
    componentBreakdown.push({ component: 'video', clipIndex, purpose: clip.purpose, seconds: clip.seconds || 5, provider: 'fal', model: 'seedance-2.0-fast', resolution: '720p', role: 'seedance_720p', ...seedance720 })
    if (recommended.unknown) {
      recommendedVideoUnknown = true
      unknownCostComponents.push({ component: `video:${clip.purpose}`, provider: recommendedModel, reason: recommended.reason })
    } else {
      recommendedVideoMinor += recommended.costMinor
    }
    if (cheap.unknown) {
      cheapFallbackVideoUnknown = true
      unknownCostComponents.push({ component: `video:${clip.purpose}`, provider: cheapModel, reason: cheap.reason })
    } else {
      cheapFallbackVideoMinor += cheap.costMinor
    }
  }

  // Voice: no provider is configured anywhere in this app — always unknown
  // when required.
  if (gp.voiceRequired) {
    const priced = estimateComponentCost('voice', 'default', 1)
    componentBreakdown.push({ component: 'voice', ...priced })
    unknownCostComponents.push({ component: 'voice', reason: priced.reason })
  }

  const imageMinor = componentBreakdown.find((c) => c.component === 'images' && !c.unknown)?.costMinor || 0
  const anyUnknown = unknownCostComponents.length > 0

  const recommendedCostMinor = imageMinor + recommendedVideoMinor
  const cheapFallbackCostMinor = imageMinor + cheapFallbackVideoMinor

  const missingAssetFlag = computeMissingAssetFlag(draft, availabilityDeclarations, knownInventory)
  // Matches the app's established idiom (see computeContributionMargin's
  // ECONOMICS_WARNING/ECONOMICS_HIGH_RISK/NEGATIVE_MARGIN) — a named flags
  // array, not a bare boolean, so the API/UI layer has one consistent shape
  // to check across both milestones.
  const flags = missingAssetFlag ? ['MISSING_REQUIRED_ASSET'] : []

  return {
    draft,
    flags,
    missingAssetFlag,
    fallbackMethod: missingAssetFlag ? draft.fallbackMethod || null : null,
    fallbackRationale: missingAssetFlag ? draft.fallbackRationale || null : null,
    recommendedCost: { minor: recommendedCostMinor, currency: 'USD', unknown: anyUnknown },
    cheapFallbackCost: gp.videoClips && gp.videoClips.length ? { minor: cheapFallbackCostMinor, currency: 'USD', unknown: cheapFallbackVideoUnknown || (imageMinor === 0 && componentBreakdown.some((c) => c.component === 'images' && c.unknown)) } : null,
    unknownCostComponents,
    componentBreakdown,
  }
}

// ---------------------------------------------------------------------------
// Batch planning across every Creative in an Iteration. Nothing written to
// the database — this only generates and prices drafts.
// ---------------------------------------------------------------------------

function classifyBudgetStatus(totalMinor, budgetTargetMinor, budgetCeilingMinor) {
  if (typeof budgetCeilingMinor === 'number' && totalMinor > budgetCeilingMinor) return 'ABOVE_CEILING'
  if (typeof budgetTargetMinor === 'number' && totalMinor > budgetTargetMinor) return 'ABOVE_TARGET_BELOW_CEILING'
  return 'WITHIN_TARGET'
}

/**
 * Generate + price a plan for every Creative in an Iteration. One Groq call
 * per Creative; a failure on one Creative is recorded against it and does
 * not stop the rest of the batch (this is a read-only preview — there is
 * nothing to roll back).
 *
 * Budget comparison uses the Iteration's own execution_policy_snapshot —
 * the already-locked source of truth — never a new budget field. See
 * rateCatalog.mjs's currency note: this compares a USD cost estimate against
 * a EUR-denominated ceiling at face value, an explicitly-flagged
 * simplification for this milestone.
 */
export async function generateBatchProductionPlan(iterationId, availabilityByCreativeId = {}) {
  const iteration = getIterationWithLineage(iterationId)
  if (!iteration) throw new Error(`generateBatchProductionPlan: no iteration with id ${iterationId}`)
  const creatives = listCreativesForIteration(iterationId)

  const plans = []
  for (const creative of creatives) {
    const availability = availabilityByCreativeId[creative.id] || availabilityByCreativeId[String(creative.id)] || {}
    const generated = await generateProductionPlanDraft(creative.id, availability)
    if (!generated.ok) {
      plans.push({ creativeId: creative.id, creativeCode: creative.creative_code, ok: false, error: generated.error })
      continue
    }
    const priced = priceProductionPlan(generated.draft, availability, generated.knownInventory)
    plans.push({ creativeId: creative.id, creativeCode: creative.creative_code, ok: true, ...priced })
  }

  const policy = iteration.executionPolicy || {}
  const budgetTargetMinor = typeof policy.budgetTargetMinor === 'number' ? policy.budgetTargetMinor : null
  const budgetCeilingMinor = typeof policy.budgetCeilingMinor === 'number' ? policy.budgetCeilingMinor : null

  let totalRecommendedMinor = 0
  let anyUnknown = false
  const methodCounts = {}
  for (const p of plans) {
    if (!p.ok) continue
    if (p.recommendedCost.unknown) anyUnknown = true
    totalRecommendedMinor += p.recommendedCost.minor
    const method = p.draft && p.draft.fineMethod
    if (method) methodCounts[method] = (methodCounts[method] || 0) + 1
  }

  const status = classifyBudgetStatus(totalRecommendedMinor, budgetTargetMinor, budgetCeilingMinor)

  return {
    plans,
    batchSummary: {
      totalRecommendedCost: { minor: totalRecommendedMinor, currency: 'USD', unknown: anyUnknown },
      methodCounts,
      budgetTargetMinor,
      budgetCeilingMinor,
      budgetCurrency: policy.currency || null,
      currencyNote:
        'totalRecommendedCost is in USD (Replicate\'s real billing currency); budgetTargetMinor/budgetCeilingMinor are in the Iteration policy\'s own currency (typically EUR). Compared at face value for this milestone — no fx conversion is wired for planning-stage estimates.',
      status,
    },
  }
}
