# Stock-count close/save race — source finding, not runtime proof

Reviewed candidate b2a37fc and main baseline 18d9d92. No production queries or writes.

## Evidence

- Migration047 `close_stock_count` locks the session with `SELECT ... FOR UPDATE` before changing its status.
- Migration047 `record_stock_count` and this PR's replacement check for an open session with an ordinary `EXISTS` read. The advisory lock is keyed to the entry ID, not the session ID.
- The entry foreign key guarantees that the session exists, not that its status remains open.
- No later replacement of these functions was found in the inspected main migration tree.

## Interleaving requiring a real two-connection test

1. Recorder checks that session is open.
2. Owner closes and commits the session.
3. Recorder inserts a new entry and commits, without rechecking status under a shared lock with close.

Alternatively, a close may be uncommitted while an unlocked reader sees the preceding open version. The foreign-key check does not encode the open-state business invariant. This is a source-confirmed missing serialization boundary; the exact concurrent behavior has not been executed here.

## Proposed acceptance and correction

Use an isolated PostgreSQL database with two independent connections and deterministic barriers. Test both orderings. If close wins, a new record must fail with no row inserted; if record wins, close must wait until its transaction completes. Identical retries of already-saved counts after closure must remain readable without creating new rows. Include rollback, changed-content retries and authorization regression tests.

Expected correction: acquire a compatible session row lock before validating open status and hold it through insertion; coordinate lock ordering with close and entry-level idempotency. Choose the least restrictive sufficient lock after the two-connection reproduction. Keep already-recorded idempotent replay semantics. Do not edit deployed047.

## Current limitations

The available PGlite test is single-instance and does not establish independent concurrent PostgreSQL sessions. `psql` and `initdb` were not found on PATH or the checked Homebrew PostgreSQL location. No installation, production lock experiment, SQL activation or guessed fix was performed. Existing 66 sequential checks are not concurrency evidence. This finding is separate from the already-tested retry-content correction in PR12.
