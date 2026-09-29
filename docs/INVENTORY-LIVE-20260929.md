# Inventory review release — 29 September 2026

Scope: reviewed product identity/search, exact-product stock navigation, compatible machine metadata, source mapping preview and explicitly saved review decisions. No source quantities imported, no stock deducted, no financial workflow activation.

User approved activation of migrations 032 and 033. Applied to Anudha project udncxdbrbaptcefvjucj using the signed-in SQL editor. Both returned success. Live catalog check confirmed RLS enabled on both tables, anonymous SELECT denied, authenticated direct INSERT/UPDATE/DELETE denied. Existing owners use gated RPCs; existing active staff read reviews. No accounts or memberships added.

Supervisor verified the exact isolated release branch: actual browser forms + migrations 001/002/017/032/033 passed saved/reopened links and mapping decisions, separate staff read/denied writes, stale versions and unchanged stock snapshots. Mapping upload browser test and exact-UUID stock navigation browser test passed. These use fictional records, blocked browser networking and serialized PGlite, not production authentication or concurrent PostgreSQL proof.

Correction-load failure was reproduced (4 RED failures, 2 passes), then fixed (6 GREEN passes). Stock and transfer screens and stale product actions now block until corrections load; godown setup remains usable. Regression includes retry recovery.

Rollback: revert frontend release to previous main commit 5ab0dd558eae9fd158a8f3cc005dcc16506b0b73; preserve review tables and audit rows. If necessary disable new RPC execution using a reviewed forward migration, never drop history.

Remaining: actual signed-in production walkthrough; controlled source-to-stock import and reconciliation; pro forma four-outcome flow and invoice-time deduction. This is not a declaration of complete ERP readiness.

Latest confirmed pro forma outcomes: invoice all agreed lines; split selected quantities into pending and remaining quantities into invoice; resolve; extend. Pending orders close after six calendar months. None of those workflow changes is activated by this inventory-only release.
