-- Phase 0 seed. Idempotent: safe to run more than once.
-- The Regenera advisory mandate (RA-ESG and GWCe arrive in phase 4 as investment mandates).
INSERT OR IGNORE INTO mandates (id, slug, name, type, rules)
VALUES ('mandate_regenera', 'regenera', 'Regenera', 'advisory', '{"massAllowed":true,"approvalRequired":true}');

-- Heartbeat proves the scheduler end to end. First run on the next tick.
INSERT OR IGNORE INTO job_schedules (id, job_type, cadence, next_run_at)
VALUES ('schedule_heartbeat', 'system.heartbeat', 'every:5m', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
