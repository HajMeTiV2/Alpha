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


## ALPHA v5
این نسخه یک Control Center یکپارچه برای مدیریت کاربران، اشتراک‌ها، Nodeها، ترافیک، Audit، Backup، دسترسی ادمین، PWA و تنظیمات پنل است. Wrangler در نسخه ثابت 4.138.0 پین شده تا نصب Build قابل تکرار باشد. تاریخچه ترافیک با جدول D1 و Cron ساعتی ثبت می‌شود.

قابلیت‌های شبکه‌ی مرتبط با دورزدن DPI، جعل اثرانگشت، Fragmentation و Scannerهای مخفیانه جزو این پیاده‌سازی نیستند.
