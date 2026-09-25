# ALPHA 6.19 — Config Studio

Config Studio is a mobile-first, Zeus-inspired configuration workspace. It combines user quota/expiry management, Cloudflare port presets, IP and proxy repositories, country-aware proxy selection, manual transport/security settings, subscription links, validation, preview, templates and snapshots.

No billing/price fields are used. Existing D1 tables from 0021 are reused; no new migration is required for 6.19.

Cloudflare port presets:
- TLS: 443, 2053, 2083, 2087, 2096, 8443
- Non-TLS: 80, 8080, 8880, 2052, 2082, 2086, 2095

When a configuration is saved for an existing user, quota, device limit, status and expiry are synchronized to that user. The generated snapshot stores the selected IP/Proxy and builder settings.
