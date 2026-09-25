# ALPHA 6.19 Config Studio Audit

## Scope
Rebuilt the Config Builder as a dedicated mobile-first Config Studio inspired by the operational UX patterns seen in ZEUS, without copying its source code.

## Included
- User selection and inline new-user flow
- Quota, device limit, status and expiry controls
- Subscription link display/copy/open
- Cloudflare TLS ports: 443, 2053, 2083, 2087, 2096, 8443
- Cloudflare non-TLS ports: 80, 8080, 8880, 2052, 2082, 2086, 2095
- Custom ports
- IP repository + ZEUS suggestions
- Proxy repository + country filtering + ZEUS suggestions
- Country-aware proxy selection after IP selection
- Manual security, transport, routing/limits and fragment/TLS settings
- Validation, preview, templates and snapshot history
- Existing user's quota/device/status/expiry synchronized on save
- Multi-port VLESS preview generation

## Migration
No new migration is required. ALPHA 6.18/0021 repository, template and snapshot tables are reused.

## Checks
- `node --check src/index.js` passed
- `node --check public/app.js` passed
- `package.json` parsed successfully
- Config Studio contains no nested `<main>` element
- ZIP integrity verified after packaging

## Production follow-up
Run the existing D1 migrations through 0021 if not already applied, then deploy and manually test the Config Studio on a real mobile viewport and desktop viewport.
