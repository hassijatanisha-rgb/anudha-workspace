# Order workflow acceptance — 18 October 2026

Partial invoicing is implemented and passes local acceptance tests for four machines delivered as **2 + 2** or **2 + 1 + 1**. Live deployment is in progress; its completion and authenticated acceptance are **pending verification**. This is scoped order-workflow evidence, not certification of the whole ERP.

## Implemented behavior

- Customer acceptance preserves the full Pro forma and sends Accounts a quantity-review task. It no longer automatically invoices the whole quote.
- In **Books → Customer invoices**, Accounts selects the accepted order, reviews **Invoice now** for each line, then uses **Post invoice & reserve stock**. Posting creates one ERP invoice and its linked delivery, reserves exactly the selected Haadi quantities and updates the linked uninvoiced balance in one transaction. Stock shortage rolls back the new invoice, journal, delivery and pending changes.
- Four ordered with two available produces an invoice/reservation for two and a linked pending balance of two. Later invoices use the same accepted order and cannot exceed its remaining quantities. Several invoices and deliveries can remain open independently.
- A pending balance closes with **Allocated to invoice** when all quantities are invoiced. This does not mean delivered. The order is complete only after all quantities have signed delivery proof.
- Packing keeps the existing packer ownership, serial, supervisor, expiry and version checks. Dispatch consumes stock once and requires the exact active invoice, matching customer and Pro forma revision. Expired lots are excluded; today and undated lots remain eligible.
- Signed delivery creates one installation case and equipment asset per delivered machine. Delivery of two machines creates two cases; delivery of the remaining two brings the total to four. Engineering assignment, reports and scheduled maintenance retain their existing workflow.
- Cancellation before dispatch releases the delivery reservation but keeps its invoice active. The same invoice can receive a replacement delivery. To undo billing, cancel its undispatched delivery first, then void the invoice; any receipts must be voided first too. Invoice void reopens the uninvoiced balance and its follow-up. Active or completed deliveries prevent invoice voiding.
- Historical whole-order invoices remain unchanged and conservatively occupy the full accepted quantity. Legacy delivery reservation uses an unambiguous eligible active invoice or requires its exact ERP number. Non-stock lines are explicitly unsupported by this stock-delivery path and fail without posting.

## Acceptance sequence

1. Accept a four-machine Pro forma with two usable units at Haadi. Confirm that acceptance creates no invoice.
2. Open **Review quantities / open invoices** or **Books → Customer invoices**. Set **Invoice now = 2**, review the dates and Accounts reference, then **Post invoice & reserve stock**.
3. Confirm invoice quantity two, reserved quantity two and linked **Pending stock orders** quantity two. The accepted quote remains four.
4. Send the delivery to packing, claim it, record two serials, mark packed, dispatch and upload the signed delivery proof. Complete delivery and confirm two installation cases.
5. Record the later stock through the inventory workflow. Open the linked pending order, review its remaining quantity and invoice two more—or one now and one later.
6. Confirm the pending record closes as **Allocated to invoice** once fully invoiced. Deliver the remaining units with serials and signed proof. Total invoiced and delivered quantities must both equal four, with four installation cases.

## Verification

| Test surface | Result |
|---|---|
| Standard Node cases | 503 passed; the 63 browser-gated cases were executed separately |
| Isolated Chrome cases | 63 passed, including 12 new Accounts partial-invoice acceptance cases |
| Combined Node and Chrome evidence | **566 passed, 0 failed, 0 unexecuted/skipped across the completed runs** |
| New real-migration database suites | **29 passed**: 15 delivery/integration scenarios and 14 accounting scenarios |
| Existing complete-order database rehearsal | 23 checks passed after shared-fixture extraction |

The 12 new Chrome cases are included in the 63 browser cases, not additional to 566. Database scenarios are a separate test surface; these counts are assertions/scenarios, not independent business processes.

The database suites execute actual migrations and RPCs in disposable PGlite. Coverage includes 2 + 2 and 2 + 1 + 1, exact retries and mismatched retries, duplicate/foreign/negative/fractional/oversized quantities, access and stale versions, rollback after shortages, expiry, cancellation/re-delivery, void/receipt protection, manual packing bounds, legacy full invoices, dispatch identity, signed proof, installation counts and multi-line discount/tax rounding after void and replacement. The original complete-order rehearsal intentionally retains its pre-107 behavior to check historical compatibility.

With `PGLITE_MODULE` pointing to the installed PGlite entry point:

```sh
node tests/order-workflow-database.mjs
node tests/partial-order-accounting-database.mjs
node tests/partial-order-database.mjs
```

Browser tests use isolated synthetic data and their documented flags. They do not write live business records.

## Deployment and remaining boundaries

Live Supabase preflight found missing dependencies from original migration **010**, including the reservation functions/triggers expected by later migrations. The deployment process is preparing an exact prerequisite catch-up before forward migrations **092–108**, with atomic rollback verification. Neither that verification nor the live release is marked successful here. Backend prerequisites, Edge functions, frontend version and authenticated sample acceptance must all be verified together.

Local fixtures substitute auth claims and uploaded-file metadata. They do not establish real MFA/authentication, file upload/download transport, concurrent PostgreSQL-session behavior, the complete live schema, TRA issuance, messages or payment settlement. Default assignees and actual user permissions still require live verification.

Changed SQL received peer/manual review and executable acceptance tests. The companion `partial-order-security-review.md` records the scoped Semgrep review: all 86 reported findings were triaged as false positives, but 15 rule errors leave automated coverage incomplete. CodeQL did not run because its official query packs were unavailable. This is not a full security audit.

Posted return credit notes remain separate work: a credit-note draft does not itself adjust the posted customer balance. Real books also require approved account/workbook mapping, opening-balance reconciliation and separate customer/supplier document and stock setup. Non-stock fulfilment needs its own supported completion rule before use.
