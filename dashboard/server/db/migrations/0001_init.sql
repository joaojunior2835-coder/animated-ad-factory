CREATE TABLE app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL CHECK (json_valid(value)),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE marketing_studio_session (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  studio_json TEXT NOT NULL CHECK (json_valid(studio_json)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE node_canvas_project (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  canvas_json TEXT NOT NULL CHECK (json_valid(canvas_json)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE import_log (
  id INTEGER PRIMARY KEY,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  imported_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(source_type, source_id)
);

CREATE TABLE product (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  supplier_url TEXT,
  product_url TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE product_test (
  id INTEGER PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES product(id),
  code TEXT NOT NULL UNIQUE,
  market TEXT NOT NULL,
  language TEXT NOT NULL,
  selling_price_minor INTEGER,
  product_cost_minor INTEGER,
  shipping_cost_minor INTEGER,
  currency TEXT NOT NULL DEFAULT 'EUR',
  expected_shipping_days INTEGER,
  status TEXT NOT NULL DEFAULT 'draft',
  policy_snapshot TEXT NOT NULL CHECK (json_valid(policy_snapshot)),
  current_iteration_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (current_iteration_id, id) REFERENCES iteration(id, product_test_id)
);
-- current_iteration_id is nullable; SQLite's default FK match behavior
-- treats a row as satisfying the constraint whenever any composite key
-- column is NULL, so a ProductTest may exist before its first Iteration.
-- Once set, this composite FK guarantees the referenced Iteration
-- actually belongs to THIS ProductTest, not another one.

CREATE TABLE iteration (
  id INTEGER PRIMARY KEY,
  product_test_id INTEGER NOT NULL REFERENCES product_test(id),
  number INTEGER NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('exploratory','confirmatory')),
  strategy_snapshot TEXT NOT NULL CHECK (json_valid(strategy_snapshot)),
  execution_policy_snapshot TEXT NOT NULL CHECK (json_valid(execution_policy_snapshot)),
  status TEXT NOT NULL DEFAULT 'planned',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  started_at TEXT,
  completed_at TEXT,
  UNIQUE(product_test_id, number),
  UNIQUE(id, product_test_id)
);
-- No verdict/verdict_evidence columns — M0 stores facts and immutable
-- experiment context only. Verdict storage is deferred until the
-- analysis/decision model is actually designed.
-- UNIQUE(id, product_test_id) exists solely so product_test's composite
-- FK above can validate against it.

CREATE TABLE creative (
  id INTEGER PRIMARY KEY,
  iteration_id INTEGER NOT NULL REFERENCES iteration(id),
  creative_code TEXT NOT NULL UNIQUE,
  angle TEXT NOT NULL,
  format TEXT NOT NULL,
  hook_family TEXT,
  hook_text TEXT,
  concept_summary TEXT,
  default_production_method TEXT NOT NULL
    CHECK (default_production_method IN ('factory_generated','manual_external','mixed')),
  marketing_studio_session_id TEXT REFERENCES marketing_studio_session(id),
  node_canvas_project_id TEXT REFERENCES node_canvas_project(id),
  active_production_run_id INTEGER,
  approval_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (approval_status IN ('pending','approved','rejected','regenerating')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (active_production_run_id, id) REFERENCES production_run(id, creative_id)
);
-- Same composite-FK-with-own-id pattern as product_test above:
-- guarantees active_production_run_id, if set, belongs to THIS Creative.

CREATE TABLE production_run (
  id INTEGER PRIMARY KEY,
  creative_id INTEGER NOT NULL REFERENCES creative(id),
  attempt_number INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'planned'
    CHECK (status IN ('planned','executing','complete','failed','superseded')),
  production_method TEXT NOT NULL
    CHECK (production_method IN ('factory_generated','manual_external','mixed')),
  spec_snapshot TEXT CHECK (spec_snapshot IS NULL OR json_valid(spec_snapshot)),
  spec_frozen_at TEXT,
  final_asset_id INTEGER REFERENCES asset(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT,
  UNIQUE(creative_id, attempt_number),
  UNIQUE(id, creative_id),
  UNIQUE(id, final_asset_id)
);
-- UNIQUE(id, creative_id) lets creative.active_production_run_id and
-- publication.production_run_id both validate "this run belongs to
-- this creative" via composite FK.
-- UNIQUE(id, final_asset_id) lets publication validate that its
-- published_asset_id equals this run's selected final asset AT THE
-- MOMENT of publishing — see publication below.
-- final_asset_id has a real, unconditional FK to asset(id) since
-- asset is defined earlier in this file.

CREATE TABLE job (
  id INTEGER PRIMARY KEY,
  production_run_id INTEGER NOT NULL REFERENCES production_run(id),
  capability TEXT NOT NULL
    CHECK (capability IN ('generate_image','generate_video','generate_voice','assemble','other')),
  provider TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'planned'
    CHECK (status IN ('planned','generating','complete','failed','cancelled')),
  input_params TEXT NOT NULL CHECK (json_valid(input_params)),
  retry_count INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  started_at TEXT,
  completed_at TEXT
);

CREATE TABLE asset (
  id INTEGER PRIMARY KEY,
  content_hash TEXT NOT NULL UNIQUE
    CHECK (length(content_hash) = 64 AND content_hash = lower(content_hash)),
  relative_path TEXT NOT NULL UNIQUE,
  mime_type TEXT NOT NULL,
  file_size INTEGER,
  width INTEGER,
  height INTEGER,
  duration_seconds REAL,
  source TEXT NOT NULL CHECK (source IN ('generated','uploaded','supplier')),
  provider TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
-- content_hash: SHA-256 of exact file bytes, lowercase hex, 64 chars.
-- Full hex-charset validation happens where the hash is computed
-- (application code), not via an unwieldy SQL GLOB pattern.
-- relative_path is UNIQUE: one canonical Asset row maps to exactly
-- one canonical stored file. Never an absolute machine path.

CREATE TABLE asset_link (
  id INTEGER PRIMARY KEY,
  asset_id INTEGER NOT NULL REFERENCES asset(id),
  product_id INTEGER REFERENCES product(id),
  product_test_id INTEGER REFERENCES product_test(id),
  creative_id INTEGER REFERENCES creative(id),
  production_run_id INTEGER REFERENCES production_run(id),
  job_id INTEGER REFERENCES job(id),
  is_shared_library INTEGER NOT NULL DEFAULT 0 CHECK (is_shared_library IN (0,1)),
  role TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (
    (CASE WHEN product_id IS NOT NULL THEN 1 ELSE 0 END +
     CASE WHEN product_test_id IS NOT NULL THEN 1 ELSE 0 END +
     CASE WHEN creative_id IS NOT NULL THEN 1 ELSE 0 END +
     CASE WHEN production_run_id IS NOT NULL THEN 1 ELSE 0 END +
     CASE WHEN job_id IS NOT NULL THEN 1 ELSE 0 END +
     is_shared_library) = 1
  )
);

CREATE TABLE cost (
  id INTEGER PRIMARY KEY,
  product_test_id INTEGER NOT NULL REFERENCES product_test(id),
  iteration_id INTEGER NOT NULL REFERENCES iteration(id),
  creative_id INTEGER REFERENCES creative(id),
  production_run_id INTEGER REFERENCES production_run(id),
  job_id INTEGER REFERENCES job(id),
  event_type TEXT NOT NULL CHECK (event_type IN ('charge','adjustment')),
  provider TEXT,
  original_amount_minor INTEGER NOT NULL,
  original_currency TEXT NOT NULL,
  base_currency_amount_minor INTEGER NOT NULL,
  base_currency TEXT NOT NULL DEFAULT 'EUR',
  fx_rate REAL NOT NULL,
  fx_rate_source TEXT NOT NULL,
  fx_rate_captured_at TEXT NOT NULL,
  related_cost_id INTEGER REFERENCES cost(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
-- Cost represents ONLY actual financial events (real provider charges
-- and corrections to them). Reservations and overrides are NOT cost
-- events — see budget_reservation and budget_override_event below.
-- All money is integer minor units (cents). fx_rate stays REAL since
-- it is a ratio, not canonical money. Corrections are new adjustment
-- rows referencing related_cost_id — never UPDATE a historical row.

CREATE TABLE budget_reservation (
  id INTEGER PRIMARY KEY,
  iteration_id INTEGER NOT NULL REFERENCES iteration(id),
  creative_id INTEGER REFERENCES creative(id),
  production_run_id INTEGER REFERENCES production_run(id),
  job_id INTEGER NOT NULL REFERENCES job(id),
  dispatch_attempt INTEGER NOT NULL,
  reserved_amount_minor INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'EUR',
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','consumed','released','cancelled')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at TEXT,
  UNIQUE(job_id, dispatch_attempt)
);
-- Authorization to spend, separate from actual spend. A retried Job
-- gets a new dispatch_attempt and a new reservation row; only the
-- current attempt's reservation should be 'active' at any time.
-- Runtime invariant (enforced in a later phase's repository code):
-- settled charges + SUM(active reservations) + proposed <= iteration
-- ceiling from iteration.execution_policy_snapshot.

CREATE TABLE budget_override_event (
  id INTEGER PRIMARY KEY,
  iteration_id INTEGER NOT NULL REFERENCES iteration(id),
  job_id INTEGER REFERENCES job(id),
  reason TEXT NOT NULL,
  actor TEXT NOT NULL CHECK (actor IN ('user','system')),
  previous_ceiling_minor INTEGER,
  authorized_ceiling_minor INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE account (
  id INTEGER PRIMARY KEY,
  platform TEXT NOT NULL,
  handle TEXT NOT NULL,
  market TEXT,
  language TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE publication (
  id INTEGER PRIMARY KEY,
  creative_id INTEGER NOT NULL REFERENCES creative(id),
  production_run_id INTEGER NOT NULL,
  published_asset_id INTEGER NOT NULL,
  account_id INTEGER NOT NULL REFERENCES account(id),
  platform TEXT NOT NULL,
  surface_type TEXT NOT NULL,
  external_post_id TEXT,
  external_url TEXT,
  published_at TEXT NOT NULL,
  platform_meta TEXT CHECK (platform_meta IS NULL OR json_valid(platform_meta)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (production_run_id, creative_id) REFERENCES production_run(id, creative_id),
  FOREIGN KEY (production_run_id, published_asset_id) REFERENCES production_run(id, final_asset_id)
);
-- Two composite FKs give real DB-level lineage integrity:
-- (1) the referenced ProductionRun must actually belong to the
--     referenced Creative — a Publication can't claim C07 while
--     pointing at a run that belongs to C12.
-- (2) published_asset_id must equal that ProductionRun's
--     final_asset_id AT INSERT TIME — you cannot publish an asset
--     that isn't the run's currently-selected final output. Once
--     inserted, this row is frozen; later changes to a run's
--     final_asset_id do not retroactively alter past Publications.
-- No separate direct FK to asset(id) is needed for published_asset_id:
-- it's transitively guaranteed correct via production_run.final_asset_id,
-- which already has a real FK to asset(id).

CREATE UNIQUE INDEX idx_publication_external_post
  ON publication(account_id, platform, external_post_id)
  WHERE external_post_id IS NOT NULL;

CREATE TABLE metric_snapshot (
  id INTEGER PRIMARY KEY,
  publication_id INTEGER NOT NULL REFERENCES publication(id),
  captured_at TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('manual','api','csv','agent')),
  qualified_exposure_metric_name TEXT,
  qualified_exposure_value REAL,
  raw_metrics TEXT NOT NULL CHECK (json_valid(raw_metrics)),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE review_event (
  id INTEGER PRIMARY KEY,
  creative_id INTEGER NOT NULL REFERENCES creative(id),
  production_run_id INTEGER,
  event_type TEXT NOT NULL
    CHECK (event_type IN ('approved','rejected','regenerate_requested','edited_in_studio','edited_in_canvas')),
  reason_code TEXT,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (production_run_id, creative_id) REFERENCES production_run(id, creative_id)
);
-- production_run_id is nullable (workspace-level events like
-- edited_in_studio may have none) but when set, the composite FK
-- guarantees it belongs to this same Creative — same pattern as
-- Publication above, applied here for the identical reason.

CREATE INDEX idx_product_test_product ON product_test(product_id);
CREATE INDEX idx_iteration_product_test ON iteration(product_test_id);
CREATE INDEX idx_creative_iteration ON creative(iteration_id);
CREATE INDEX idx_production_run_creative ON production_run(creative_id);
CREATE INDEX idx_job_production_run ON job(production_run_id);
CREATE INDEX idx_asset_link_asset ON asset_link(asset_id);
CREATE INDEX idx_asset_link_creative ON asset_link(creative_id);
CREATE INDEX idx_asset_link_production_run ON asset_link(production_run_id);
CREATE INDEX idx_cost_iteration ON cost(iteration_id);
CREATE INDEX idx_cost_job ON cost(job_id);
CREATE INDEX idx_budget_reservation_iteration ON budget_reservation(iteration_id);
CREATE INDEX idx_budget_reservation_status ON budget_reservation(status);
CREATE INDEX idx_publication_creative ON publication(creative_id);
CREATE INDEX idx_metric_snapshot_publication ON metric_snapshot(publication_id);
CREATE INDEX idx_review_event_creative ON review_event(creative_id);
