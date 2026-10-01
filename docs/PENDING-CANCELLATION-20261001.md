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

Migration 043 is unchanged and must not be reapplied. Apply only 051 after review/required activation, then publish frontend and verify staff/owner sessions without real business-data tests. The function keeps its signature, ACL, search path, locking, expiry and fulfilment logic; no stock writes or data backfill. A rollback would require a reviewed forward function replacement and would reopen this permission gap, so prefer fixing forward.

PR #8 separately fixes retry-content validation in the creation function. These SQL changes are independent, but both branches edit the database test: preserve both sets of regression checks during integration. This fix does NOT establish verified invoice-linked fulfilment, automatic expiry scheduling, fiscal issuance or complete department permissions.
# Migration identifier update — 1 October, 08:12 UTC

The unapplied candidate is now `202610010055_pending_cancel_owner.sql`, not 051.
Main bd87100 records concurrent migrations 050–053 as applied. Their files are
unchanged. This renumber only changes this candidate's path/test reference and adds
a comment; 40 isolated DB checks still pass. Historical references below retain
the original identifier. Integration with the new main trigger chain is still required.
