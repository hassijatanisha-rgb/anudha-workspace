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
