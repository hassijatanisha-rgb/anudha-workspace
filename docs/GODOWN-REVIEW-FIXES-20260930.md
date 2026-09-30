# Supervisor findings addressed

- Table location status now updates in place after a confirmed mapping save, including an Unresolved revision. Search/filter/scroll state is not redrawn.
- Raw source godown identity is retained in a data attribute; a blank source no longer gets interpreted as its human-readable placeholder. Blank/whitespace labels cannot open mapping actions.
- RED: both browser reproductions failed (blank label and stale location status); checkpoint 0e836b0.
- GREEN: godown-review-browser.mjs and godown-mapping-integration.mjs pass, plus 13 focused unit tests. Database fixture verifies retry uniqueness and unchanged source/operational stock. No live SQL executed.
- Migration 041 remains unapplied by this change. These are review-branch fixes, not a live activation.

## Interrupted-save and visible walkthrough verification

- RED checkpoint 9d25db2 reproduces a stale ready state when the database commits but the response is lost. GREEN 9e24719 marks the row unconfirmed before saving and restores readiness only from a confirmed response. Retrying keeps the same request ID and does not duplicate history.
- All three browser scripts pass: godown-mapping-integration.mjs, godown-mapping-browser.mjs, and godown-review-browser.mjs.
- Preview RED checkpoint ccb2a6f requires a visible readiness table. The preview now renders that table using the actual application status and save functions. Preview and location-readiness tests: 4 passed, 0 failed, 0 skipped.
- Visible in-app walkthrough on 2026-09-30: saved City Printer, reopened its persisted version 1, saved Unresolved, closed the dialog, and verified the table immediately displayed "Unresolved — do not import" without reloading. This used an isolated in-memory database and fictional records, not Supabase or company stock.
- Follow-up fixed the open dialog's stale history: RED abe4308 reproduced "No saved mapping yet" after a confirmed save; GREEN 21933ea refreshes history from the verified result. Failed saves leave history unchanged. Both `node tests/godown-mapping-browser.mjs` and `node tests/godown-mapping-integration.mjs` passed. Visible walkthrough showed version 3 immediately after Save with versions 2 and 1 retained. Coverage percentage was not measured for this browser change. No claim of production deployment or migration activation is made.

## Existing pending-stock integration contract

User and Claude's docs/LEADS-PENDING-LIVE-20260930.md report migrations 042/043 already applied. Do not reapply or create another pending table.

Use create_pending_stock_request(p_id, p_organization_id, p_contact_id, p_product_id, p_quantity, p_proforma_id, p_lead_id, p_salesperson_user_id, p_notes) for split remainder creation. Persist a stable request ID per split line; retry the identical payload. Whole quantity range in 043 is 1–1,000,000.

Review finding for Claude: fetched RPC 043 compares creator/client/product/quantity/contact/proforma/lead on retry, but not salesperson or notes. Do not rely on changed salesperson/notes being rejected as a conflict. This follow-up does not alter the applied migration. Invoice/split orchestration still requires a transaction-level design; a separate browser RPC call alone cannot guarantee atomic invoice-plus-remainder creation.
