// Product Test lineage: Product → ProductTest → Iteration → Creative →
// ProductionRun → Publication → MetricSnapshot.
//
// This is the MANUAL foundation. Nothing here generates angles, hooks or
// verdicts; a human enters the facts and this layer records them against the
// M0 schema so the lineage and budget machinery gets exercised for real before
// any intelligence is built on top.
//
// It builds on repository.mjs rather than duplicating it — the creators there
// (createProduct, createProductTest, createIteration, …) stay the only place
// those inserts are written.

import { getDb, createProduct, createProductTest, createIteration, createCreative, createProductionRun, createAccount } from './repository.mjs'

const NOW = "datetime('now')"

function requireRow(row, message) {
  if (!row) throw new Error(message)
  return row
}

const parseJson = (text, fallback = null) => {
  try {
    return JSON.parse(text)
  } catch {
    return fallback
  }
}

// ---------------------------------------------------------------------------
// Policy defaults — data, not schema. One app_settings row.
// ---------------------------------------------------------------------------

export const DEFAULT_TEST_POLICY_KEY = 'default_test_policy'

export const DEFAULT_TEST_POLICY = {
  minContributionMarginMinor: 1500,
  minContributionMarginPercent: 40,
  budgetTargetMinor: 1000,
  budgetCeilingMinor: 2000,
  currency: 'EUR',
  sufficiency: {
    tiktok_standard: 1000,
    instagram_reel: 1000,
    instagram_trial_reel: 1000,
    youtube_short: 1000,
  },
  iterationSufficiencyFraction: {
    exploratory: 0.5,
    confirmatory: 0.67,
  },
  observationWindowHours: 72,
  matureSnapshotHours: 168,
  killPolicyVersion: 'v1',
}

/**
 * Write the default policy once. INSERT OR IGNORE, so a policy the user has
 * since edited is never silently reset by a server restart.
 */
export function seedDefaultTestPolicy() {
  const changes = getDb()
    .prepare(`INSERT OR IGNORE INTO app_settings (key, value, updated_at) VALUES (?, ?, ${NOW})`)
    .run(DEFAULT_TEST_POLICY_KEY, JSON.stringify(DEFAULT_TEST_POLICY)).changes
  return { seeded: changes > 0 }
}

export function getDefaultTestPolicy() {
  const row = getDb().prepare('SELECT value FROM app_settings WHERE key = ?').get(DEFAULT_TEST_POLICY_KEY)
  if (!row) return { ...DEFAULT_TEST_POLICY }
  return parseJson(row.value, { ...DEFAULT_TEST_POLICY })
}

// ---------------------------------------------------------------------------
// Product
// ---------------------------------------------------------------------------

export function listProducts() {
  return getDb().prepare('SELECT * FROM product ORDER BY created_at DESC, id DESC').all()
}

export function getProduct(id) {
  return getDb().prepare('SELECT * FROM product WHERE id = ?').get(id) || null
}

const PRODUCT_FIELDS = { name: 'name', supplierUrl: 'supplier_url', productUrl: 'product_url', notes: 'notes' }

export function updateProduct(id, fields = {}) {
  const sets = []
  const values = []
  for (const [key, column] of Object.entries(PRODUCT_FIELDS)) {
    if (fields[key] !== undefined) {
      sets.push(`${column} = ?`)
      values.push(fields[key])
    }
  }
  if (!sets.length) return getProduct(id)
  getDb()
    .prepare(`UPDATE product SET ${sets.join(', ')}, updated_at = ${NOW} WHERE id = ?`)
    .run(...values, id)
  return getProduct(id)
}

// ---------------------------------------------------------------------------
// ProductTest
// ---------------------------------------------------------------------------

/** PT001, PT002, … Single-user local app; a sequence table would be overkill. */
export function generateProductTestCode() {
  const n = getDb().prepare('SELECT COUNT(*) AS n FROM product_test').get().n
  return `PT${String(n + 1).padStart(3, '0')}`
}

/**
 * Create a ProductTest with its policy FROZEN at creation.
 *
 * The snapshot is deliberately a copy, never a live reference: a test that ran
 * under a €20 ceiling must still read as having run under a €20 ceiling after
 * someone edits the defaults next month, or every past result becomes
 * uninterpretable.
 */
