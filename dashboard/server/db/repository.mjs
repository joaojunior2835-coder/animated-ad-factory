// Repository layer for the Animated Ad Factory / Organic Product Testing data.
// Pure database logic: no HTTP, no provider calls, no UI, no cost.
//
// ATOMICITY GUARANTEE
// -------------------
// Every write below runs inside ONE synchronous SQLite transaction. The
// guarantee comes from SQLite's own write-serialization, NOT from JavaScript
// being single-threaded. That distinction is the whole point: the event-loop
// argument would only hold while this database has exactly one connection in
// one process. It says nothing about a second connection, a worker thread, or
// a separate process opening the same file — all of which are plausible as
// this system grows. SQLite's transaction protects us in every one of those
// cases; the event loop protects us in none of them.
//
// We use `db.transaction(fn).immediate()`, not `db.transaction(fn)()`.
// This is deliberate and verified against better-sqlite3's implementation
// (node_modules/better-sqlite3/lib/methods/transaction.js): the default form
// issues a plain `BEGIN`, which SQLite treats as DEFERRED — no lock is taken
// until the first actual read or write inside the body. `.immediate()` issues
// `BEGIN IMMEDIATE`, taking the write lock up front.
//
// For read-then-write logic that difference is the bug. reserveBudget reads
// the settled and reserved sums, decides against the ceiling, then inserts.
// Under a deferred transaction two concurrent writers can both read the same
// sums before either writes, and each then authorizes spend the other's read
// never saw — the classic read-modify-write race, which is exactly the kind of
// double-authorization this layer exists to prevent. BEGIN IMMEDIATE
// serializes such writers from the start instead.
//
// No async/await appears inside any transaction body. better-sqlite3 is
// synchronous, and awaiting inside a transaction would let unrelated work
// interleave while the transaction is open.

import { openDatabase } from './migrate.mjs'

let _db = null

/** The shared connection (foreign keys enforced, per openDatabase). */
export function getDb() {
  if (!_db) _db = openDatabase()
  return _db
}

/** Point the repository at a specific database file — used by tests. */
export function setDb(db) {
  _db = db
}

export function closeDb() {
  if (_db) {
    _db.close()
    _db = null
  }
}

const NOW = "datetime('now')"

function requireRow(row, message) {
  if (!row) throw new Error(message)
  return row
}

// ---------------------------------------------------------------------------
// Basic creators — thin insert wrappers, return the new row id.
// ---------------------------------------------------------------------------

export function createProduct({ name, supplierUrl = null, productUrl = null, notes = null }) {
  return Number(
    getDb()
      .prepare('INSERT INTO product (name, supplier_url, product_url, notes) VALUES (?, ?, ?, ?)')
      .run(name, supplierUrl, productUrl, notes).lastInsertRowid
  )
}

