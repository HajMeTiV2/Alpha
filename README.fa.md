# ALPHA v2.0
نسخه دوم مستقل Alpha بر پایه Cloudflare Workers + D1.

```bash
npm install
npx wrangler login
npx wrangler d1 create alpha-db
```

شناسه D1 را داخل `wrangler.toml` بگذار، سپس:

```bash
npx wrangler secret put ALPHA_ADMIN_PASSWORD
npm run db:migrate:remote
npm run deploy
```

توکن Cloudflare یا رمز را داخل GitHub و سورس کد قرار نده.
