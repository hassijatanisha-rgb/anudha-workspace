# Leads and pending stock: database activation, 30 September 2026

Applied to Supabase project `udncxdbrbaptcefvjucj` with the user's approval, through the Supabase migration tool (recorded in `supabase_migrations.schema_migrations`):

1. `202609300042_sales_leads`: `sales_leads`, `sales_lead_events`, `save_sales_lead`, `advance_sales_lead`
2. `202609300043_pending_stock_requests`: `pending_stock_requests`, `pending_stock_events`, `create_pending_stock_request`, `advance_pending_stock_request`

The files were applied as committed, minus their own `begin;`/`commit;` lines, because the tool wraps each migration in a transaction. Both are additive. They change no existing table, stock lot, price or invoice.

## Pre-checks (read-only)
- All referenced columns and helpers exist live: `organizations/contacts/products/sales_proformas.deleted_at`, `contacts.organization_id`, `staff.active/role`, `inventory_active_staff()`, `inventory_owner()`.
- None of the new tables or sequences existed.

## Post-checks
- RLS is enabled on all four tables. `authenticated` has SELECT only (no INSERT/UPDATE/DELETE). `anon` has no table access.
- `anon` cannot execute any of the four RPCs, and neither `anon` nor `authenticated` can use the number sequences. The internal `sales_lead_active_assignee` helper is not executable by API roles.
- The two `deny_*_mutation` trigger functions are executable by default roles. They are not SECURITY DEFINER and cannot be invoked directly as triggers.
- Live functional check inside one aborted transaction, run as the real active owner account under the `authenticated` role:
  - A signed-out caller was refused ("Active staff access is required").
  - Lead created as `inquiry`, then qualified to `lead`, producing 2 history rows.
  - Pending request created, closing six months later (2027-03-30).
  - RLS showed the rows to the owner.
- After the abort, all four tables contain 0 rows. The only side effect is that the `LD-` and `PS-` number sequences advanced by one.

## Not yet done
- The frontend (`sales-leads.js`, `pending-stock.js`) reaches the official site only once `claude/friendly-volta-3lwcib` is reviewed and merged into `main`.
- Codex should call `create_pending_stock_request` from the invoice "split remainder to pending" step in the stock-timing work, instead of creating a second pending mechanism.

## Migration 044: close anonymous RPC access (applied the same day)
- Pre-check (read-only): `anon` holds no table grants in `public`, and no RLS policy for `anon`/`public` calls `inventory_active_staff()` or `inventory_owner()`.
- Revoked EXECUTE from `PUBLIC` and `anon` on ten SECURITY DEFINER functions: eight inventory write functions plus the two access helpers `inventory_active_staff()` and `inventory_owner()`. `authenticated` keeps explicit grants. The trigger-only `create_installation_cases_for_delivery()` is no longer executable by any API role. `protect_project_approval_answers()` now pins `search_path`.
- Post-check in an aborted transaction as the real owner: both helpers return true, and 2 locations and 4,247 products are visible through RLS. As `anon`, calling `inventory_owner()` gives "permission denied".
- The Supabase security advisor no longer reports anonymous-executable functions or a mutable search_path. Remaining: signed-in RPC access (by design, since every RPC checks the caller) and leaked-password protection (a dashboard setting for the owner).

## Migration 045: handoffs and personal task list (applied the same day)
- Pre-check: all five parent tables exist and `work_assignments` did not.
- Post-check: RLS on; `authenticated` can SELECT only (no INSERT/UPDATE); `anon` has no table or RPC access; the `work_record_exists` helper is not executable by API roles.
- Live functional check in an aborted transaction as the real owner: first handoff opened; a second handoff that did not name the open one was refused; a correct second handoff closed the first as `handed_on` and linked to it; marking it done worked; RLS showed both rows. After the abort, `work_assignments` has 0 rows.
- Recorded migrations now: 042, 043, 044, 045.

## Migration 046: suppliers and purchasing (applied the same day)
- Pre-check: `products` and `pending_stock_requests` exist. No supplier or purchasing table or sequence existed.
- Post-check: RLS on all four tables. `authenticated` has SELECT only (no INSERT). `anon` has no table or RPC access, and API roles cannot use the number sequences.
- Live functional check in an aborted transaction as the real owner: a signed-out call was refused; SUP-000001 was created; PO-000001 went request → approve → order (LPO) → close with 1 item and 4 history rows. After the abort: suppliers, orders, items and events are all 0, and `inventory_lots` is unchanged at 0.
- Recorded migrations now: 042–046.

