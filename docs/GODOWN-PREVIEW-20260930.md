# Isolated mapping preview

Start: bundled Node tests/godown-preview-server.mjs. URL http://127.0.0.1:4186/; loopback only. In-memory fictional data; reset on process restart. No Supabase/config.js served. Only allowlisted files/queries and mapping RPC. Host/origin/content-type checks and 8KB request limit. Official pinned PGlite0.3.14 dependency in sibling test-runtime.

RED cd91b47: missing preview server. GREEN tests/godown-preview.test.mjs: eight labels, local page, foreign-origin write rejection, config.js404. Actual in-app browser opened eight buttons, opened CITY PRINTER, saved fictional mapping through actual local SQL and visibly received Mapping saved. Stock quantities unchanged.

This is a mapping-only review page, not completed stock import or full inventory acceptance. Only one fictional target location is seeded deliberately; source labels are eight, all balances fictional. No real godown mapping inferred. Operational import, full inventory preview, approval, migration activation and live verification remain. Accounting paused. Do not copy this fixture server into production.
