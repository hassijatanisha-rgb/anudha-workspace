# Pending cancellation permission correction

Status: local tests passed; NOT live. Independent review and activation are outstanding.
Base: c9cff60. Accounting remains paused.

## Scope and role limitation

The workflow baseline prohibits ordinary staff from cancelling pending requests. Existing production code instead permits any assigned salesperson. Current staff provisioning recognizes only `owner` and `staff`; this fix uses the existing owner gate, removes staff cancellation, and does not create head roles or grant broader access. Configured department-head delegation remains a separate delivery requirement, not claimed complete here.

## TDD evidence

- RED 8b0e952: actual isolated SQL accepted salesperson cancellation (`Missing expected rejection`); frontend renderer exposed `data-pending-action="cancel"` to that salesperson.
- GREEN 7d31b5c: separate forward migration 051 adds the owner check; frontend exposes Cancel only to owners. 38 database checks and all six frontend tests passed.
- Expanded checks: 40 isolated database checks pass, including actual authenticated-role staff rejection and owner success, other staff/inactive/unsigned rejection, unchanged waiting row/history on denial, required reason, version increments, duplicate stale request rejection, immutable history and unchanged stock.
- `git diff --check` passed. SQL/JS coverage percentage not measured; no live browser acceptance or production-size test performed.

Commands: `PGLITE_MODULE=<installed runtime>/dist/index.js node tests/pending-stock-database.mjs`; `node --test tests/pending-stock.test.mjs`.

## Release constraints

Migration 043 is unchanged and must not be reapplied. Apply only `20261001112436_pending_cancel_owner.sql` after review/required activation, then publish frontend and verify staff/owner sessions without real business-data tests. The function keeps its signature, ACL, search path, locking, expiry and fulfilment logic; no stock writes or data backfill. A rollback would require a reviewed forward function replacement and would reopen this permission gap, so prefer fixing forward.

PR #8 separately fixes retry-content validation in the creation function. These SQL changes are independent, but both branches edit the database test: preserve both sets of regression checks during integration. This fix does NOT establish verified invoice-linked fulfilment, automatic expiry scheduling, fiscal issuance or complete department permissions.
# Migration identifier update — 1 October, 08:12 UTC

At 08:12 the unapplied candidate became `202610010055_pending_cancel_owner.sql`, not 051 (superseded below).
Main bd87100 records concurrent migrations 050–053 as applied. Their files are
unchanged. This renumber only changes this candidate's path/test reference and adds
a comment; 40 isolated DB checks still pass. Historical references below retain
the original identifier. Integration with the new main trigger chain is still required.

## 11:24 UTC identifier correction

Main now includes 055_hardening. The unapplied cancellation fix is renamed to `20261001112436_pending_cancel_owner.sql` to avoid that collision. SQL behavior is unchanged; applied migrations are untouched. PR9 and PR22 review lookup returned open with no comments/reviews this cycle. This is not approval or activation.

## 2 October integration with main 37c44cb

Merged current main into this isolated review branch without conflict or history rewriting. Main's readable workflow labels remain intact; the only pending-stock.js delta is the owner-only Cancel control. No new permissions, stock writes or changes to applied migrations.

Full Node suite: 254 passed, 40 skipped, zero failed. Extended the disposable pending database suite to execute the entire real 058 two-step migration after the pending cancellation candidate, with minimal prerequisite table/auth fixtures. All 46 checks pass, including authenticated-role denial and hidden pending rows for an enrolled owner at aal1, unchanged version after denial, continued staff cancellation denial at aal2, and owner cancellation at aal2 with unchanged stock. `git diff --check` passes.

This is selected-chain integration, not a full production restore or Supabase browser acceptance. Automatic handoff triggers are not exercised by this fixture. No migration was applied remotely. PR9 and gated PR7 remain open with no reviews at this check; independent review and required activation are outstanding. Department-head delegation remains unimplemented here.

## 10:49 UTC — pending handoff integration

Extended the fixture with full045 assignment schema/guards and the exact auto_assign_work, auto_close_work, handoff_pending bodies and pending trigger extracted from051. No reimplementation of those bodies. Five new checks pass: creation assigns one open task to the salesperson; denied staff cancellation leaves the task unchanged; owner cancellation closes it while preserving sender and recording owner/version; stale cancellation retry adds no changes; stock remains unchanged. Total51 database checks pass; diff clean.

This supersedes the earlier absence of pending-trigger coverage only. Other051 triggers, production permissions across the entire schema, UI task-refresh and live persistence remain unverified. No application or migration code changed this run. PR7/9 still lack independent reviews; no production activation or merge was attempted.
