CREATE TABLE IF NOT EXISTS node_health_history (
  id TEXT PRIMARY KEY,
  node_id TEXT NOT NULL,
  checked_at INTEGER NOT NULL,
  status TEXT NOT NULL,
  latency_ms INTEGER,
  error TEXT,
  FOREIGN KEY(node_id) REFERENCES nodes(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_node_health_node_time ON node_health_history(node_id, checked_at DESC);
CREATE INDEX IF NOT EXISTS idx_node_health_time ON node_health_history(checked_at DESC);