export function createProductTestForProduct({
  productId,
  market,
  language,
  sellingPriceMinor = null,
  productCostMinor = null,
  shippingCostMinor = null,
  currency = 'EUR',
  expectedShippingDays = null,
}) {
  const code = generateProductTestCode()
  const policy = getDefaultTestPolicy()
  const id = createProductTest({
    productId,
    code,
    market,
    language,
    sellingPriceMinor,
    productCostMinor,
    shippingCostMinor,
    currency,
    expectedShippingDays,
    policySnapshot: policy,
  })
  return getProductTestWithLineage(id)
}

/**
 * Contribution margin. Pure — no database, no policy lookup side effects.
 *
 * Flags are informational only and never block anything: they influence the
 * decision, they do not make it.
 */
export function computeContributionMargin({
  sellingPriceMinor = 0,
  productCostMinor = 0,
  shippingCostMinor = 0,
  paymentFeeEstimateMinor = 0,
  policy = null,
}) {
  const p = policy || DEFAULT_TEST_POLICY
  const selling = Number(sellingPriceMinor) || 0
  const marginMinor =
    selling - (Number(productCostMinor) || 0) - (Number(shippingCostMinor) || 0) - (Number(paymentFeeEstimateMinor) || 0)
  const marginPercent = selling > 0 ? (marginMinor / selling) * 100 : null

  const belowMinor = marginMinor < p.minContributionMarginMinor
  const belowPercent = marginPercent !== null && marginPercent < p.minContributionMarginPercent

  const flags = []
  if (belowMinor && belowPercent) flags.push('ECONOMICS_HIGH_RISK')
  else if (belowMinor || belowPercent) flags.push('ECONOMICS_WARNING')
  if (marginMinor < 0) flags.push('NEGATIVE_MARGIN')

  return {
    marginMinor,
    marginPercent,
    flags,
    thresholds: {
      minContributionMarginMinor: p.minContributionMarginMinor,
      minContributionMarginPercent: p.minContributionMarginPercent,
    },
  }
}

export function listProductTests() {
  return getDb()
    .prepare(
      `SELECT pt.*, p.name AS product_name,
              (SELECT COUNT(*) FROM iteration i WHERE i.product_test_id = pt.id) AS iteration_count,
              (SELECT COUNT(*) FROM creative c
                 JOIN iteration i2 ON i2.id = c.iteration_id
                WHERE i2.product_test_id = pt.id) AS creative_count
         FROM product_test pt
         JOIN product p ON p.id = pt.product_id
        ORDER BY pt.id DESC`
    )
    .all()
    .map((r) => ({ ...r, policy: parseJson(r.policy_snapshot, {}) }))
}

export function getProductTestWithLineage(id) {
  const row = getDb()
    .prepare(
      `SELECT pt.*, p.name AS product_name, p.product_url, p.supplier_url, p.notes AS product_notes,
              (SELECT COUNT(*) FROM iteration i WHERE i.product_test_id = pt.id) AS iteration_count,
              (SELECT COUNT(*) FROM creative c
                 JOIN iteration i2 ON i2.id = c.iteration_id
                WHERE i2.product_test_id = pt.id) AS creative_count
         FROM product_test pt
         JOIN product p ON p.id = pt.product_id
        WHERE pt.id = ?`
    )
    .get(id)
  if (!row) return null
  return { ...row, policy: parseJson(row.policy_snapshot, {}) }
}

export function updateProductTestStatus(id, status) {
  const changes = getDb()
    .prepare(`UPDATE product_test SET status = ?, updated_at = ${NOW} WHERE id = ?`)
    .run(status, id).changes
  if (!changes) return null
  return getProductTestWithLineage(id)
}

// ---------------------------------------------------------------------------
// Iteration
// ---------------------------------------------------------------------------

