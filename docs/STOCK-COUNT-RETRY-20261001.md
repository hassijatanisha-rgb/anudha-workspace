# Stock-count retry correction — review candidate only

Journey: staff retry a count after losing the response; identical content returns
the saved record, changed content must fail rather than appear saved.

Baseline: cached origin/main c9cff60 (fetch initially failed DNS). Migration 047
compared only actor/session/godown/code/quantity/unit. Batch, expiry, condition,
notes and unlisted description were ignored. Its old test incorrectly retried a
batched/dated count without those fields. Corrected that fixture to same content.

RED 246847b: executed tests/stock-count-database.mjs against 047; failed with
`Missing expected rejection` on changed batch. GREEN dbfc121: new forward-only
052 replaces only record_stock_count with comparisons matching insert normalization.
Applied migration 047 is unchanged. No stock, rows, role grants or signatures change.

Validation (2026-10-01):

- `PGLITE_MODULE=<local PGlite module> node tests/stock-count-database.mjs`: 61 checks pass.
- `node --test tests/stock-count.test.mjs tests/inventory-import-workflow.test.mjs`: eight pass, zero skipped.
- `git diff --check`: clean.

Checks include changed/missing batch, expiry, condition, notes and unlisted text;
normalized replay; different actor rejection; authenticated role calls; unchanged
stock; no duplicate counts; migration reapplication preserving existing rows; ACLs.

Limitations: disposable PGlite fixtures, no live Supabase or signed-in browser
acceptance, no concurrency load test or measured SQL coverage percentage. Session
opening retry content and count-versus-session-close locking remain separate audit
items. Review-to-operational-stock import remains unimplemented; accepted counts
are not saleable inventory. Independent review and authorized activation required.
Retirement must use a reviewed forward migration; do not restore permissive retries.
