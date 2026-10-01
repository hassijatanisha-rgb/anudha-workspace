# Stock-count retry correction — review candidate only

Journey: staff retry a count after losing the response; identical content returns
the saved record, changed content must fail rather than appear saved.

Baseline: cached origin/main c9cff60 (fetch initially failed DNS). Migration 047
compared only actor/session/godown/code/quantity/unit. Batch, expiry, condition,
notes and unlisted description were ignored. Its old test incorrectly retried a
batched/dated count without those fields. Corrected that fixture to same content.

RED 246847b: executed tests/stock-count-database.mjs against 047; failed with
`Missing expected rejection` on changed batch. GREEN dbfc121: new forward-only
052 replaces record_stock_count with comparisons matching insert normalization.
Applied migration 047 is unchanged. No stock, rows, role grants or signatures change.

Validation (2026-10-01):

- `PGLITE_MODULE=<local PGlite module> node tests/stock-count-database.mjs`: 66 checks pass after the session follow-up below.
- `node --test tests/stock-count.test.mjs tests/inventory-import-workflow.test.mjs`: eight pass, zero skipped.
- `git diff --check`: clean.

Checks include changed/missing batch, expiry, condition, notes and unlisted text;
normalized replay; different actor rejection; authenticated role calls; unchanged
stock; no duplicate counts; migration reapplication preserving existing rows; ACLs.

Limitations: disposable PGlite fixtures, no live Supabase or signed-in browser
acceptance, no concurrency load test or measured SQL coverage percentage.
Count-versus-session-close locking remains a separate audit item.
Review-to-operational-stock import remains unimplemented; accepted counts
are not saleable inventory. Independent review and authorized activation required.
Retirement must use a reviewed forward migration; do not restore permissive retries.

## 04:10 UTC session follow-up

RED 2b7f5a7 reproduces open_stock_count returning the old session for a different
requested name. The still-unapplied 052 candidate now also replaces that function:
same creator and normalized name are required for replay, null IDs fail explicitly,
and equal IDs serialize through an advisory transaction lock. The existing unique
open-session constraint remains unchanged. Tests also reject another owner's replay,
accept whitespace-normalized names and prove retries do not reopen closed sessions.
No concurrent-session execution proof is claimed from single-instance PGlite.
PR #12 was open with no review or comments at the start of this cycle.
# Migration identifier update — 1 October, 08:12 UTC

The unapplied candidate is now `202610010056_stock_count_retry_content.sql`, not 052.
Main bd87100 records concurrent migrations 050–053 as applied. Their files are
unchanged. This renumber only changes this candidate's path/test reference and adds
a comment; 66 isolated DB checks still pass. Historical references below retain
the original identifier. Integration with the new main trigger chain is still required.

## 17:51 UTC migration identifier correction

Fresh main contains `202610010056_team_tasks.sql`, colliding with this unapplied candidate's numeric version. PR12 remains open with no review/comments. Renamed only the candidate to `20261001175113_stock_count_retry_content.sql` and updated its test reference. SQL executable content is unchanged; applied migrations are untouched. This resolves the release filename collision, not database activation or integration acceptance.