## Migration 047: temporary stock count (applied the same day)
- Pre-check: none of `count_catalogue`, `stock_count_sessions` or `stock_count_entries` existed; `inventory_active_staff()` and `inventory_owner()` exist; `inventory_lots` had 0 rows.
- Post-check in an aborted transaction as the real owner: one product loaded, a count started, a count recorded and accepted. A direct UPDATE of a saved count was refused ("permission denied"). `inventory_lots` stayed at 0.
- As `anon`: "permission denied" for `open_stock_count` and for reading `count_catalogue`.
- After the abort, all three tables are empty. The security advisor lists only the existing categories: signed-in RPC access, which is by design, and leaked-password protection.
- The product list (9,766 AN-coded products) is not stored in this repository. The owner loads it from the prepared file through **Stock count → Load the product list**. The same file was checked against this migration in a disposable database: all 9,766 rows load, and loading it again updates the rows instead of duplicating them.
- Recorded migrations now: 042–047.

## Migration 048: apply the product list to ERP products (applied the same day)
- Pre-check: 4,247 products and 0 product detail reviews or classifications. `apply_product_list` did not exist. The products table has two triggers: `products_audit` (records every change in `audit_log`) and `products_soft_delete_guard`.
- Adds the Furniture category (a wider check constraint, and `save_product_inventory_classification` accepts it) and the owner-only `apply_product_list(jsonb)`, 500 rows per call.
- How it applies the list:
  - A product linked to the list gets a new review version (name, company, specification) and a new category version. Nothing is overwritten.
  - A correction saved by a person is never replaced by the list.
  - Products not in the ERP are created, with the AN code as the stock code.
  - Running it again changes nothing.
  - Stock, prices and documents are untouched.
- Live check in an aborted transaction as the real owner: the first run updated one real product and created one new product. The second run reported 0 changes. The stock code was set to the AN code and the category to Furniture. Everything was rolled back.
- Disposable database with the real file: 9,766 rows gave 4,244 existing products updated, 5,546 created, and every product with an AN stock code.
- The owner still has to load the file once: Inventory → Product data workbench → **Apply product list file**, or through the Stock count screen, which does the same.
- Recorded migrations now: 042–048.

## Migration 049 and the staff-accounts Edge Function (applied and deployed the same day)
- Migration 049 adds:
  - `staff.phone`, in +country-code format;
  - an append-only `staff_account_events` log, readable by owners only;
  - owner-only `set_staff_phone` and `record_staff_account_event`.
- Pre-check: `staff` had no phone column, and the log table didn't exist. There were 2 staff rows.
- Edge Function `staff-accounts` (version 1, JWT verification on):
  - It checks `is_owner()` with the caller's own session.
  - It uses the service key only for `auth.admin.createUser` / `updateUserById` / `getUserById`, and for `deleteUser`, which removes a new login again if enabling its access fails.
  - Staff-table changes and log entries go through existing owner RPCs under the owner's session.
  - Temporary passwords are returned once and never stored.
  - CORS allows only the official GitHub Pages origin.
- Employees sign in with an ID made from their name (`tanisha.hassija`), or the name typed with spaces. At first sign-in they must choose their own password.
- Not yet exercised live: the container cannot reach Supabase over HTTPS. The first real run is the owner's first **Add employee**.
- Recorded migrations now: 042–049.

## Migration 050: Tally sales invoice register (applied 1 October)
- Decision by the owner: tax invoices are made in Tally and flow into the ERP. The ERP does not issue invoices.
- Adds:
  - `tally_sales_invoices` (no deletes) and an append-only `tally_sales_invoice_events`;
  - `tally_proforma_number()`, which reads `PF-2026-1`, `pf 2026 12` and `PF2026000012` as Pro forma numbers;
  - `tally_invoice_staff()`, which is the owner or accounting access;
  - `import_tally_invoices(jsonb, source)`, 500 rows per call. It matches on the Tally GUID, or on type + number + date. Unchanged rows are skipped. A changed voucher is updated and its old values are kept in history. Only links the system made itself are re-matched; a person's link, unlink or ignore stays;
  - `review_tally_invoice` (match, unmatch or ignore, with a reason).
