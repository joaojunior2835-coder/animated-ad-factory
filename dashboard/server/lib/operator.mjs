import { getDb, getBudgetSummary, getProductionRunExecution } from '../db/repository.mjs'
import * as pt from '../db/productTestRepository.mjs'
import { estimateComponentCost } from './rateCatalog.mjs'
import { localAssetPath } from './assembly.mjs'

export const METRICS = ['views', 'impressions', 'likes', 'comments', 'shares', 'saves', 'profile_visits', 'link_clicks', 'atcs', 'purchases', 'spend_minor', 'revenue_minor']
export const ANALYSIS_RULES = { minimumViews: 1000, minimumClicks: 20 }
const parse = (value, fallback = {}) => { try { return JSON.parse(value) ?? fallback } catch { return fallback } }

export function reviewQueue() {
  return getDb().prepare(`SELECT c.id AS creativeId,c.creative_code,c.iteration_id,
    COALESCE((SELECT CASE event_type WHEN 'regenerate_requested' THEN 'regenerating' ELSE event_type END FROM review_event WHERE production_run_id=pr.id AND event_type IN ('approved','rejected','regenerate_requested') ORDER BY id DESC LIMIT 1),'pending') AS approval_status,
    i.number AS iteration_number,pt.id AS product_test_id,pt.code AS product_test_code,p.name AS product_name,
    pr.id AS runId,pr.created_at,pr.spec_snapshot,a.relative_path,a.file_size,a.duration_seconds,
    (SELECT sum(base_currency_amount_minor) FROM cost WHERE production_run_id=pr.id) AS cost_minor,
    (SELECT note FROM review_event WHERE production_run_id=pr.id ORDER BY id DESC LIMIT 1) AS review_note
    FROM creative c JOIN iteration i ON i.id=c.iteration_id JOIN product_test pt ON pt.id=i.product_test_id
    JOIN product p ON p.id=pt.product_id JOIN production_run pr ON pr.id=(SELECT MAX(r.id) FROM production_run r WHERE r.creative_id=c.id AND r.status='complete' AND r.final_asset_id IS NOT NULL AND COALESCE(json_extract(r.spec_snapshot,'$.planning.productionNotes'),'') != 'creative_generator_scene')
    JOIN asset a ON a.id=pr.final_asset_id WHERE pr.status='complete' ORDER BY pr.created_at DESC,pr.id DESC`).all().map((row) => ({ ...row, planning: parse(row.spec_snapshot).planning || {}, spec_snapshot: undefined }))
}

export function reviewCreative({ creativeId, productionRunId, decision, note = '' }) {
  const events = { approved: 'approved', rejected: 'rejected', regenerating: 'regenerate_requested' }
  if (!events[decision]) throw new Error('Choose Approve, Reject, or Needs revision.')
  return getDb().transaction(() => {
    const run = getDb().prepare('SELECT * FROM production_run WHERE id=? AND creative_id=?').get(productionRunId, creativeId)
    if (!run || run.status !== 'complete' || !run.final_asset_id) throw new Error('Review requires a completed final video from this creative.')
    const asset = getDb().prepare('SELECT * FROM asset WHERE id=?').get(run.final_asset_id)
    localAssetPath(asset.relative_path)
    if (typeof note !== 'string' || note.length > 4000) throw new Error('Review note must be under 4000 characters.')
    const last = getDb().prepare('SELECT * FROM review_event WHERE creative_id=? ORDER BY id DESC LIMIT 1').get(creativeId)
    if (last?.production_run_id !== Number(productionRunId) || last.event_type !== events[decision] || last.note !== (note.trim() || null)) pt.addReviewEvent({ creativeId, productionRunId, eventType: events[decision], note: note.trim() || null })
    getDb().prepare("UPDATE creative SET active_production_run_id=?,approval_status=?,updated_at=datetime('now') WHERE id=?").run(productionRunId, decision, creativeId)
    return { creativeId, productionRunId, decision }
  }).immediate()
}

export function requirePublishable(creativeId, runId) {
  const c = getDb().prepare('SELECT * FROM creative WHERE id=?').get(creativeId)
  const run = getDb().prepare('SELECT * FROM production_run WHERE id=? AND creative_id=?').get(runId, creativeId)
  if (!c || c.approval_status !== 'approved' || c.active_production_run_id !== Number(runId) || run?.status !== 'complete' || !run.final_asset_id) throw new Error('Approve this completed final video before recording publication.')
  localAssetPath(getDb().prepare('SELECT relative_path FROM asset WHERE id=?').get(run.final_asset_id).relative_path)
}