export function listIterationsForTest(productTestId) {
  return getDb()
    .prepare(
      `SELECT i.*, (SELECT COUNT(*) FROM creative c WHERE c.iteration_id = i.id) AS creative_count
         FROM iteration i WHERE i.product_test_id = ? ORDER BY i.number ASC`
    )
    .all(productTestId)
    .map((r) => ({
      ...r,
      strategy: parseJson(r.strategy_snapshot, {}),
      executionPolicy: parseJson(r.execution_policy_snapshot, {}),
    }))
}

export function getIterationWithLineage(id) {
  const row = getDb()
    .prepare(
      `SELECT i.*, pt.code AS product_test_code, pt.market, pt.language, p.name AS product_name,
              (SELECT COUNT(*) FROM creative c WHERE c.iteration_id = i.id) AS creative_count
         FROM iteration i
         JOIN product_test pt ON pt.id = i.product_test_id
         JOIN product p ON p.id = pt.product_id
        WHERE i.id = ?`
    )
    .get(id)
  if (!row) return null
  return {
    ...row,
    strategy: parseJson(row.strategy_snapshot, {}),
    executionPolicy: parseJson(row.execution_policy_snapshot, {}),
  }
}

/** Shallow merge: an iteration-level override replaces a top-level policy key. */
export function buildExecutionPolicySnapshot(productTestPolicySnapshot, overrides = {}) {
  const base =
    typeof productTestPolicySnapshot === 'string'
      ? parseJson(productTestPolicySnapshot, {})
      : productTestPolicySnapshot || {}
  return { ...base, ...(overrides || {}) }
}

export function createIterationForTest({ productTestId, mode, strategySnapshot = {}, policyOverrides = {} }) {
  const db = getDb()
  return db
    .transaction(() => {
      const test = requireRow(
        db.prepare('SELECT id, policy_snapshot, current_iteration_id FROM product_test WHERE id = ?').get(productTestId),
        `createIterationForTest: no product_test with id ${productTestId}`
      )
      const maxRow = db.prepare('SELECT MAX(number) AS maxNumber FROM iteration WHERE product_test_id = ?').get(productTestId)
      const number = (maxRow && maxRow.maxNumber ? Number(maxRow.maxNumber) : 0) + 1

      const executionPolicySnapshot = buildExecutionPolicySnapshot(test.policy_snapshot, policyOverrides)
      const iterationId = createIteration({
        productTestId,
        number,
        mode,
        strategySnapshot,
        executionPolicySnapshot,
      })

      // The composite FK only accepts an iteration that belongs to this test —
      // true by construction here.
      if (test.current_iteration_id === null) {
        db.prepare(`UPDATE product_test SET current_iteration_id = ?, updated_at = ${NOW} WHERE id = ?`).run(
          iterationId,
          productTestId
        )
      }
      return iterationId
    })
    .immediate()
}

// ---------------------------------------------------------------------------
// Creative
// ---------------------------------------------------------------------------

export function listCreativesForIteration(iterationId) {
  return getDb()
    .prepare(
      `SELECT c.*,
              (SELECT COUNT(*) FROM production_run pr WHERE pr.creative_id = c.id) AS production_run_count,
              (SELECT COUNT(*) FROM publication pb WHERE pb.creative_id = c.id) AS publication_count
         FROM creative c WHERE c.iteration_id = ? ORDER BY c.id ASC`
    )
    .all(iterationId)
}

export function getCreativeWithLineage(id) {
  const row = getDb()
    .prepare(
      `SELECT c.*, i.number AS iteration_number, i.mode AS iteration_mode,
              pt.id AS product_test_id, pt.code AS product_test_code, pt.market, pt.language,
              p.name AS product_name,
              ms.name AS marketing_studio_session_name,
              nc.name AS node_canvas_project_name
         FROM creative c
         JOIN iteration i ON i.id = c.iteration_id
         JOIN product_test pt ON pt.id = i.product_test_id
         JOIN product p ON p.id = pt.product_id
         LEFT JOIN marketing_studio_session ms ON ms.id = c.marketing_studio_session_id
         LEFT JOIN node_canvas_project nc ON nc.id = c.node_canvas_project_id
        WHERE c.id = ?`
    )
    .get(id)
  return row || null
}

