# ALPHA 6.19 — Config Factory

- IP Repository and Proxy Repository
- Simple / Advanced accordion builder
- Templates / Presets
- Validation and preview
- Versioned config snapshots
- Repository selections are snapshotted with generated config metadata
- No pricing/billing fields were added

Migration: `0021_config_factory.sql`


## 6.19.3 — ZEUS Suggested Sources
- Added live suggested IPs from the public ZEUS `ips.txt` repository.
- Added country-scoped suggested proxies from the ZEUS `proxy/*.txt` repository.
- Suggestions are sampled, marked unverified, and are not used until the admin explicitly imports them into the ALPHA repository.
- Imported suggestions are tagged `suggested` and `zeus` and include a note to test before use.
- No price, billing, or cost fields were added.
