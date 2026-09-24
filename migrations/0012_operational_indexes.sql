-- ALPHA 6.0 — operational query indexes
CREATE INDEX IF NOT EXISTS idx_users_status_expiry_used ON users(status, expires_at, used_gb);
CREATE INDEX IF NOT EXISTS idx_users_updated_status ON users(updated_at, status);
CREATE INDEX IF NOT EXISTS idx_nodes_status_updated ON nodes(status, updated_at);
CREATE INDEX IF NOT EXISTS idx_notifications_level_read ON panel_notifications(level, is_read, created_at);