- It is a register only. It changes no stock, delivery status or accounting record.
- Pre-check: the tables didn't exist; `accounting_access()` and `inventory_owner()` exist.
- Live check in an aborted transaction as the real owner: 2 imported, 1 linked automatically to `PF-2026-000001`, and the re-import reported 1 unchanged. `anon` was refused. Afterwards there were 0 invoices and 0 events.
- Upload path: Tally Day Book or Sales Register → Export → XML, then Orders → Tally invoices → **Upload Tally XML export**. The in-house connector will send the same normalised rows with source `connector`.
- Not yet checked against a real export from your Tally. The reader follows Tally's documented XML layouts (`ALLINVENTORYENTRIES.LIST` / `LEDGERENTRIES.LIST` and the older `INVENTORYENTRIES.LIST` / `ALLLEDGERENTRIES.LIST`). The first real file should be checked by eye.

## Migration 051: automatic handoffs (applied 1 October)
- Every open record has one responsible person, handed on automatically at each step:
  - **Pro forma:** the creator while drafting and following up, then the invoice-step default (Mujtaba) once accepted.
  - **Tally invoice linked:** invoicing is marked done, a packing job goes to the packing default (Jagroop), and the Pro forma creator gets an Update.
  - **Delivery note:** packing default while packing, delivery default when out for delivery, done when delivered.
  - **Service and installation:** the step default to assign an engineer, then the assigned engineer, then done.
  - **Lead:** the owner, else the creator; closed when won or lost.
  - **Pending order:** the salesperson.
  - **Purchase:** the approval default, then the requester to order and receive.
- Default people per step: owner-chosen in `workflow_step_owners`, which is versioned and append-only. Set them under Staff → Who does each step.
- `unowned_work()` lists open records with nobody responsible (no default set, or an inactive person). It is shown on everyone's To-do page.
- A failed handoff never blocks the business action: it raises a warning, and the record appears as nobody responsible.
- Pre-check: the constraint name matched; neither new table existed; 0 assignments.
- Live check in an aborted transaction as the real owner: packing default set (version 1); a Tally invoice for `PF-2026-1` created the packing job for that person; `unowned_work` returned 0. Afterwards, all counts were 0.
- Recorded migrations now: 042–051.

## Migration 052: Send to Tally (applied 1 October)
- An accepted Pro forma downloads as a TallyPrime import file: a Sales Order with voucher number = Order No. = the Pro forma number.
  - The voucher balances: the party debit equals sales plus VAT, and both match the Pro forma total exactly.
  - Accounts import it (Import → Transactions) and make the tax invoice from it. That invoice then links back under Tally invoices.
- Adds:
  - `tally_export_settings` (versioned): company, voucher type, sales ledger and VAT ledger;
  - `tally_ledger_names` per client and `tally_item_names` per product, corrected in place, never deleted, every change in `audit_log`;
  - `tally_exports` (append-only): who sent which Pro forma version, with the file's SHA-256;
  - owner- or accounts-only `save_tally_export_settings` and `record_tally_export`.
- Default item names come from each product's original Tally export (`source.raw`). Products added from the CRM list need their Tally name typed, or must be created in Tally first.
- TZS only for now; foreign-currency Pro formas are refused.
- Live check in an aborted transaction as the real owner: settings saved as version 1; sending the cancelled `PF-2026-000001` was refused ("Only an accepted Pro forma can be sent to Tally"). Afterwards nothing remained.
- Not yet run against your TallyPrime. The first import should be checked, and Order Processing must be enabled in Tally for Sales Orders.
- Recorded migrations now: 042–052.

## Migration 053: step times and delay reasons (applied 1 October)
- Every handoff strip on a card shows:
  - who holds the step, the task, and how long it has waited;
  - the total time since the record's first handoff;
  - the latest delay reason and expected date;
  - a **Step times** timeline listing each holder, their task and its duration.
- Colours:
  - over a day waiting → yellow;
  - over two days, or a passed due date or expected date → red;
  - a reported delay with a future expected date → no colour (on track).
- To-do lists are sorted red, then yellow, then the rest, with **Report delay** on each item.
- Adds `work_delays` (append-only) and `record_work_delay`. Only the person doing the step, the sender or the owner can report a delay; the expected date must be today or later, and the step must be open.
- Live check in an aborted transaction as the real owner: a delay was recorded (expected in 2 days) and a past date was refused. Nothing remained afterwards.
- Recorded migrations now: 042–053.
