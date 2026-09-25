CREATE TABLE IF NOT EXISTS backup_manifests (
  id TEXT PRIMARY KEY,
  checksum TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  table_count INTEGER NOT NULL DEFAULT 0,
  row_count INTEGER NOT NULL DEFAULT 0,
  notes TEXT
);
CREATE INDEX IF NOT EXISTS idx_backup_manifests_created ON backup_manifests(created_at DESC);
