CREATE TABLE IF NOT EXISTS subscription_nodes (
  user_id TEXT NOT NULL,
  node_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(user_id,node_id),
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY(node_id) REFERENCES nodes(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_subscription_nodes_node ON subscription_nodes(node_id);
CREATE INDEX IF NOT EXISTS idx_users_subscription_status_expiry ON users(status, expires_at);
