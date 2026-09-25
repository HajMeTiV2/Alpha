CREATE TABLE IF NOT EXISTS automation_jobs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL UNIQUE,
  enabled INTEGER NOT NULL DEFAULT 1,
  interval_minutes INTEGER NOT NULL DEFAULT 60,
  last_run_at INTEGER,
  next_run_at INTEGER,
  last_status TEXT NOT NULL DEFAULT 'never',
  last_duration_ms INTEGER,
  last_error TEXT,
  run_count INTEGER NOT NULL DEFAULT 0,
  fail_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS automation_job_runs (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  status TEXT NOT NULL DEFAULT 'running',
  duration_ms INTEGER,
  details TEXT,
  error TEXT
);
CREATE INDEX IF NOT EXISTS idx_automation_jobs_due ON automation_jobs(enabled,next_run_at);
CREATE INDEX IF NOT EXISTS idx_automation_runs_job ON automation_job_runs(job_id,started_at DESC);
CREATE INDEX IF NOT EXISTS idx_automation_runs_status ON automation_job_runs(status,started_at DESC);

INSERT OR IGNORE INTO automation_jobs
(id,name,type,enabled,interval_minutes,next_run_at,created_at,updated_at)
VALUES
('job-health','Node Health Check','health_check',1,60,NULL,strftime('%s','now')*1000,strftime('%s','now')*1000),
('job-traffic','Traffic Snapshot','traffic_snapshot',1,60,NULL,strftime('%s','now')*1000,strftime('%s','now')*1000),
('job-notifications','Alert Sync','notifications_sync',1,15,NULL,strftime('%s','now')*1000,strftime('%s','now')*1000),
('job-cleanup','Data Cleanup','cleanup',1,1440,NULL,strftime('%s','now')*1000,strftime('%s','now')*1000);
