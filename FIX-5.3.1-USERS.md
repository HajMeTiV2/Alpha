# ALPHA 5.3.1 — Users API fix

Fixed a route-ordering bug in `src/index.js`.

The professional users page calls:
`GET /api/users/advanced`

The generic:
`GET /api/users/:id`

route previously ran first and treated `advanced` as a user ID, returning 404 (`not found`).

The professional `/api/users/advanced` route is now matched before the generic user-detail route.

No database migration is required for this fix.

Deploy:
```bash
npx wrangler deploy
```
