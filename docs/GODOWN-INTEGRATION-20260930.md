# Mapping integration release gate

Base: production 074bcc3. Integration keeps the deployed cached checklist while bringing mapping controls and migration 041 forward from the reviewed inventory branch. Migration 041 has not been applied; user activation approval is pending. No stock changes are authorized by this release.

RED: `node tests/godown-review-browser.mjs` failed with 10 calculations versus expected 1. The newly integrated mapping column independently called the full reconciliation calculator on each redraw. Preserve the existing performance test and reuse the cached group list.

GREEN: mapping column now reuses `tallyReadiness`. Nine focused unit tests passed. All four executables passed: `godown-mapping-database.mjs`, `godown-review-browser.mjs`, `godown-mapping-browser.mjs`, `godown-mapping-integration.mjs`. PGLITE_MODULE pointed to the existing local isolated runtime; no production database access. Checks cover authorization, immutable history, retries, stale versions, inactive/unknown locations, unresolved mappings, immediate history/status, retained search cache and unchanged source/operational stock. The database-only test now accepts PGLITE_MODULE instead of a vanished temporary directory. Coverage percentage not measured.

Release remains blocked on final independent review, user activation approval, actual schema activation and signed-in live save/read verification. Do not merge and expose controls before that gate. Migrations 042/043 and later Claude migrations are not included or reapplied.