/** PT001-I01-C01 */
export function generateCreativeCode(productTestCode, iterationNumber, iterationId) {
  const n = getDb().prepare('SELECT COUNT(*) AS n FROM creative WHERE iteration_id = ?').get(iterationId).n
  return `${productTestCode}-I${String(iterationNumber).padStart(2, '0')}-C${String(n + 1).padStart(2, '0')}`
}

/**
 * The code is derived from the iteration's own lineage, never from a
 * caller-supplied code — the same "trust the id, derive the rest" rule the
 * budget functions follow.
 */
export function createCreativeForIteration({
  iterationId,
  angle,
  format,
  hookFamily = null,
  hookText = null,
  conceptSummary = null,
  defaultProductionMethod,
  marketingStudioSessionId = null,
  nodeCanvasProjectId = null,
}) {
  const db = getDb()
  return db
    .transaction(() => {
      const lineage = requireRow(
        db
          .prepare(
            `SELECT i.number AS iterationNumber, pt.code AS productTestCode
               FROM iteration i JOIN product_test pt ON pt.id = i.product_test_id
              WHERE i.id = ?`
          )
          .get(iterationId),
        `createCreativeForIteration: no iteration with id ${iterationId}`
      )
      const creativeCode = generateCreativeCode(lineage.productTestCode, lineage.iterationNumber, iterationId)
      return createCreative({
        iterationId,
        creativeCode,
        angle,
        format,
        hookFamily,
        hookText,
        conceptSummary,
        defaultProductionMethod,
        marketingStudioSessionId,
        nodeCanvasProjectId,
      })
    })
    .immediate()
}

// ---------------------------------------------------------------------------
// ProductionRun
// ---------------------------------------------------------------------------

/**
 * A Creative's first ProductionRun becomes its active_production_run_id.
 * This column has existed since M0 but nothing ever set it (confirmed by a
 * repo-wide search before this fix) — a real, small pre-existing gap, safe
 * to close here since no code anywhere reads it yet. The composite FK
 * (active_production_run_id, id) REFERENCES production_run(id, creative_id)
 * only accepts a run that belongs to this same creative, which is true by
 * construction immediately after creating it.
 */
export function createProductionRunForCreative({ creativeId, productionMethod }) {
  const db = getDb()
  return db
    .transaction(() => {
      const creative = requireRow(
        db.prepare('SELECT active_production_run_id FROM creative WHERE id = ?').get(creativeId),
        `createProductionRunForCreative: no creative with id ${creativeId}`
      )
      const maxRow = db
        .prepare('SELECT MAX(attempt_number) AS maxAttempt FROM production_run WHERE creative_id = ?')
        .get(creativeId)
      const attemptNumber = (maxRow && maxRow.maxAttempt ? Number(maxRow.maxAttempt) : 0) + 1
      const runId = createProductionRun({ creativeId, attemptNumber, productionMethod })

      if (creative.active_production_run_id === null) {
        db.prepare(`UPDATE creative SET active_production_run_id = ?, updated_at = ${NOW} WHERE id = ?`).run(runId, creativeId)
      }
      return runId
    })
    .immediate()
}

export function listProductionRunsForCreative(creativeId) {
  return getDb()
    .prepare(
      `SELECT pr.*, a.relative_path AS final_asset_path, a.mime_type AS final_asset_mime
         FROM production_run pr
         LEFT JOIN asset a ON a.id = pr.final_asset_id
        WHERE pr.creative_id = ? ORDER BY pr.attempt_number ASC`
    )
    .all(creativeId)
}

export function getProductionRunWithLineage(id) {
  const row = getDb()
    .prepare(
      `SELECT pr.*, c.creative_code, c.angle, c.format, i.number AS iteration_number,
              pt.code AS product_test_code, a.relative_path AS final_asset_path
         FROM production_run pr
         JOIN creative c ON c.id = pr.creative_id
         JOIN iteration i ON i.id = c.iteration_id
         JOIN product_test pt ON pt.id = i.product_test_id
         LEFT JOIN asset a ON a.id = pr.final_asset_id
        WHERE pr.id = ?`
    )
    .get(id)
  return row || null
}

