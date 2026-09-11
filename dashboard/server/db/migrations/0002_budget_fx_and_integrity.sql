-- Rebuild budget_reservation: Phase 1 gave it a single currency-blind
-- amount field, which cannot correctly compare a USD provider estimate
-- against a EUR iteration ceiling. Every reservation now captures the
-- same original/base/fx shape that Cost already uses.
CREATE TABLE budget_reservation_new (
  id INTEGER PRIMARY KEY,
  iteration_id INTEGER NOT NULL REFERENCES iteration(id),
  creative_id INTEGER REFERENCES creative(id),
  production_run_id INTEGER REFERENCES production_run(id),
  job_id INTEGER NOT NULL REFERENCES job(id),
  dispatch_attempt INTEGER NOT NULL,
  original_amount_minor INTEGER NOT NULL,
  original_currency TEXT NOT NULL,
  base_currency_amount_minor INTEGER NOT NULL,
  base_currency TEXT NOT NULL DEFAULT 'EUR',
  fx_rate REAL NOT NULL,
  fx_rate_source TEXT NOT NULL,
  fx_rate_captured_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','consumed','released','cancelled')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at TEXT,
  UNIQUE(job_id, dispatch_attempt)
);

INSERT INTO budget_reservation_new
  (id, iteration_id, creative_id, production_run_id, job_id,
   dispatch_attempt, status, created_at, resolved_at,
   original_amount_minor, original_currency,
   base_currency_amount_minor, base_currency,
   fx_rate, fx_rate_source, fx_rate_captured_at)
SELECT id, iteration_id, creative_id, production_run_id, job_id,
  dispatch_attempt, status, created_at, resolved_at,
  reserved_amount_minor, currency,
  reserved_amount_minor, currency,
  1.0, 'legacy_migration', created_at
FROM budget_reservation;

DROP TABLE budget_reservation;
ALTER TABLE budget_reservation_new RENAME TO budget_reservation;

CREATE INDEX idx_budget_reservation_iteration ON budget_reservation(iteration_id);
CREATE INDEX idx_budget_reservation_status ON budget_reservation(status);

-- At most one final_video AssetLink per ProductionRun, enforced at
-- the DB level (defense-in-depth alongside the repository logic that
-- downgrades any prior final_video link before setting a new one).
CREATE UNIQUE INDEX idx_asset_link_one_final_per_run
  ON asset_link(production_run_id)
  WHERE role = 'final_video';

-- Rebuild cost: enforce that charge rows are always positive spend
-- and adjustment rows are always a nonzero signed correction — no
-- zero-value noise rows in the financial ledger.
CREATE TABLE cost_new (
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
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (
    (event_type = 'charge'
      AND original_amount_minor > 0 AND base_currency_amount_minor > 0)
    OR
    (event_type = 'adjustment'
      AND original_amount_minor != 0 AND base_currency_amount_minor != 0)
  )
);

INSERT INTO cost_new SELECT * FROM cost;
DROP TABLE cost;
ALTER TABLE cost_new RENAME TO cost;

CREATE INDEX idx_cost_iteration ON cost(iteration_id);
CREATE INDEX idx_cost_job ON cost(job_id);