export function savePublication(body) {
  if (!Number.isFinite(Date.parse(body.publishedAt))) throw new Error('Enter a valid publication time.')
  const normalized = { ...body, publishedAt: new Date(body.publishedAt).toISOString(), externalPostId: String(body.externalPostId || '').trim() || null, externalUrl: String(body.externalUrl || '').trim() || null }
  if (normalized.externalUrl && !['http:', 'https:'].includes(new URL(normalized.externalUrl).protocol)) throw new Error('Publication URL must use HTTP or HTTPS.')
  return getDb().transaction(() => {
    requirePublishable(Number(body.creativeId), Number(body.productionRunId))
    const account = getDb().prepare('SELECT platform FROM account WHERE id=?').get(body.accountId)
    if (!account || account.platform !== body.platform) throw new Error('Publication platform must match the selected account.')
    const rows = getDb().prepare('SELECT * FROM publication WHERE account_id=? AND platform=?').all(body.accountId, body.platform)
    const samePost = rows.find((r) => (normalized.externalPostId && r.external_post_id === normalized.externalPostId) || (normalized.externalUrl && r.external_url === normalized.externalUrl) || (!normalized.externalPostId && !normalized.externalUrl && !r.external_post_id && !r.external_url && r.production_run_id === Number(body.productionRunId) && Date.parse(r.published_at) === Date.parse(normalized.publishedAt)))
    if (samePost) {
      if (samePost.creative_id !== Number(body.creativeId) || samePost.production_run_id !== Number(body.productionRunId) || samePost.published_asset_id !== Number(body.publishedAssetId)) throw new Error('This post is already linked to another creative/run/Asset. It was not changed.')
      return samePost
    }
    return pt.createPublicationForCreative(normalized)
  }).immediate()
}

export function approveManualPlan({ creativeId, provider, clips }) {
  const creative = getDb().prepare('SELECT * FROM creative WHERE id=?').get(creativeId)
  if (!creative) throw new Error('Creative not found.')
  if (!['mock', 'fal'].includes(provider)) throw new Error('Choose Mock or fal.ai.')
  if (!Array.isArray(clips) || clips.length < 1 || clips.length > 12) throw new Error('Configure 1–12 video scenes.')
  let minor = 0
  const videoClips = clips.map((clip) => {
    if (typeof clip.prompt !== 'string' || !clip.prompt.trim()) throw new Error('Every scene needs a prompt.')
    const seconds = Number(clip.seconds)
    if (!Number.isInteger(seconds) || seconds < 4 || seconds > 15) throw new Error('Duration must be an integer from 4 to 15 seconds.')
    if (!['480p', '720p'].includes(clip.resolution)) throw new Error('Choose 480p or 720p.')
    if (typeof clip.generate_audio !== 'boolean') throw new Error('Choose whether to generate audio.')
    const priced = estimateComponentCost('video', provider === 'fal' ? `seedance-2.0-fast-${clip.resolution}` : 'mock', seconds)
    if (!priced.unknown) minor += priced.costMinor
    return { prompt: clip.prompt.trim(), purpose: 'video scene', seconds, resolution: clip.resolution, aspect_ratio: '9:16', generate_audio: clip.generate_audio, ...(clip.start_frame ? { start_frame: clip.start_frame } : {}) }
  })
  const [runId] = pt.approveProductionPlan({ plans: [{ creativeId, fineMethod: 'ai_generated_full', requiredAssets: [], plannedProvider: provider,
    plannedModel: provider === 'fal' ? 'seedance-2.0-fast' : 'mock-video', generationPlan: { imageGenerations: 0, videoClips, voiceRequired: false },
    estimatedCost: { minor, currency: provider === 'fal' ? 'USD' : 'EUR' }, coarseProductionMethod: 'factory_generated' }] })
  return { runId, iterationId: creative.iteration_id }
}

export function analyzeMetrics(raw = {}) {
  const number = (key) => typeof raw[key] === 'number' && Number.isFinite(raw[key]) && raw[key] >= 0 ? raw[key] : null
  const ratio = (a, b, scale = 1) => a === null || b === null || b === 0 ? null : a / b * scale
  const views = number('views'), impressions = number('impressions'), clicks = number('link_clicks'), purchases = number('purchases')
  const engagementParts = ['likes', 'comments', 'shares', 'saves'].map(number)
  const engagement = engagementParts.every((v) => v !== null) ? engagementParts.reduce((a, b) => a + b, 0) : null
  const enough = (impressions ?? views) !== null && (impressions ?? views) >= ANALYSIS_RULES.minimumViews
  const clickEnough = clicks !== null && clicks >= ANALYSIS_RULES.minimumClicks
  const distribution = (impressions ?? views) === null ? 'missing distribution data' : !enough ? 'insufficient distribution' : !clickEnough ? 'keep collecting click data' : 'sufficient for directional judgment'
  const availability = (a, b) => a === null || b === null ? 'missing data' : b === 0 ? 'not applicable (zero denominator)' : 'available'
  return { raw, engagementRate: ratio(engagement, views, 100), ctr: ratio(clicks, impressions, 100), conversionRate: ratio(purchases, clicks, 100),
    cpaMinor: ratio(number('spend_minor'), purchases), roas: ratio(number('revenue_minor'), number('spend_minor')), costPerViewMinor: ratio(number('spend_minor'), views),
    availability: { engagementRate: availability(engagement, views), ctr: availability(clicks, impressions), conversionRate: availability(purchases, clicks), cpaMinor: availability(number('spend_minor'), purchases), roas: availability(number('revenue_minor'), number('spend_minor')), costPerViewMinor: availability(number('spend_minor'), views) },
    distribution, recommendation: !enough ? distribution : !clickEnough || purchases === null ? 'keep collecting data' : purchases > 0 ? 'promising — purchases observed; compare the next iteration' : 'underperforming — no purchases after the click threshold', rules: ANALYSIS_RULES }
}

