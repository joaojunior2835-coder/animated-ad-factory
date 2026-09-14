-- Per-attempt execution outcome. job_execution_attempt (0003) stays the
-- single source of truth for provider-facing execution state — nothing here
-- duplicates it onto job. An earlier draft of this migration added
-- external_request_id/provider_status/last_checked_at onto job as well; an
-- audit found them written on every update but read by no query anywhere in
-- the codebase (the one status-list query, listProductionRunStatusesForIteration,
-- already joins job_execution_attempt directly), so they were dropped before
-- this migration was ever applied.
ALTER TABLE job_execution_attempt ADD COLUMN result_data TEXT CHECK (result_data IS NULL OR json_valid(result_data));
ALTER TABLE job_execution_attempt ADD COLUMN failure_classification TEXT;
ALTER TABLE job_execution_attempt ADD COLUMN error_message TEXT;
