# Anudha workspace — Monday release candidate

Prepared 16 October 2026; updated 18 October for the order-workflow release. Base: `c9cf493532c45dc7adca47c7eabf0d71639ee21a`.

**Status: implemented and locally tested; not deployed or certified ready for live operation.** The GitHub Pages site deploys from `main`. This branch must be released with its Supabase migrations and two Edge functions. GitHub access is available; the production Supabase administration connection and authenticated live acceptance session are not available in this task yet.

## What changed

- The 18 October order fixes and their executable acceptance evidence are described in `ORDER_WORKFLOW_ACCEPTANCE.md`. The same operator can explicitly take each authorized step; a whole-order panel links the Pro forma, ERP invoices, packing/delivery and automatically created machine installation cases.

- Sign-out invalidates cached business data and late responses. Temporary-password replacement is enforced by the database; existing MFA challenges happen first. Attachment access follows the parent work area's permission. Service completion, purchasing edits, task deadlines and public-request assignments enforce the relevant permissions.
- Sales loads complete paginated registers and related records, preserves unsaved forms and retry identities, reports partial deliveries correctly, and snapshots customer/contact/product identities for new proforma revisions. Historical revisions without those fields are labelled unavailable rather than rewritten.
- Stock handles expired returns, versioned serial corrections, blocked packing queue continuation, precise decimal counts, delayed saves after form closure, older count-session review/export, and catalogue refresh. Purchasing no longer inherits abandoned customer handoffs.
- Branch orders/leads/service tabs show scoped records. Service handoffs open the correct job, reports reject excess rows and print all sign-offs, and deadline approvals show task identity without granting broader access. Public-request retries distinguish changed content; confirmation-provider timeouts cannot hide a saved reference.
- Accounting uses complete balances and waiting queues, historical ageing remains correct after later reversals, printing selects only the active document, CSV exports neutralize formulas, and unsupported foreign-currency invoices are not relabelled TZS. Business dates use Africa/Dar_es_Salaam.
- **Books → Import Excel** accepts `.xlsx` and Excel CSV for balanced general-ledger opening balances and journals in TZS. It offers an account-aware template, sheet selection, row-level validation, preview totals, explicit posting, atomic rollback, source/reference deduplication and safe retry reconciliation.

## Excel handover

1. After deployment, open **Books → Import Excel** and download the template to obtain current active account codes.
2. Fill the Journal sheet: `Entry Reference`, `Date`, `Memo`, `Account Code`, `Debit`, `Credit`, `Line Description`, `Currency`. Repeat reference/date/memo for all lines belonging to one journal. Use TZS, values only, dates without times, and at most two decimal places for amounts.
3. Use one stable source name for a source ledger. Unchanged references are skipped; a changed entry with an existing reference is rejected. Every journal must balance.
4. Select the workbook and intended sheet, resolve every preview error, review debit/credit totals, then post. If the response is uncertain, retry the same retained batch until its receipt is confirmed.
5. Compare the posted trial balance with the approved source totals before using the books operationally.

Limits: 5 MB file, 25 MB declared expanded archive size, 20 sheets, 1,000 rows, 100 entries, 2–200 lines per entry. Formula cells and foreign currencies are rejected. This is a journal import, **not** an arbitrary financial-workbook mapper. It does not create customer invoices, supplier bills, receipts, allocations, stock or customer/supplier subledger opening balances. Those details must be loaded/reconciled separately before relying on ageing or outstanding-invoice reports. No real financial figures were supplied or imported.

SheetJS CE 0.20.3 is vendored with its Apache 2.0 licence. Source: https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js; official installation documentation: https://docs.sheetjs.com/docs/getting-started/installation/standalone/.

## Deployment order

Use a staging copy with the deployed schema first. These tests use focused disposable databases, not a full production-schema replay.

1. Verify the target Supabase project and effective migration history through `202610160091_erp_tax_invoice.sql`. If the deployed function bodies differ, inspect the difference before applying the forward migrations; anchor checks deliberately fail rather than silently patch an unexpected body. Take the normal database backup/snapshot before release.
2. Deploy `supabase/functions/staff-accounts/index.ts` so administrator-created/reset passwords receive the private replacement flag and reset nonce. Preserve the existing function authentication configuration and secrets.
3. Apply these forward migrations in order, once, through the project's migration mechanism:

   | Version | File | Purpose |
   |---|---|---|
   | 092 | `202610160092_workflow_authorization.sql` | Parent attachment permissions, service completion, purchase ownership, protected deadlines |
   | 093 | `202610160093_accounting_integrity.sql` | Complete balances/waiting invoices and historical ageing |
   | 094 | `202610160094_proforma_integrity.sql` | Immutable identity snapshots for new revisions |
   | 095 | `202610160095_operational_integrity.sql` | Return expiry, serial versions, packing continuation, travel note limits |
   | 096 | `202610160096_financial_import.sql` | Transactional journal-import RPC and receipts |
   | 097 | `202610160097_deadline_identity.sql` | Narrow approval-task identity RPC |
   | 098 | `202610160098_public_request_integrity.sql` | Full-content deduplication and eligible assignees |
   | 099 | `202610160099_password_replacement.sql` | Server-controlled password replacement and preserved MFA |
   | 100 | `202610180100_work_assignment_access.sql` | Actor and assignee workflow access |
   | 101 | `202610180101_service_assignee_access.sql` | Engineer eligibility and self-assignment |
   | 102 | `202610180102_packing_shipping_handoffs.sql` | Shared packing claims, completion and partial balances |
   | 103 | `202610180103_erp_invoice_delivery_link.sql` | Canonical ERP invoice linked to reservation |
   | 104 | `202610180104_active_invoice_dispatch.sql` | Dispatch and invoice-void consistency |
   | 105 | `202610180105_work_handoff_parent_state.sql` | Canonical task labels and terminal-record guards |
   | 106 | `202610180106_order_stock_expiry.sql` | Exclude expired lots through dispatch |

