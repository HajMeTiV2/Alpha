# ALPHA v4.2 — Glass Dashboard Final

این بسته Dashboard اصلی ALPHA را به طراحی Glass حرفه‌ای تبدیل می‌کند.

## فایل‌های تغییرکرده
- `public/index.html` — ساختار Dashboard و Header/Sidebar
- `public/styles.css` — استایل Glass و Responsive
- `public/app.js` — اتصال Dashboard به APIهای موجود برای آمار، کاربران، نودها و Activity

## نکته
هیچ migration، D1 schema، secret یا `src/index.js` تغییر نکرده است.
نمودار کوچک ترافیک از `used_gb` کاربران ساخته می‌شود و ادعای تاریخچه ساعتی ندارد، چون API فعلی ALPHA تاریخچه ساعتی ترافیک ارائه نمی‌کند.

پس از جایگزینی این سه فایل در GitHub، Cloudflare Deploy/Build معمول خود را اجرا می‌کند.
