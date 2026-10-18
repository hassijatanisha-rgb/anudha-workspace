# Order workflow acceptance — 18 October 2026

Implemented in the release branch. Not yet deployed: the live Supabase schema, Edge functions and GitHub Pages release still need coordinated deployment and authenticated acceptance.

## Resulting behavior

- On a Pro forma, **Whole order** shows its status, every delivery, authorized ERP invoice details and linked machine installations. Delivery/task links select the exact record. Late responses cannot reopen another login's record.
- **Assign to me** opens a prefilled current-step handoff. Actor and recipient must already have that workflow's access. Packing and engineer assignment remain explicit operational actions. All prior handoff history is retained. Completed delivery/service and rejected/cancelled Pro forma records cannot receive new current-work handoffs; separate Team tasks remain available for follow-up work.
- Customer acceptance automatically creates the ERP invoice under the existing accounting workflow. **Link ERP invoice & reserve stock** derives the actual active invoice number for the same customer and Pro forma revision. There is no free-text invoice substitute.
- Packing through the delivery card and packing queue uses the same claim, timer, reservation and packer checks. A packer cannot hold two orders at once. Only that packer or an authorized supervisor can mark packed. Legacy partial deliveries keep the remaining quantity visible.
- Dispatch consumes reserved stock once. An active/completed linked delivery prevents invoice voiding; cancelling before dispatch releases stock and permits invoice reversal. Missing, voided, stale or mismatched invoice links block dispatch.
- Expired lots are excluded from automatic reservation and queue picking, rejected for manual picking, and checked again at reserved packing, ready and dispatch. Existing expiry semantics are preserved: yesterday is expired; today and undated lots remain eligible.
- Signed proof is required to complete delivery. Each delivered machine unit automatically creates its own installation case and equipment asset. Authorized engineers can assign themselves; completed reports create the next maintenance job.

## Executable rehearsal

`tests/order-workflow-database.mjs` executes real SQL RPCs and selected production migration definitions in a disposable PGlite database. It is not a mocked success response or a live business transaction.

First fictional order: two machines plus three reagent kits. Create Pro forma → self-handoff → send → accept → automatic ERP invoice and balanced journal → Accounts approval → reserve stock → claim packing → record serials → ready → dispatch → finalize synthetic signed-proof metadata → signed delivery → two installation cases → assign/schedule/on-site → two completed reports → two scheduled maintenance jobs.

Second fictional order: a single already-authorized owner with accounting membership explicitly takes the sales, Accounts, packing, shipping and engineering steps. The resulting installation is assigned to that same person. Existing departmental defaults and access grants are preserved.

The two orders end with seven machine units and 17 reagent kits in stock and zero reserved units. Denied actions are checked for unchanged stock, history, versions and journals. An invoice-void probe is rolled back; cancellation-before-dispatch and invoice reversal are also verified in a rolled-back branch.

## Verification

- Standard Node suite: 497 passed, zero failed; 51 browser-gated cases tested separately.
- Isolated Chrome: all 51 cases passed across accounting, attachments, personal workspace, Pro formas and Excel import. The final changed order/assignment UI was rerun: 19 passed.
- Work assignment database: 83 checks; packing/shipping/invoice/expiry: 79 checks; machine handoff: 24 checks; integrated order: 23 checks. All passed. Final integrated migration loading includes 100–106.
- Earlier Excel review: 29 unit tests, eight browser cases and 110 accounting/import database checks passed. Those overlap some totals above and must not be added as independent coverage.
- Bundle build, syntax/consistency tests and whitespace checks passed. The standard suite first caught stale generated assets; rebuilding fixed that. The final browser rerun first lacked a configured Chromium executable; rerunning with installed Chrome passed.

Run from the repository with a locally installed `@electric-sql/pglite` entry point in `PGLITE_MODULE`:

```sh
node scripts/build-bundle.mjs
node --test tests/*.test.mjs
node tests/work-assignments-database.mjs
node tests/packing-shipping-database.mjs
node tests/service-machine-handoff-database.mjs
node tests/order-workflow-database.mjs
```

The integration test writes synthetic `order-workflow-result.json` and `order-demo-snapshots.json` beside the checkout. Browser suites require their documented environment flags plus Playwright and Chrome.

## Security and boundaries

Changed-source manual review covered access, record identity, terminal states, HTML escaping, stale sessions, version conflicts, fixed SQL search paths, stock atomicity, invoice consistency and lock ordering. User-approved Semgrep OSS scanned the six changed runtime JavaScript files with security-audit, secrets, JavaScript, Trail of Bits, elttam and Apiiro rules. All 63 findings were triaged as false positives; 15 rule compilation errors make coverage partial, including one applicable JavaScript rule; the runner also excludes one unsupported elttam join-mode rule. CodeQL was skipped because official query packs are absent. SQL was reviewed and executed in fixtures, not scanned by CodeQL.

The fixture substitutes JWT claims and storage object metadata. It does not test real authentication/MFA transport, uploaded file bytes, live TRA issuance, simultaneous PostgreSQL sessions, full production migration history, external notifications, real financial files or payment settlement. Production permissions/default assignees still need verification with the actual users. Local results do not establish that the live ERP has these fixes.

## Before client use

Follow `MONDAY_READINESS.md`: verify the actual project and migration history; deploy the two changed Edge functions and unapplied forward migrations 092–106; then publish frontend assets and run the authorized sample workflow. No real books, stock or customer messages were imported/created/sent in this task.

Books → Import Excel supports balanced TZS general-ledger opening balances and journals. Arbitrary workbook layouts, customer/supplier outstanding-document imports and stock opening quantities require separate mapping and reconciliation before live use. Existing non-stock line reservation behavior was not redesigned in this order repair.