4. Deploy `supabase/functions/website-request/index.ts`, preserving its existing public-endpoint JWT configuration and server-only secrets.
5. Run the acceptance sequence below in staging. Then repeat the backend deployment during a controlled release window and merge this branch to `main`. GitHub Pages publishes the committed `index.html` and generated bundles. Do not publish the frontend before the new RPCs and views exist.
6. Confirm Pages serves the new bundle hash, then run the authenticated production smoke checks with designated test records and appropriate staff roles. Do not send provider messages to real customers as tests without authorization.

Build command: `node scripts/build-bundle.mjs`. Edit source files and `index.src.html`, not generated bundles. If a release must be held, leave the draft PR unmerged. If problems occur after posting real transactions, stop new writes and use an assessed forward fix; do not blindly drop audit/ledger/import tables or erase postings. Reverting frontend assets does not roll back database records.

## Required live acceptance

- Owner/accounts/stores/sales/service logins; fresh temporary-password login with and without existing MFA; password reset twice; sign-out during a pending load. Confirm unauthorized roles cannot access attachments, finish service jobs, edit someone else's purchase, change protected deadlines or obtain approval-task details.
- Lead → proforma → sent → accepted/automatic ERP tax invoice → accounts approval → packing → partial delivery → remainder → signed proof. Verify stock/reservations, version conflicts, source quantities, invoice balances, cancellation and return handling at each affected transition.
- Purchase request → supplier/order → receipt; pending-stock handoff; transfer dispatch/receive. Count decimal quantities, close a form during save, review/export an old session, and verify expired returns remain quarantined.
- Service creation/assignment/date/work/report → next maintenance; print the engineer, customer, Anudha and collection references. Task assignment → extension request → authorized approval → result.
- Import a small approved test ledger; retry the same file and a lost response; attempt a changed duplicate and unbalanced journal; confirm no double posting or partial writes. Compare trial balance, historical ageing and customer balances to authoritative source figures.
- Public inquiry retries with identical and changed quantities; eligible assignment; provider failure/timeout; saved reference retained. Configure and test each requested integration separately.
- Print/PDF layout with actual company terms, payment instructions and representative long documents; mobile/browser navigation and accessibility with the deployed application.

## Operational inputs still required

The earlier 16 October site review observed 9,537 client accounts (9,534 flagged), 4,254 products (all flagged, 6 active for sale), and 354 negative Tally source balances among 2,405 source rows. These are earlier UI observations, not a fresh database audit. They require business review and reconciliation; this release does not fabricate missing details or bulk-approve records. Prioritize the clients, products, locations, units, pack definitions and opening stock needed on Monday.

Email, WhatsApp, direct Tally and VFD were reported unconnected in that review. The user has not confirmed the final integration list. Existing public-request confirmations use Resend (`RESEND_API_KEY`, `EMAIL_FROM`) and WhatsApp Business (`WHATSAPP_TOKEN`, `WHATSAPP_PHONE_ID`, `WHATSAPP_TEMPLATE`, optional `WHATSAPP_LANGUAGE`). Keep secrets in Supabase, never frontend config. Direct Tally and VFD setup/adapter acceptance remains separate; manual Tally XML behavior is preserved. No outbound messages were sent. Obtain approved bank/payment instructions and document terms from Accounting.

## Verification and security status

- Node suite: **497 passed, 0 failed, 51 browser-gated cases skipped** in the ordinary run.
- Separate real Chrome run: **51 passed, 0 failed, 0 skipped**. Covers accounting editors, attachments, personal workspace, proformas and the new Excel importer with synthetic data and external networking blocked.
- Eight relevant PGlite database suites: **243 checks passed**. Workflow authorization 33; accounting 59; proforma identity 21; operations 35; financial import 26; deadline identity 24; public requests 34; password replacement 11.
- Generated full bundle starts the login page in Chrome with zero uncaught page errors. Build consistency, syntax and whitespace checks pass. A blank Excel template was generated and reopened successfully.
- Changed-source manual security reviews covered authorization, stale sessions, SQL privileges/search paths, input escaping, CSV formulas, import limits/atomicity/idempotency, private password metadata, and provider failures. Review findings were fixed, including MFA/password ordering, exact protected deadline timestamps, permission-aware branch links and late service responses.
- **Semgrep OSS 1.180.0 ran with user approval, telemetry disabled, on the six JavaScript source files changed on 18 October.** Rules: `p/security-audit`, `p/secrets`, `p/javascript`, Trail of Bits, elttam and Apiiro. All 63 findings were retained and manually triaged as false positives (61 dense-line heuristics, two obfuscation heuristics). Coverage is partial: elttam has 12 Java rule compilation errors; Apiiro has three errors including an applicable JavaScript rule; the runner also excludes one unsupported elttam join-mode rule. This does not cover every file in the earlier release commit. CodeQL 2.27.2 has no installed official query packs, so no database or analysis was run. SQL received manual review and executable tests; no SQL scanner coverage is claimed.

Residual limits: production Auth/PostgREST behavior, the entire migration chain, multi-connection PostgreSQL contention, real financial files, integration-provider delivery, and complete print/PDF pagination remain unverified. Passing local fixtures does not certify production readiness.
