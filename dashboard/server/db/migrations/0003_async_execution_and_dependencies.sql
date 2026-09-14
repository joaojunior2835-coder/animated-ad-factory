-- M5 async execution state and dependency graph.
-- Keep provider request identity and raw provider status separate from the
-- logical Job status so restart reconciliation can resume without guessing.
CREATE TABLE job_execution_attempt (
  id INTEGER PRIMARY KEY,
  job_id INTEGER NOT NULL REFERENCES job(id),
  dispatch_attempt INTEGER NOT NULL,
  external_request_id TEXT NOT NULL,
  provider_status TEXT,
  dispatched_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_checked_at TEXT,
  reconciliation_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (reconciliation_status IN ('pending','reconciled','reconciliation_required')),
  UNIQUE(job_id, dispatch_attempt),
  UNIQUE(external_request_id)
);

CREATE INDEX idx_job_execution_attempt_pending
  ON job_execution_attempt(reconciliation_status, last_checked_at);
CREATE INDEX idx_job_execution_attempt_job
  ON job_execution_attempt(job_id);

CREATE TABLE job_dependency (
  id INTEGER PRIMARY KEY,
  job_id INTEGER NOT NULL REFERENCES job(id),
  depends_on_job_id INTEGER NOT NULL REFERENCES job(id),
  dependency_type TEXT NOT NULL DEFAULT 'completion',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (job_id <> depends_on_job_id),
  UNIQUE(job_id, depends_on_job_id, dependency_type)
);

CREATE INDEX idx_job_dependency_job
  ON job_dependency(job_id);
CREATE INDEX idx_job_dependency_depends_on
  ON job_dependency(depends_on_job_id);