export function createProductTest({
  productId,
  code,
  market,
  language,
  sellingPriceMinor = null,
  productCostMinor = null,
  shippingCostMinor = null,
  currency = 'EUR',
  expectedShippingDays = null,
  policySnapshot,
}) {
  return Number(
    getDb()
      .prepare(
        `INSERT INTO product_test
           (product_id, code, market, language, selling_price_minor, product_cost_minor,
            shipping_cost_minor, currency, expected_shipping_days, policy_snapshot)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        productId,
        code,
        market,
        language,
        sellingPriceMinor,
        productCostMinor,
        shippingCostMinor,
        currency,
        expectedShippingDays,
        JSON.stringify(policySnapshot)
      ).lastInsertRowid
  )
}

export function createIteration({ productTestId, number, mode, strategySnapshot, executionPolicySnapshot }) {
  return Number(
    getDb()
      .prepare(
        `INSERT INTO iteration
           (product_test_id, number, mode, strategy_snapshot, execution_policy_snapshot)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(productTestId, number, mode, JSON.stringify(strategySnapshot), JSON.stringify(executionPolicySnapshot))
      .lastInsertRowid
  )
}

export function createCreative({
  iterationId,
  creativeCode,
  angle,
  format,
  hookFamily = null,
  hookText = null,
  conceptSummary = null,
  defaultProductionMethod,
  marketingStudioSessionId = null,
  nodeCanvasProjectId = null,
}) {
  return Number(
    getDb()
      .prepare(
        `INSERT INTO creative
           (iteration_id, creative_code, angle, format, hook_family, hook_text, concept_summary,
            default_production_method, marketing_studio_session_id, node_canvas_project_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        iterationId,
        creativeCode,
        angle,
        format,
        hookFamily,
        hookText,
        conceptSummary,
        defaultProductionMethod,
        marketingStudioSessionId,
        nodeCanvasProjectId
      ).lastInsertRowid
  )
}

export function createProductionRun({ creativeId, attemptNumber, productionMethod }) {
  return Number(
    getDb()
      .prepare('INSERT INTO production_run (creative_id, attempt_number, production_method) VALUES (?, ?, ?)')
      .run(creativeId, attemptNumber, productionMethod).lastInsertRowid
  )
}

export function createJob({ productionRunId, capability, provider, inputParams }) {
  return Number(
    getDb()
      .prepare('INSERT INTO job (production_run_id, capability, provider, input_params) VALUES (?, ?, ?, ?)')
      .run(productionRunId, capability, provider, JSON.stringify(inputParams)).lastInsertRowid
  )
}

export function createAccount({ platform, handle, market = null, language = null }) {
  return Number(
    getDb()
      .prepare('INSERT INTO account (platform, handle, market, language) VALUES (?, ?, ?, ?)')
      .run(platform, handle, market, language).lastInsertRowid
  )
}

// ---------------------------------------------------------------------------
// Asset dedup
// ---------------------------------------------------------------------------

/**
 * Look up an asset by content hash, inserting it only if absent.
 * The lookup and the insert share one transaction, so two calls with the same
 * hash cannot both decide to insert.
 */
export function getOrCreateAsset({
  contentHash,
  relativePath,
  mimeType,
  fileSize = null,
  width = null,
  height = null,
  durationSeconds = null,
  source,
  provider = null,
}) {
  const db = getDb()
  return db
    .transaction(() => {
      const existing = db.prepare('SELECT id FROM asset WHERE content_hash = ?').get(contentHash)
      if (existing) return { id: Number(existing.id), created: false }
      const id = db
        .prepare(
          `INSERT INTO asset
             (content_hash, relative_path, mime_type, file_size, width, height,
              duration_seconds, source, provider)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(contentHash, relativePath, mimeType, fileSize, width, height, durationSeconds, source, provider)
        .lastInsertRowid
      return { id: Number(id), created: true }
    })
    .immediate()
}

const OWNER_COLUMNS = {
  productId: 'product_id',
  productTestId: 'product_test_id',
  creativeId: 'creative_id',
  productionRunId: 'production_run_id',
  jobId: 'job_id',
  isSharedLibrary: 'is_shared_library',
}

/**
 * Link an asset to exactly one owner.
 * The DB CHECK constraint is the real enforcement; this validation exists to
 * fail fast and legibly on programmer error rather than surfacing a raw
 * SQLite CHECK message.
 */
export function attachAssetLink(assetId, ownerFields, role) {
  const keys = Object.keys(ownerFields || {}).filter((k) => {
    const v = ownerFields[k]
    return v !== undefined && v !== null && v !== false
  })
  const unknown = keys.filter((k) => !(k in OWNER_COLUMNS))
  if (unknown.length) throw new Error(`attachAssetLink: unknown owner field(s): ${unknown.join(', ')}`)
  if (keys.length === 0) {
    throw new Error(
      'attachAssetLink: exactly one owner field is required, got none ' +
        `(one of ${Object.keys(OWNER_COLUMNS).join(', ')})`
    )
  }
  if (keys.length > 1) {
    throw new Error(`attachAssetLink: exactly one owner field is required, got ${keys.length}: ${keys.join(', ')}`)
  }

  const key = keys[0]
  const column = OWNER_COLUMNS[key]
  const value = key === 'isSharedLibrary' ? 1 : ownerFields[key]
  return Number(
    getDb()
      .prepare(`INSERT INTO asset_link (asset_id, ${column}, role) VALUES (?, ?, ?)`)
      .run(assetId, value, role).lastInsertRowid
  )
}

// ---------------------------------------------------------------------------
// Lineage derivation
// ---------------------------------------------------------------------------

/**
 * Resolve a job's full lineage in one query.
 *
 * This is the ONLY place lineage ids are derived. reserveBudget and settleJob
 * call it instead of accepting ids from their caller, so no caller can attach
 * a Cost or a reservation to the wrong Creative, Iteration or ProductTest —
 * the money always lands on the lineage the Job actually belongs to.
 */
export function _deriveLineageFromJob(db, jobId) {
  const row = db
    .prepare(
      `SELECT j.id            AS jobId,
              j.provider      AS provider,
              j.status        AS jobStatus,
              j.production_run_id AS productionRunId,
              pr.creative_id  AS creativeId,
              c.iteration_id  AS iterationId,
              i.product_test_id AS productTestId,
              i.execution_policy_snapshot AS executionPolicySnapshot
         FROM job j
         JOIN production_run pr ON pr.id = j.production_run_id
         JOIN creative c        ON c.id  = pr.creative_id
         JOIN iteration i       ON i.id  = c.iteration_id
         JOIN product_test pt   ON pt.id = i.product_test_id
        WHERE j.id = ?`
    )
    .get(jobId)
  requireRow(row, `_deriveLineageFromJob: no job with id ${jobId}`)

  let executionPolicySnapshot
  try {
    executionPolicySnapshot = JSON.parse(row.executionPolicySnapshot)
  } catch (e) {
    throw new Error(`_deriveLineageFromJob: iteration ${row.iterationId} has unparseable execution_policy_snapshot`)
  }

  return {
    job: { id: Number(row.jobId), provider: row.provider, status: row.jobStatus },
    jobId: Number(row.jobId),
    provider: row.provider,
    productionRunId: Number(row.productionRunId),
    creativeId: Number(row.creativeId),
    iterationId: Number(row.iterationId),
    productTestId: Number(row.productTestId),
    executionPolicySnapshot,
  }
}

// ---------------------------------------------------------------------------
// Budget reservation and settlement
// ---------------------------------------------------------------------------

/**
 * Authorize spend for one dispatch attempt of a Job.
 *
 * Retrying the same (jobId, dispatchAttempt) returns the existing reservation
 * untouched rather than authorizing money a second time.
 */
export function reserveBudget({
  jobId,
  dispatchAttempt,
  originalAmountMinor,
  originalCurrency,
  fxRate,
  fxRateSource,
  fxRateCapturedAt,
}) {
  const db = getDb()
  return db
    .transaction(() => {
      const lineage = _deriveLineageFromJob(db, jobId)

      // Same dispatch attempt twice: hand back what already exists.
      const existing = db
        .prepare('SELECT * FROM budget_reservation WHERE job_id = ? AND dispatch_attempt = ?')
        .get(jobId, dispatchAttempt)
      if (existing) {
        return {
          allowed: true,
          idempotent: true,
          reservationId: Number(existing.id),
          iterationId: Number(existing.iteration_id),
          originalAmountMinor: existing.original_amount_minor,
          originalCurrency: existing.original_currency,
          baseCurrencyAmountMinor: existing.base_currency_amount_minor,
          status: existing.status,
        }
      }

      const baseCurrencyAmountMinor = Math.round(originalAmountMinor * fxRate)

      const ceiling = lineage.executionPolicySnapshot?.budgetCeilingMinor
      if (typeof ceiling !== 'number' || !Number.isFinite(ceiling)) {
        throw new Error(
          `reserveBudget: iteration ${lineage.iterationId} execution_policy_snapshot has no numeric budgetCeilingMinor`
        )
      }

      // Adjustments are signed corrections to real spend, so they belong in
      // the settled total alongside charges — the ledger is financial truth.
      const settledMinor =
        db
          .prepare('SELECT COALESCE(SUM(base_currency_amount_minor), 0) AS total FROM cost WHERE iteration_id = ?')
          .get(lineage.iterationId).total || 0

      const activeReservedMinor =
        db
          .prepare(
            `SELECT COALESCE(SUM(base_currency_amount_minor), 0) AS total
               FROM budget_reservation
              WHERE iteration_id = ? AND status = 'active'`
          )
          .get(lineage.iterationId).total || 0

      const proposedTotal = settledMinor + activeReservedMinor + baseCurrencyAmountMinor

      if (proposedTotal > ceiling) {
        return {
          allowed: false,
          reason: 'over_budget',
          settledMinor,
          activeReservedMinor,
          budgetCeilingMinor: ceiling,
          proposedTotal,
        }
      }

      const reservationId = db
        .prepare(
          `INSERT INTO budget_reservation
             (iteration_id, creative_id, production_run_id, job_id, dispatch_attempt,
              original_amount_minor, original_currency, base_currency_amount_minor,
              fx_rate, fx_rate_source, fx_rate_captured_at, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')`
        )
        .run(
          lineage.iterationId,
          lineage.creativeId,
          lineage.productionRunId,
          jobId,
          dispatchAttempt,
          originalAmountMinor,
          originalCurrency,
          baseCurrencyAmountMinor,
          fxRate,
          fxRateSource,
          fxRateCapturedAt
        ).lastInsertRowid

      return {
        allowed: true,
        idempotent: false,
        reservationId: Number(reservationId),
        iterationId: lineage.iterationId,
        originalAmountMinor,
        originalCurrency,
        baseCurrencyAmountMinor,
        settledMinor,
        activeReservedMinor,
        budgetCeilingMinor: ceiling,
        proposedTotal,
      }
    })
    .immediate()
}

/**
 * Settle a dispatched Job: record what it actually cost, resolve its
 * reservation and close the job — all or nothing.
 *
 * Lineage and provider are derived from the Job, never taken from the caller.
 */
export function settleJob({
  jobId,
  reservationId,
  success,
  actualAmountMinor,
  actualCurrency,
  fxRate,
  fxRateSource,
  fxRateCapturedAt,
}) {
  const db = getDb()
  return db
    .transaction(() => {
      const lineage = _deriveLineageFromJob(db, jobId)

      const reservation = db.prepare('SELECT * FROM budget_reservation WHERE id = ?').get(reservationId)
      requireRow(reservation, `settleJob: no reservation with id ${reservationId}`)

      if (Number(reservation.job_id) !== Number(jobId)) {
        throw new Error(
          `reservation_wrong_job: reservation ${reservationId} belongs to job ${reservation.job_id}, not job ${jobId}`
        )
      }

      // Expected idempotent path, not programmer error — do not throw.
      if (reservation.status !== 'active') {
        return { alreadySettled: true, currentStatus: reservation.status }
      }

      const baseCurrencyAmountMinor = Math.round(actualAmountMinor * fxRate)

      // Record the real amount even if it exceeds the reservation or the
      // ceiling. The ledger records what happened; it is never massaged to fit.
      let costId = null
      if (actualAmountMinor > 0) {
        costId = Number(
          db
            .prepare(
              `INSERT INTO cost
                 (product_test_id, iteration_id, creative_id, production_run_id, job_id,
                  event_type, provider, original_amount_minor, original_currency,
                  base_currency_amount_minor, fx_rate, fx_rate_source, fx_rate_captured_at)
               VALUES (?, ?, ?, ?, ?, 'charge', ?, ?, ?, ?, ?, ?, ?)`
            )
            .run(
              lineage.productTestId,
              lineage.iterationId,
              lineage.creativeId,
              lineage.productionRunId,
              jobId,
              lineage.provider,
              actualAmountMinor,
              actualCurrency,
              baseCurrencyAmountMinor,
              fxRate,
              fxRateSource,
              fxRateCapturedAt
            ).lastInsertRowid
        )
      }

      const reservationStatus = success ? 'consumed' : 'released'
      db.prepare(`UPDATE budget_reservation SET status = ?, resolved_at = ${NOW} WHERE id = ?`).run(
        reservationStatus,
        reservationId
      )

      const jobStatus = success ? 'complete' : 'failed'
      db.prepare(`UPDATE job SET status = ?, completed_at = ${NOW} WHERE id = ?`).run(jobStatus, jobId)

      return {
        alreadySettled: false,
        costId,
        baseCurrencyAmountMinor,
        reservationStatus,
        jobStatus,
        iterationId: lineage.iterationId,
      }
    })
    .immediate()
}

/**
 * Record a budget override. Either jobId or iterationId must be given; when
 * both are, they must agree.
 */
export function recordOverride({
  iterationId = null,
  jobId = null,
  reason,
  actor,
  previousCeilingMinor = null,
  authorizedCeilingMinor = null,
}) {
  if (typeof reason !== 'string' || reason.trim() === '') {
    throw new Error('recordOverride: reason is mandatory and cannot be empty')
  }
  if (actor !== 'user' && actor !== 'system') {
    throw new Error(`recordOverride: actor must be 'user' or 'system', got ${JSON.stringify(actor)}`)
  }
  if (jobId === null && iterationId === null) {
    throw new Error('recordOverride: one of jobId or iterationId is required')
  }

  const db = getDb()
  return db
    .transaction(() => {
      let resolvedIterationId = iterationId

      if (jobId !== null) {
        const lineage = _deriveLineageFromJob(db, jobId)
        if (iterationId !== null && Number(iterationId) !== lineage.iterationId) {
          throw new Error(
            `iteration_mismatch: job ${jobId} belongs to iteration ${lineage.iterationId}, ` +
              `but iterationId ${iterationId} was supplied`
          )
        }
        resolvedIterationId = lineage.iterationId
      }

      const id = db
        .prepare(
          `INSERT INTO budget_override_event
             (iteration_id, job_id, reason, actor, previous_ceiling_minor, authorized_ceiling_minor)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
        .run(resolvedIterationId, jobId, reason, actor, previousCeilingMinor, authorizedCeilingMinor).lastInsertRowid

      return { id: Number(id), iterationId: Number(resolvedIterationId) }
    })
    .immediate()
}

// ---------------------------------------------------------------------------
// ProductionRun lineage helpers
// ---------------------------------------------------------------------------

/**
 * Select the final asset for a run.
 *
 * Any previous final_video link is downgraded to 'production_output' rather
 * than deleted — the earlier output still happened and stays in the history.
 * Afterwards exactly one asset_link has role 'final_video' for this run, and
 * it points at the same asset as production_run.final_asset_id. The 0002
 * partial unique index enforces the same invariant independently.
 */
export function setProductionRunFinalAsset(productionRunId, assetId) {
  const db = getDb()
  return db
    .transaction(() => {
      const downgraded = db
        .prepare(
          `UPDATE asset_link SET role = 'production_output'
            WHERE production_run_id = ? AND role = 'final_video'`
        )
        .run(productionRunId).changes

      const existingLink = db
        .prepare('SELECT id FROM asset_link WHERE production_run_id = ? AND asset_id = ?')
        .get(productionRunId, assetId)

      let linkId
      if (existingLink) {
        db.prepare("UPDATE asset_link SET role = 'final_video' WHERE id = ?").run(existingLink.id)
        linkId = Number(existingLink.id)
      } else {
        linkId = Number(
          db
            .prepare("INSERT INTO asset_link (asset_id, production_run_id, role) VALUES (?, ?, 'final_video')")
            .run(assetId, productionRunId).lastInsertRowid
        )
      }

      db.prepare('UPDATE production_run SET final_asset_id = ? WHERE id = ?').run(assetId, productionRunId)

      return { linkId, downgradedCount: downgraded }
    })
    .immediate()
}

/** Freeze a run's spec. Immutable once frozen. */
export function freezeProductionRunSpec(productionRunId, specSnapshotObj) {
  const db = getDb()
  return db
    .transaction(() => {
      const row = db.prepare('SELECT spec_frozen_at FROM production_run WHERE id = ?').get(productionRunId)
      requireRow(row, `freezeProductionRunSpec: no production_run with id ${productionRunId}`)
      if (row.spec_frozen_at !== null) {
        throw new Error(
          `spec_already_frozen: production_run ${productionRunId} was frozen at ${row.spec_frozen_at} and cannot be re-frozen`
        )
      }
      db.prepare(`UPDATE production_run SET spec_snapshot = ?, spec_frozen_at = ${NOW} WHERE id = ?`).run(
        JSON.stringify(specSnapshotObj),
        productionRunId
      )
      const after = db.prepare('SELECT spec_frozen_at FROM production_run WHERE id = ?').get(productionRunId)
      return { productionRunId, specFrozenAt: after.spec_frozen_at }
    })
    .immediate()
}

/**
 * Read-only guard for Phase 3's dispatch code: a run's spec must be frozen
 * before any Job is created or started against it.
 */
export function assertProductionRunReadyForExecution(productionRunId) {
  const row = getDb().prepare('SELECT spec_frozen_at FROM production_run WHERE id = ?').get(productionRunId)
  requireRow(row, `assertProductionRunReadyForExecution: no production_run with id ${productionRunId}`)
  if (row.spec_frozen_at === null) {
    throw new Error(
      `spec_not_frozen: production_run ${productionRunId} has no frozen spec; freeze it before creating or dispatching jobs`
    )
  }
  return true
}

// ---------------------------------------------------------------------------
// Workspace persistence: Marketing Studio sessions and Node Canvas projects.
//
// Ids here are CLIENT-generated and stable — they are the same ids the browser
// already uses in localStorage today (see SESSION_STORAGE_KEY in
// src/lib/marketingStudioModel.js). So these are upserts, not inserts: saving
// the same workspace twice updates it in place rather than forking a copy.
//
// Nothing in the frontend calls these yet. The live Marketing Studio and Node
// Canvas still read and write localStorage exactly as before; this is a
// parallel backend home for the same data.
// ---------------------------------------------------------------------------

function makeWorkspaceStore({ table, jsonColumn, jsonKey }) {
  const upsert = ({ id, name, ...rest }) => {
    const payload = rest[jsonKey]
    const db = getDb()
    return db
      .transaction(() => {
        db.prepare(
          `INSERT INTO ${table} (id, name, ${jsonColumn}, created_at, updated_at)
           VALUES (?, ?, ?, ${NOW}, ${NOW})
           ON CONFLICT(id) DO UPDATE SET
             name = excluded.name,
             ${jsonColumn} = excluded.${jsonColumn},
             updated_at = ${NOW}`
        ).run(id, name, JSON.stringify(payload))
        return db.prepare(`SELECT id, name, updated_at FROM ${table} WHERE id = ?`).get(id)
      })
      .immediate()
  }

  // The list view deliberately omits the JSON blob — a workspace payload can be
  // large, and a list of twenty of them should not drag twenty full documents
  // across just to render their names.
  const list = () =>
    getDb().prepare(`SELECT id, name, created_at, updated_at FROM ${table} ORDER BY updated_at DESC`).all()

  const get = (id) => {
    const row = getDb().prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id)
    if (!row) return null
    // Return the parsed payload only — carrying the raw JSON string alongside
    // it would double the response size for no benefit.
    const { [jsonColumn]: raw, ...rest } = row
    return { ...rest, [jsonKey]: JSON.parse(raw) }
  }

  const remove = (id) => ({ deleted: getDb().prepare(`DELETE FROM ${table} WHERE id = ?`).run(id).changes > 0 })

  return { upsert, list, get, remove }
}

const studioStore = makeWorkspaceStore({
  table: 'marketing_studio_session',
  jsonColumn: 'studio_json',
  jsonKey: 'studioJson',
})
const canvasStore = makeWorkspaceStore({
  table: 'node_canvas_project',
  jsonColumn: 'canvas_json',
  jsonKey: 'canvasJson',
})

export const upsertMarketingStudioSession = studioStore.upsert
export const listMarketingStudioSessions = studioStore.list
export const getMarketingStudioSession = studioStore.get
export const deleteMarketingStudioSession = studioStore.remove

export const upsertNodeCanvasProject = canvasStore.upsert
export const listNodeCanvasProjects = canvasStore.list
export const getNodeCanvasProject = canvasStore.get
export const deleteNodeCanvasProject = canvasStore.remove

// ---------------------------------------------------------------------------
// Idempotent legacy import
// ---------------------------------------------------------------------------

/**
 * Import workspaces out of browser localStorage into the database.
 *
 * Each item gets its OWN transaction. A batch import is a long, partly
 * untrusted operation over data this code has never seen; one malformed
 * session must not roll back the twenty that already imported cleanly. So a
 * failure is recorded against that item and the batch continues.
 *
 * import_log is what makes re-running safe: an item already recorded there is
 * skipped, so importing twice imports nothing twice.
 */
export function importLegacyData({ marketingStudioSessions = [], nodeCanvasProjects = [] } = {}) {
  const db = getDb()
  const summary = {
    sessionsImported: 0,
    sessionsSkipped: 0,
    projectsImported: 0,
    projectsSkipped: 0,
    errors: [],
  }

  const alreadyImported = db.prepare('SELECT 1 FROM import_log WHERE source_type = ? AND source_id = ?')
  const recordImport = db.prepare(
    'INSERT OR IGNORE INTO import_log (source_type, source_id) VALUES (?, ?)'
  )

  // sourceField is the property on the incoming localStorage item ('studio' or
  // 'canvas'); jsonKey is what the upsert function expects to receive it as.
  const importOne = ({ items, sourceType, sourceField, jsonKey, upsertFn, importedKey, skippedKey }) => {
    for (const item of Array.isArray(items) ? items : []) {
      const id = item && item.id
      try {
        if (!id) throw new Error('item has no id')
        const outcome = db
          .transaction(() => {
            if (alreadyImported.get(sourceType, String(id))) return 'skipped'
            upsertFn({ id, name: item.name, [jsonKey]: item[sourceField] })
            recordImport.run(sourceType, String(id))
            return 'imported'
          })
          .immediate()
        summary[outcome === 'skipped' ? skippedKey : importedKey]++
      } catch (e) {
        summary.errors.push({ id: id ?? null, error: e && e.message ? e.message : String(e) })
      }
    }
  }

  importOne({
    items: marketingStudioSessions,
    sourceType: 'marketing_studio_session',
    sourceField: 'studio',
    jsonKey: 'studioJson',
    upsertFn: upsertMarketingStudioSession,
    importedKey: 'sessionsImported',
    skippedKey: 'sessionsSkipped',
  })
  importOne({
    items: nodeCanvasProjects,
    sourceType: 'node_canvas_project',
    sourceField: 'canvas',
    jsonKey: 'canvasJson',
    upsertFn: upsertNodeCanvasProject,
    importedKey: 'projectsImported',
    skippedKey: 'projectsSkipped',
  })

  return summary
}

/** Cheap liveness probe for /health: can we actually query the database now? */
export function checkDbConnectivity() {
  try {
    const row = getDb().prepare('SELECT COUNT(*) AS n FROM applied_migrations').get()
    return typeof row.n === 'number'
  } catch {
    return false
  }
}
