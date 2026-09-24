CREATE TABLE IF NOT EXISTS traffic_snapshots (
  id TEXT PRIMARY KEY,
  captured_at INTEGER NOT NULL,
  total_used_gb REAL NOT NULL DEFAULT 0,
  users_count INTEGER NOT NULL DEFAULT 0,
  active_users_count INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_traffic_snapshots_captured_at ON traffic_snapshots(captured_at);