export function saveMetrics(publicationId, body) {
  if (!body.capturedAt || !Number.isFinite(Date.parse(body.capturedAt))) throw new Error('Enter a valid capture time.')
  const raw = body.rawMetrics || {}
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Metrics must be an object.')
  for (const [key, value] of Object.entries(raw)) if (!METRICS.includes(key) || typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new Error(`Invalid nonnegative metric: ${key}`)
  const exposure = body.qualifiedExposureValue
  if (exposure != null && (typeof exposure !== 'number' || !Number.isFinite(exposure) || exposure < 0)) throw new Error('Exposure must be nonnegative.')
  const capturedAt = new Date(body.capturedAt).toISOString()
  const canonical = (value) => JSON.stringify(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)))
  return getDb().transaction(() => {
    const latest = getDb().prepare('SELECT * FROM metric_snapshot WHERE publication_id=? AND captured_at=? ORDER BY id DESC LIMIT 1').get(publicationId, capturedAt)
    if (latest && canonical(parse(latest.raw_metrics)) === canonical(raw) && latest.source === body.source && latest.notes === (body.notes ?? null) && latest.qualified_exposure_metric_name === (body.qualifiedExposureMetricName ?? null) && latest.qualified_exposure_value === (exposure ?? null)) return latest
    return pt.addMetricSnapshot({ ...body, publicationId, capturedAt, rawMetrics: raw })
  }).immediate()
}

export function analysisSummary({ productTestId, iterationId, creativeId } = {}) {
  const rows = getDb().prepare(`SELECT pb.*,c.creative_code,c.iteration_id,i.product_test_id,ac.handle,
    (SELECT raw_metrics FROM metric_snapshot ms WHERE ms.publication_id=pb.id ORDER BY julianday(captured_at) DESC,id DESC LIMIT 1) AS metrics,
    (SELECT captured_at FROM metric_snapshot ms WHERE ms.publication_id=pb.id ORDER BY julianday(captured_at) DESC,id DESC LIMIT 1) AS captured_at
    FROM publication pb JOIN creative c ON c.id=pb.creative_id JOIN iteration i ON i.id=c.iteration_id JOIN account ac ON ac.id=pb.account_id
    WHERE (? IS NULL OR i.product_test_id=?) AND (? IS NULL OR c.iteration_id=?) AND (? IS NULL OR c.id=?)`).all(productTestId || null, productTestId || null, iterationId || null, iterationId || null, creativeId || null, creativeId || null)
  const publications = rows.map((row) => ({ ...row, analysis: analyzeMetrics(parse(row.metrics)) }))
  // Only aggregate a metric when every publication has it: missing != zero.
  const aggregate = (items) => {
    const raw = {}
    for (const key of METRICS) if (items.length && items.every((r) => typeof r.analysis.raw[key] === 'number')) raw[key] = items.reduce((sum, r) => sum + r.analysis.raw[key], 0)
    return analyzeMetrics(raw)
  }
  const groups = (key) => [...new Set(publications.map((p) => p[key]))].map((id) => ({ id, analysis: aggregate(publications.filter((p) => p[key] === id)) }))
  return { publications, total: aggregate(publications), productTests: groups('product_test_id'), iterations: groups('iteration_id'), creatives: groups('creative_id'), rules: ANALYSIS_RULES,
    basis: 'Latest cumulative snapshot per publication; never sum snapshots of the same post. Money metrics are EUR cents. Missing values remain missing.' }
}

export function runDetails(runId) {
  const run = getProductionRunExecution(runId)
  if (!run) throw new Error('Production run not found.')
  const attempts = getDb().prepare('SELECT a.* FROM job_execution_attempt a JOIN job j ON j.id=a.job_id WHERE j.production_run_id=?').all(runId)
  const reservations = getDb().prepare('SELECT * FROM budget_reservation WHERE production_run_id=?').all(runId)
  const costs = getDb().prepare('SELECT * FROM cost WHERE production_run_id=?').all(runId)
  const assets = getDb().prepare('SELECT a.*,al.job_id FROM asset a JOIN asset_link al ON al.asset_id=a.id JOIN job j ON j.id=al.job_id WHERE j.production_run_id=?').all(runId)
  const finalAsset = run.final_asset_id ? getDb().prepare('SELECT * FROM asset WHERE id=?').get(run.final_asset_id) : null
  const creative = getDb().prepare('SELECT iteration_id FROM creative WHERE id=?').get(run.creative_id)
  return { run, attempts, reservations, costs, assets, finalAsset, budget: getBudgetSummary(creative.iteration_id) }
}
