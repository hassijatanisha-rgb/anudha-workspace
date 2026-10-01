# Pending stock retry-content fix

Status: tested locally; independent review and production activation outstanding.
Base: c9cff60. No accounting, stock, user or permission changes.

## Contract and evidence

User contract: the same request ID and content may safely replay; changed content must conflict. Migration 043 compared neither notes nor salesperson, so a lost-response retry with edited fields appeared saved while returning the old values.

- RED e4db7db: isolated PostgreSQL-compatible PGlite execution failed with `actual: ['notes', 'salesperson']`, expected no accepted changed fields.
- GREEN 559e67d: forward migration 050 adds comparisons against the normalized salesperson and notes; 36 database checks passed and six pending frontend unit tests passed.
- Expanded acceptance: 41 database checks pass, applying the new migration twice over an existing request without changing it. Covers normalized whitespace/null notes, default/explicit assignee equivalence, other-actor conflicts, single history event, untouched stock, unchanged grants, actual anon denial and authenticated replay/conflict.
- `git diff --check`: passed.

Commands (runtime paths configured externally):

```
PGLITE_MODULE=<installed-pglite>/dist/index.js node tests/pending-stock-database.mjs
node --test tests/pending-stock.test.mjs
```

## Deployment and limits

Do not reapply or edit 043. Apply only `20261001095315_pending_retry_content.sql` after review/required activation gate. This replaces one function, keeping its signature, security-definer search path and ACL. No table rewrite or backfill. Rollback requires a reviewed forward function replacement; reverting would restore the known bug, so prefer fixing forward.

No live Supabase activation or browser end-to-end claim. No production-size dataset, multi-connection race/load test or numerical SQL coverage measurement; advisory locking is unchanged. Existing fulfil/cancel permissions and fiscal-reference verification are outside this change and still need workflow acceptance. Accounting remains paused.
# Migration identifier update — 1 October, 08:12 UTC

At 08:12 the unapplied candidate became `202610010054_pending_retry_content.sql`, not 050 (superseded below).
Main bd87100 records concurrent migrations 050–053 as applied. Their files are
unchanged. This renumber only changes this candidate's path/test reference and adds
a comment; 41 isolated DB checks still pass. Historical references below retain
the original identifier. Integration with the new main trigger chain is still required.

## 09:53 UTC identifier correction

Main 1929652 introduced 054_staff_departments. This unapplied candidate now uses `20261001095315_pending_retry_content.sql`, a full UTC timestamp, rather than racing the shared short sequence. Applied migrations remain untouched. SQL behavior is unchanged; the isolated test reference follows the new path. This rename is not production activation or combined-trigger acceptance.