// ---------------------------------------------------------------------------
// Account / Publication / MetricSnapshot / ReviewEvent
// ---------------------------------------------------------------------------

export function listAccounts() {
  return getDb().prepare('SELECT * FROM account ORDER BY platform, handle').all()
}

export function createAccountIfNotExists({ platform, handle, market = null, language = null }) {
  const db = getDb()
  return db
    .transaction(() => {
      const existing = db.prepare('SELECT * FROM account WHERE platform = ? AND handle = ?').get(platform, handle)
      if (existing) return { ...existing, created: false }
      const id = createAccount({ platform, handle, market, language })
      return { ...db.prepare('SELECT * FROM account WHERE id = ?').get(id), created: true }
    })
    .immediate()
}

/**
 * Record a publication.
 *
 * The database already guarantees the hard part through composite foreign
 * keys: the run must belong to this creative, and the asset must be that run's
 * currently-selected final asset. That produces a bare "FOREIGN KEY constraint
 * failed", which tells a user nothing — so the likely causes are diagnosed here
 * and reported in words.
 */
export function createPublicationForCreative({
  creativeId,
  productionRunId,
  publishedAssetId,
  accountId,
  platform,
  surfaceType,
  externalPostId = null,
  externalUrl = null,
  publishedAt,
  platformMeta = null,
}) {
  const db = getDb()
  try {
    const id = db
      .prepare(
        `INSERT INTO publication
           (creative_id, production_run_id, published_asset_id, account_id, platform,
            surface_type, external_post_id, external_url, published_at, platform_meta)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        creativeId,
        productionRunId,
        publishedAssetId,
        accountId,
        platform,
        surfaceType,
        externalPostId,
        externalUrl,
        publishedAt,
        platformMeta === null || platformMeta === undefined ? null : JSON.stringify(platformMeta)
      ).lastInsertRowid
    return db.prepare('SELECT * FROM publication WHERE id = ?').get(id)
  } catch (e) {
    if (!/FOREIGN KEY constraint failed/i.test(e.message || '')) throw e

    const run = db.prepare('SELECT * FROM production_run WHERE id = ?').get(productionRunId)
    if (!run) throw new Error(`No production run with id ${productionRunId}.`)
    if (Number(run.creative_id) !== Number(creativeId)) {
      throw new Error(
        `That production run belongs to creative ${run.creative_id}, not creative ${creativeId}. ` +
          'A publication can only reference a run from its own creative.'
      )
    }
    if (run.final_asset_id === null) {
      throw new Error(
        "This production run's final asset does not match the asset you're trying to publish — " +
          'has final_asset_id been set on this run? Set a final asset first, then publish.'
      )
    }
    if (Number(run.final_asset_id) !== Number(publishedAssetId)) {
      throw new Error(
        `This production run's final asset is ${run.final_asset_id}, but you're trying to publish asset ` +
          `${publishedAssetId}. You can only publish the run's currently-selected final asset.`
      )
    }
    if (!db.prepare('SELECT 1 FROM account WHERE id = ?').get(accountId)) {
      throw new Error(`No account with id ${accountId}.`)
    }
    throw e
  }
}

export function listPublicationsForCreative(creativeId) {
  return getDb()
    .prepare(
      `SELECT pb.*, ac.handle AS account_handle, ac.platform AS account_platform,
              (SELECT COUNT(*) FROM metric_snapshot ms WHERE ms.publication_id = pb.id) AS metric_count
         FROM publication pb
         JOIN account ac ON ac.id = pb.account_id
        WHERE pb.creative_id = ? ORDER BY pb.published_at DESC, pb.id DESC`
    )
    .all(creativeId)
    .map((r) => ({ ...r, platformMeta: r.platform_meta ? parseJson(r.platform_meta, null) : null }))
}

