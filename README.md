# ALPHA PANEL

ALPHA is a standalone Cloudflare Workers + D1 network command center.

- Channel: `@V2rayTun0`
- Author: `@Mehtif`
- Repository: `HajMeTiV2/Alpha`

## Quick start

1. Install Node.js.
2. Run `npm install`.
3. Create a Cloudflare D1 database.
4. Put its ID in `wrangler.toml`.
5. Run the migration with Wrangler.
6. Start locally with `npm run dev`.

Do not commit secrets. If you enable `ALPHA_ADMIN_KEY`, send it as the `x-alpha-key` header.
