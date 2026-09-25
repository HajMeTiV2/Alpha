-- ALPHA 6.14 — performance indexes for high-frequency admin queries
CREATE INDEX IF NOT EXISTS idx_users_country_status_created ON users(country, status, created_at);
CREATE INDEX IF NOT EXISTS idx_users_expires_status ON users(expires_at, status);
CREATE INDEX IF NOT EXISTS idx_activity_created_action ON activity_logs(created_at, action);
CREATE INDEX IF NOT EXISTS idx_traffic_captured ON traffic_snapshots(captured_at);
CREATE INDEX IF NOT EXISTS idx_health_node_checked ON node_health_history(node_id, checked_at);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_created_status ON webhook_deliveries(created_at, status);
CREATE INDEX IF NOT EXISTS idx_job_runs_started_status ON automation_job_runs(started_at, status);