export function addMetricSnapshot({
  publicationId,
  capturedAt,
  source,
  qualifiedExposureMetricName = null,
  qualifiedExposureValue = null,
  rawMetrics = {},
  notes = null,
}) {
  const db = getDb()
  const id = db
    .prepare(
      `INSERT INTO metric_snapshot
         (publication_id, captured_at, source, qualified_exposure_metric_name,
          qualified_exposure_value, raw_metrics, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      publicationId,
      capturedAt,
      source,
      qualifiedExposureMetricName,
      qualifiedExposureValue,
      JSON.stringify(rawMetrics || {}),
      notes
    ).lastInsertRowid
  return db.prepare('SELECT * FROM metric_snapshot WHERE id = ?').get(id)
}

export function listMetricSnapshotsForPublication(publicationId) {
  return getDb()
    .prepare('SELECT * FROM metric_snapshot WHERE publication_id = ? ORDER BY captured_at ASC, id ASC')
    .all(publicationId)
    .map((r) => ({ ...r, rawMetrics: parseJson(r.raw_metrics, {}) }))
}

export function addReviewEvent({ creativeId, productionRunId = null, eventType, reasonCode = null, note = null }) {
  const db = getDb()
  const id = db
    .prepare(
      `INSERT INTO review_event (creative_id, production_run_id, event_type, reason_code, note)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(creativeId, productionRunId, eventType, reasonCode, note).lastInsertRowid
  return db.prepare('SELECT * FROM review_event WHERE id = ?').get(id)
}

export function listReviewEventsForCreative(creativeId) {
  return getDb().prepare('SELECT * FROM review_event WHERE creative_id = ? ORDER BY id DESC').all(creativeId)
}

// ---------------------------------------------------------------------------
// AI-assisted strategy approval (M2)
//
// research/generate and strategy/generate (server/lib/organicStrategy.mjs)
// write nothing to the database — only this function does, and only atomically.
// It reuses createIterationForTest and createCreativeForIteration directly
// rather than duplicating their code generation / lineage-derivation logic.
// This is safe without modifying either function: better-sqlite3's
// db.transaction(fn) automatically uses SAVEPOINT/RELEASE instead of
// BEGIN/COMMIT when called while db.inTransaction is already true, so calling
// them from inside this function's own .immediate() transaction nests
// correctly and rolls back completely on any failure. Verified empirically
// (not just by reading the library source) before relying on it here.
// ---------------------------------------------------------------------------

/**
 * Compact provenance carried into strategy_snapshot.research — deliberately
 * NOT the full fetched page text (that can be kilobytes of scraped HTML-derived
 * text; it already served its purpose informing the research draft and has no
 * reason to be duplicated into every iteration row going forward).
 */
function buildStrategyProvenance(researchDraft) {
  const rd = researchDraft || {}
  const sourceMeta = rd.sourceMeta || {}
  const product = rd.product || {}
  const avatar = rd.primaryAvatar || {}

  const researchSummary = [product.whatItIs, avatar.mainProblem].filter(Boolean).join(' — ')

  const sourceLabeledFacts = []
  for (const item of rd.customerLanguage || []) sourceLabeledFacts.push({ type: 'customerLanguage', ...item })
  if (product.provenance === 'SOURCE FACT') {
    sourceLabeledFacts.push({
      type: 'product',
      provenance: 'SOURCE FACT',
      whatItIs: product.whatItIs,
      mechanism: product.mechanism,
    })
  }

  return {
    sourceUrl: sourceMeta.sourceUrl ?? null,
    fetchSucceeded: !!sourceMeta.fetchSucceeded,
    fetchedAt: sourceMeta.fetchedAt ?? null,
    contentHash: sourceMeta.contentHash ?? null,
    researchSummary,
    sourceLabeledFacts,
  }
}

/**
 * Create one Iteration and its Creatives from an approved (human-edited)
 * strategy, all in a single transaction. Any failure — including a single bad
 * row partway through — rolls back the entire batch: zero Iteration, zero
 * Creatives, never a partial mess.
 *
 * strategyRows: flat array, one entry per execution, each carrying its parent
 * angle's name as `angle` plus the execution fields (format, hookFamily,
 * hookText, coreScenario, differentiationNote, defaultProductionMethod?).
 * targetCount: the originally requested execution count (informational —
 * strategyRows may have been edited/trimmed since generation); defaults to
 * strategyRows.length when not supplied.
 */
export function approveStrategyForProductTest({
  productTestId,
  mode,
  researchDraft,
  strategyRows,
  policyOverrides = {},
  targetCount,
}) {
  if (!Array.isArray(strategyRows) || strategyRows.length === 0) {
    throw new Error('approveStrategyForProductTest: strategyRows must be a non-empty array')
  }

  const db = getDb()
  return db
    .transaction(() => {
      const provenance = buildStrategyProvenance(researchDraft)
      const strategySnapshot = {
        research: provenance,
        matrix: strategyRows,
        generatedAt: new Date().toISOString(),
        targetCount: Number.isFinite(Number(targetCount)) ? Number(targetCount) : strategyRows.length,
        actualCount: strategyRows.length,
      }

      const iterationId = createIterationForTest({
        productTestId,
        mode,
        strategySnapshot,
        policyOverrides,
      })

      for (const row of strategyRows) {
        const conceptSummary = [row.coreScenario, row.differentiationNote].filter(Boolean).join(' — ') || null
        createCreativeForIteration({
          iterationId,
          angle: row.angle,
          format: row.format,
          hookFamily: row.hookFamily || null,
          hookText: row.hookText || null,
          conceptSummary,
          defaultProductionMethod: row.defaultProductionMethod || 'factory_generated',
        })
      }

      return iterationId
    })
    .immediate()
}

// ---------------------------------------------------------------------------
// Production planning approval (M4)
//
// generateBatchProductionPlan / priceProductionPlan (server/lib/
// productionPlanner.mjs) write nothing to the database. Only this function
// does, and only atomically. Planning is not spending: it creates
// ProductionRuns in status 'planned' with spec_frozen_at left null — zero
// Jobs, zero BudgetReservations, zero Cost rows.
// ---------------------------------------------------------------------------

/**
 * Create one planned ProductionRun per plan, all in a single transaction.
 * Any failure — including one bad plan partway through — rolls back the
 * entire batch, same discipline as approveStrategyForProductTest.
 *
 * coarseProductionMethod is NOT pre-validated in JS: an invalid value is left
 * to fail the real production_run.production_method CHECK constraint inside
 * createProductionRunForCreative, the same way a manually-entered one would,
 * so the failure path is identical regardless of where the bad value came
 * from — and the transaction rolls back identically either way.
 *
 * Each plan: { creativeId, fineMethod, rationale, requiredAssets,
 *   plannedProvider, plannedModel, generationPlan, estimatedCost, notes,
 *   coarseProductionMethod }
 */
export function approveProductionPlan({ plans }) {
  if (!Array.isArray(plans) || plans.length === 0) {
    throw new Error('approveProductionPlan: plans must be a non-empty array')
  }

  const db = getDb()
  return db
    .transaction(() => {
      const createdRunIds = []
      for (const plan of plans) {
        const runId = createProductionRunForCreative({
          creativeId: plan.creativeId,
          productionMethod: plan.coarseProductionMethod,
        })

        const gp = plan.generationPlan || {}
        const estimatedVideoSeconds = (gp.videoClips || []).reduce((sum, c) => sum + (Number(c.seconds) || 0), 0)

        const specSnapshot = {
          schemaVersion: 1,
          planning: {
            fineMethod: plan.fineMethod,
            rationale: plan.rationale || null,
            requiredAssets: plan.requiredAssets || [],
            plannedProvider: plan.plannedProvider || null,
            plannedModel: plan.plannedModel || null,
            estimatedGenerationCounts: {
              images: gp.imageGenerations || 0,
              videoClips: (gp.videoClips || []).length,
            },
            estimatedVideoSeconds,
            estimatedCost: plan.estimatedCost || null,
            productionNotes: plan.notes || null,
          },
          execution: null,
        }

        // A direct UPDATE, deliberately NOT freezeProductionRunSpec — that
        // function also stamps spec_frozen_at, and spec_frozen_at must stay
        // null here. It is reserved for actual execution dispatch, a later
        // milestone; this is planning, not spending.
        db.prepare('UPDATE production_run SET spec_snapshot = ? WHERE id = ?').run(JSON.stringify(specSnapshot), runId)
        createdRunIds.push(runId)
      }
      return createdRunIds
    })
    .immediate()
}
