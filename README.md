# ALPHA v2.0
Independent Cloudflare Workers + D1 control panel.

## Deploy
1. `npm install`
2. `npx wrangler login`
3. `npx wrangler d1 create alpha-db`
4. Put the returned ID in `wrangler.toml`
5. `npx wrangler secret put ALPHA_ADMIN_PASSWORD`
6. `npm run db:migrate:remote`
7. `npm run deploy`

Never commit Cloudflare API tokens or passwords. The UI is served by the Worker; a `/panel` route can be mapped to the same app when the final domain is selected.

Brand: ALPHA | Channel: @V2rayTun0 | Creator: @Mehtif

## Installer
The web app includes an Alpha installer wizard. It verifies a supplied Cloudflare API token and can create the D1 database. The token is never written to D1, cookies, or source files. After D1 creation, complete migration/secret/deploy from the shown commands. For production, protect or remove the public installer route after setup.


## Panel URL
After deployment, the application is available at `/panel` as well as the root route. Example:
`https://YOUR-WORKER.workers.dev/panel`

The installer can verify a Cloudflare API token and create an Alpha D1 database. Do not paste real tokens into source files, GitHub issues, commits, or chat.


## Alpha v2.3
Adds node CRUD and subscription management APIs/UI. Run the new migration after deployment:
`npx wrangler d1 migrations apply alpha-db --remote`


## Alpha v2.4 — User Profiles & Subscriptions
- Per-user opaque subscription token
- User detail/profile view
- Copyable subscription URL
- Browser-generated QR code
- VLESS configuration templates from active Alpha nodes
- User UUID generated automatically
- New D1 migration: `0003_user_profiles.sql`

Run:
`npx wrangler d1 migrations apply alpha-db --remote`


## Alpha v2.6 — Professional User Management
Adds searchable/sortable user management, status filters, bulk actions, user detail drawer/modal, quota/device editing, suspend/activate, subscription extension, and CSV export.
Run:
`npx wrangler d1 migrations apply alpha-db --remote`


## Alpha v2.7 — Node Monitoring
Adds per-node health checks, bulk monitoring, online/offline status, latency, last-seen timestamps, node statistics, and optional 60-second auto checks.
Run:
`npx wrangler d1 migrations apply alpha-db --remote`


## Alpha v2.8 — Subscription Center
Advanced subscription search/filtering, expiry awareness, renewal, multi-node assignment API, bulk management endpoints, and CSV export.

After deployment run:
`npx wrangler d1 migrations apply alpha-db --remote`


## Alpha v2.9 — Security + Audit Center
Adds security status checks, searchable audit log, D1 backup export, and audit indexes.

After deployment:
`npx wrangler d1 migrations apply alpha-db --remote`


## Alpha v3.0 — Production + PWA
- PWA manifest, service worker and install prompt
- Production Center with security/node/PWA status
- Mobile install support
- Static asset caching without caching `/api/*`
- Deployment remains Cloudflare Workers + D1

Deployment:
`npm install`
`npx wrangler d1 migrations apply alpha-db --remote`
`npx wrangler secret put ALPHA_ADMIN_PASSWORD`
`npx wrangler deploy`


## Alpha v3.1 — Control Center
Adds admin role records (owner/admin/operator/viewer), status controls, system health endpoint, and a settings/access UI.

After deployment:
`npx wrangler d1 migrations apply alpha-db --remote`


## Alpha v3.2 — UI/UX + Notifications
Adds configurable theme/accent/compact mode, persistent panel settings, and notification center APIs/UI.

Migration:
`npx wrangler d1 migrations apply alpha-db --remote`


## Alpha v5.3 — Professional hardening
- Wired the advanced user-management and node-monitoring endpoints used by the UI.
- Added DB-backed login throttling after repeated failed attempts.
- Removed admin session tokens from backup exports.
- Added node endpoint validation before worker-side health checks.
- Added security-oriented `no-store` headers to public subscription responses.
- Added migration `0011_auth_rate_limits.sql`.

After deployment run:
`npx wrangler d1 migrations apply alpha-db --remote`


## Alpha v6.0 — Operations Suite
- Operations summary endpoint for expiring users, exhausted quotas, offline/stale nodes and unread notifications.
- New dashboard attention center with actionable alerts.
- Global Command Palette (`Ctrl/Cmd + K`) with navigation and common operations.
- Improved keyboard-first navigation and mobile-friendly command UI.
- Added operational indexes in migration `0012_operational_indexes.sql`.
- Version labels and health endpoint aligned to 6.0.0.

This release focuses on management UX, observability and operational safety. It intentionally does not copy ZEUS features related to stealth scanning, proxy harvesting/rotation, DPI evasion or traffic-obfuscation controls.
