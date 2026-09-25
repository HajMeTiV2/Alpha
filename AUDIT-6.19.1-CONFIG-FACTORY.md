# ALPHA 6.19.1 — Config Factory UI Rebuild

This release replaces the previous Config Studio presentation with a mobile-first Config Factory layout.

## Main flow
1. User & Subscription
2. Cloudflare Ports
3. IP Repository
4. Proxy Repository
5. Manual Settings
6. Validation / Preview / Create
7. Sub Link
8. Snapshot History

## UI changes
- Config Factory is full-width when opened.
- The unrelated global sidebar is hidden while the factory is active.
- Mobile layout is single-column and follows the build workflow.
- Repository, builder, preview and history are all visible in one continuous workspace.
- Quick navigation anchors were added for long mobile pages.
- Config view is reset to the top when opened.

## Functional notes
- Existing D1 schema 0021 is reused.
- No new migration is required.
- IP and Proxy repositories remain independent.
- Proxy country selection remains available to align the selected proxy with the build.
- Cloudflare TLS/non-TLS ports and manual ports remain supported.
- Manual advanced settings, templates, snapshots and subscription link remain supported.

## Verification
- `node --check public/app.js`
- `node --check src/index.js`
