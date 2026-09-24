ALTER TABLE admin_sessions ADD COLUMN ip TEXT;
ALTER TABLE admin_sessions ADD COLUMN user_agent TEXT;
CREATE INDEX IF NOT EXISTS idx_sessions_ip ON admin_sessions(ip);
CREATE INDEX IF NOT EXISTS idx_sessions_created ON admin_sessions(created_at);
