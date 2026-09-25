# ALPHA / ZEUS Audit — 2026-09-25

## بررسی انجام‌شده
- ساختار و مستندات ZEUS و فایل اصلی `Source.js` بررسی شد.
- کل ساختار ALPHA شامل Worker، UI، migrations و endpointهای استفاده‌شده توسط UI بررسی شد.
- تست syntax برای `src/index.js` و `public/app.js` انجام شد.

## چیزهایی که ZEUS دارد و ALPHA باید از نظر محصولی/مدیریتی پوشش دهد
1. مدیریت کاربر و اشتراک با عملیات گروهی.
2. مانیتورینگ Node و latency.
3. مرکز امنیت و Audit.
4. Backup/Export.
5. PWA و UI واکنش‌گرا.
6. تنظیمات پنل و اعلان‌ها.
7. داشبورد عملیاتی با وضعیت سیستم.

این موارد در ALPHA تا حد زیادی وجود داشتند، اما بخشی از APIهای پشت UI اصلاً به Router متصل نبودند؛ بنابراین بعضی قابلیت‌های ظاهراً موجود در عمل 404 می‌شدند.

## ایرادهای مهم پیدا شده در ALPHA
- APIهای `users/advanced`, `users/bulk`, `users/:id/extend` به Router وصل نبودند.
- APIهای `nodes/stats`, `nodes/:id/health`, `nodes/monitor` به Router وصل نبودند.
- Installer قبل از وجود session مدیریتی، به دلیل auth middleware عملاً قابل استفاده نبود.
- Login rate limiting نداشت.
- Backup شامل `admin_sessions` بود؛ این داده نباید در backup عمومی مدیریتی قرار بگیرد.
- Health check نودها endpoint را بدون validation به Worker fetch می‌کردند.
- نسخه‌ها در package/README/UI هماهنگ نبودند.
- سیستم Role در دیتابیس/UI وجود داشت، اما authentication فعلی هنوز یک shared admin password است؛ بنابراین Roleها هنوز کنترل دسترسی واقعی چندادمینی نیستند.

## اصلاحات انجام‌شده در ALPHA
- اتصال کامل endpointهای missing به Router.
- فعال‌سازی Installer بدون session، با این محدودیت که Cloudflare token فقط در همان request استفاده می‌شود و ذخیره نمی‌شود.
- اضافه شدن migration `0011_auth_rate_limits.sql`.
- محدودسازی login پس از 8 تلاش ناموفق از یک IP برای 15 دقیقه.
- حذف session tokenها از backup و افزودن داده‌های مدیریتی غیرحساس موردنیاز.
- validation برای endpointهای Node و جلوگیری از localhost/private IPv4 در health checks.
- اضافه شدن security headers پایه به پاسخ‌ها.
- `no-store` برای subscription responses.
- هماهنگ‌سازی نسخه ALPHA روی 5.3.
- syntax check موفق برای Worker و frontend.

## نکته امنیتی درباره ZEUS
در ZEUS قابلیت‌ها و تجربه عملیاتی بسیار گسترده‌تر است، اما برای انتقال معماری آن به ALPHA نباید صرفاً کد را کپی کرد. از جمله، مدل session در ZEUS به password hash وابستگی مستقیم دارد؛ برای ALPHA این الگو توصیه نمی‌شود. همچنین قابلیت‌های شبکه‌ای/ضدسانسور ZEUS عمداً به ALPHA اضافه نشده‌اند؛ تمرکز این نسخه روی پنل مدیریتی، پایداری، امنیت و UX است.

## وضعیت
ALPHA از نظر پنل مدیریتی نسبت به نسخه دریافت‌شده کامل‌تر و قابل اتکاتر شده، اما برای «Production کامل» هنوز پیشنهاد می‌شود در مرحله بعد:
- multi-admin واقعی با credential مستقل و RBAC اجرایی پیاده شود.
- backup restore با migration-aware validation اضافه شود.
- تست end-to-end روی Cloudflare D1 واقعی انجام شود.
- health check نودها با probe اختصاصی و قابل تنظیم طراحی شود.
- pagination سمت سرور برای کاربران/اشتراک‌ها اضافه شود.


## ALPHA 6.0 — تکمیل مرحله عملیات و UX
- مرکز Operations به داشبورد اضافه شد و مواردی مثل Node آفلاین، انقضای نزدیک، سهمیه تمام‌شده، کاربران معلق و اعلان‌های خوانده‌نشده را برجسته می‌کند.
- Command Palette با `Ctrl/Cmd + K` برای ناوبری سریع و عملیات پرتکرار اضافه شد.
- صفحه Node از حالت ساده به مانیتورینگ واقعی UI متصل شد: آمار Node، Health Check همه، Auto Check و کارت‌های وضعیت.
- migration `0012_operational_indexes.sql` برای queryهای عملیاتی اضافه شد.
- نسخه UI/Worker/Health به 6.0.0 هماهنگ شد.
- Syntax check برای Worker و frontend با موفقیت انجام شد.

### تصمیم محصولی درباره ZEUS
الگوهای UX قابل انتقال مانند کارت‌های گروه‌بندی‌شده، preset/quick action، هشدار زمینه‌ای، navigation سریع و تأیید عملیات در نظر گرفته شدند. قابلیت‌های مرتبط با proxy harvesting/rotation، scanner، DPI evasion و traffic obfuscation عمداً وارد ALPHA نشدند؛ تمرکز ALPHA روی مدیریت، observability، امنیت و UX است.
