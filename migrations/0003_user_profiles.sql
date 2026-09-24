ALTER TABLE users ADD COLUMN client_uuid TEXT;
ALTER TABLE users ADD COLUMN subscription_token TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_subscription_token ON users(subscription_token);
CREATE INDEX IF NOT EXISTS idx_users_client_uuid ON users(client_uuid);
