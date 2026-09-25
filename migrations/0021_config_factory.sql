CREATE TABLE IF NOT EXISTS config_ip_repository (
  id TEXT PRIMARY KEY,
  address TEXT NOT NULL UNIQUE,
  port INTEGER,
  country TEXT NOT NULL DEFAULT 'Unknown',
  city TEXT NOT NULL DEFAULT '',
  provider TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'manual',
  status TEXT NOT NULL DEFAULT 'active',
  latency_ms INTEGER,
  last_checked_at INTEGER,
  tags TEXT NOT NULL DEFAULT '[]',
  notes TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_config_ip_status_latency ON config_ip_repository(status,latency_ms);
CREATE INDEX IF NOT EXISTS idx_config_ip_country ON config_ip_repository(country);

CREATE TABLE IF NOT EXISTS config_proxy_repository (
  id TEXT PRIMARY KEY,
  host TEXT NOT NULL,
  port INTEGER NOT NULL,
  type TEXT NOT NULL DEFAULT 'HTTP',
  username TEXT NOT NULL DEFAULT '',
  password TEXT NOT NULL DEFAULT '',
  country TEXT NOT NULL DEFAULT 'Unknown',
  provider TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'manual',
  status TEXT NOT NULL DEFAULT 'active',
  latency_ms INTEGER,
  last_checked_at INTEGER,
  tags TEXT NOT NULL DEFAULT '[]',
  notes TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_config_proxy_status_latency ON config_proxy_repository(status,latency_ms);
CREATE INDEX IF NOT EXISTS idx_config_proxy_host_port ON config_proxy_repository(host,port);

CREATE TABLE IF NOT EXISTS config_templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  mode TEXT NOT NULL DEFAULT 'simple',
  settings_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS config_snapshots (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'active',
  user_id INTEGER,
  template_id TEXT,
  settings_json TEXT NOT NULL DEFAULT '{}',
  config_text TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_config_snapshots_name_version ON config_snapshots(name,version DESC);
CREATE INDEX IF NOT EXISTS idx_config_snapshots_created ON config_snapshots(created_at DESC);
