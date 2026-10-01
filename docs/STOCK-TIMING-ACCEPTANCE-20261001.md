# Stock timing acceptance — RED, not a release

Baseline main c9cff60042cbb0a2b34c659a244e21a89fa4631a.
Run: `PGLITE_MODULE=<local PGlite module> node tests/stock-timing-acceptance-database.mjs`.
Executed 2026-10-01: exits 1 for the intended business-rule assertion, not setup.

The disposable database loads the actual 001, 004, 005 and 010 migrations, including
their triggers, and executes proforma save/send/accept, accounts handoff, invoice
reference, sales handoff, packing, ready and dispatch. Minimal identity/catalogue
fixtures are synthetic. No network, real invoice, Supabase or stock is touched.

| Stage | Physical pieces | Reserved pieces |
| --- | ---: | ---: |
| Before invoice reference | 100 | 0 |
| After invoice reference | 100 | 10 |
| Ready | 100 | 10 |
| Dispatched | 90 | 0 |

Acceptance expects 90 physical pieces after actual issuance and no further deduction
at dispatch. The first assertion fails (100 versus 90). A repeated stale dispatch
is rejected, stock stays 90, and only one inventory issue exists. Thus this test
proves wrong timing, **not** a demonstrated double deduction in the current path.

Limitations: selected migration chain, not every later migration/permission gate,
not live schema inspection, not concurrency, not fiscal issuance verification.
Calling the existing invoice-reference RPC is not proof of a legally issued invoice.
Existing regex schema tests pass the old behavior and cannot certify this rule.

## Required coordinated correction

1. Define and verify authoritative issuance evidence at the external-accounting
   boundary. A text reference alone must not be silently upgraded to fiscal proof.
2. Atomically consume holds, write one stock issue/movement per invoiced allocation,
   and make replay safe. Reuse existing pending-stock contracts for split balances.
3. Update packing/ready/dispatch guards to validate issued allocations rather than
   require an unconsumed reservation. Remove dispatch deduction only together with
   the issuance correction; removing it alone would allow undeducted deliveries.
4. Handle already-created deliveries, cancellation/returns, reconciliation and
   concurrency in forward migrations, then independently review and obtain required
   activation approval. No deployed migration edits or automatic live backfill.

Accounting/Tally development remains paused. This branch contains diagnostic tests
and evidence only; no production correction or launch readiness is claimed.
