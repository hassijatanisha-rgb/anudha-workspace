# Architecture: Anudha Books (a rebuild of TallyPrime's accounting core inside the Anudha ERP)

Reads `replica/recon.md` and `replica/features.csv`. The SQL for milestone M1
is in `replica/schema.sql`, tested by `tests/general-ledger-database.mjs`.

## Stack

There's no new stack. The ledger is a feature of the ERP and follows
`.ai-style-rules.md`.

| layer | choice | why |
| --- | --- | --- |
| web | Plain strict-mode JS files loaded by `index.html`, one feature file per area (`ledger-*.js`) | It's the ERP's stack, and the rules forbid a bundler or framework |
| styling | `style.css`, `legacy-brand.css`, `ui-polish.css` | Same look as the rest of the ERP |
| database | Postgres on the existing Supabase project | One database, so a voucher can link directly to a Pro forma, delivery or purchase order |
| writes | `security definer` RPCs only; RLS allows reads to `ledger_staff()` | Repo rule. Balancing, numbering, bill settlement and locks are enforced in the database, not the UI |
| auth / rights | Supabase Auth + `staff` + `accounting_memberships` | Already gates the accounting drafts and the Tally screens |
| jobs | Supabase Edge Function `tra-vfd` plus a cron schedule, or the planned in-house connector | Posts fiscal receipts and the daily Z report; retries from a queue table |
| files | Existing `document-attachments.js` (private storage when the server week lands) | Supplier receipts, bank statements |
| hosting | Unchanged (static site + Supabase, moving to the in-house server) | — |
| payments, email | None | It's internal bookkeeping software, not a SaaS product |

## Schema

**M1 tables: 12.** Access rule: RLS `select` for `ledger_staff()` (owner or
enrolled accounts staff). No table grants insert, update or delete to
clients.

| table | purpose | notes |
| --- | --- | --- |
| `fiscal_years` | Financial years | Owner-only; overlaps blocked by an exclusion constraint |
| `ledger_period_locks` | Books locked through a date | Append-only; latest row wins; only the owner moves it back |
| `account_groups` | Chart of accounts tree | 28 standard groups seeded; a child inherits nature and gross-profit placement; no cycles |
| `ledgers` | Accounts | Optional link to `organizations` or `suppliers` (one ledger each); VAT class or VAT role; bill-wise; credit days and limit |
| `voucher_types` | Sales, Purchase, Payment, Receipt, Contra, Journal, Credit/Debit Note, Opening | Custom types inherit a base type; auto or manual numbering with prefix |
| `voucher_number_counters` | Next number per type and year | Row-locked in the posting transaction, so numbering is gap-free |
| `vouchers` | Header | Immutable; `reverses_voucher_id` unique; `source_kind/source_id` links to ERP records; supplier fiscal code and TIN; `content_hash` for idempotent resends |
| `voucher_entries` | Lines, signed TZS minor units (Dr +) | Immutable; **sum = 0 per voucher, checked at commit** by deferred constraint triggers |
| `ledger_bills` | Receivable/payable references | Unique per ledger, case-insensitive |
| `bill_allocations` | New / Against / Advance / On account | Immutable; a bill settles to zero but never past it (checked under a per-ledger lock) |
| `vat_rates` | Effective-dated rates | Standard 18% (confirmed 2026-10-06); zero, exempt and out-of-scope at 0 |
| `accounting_events` | Audit log for every master change, posting, reversal and lock | Immutable |

Hard constraints the recon found, and where they live:

- **Debits = credits:** a deferred constraint trigger on `vouchers` and
  `voucher_entries`.
- **Same bill paid twice by two accountants at once:** an advisory lock per
  bill-wise ledger, then `check_ledger_bills`. Tested with two real
  concurrent Postgres 16 sessions: the second waits, then is refused.
- **Same Pro forma invoiced twice:** an advisory lock per source plus a check
  for an unreversed voucher of the same base type.
- **Posting into a filed VAT month:** `ledger_period_locks`, checked by every
  posting RPC.
- **VAT arithmetic:** the server recomputes VAT per taxable line
  (`round(net × rate)`, the same rounding as `save_sales_proforma` and
  `tally-export.js`) and refuses the voucher if the VAT lines differ.
- **Input VAT without a fiscal receipt:** refused. The error tells the
  accountant to post it to cost.
- **Editing books:** update, delete and truncate triggers refuse all three
  on every posted table. Corrections go through `reverse_voucher`.

Tables for later milestones (sketch; final SQL comes with their milestone):

```
fiscal_receipts      voucher_id unique, status (queued|sent|accepted|failed), attempt_count, receipt_number,
                     verification_code, qr_url, last_error, sent_at            -- M4, one per sales voucher
vfd_daily_reports    report_date unique, status, totals jsonb, sent_at          -- M4
bank_reconciliations entry_id unique -> voucher_entries, bank_date, matched_line_id, reconciled_by  -- M5, append-only
bank_statement_lines id, ledger_id, line_date, amount_minor, description, bank_ref, import_id     -- M5
cost_centres / cost_allocations (entry_id, cost_centre_id, amount_minor)       -- M7
exchange_rates (currency, rate_date, rate) + foreign_amount_minor, currency, fx_rate on voucher_entries  -- M7
budgets / budget_lines                                                          -- M7
```

## API

All calls are Supabase RPCs (`client.rpc(...)`) or RLS reads
(`client.from(...).select`). No HTTP routes are added. Who can call:
**L** = `ledger_staff()` (owner or accounts), **O** = owner only.

| call | does | who | input | output | flow |
| --- | --- | --- | --- | --- | --- |
| `save_fiscal_year` | Open a financial year | O | id, name, start, end | year | F10 |
| `lock_ledger_period` | Lock books through a date (reopen = owner) | L / O | through date, reason | lock | F09 F10 |
| `save_account_group` | Create, rename or move a group | L | id, version, name, parent, nature | group | F12 |
| `save_ledger` | Create or alter a ledger | L | id, version, fields | ledger | F12 |
| `post_voucher` | Post any voucher with VAT and bill allocations | L | id (idempotency key), type, date, lines, narration, ref, number, source, supplier fiscal | voucher | F02–F06 F12 |
| `reverse_voucher` | Exact opposite voucher, bills mirrored | L | id, original, date, reason | voucher | F07 F11 |
| `trial_balance(from,to)` | Opening, Dr, Cr, closing per ledger | L (RLS) | dates | rows | F10 |
| read `ledger_bill_balances` | Pending bills, due dates | L (RLS) | filters | rows | F02 F04 F13 |
| read `vouchers` / `voucher_entries` | Day Book, ledger statement | L (RLS) | date range, ledger, page | rows | F10 F13 |
| `post_sales_invoice(p_id, p_proforma_id, p_date)` (M2) | Builds the invoice from the accepted Pro forma lines server-side, with no client-supplied amounts | L | ids, date | voucher | F01 |
| `post_purchase_bill(p_id, p_purchase_order_id, ...)` (M2) | Bill from a received purchase order | L | ids, supplier fiscal code, TIN | voucher | F03 |
| `import_tally_masters(jsonb)` (M3) | Groups and ledgers from a Tally XML export | L | ≤ 500 rows | counts | F12 |
| `import_tally_openings(jsonb)` (M3) | Opening voucher and open bills on the cut-over date | O | rows | voucher | F12 |
| `compare_tally_trial_balance(jsonb)` (M3) | Tally TB vs ERP TB by ledger | L | Tally TB rows | differences | F12 |
| `vat_return(month)` (M4) | Output, input and exempt totals plus exceptions | L | month | summary | F09 |
| `record_bank_dates(jsonb)` / `import_bank_statement(jsonb)` (M5) | Bank reconciliation | L | rows | counts | F08 |
| `profit_and_loss` / `balance_sheet` (M6) | Statements by group | L | dates | rows | F10 |
| `close_fiscal_year(id)` (M6) | Closing journal, carry forward, lock | O | year | voucher | F10 |

Count: 7 RPCs and 3 reads in M1; 12 more planned.

Webhooks in: none. Webhooks out: TRA VFD (M4), through TRA's official
interface and Anudha's own VFD credentials.

Jobs:
- `tra-vfd-send`, every minute: sends queued fiscal receipts and retries
  failures with back-off. The voucher id is the idempotency key, so TRA
  never receives a sale twice.
- `tra-vfd-zreport`, daily at 23:55 Africa/Dar_es_Salaam: posts the day's
  Z report.

## The parts that bite

- **Dates and time zones.** `voucher_date` is a `date` the accountant
  chooses, never `now()` in UTC. The UI defaults it to today in
  Africa/Dar_es_Salaam (UTC+3, no daylight saving). Timestamps stay
  `timestamptz`.
- **Idempotency.** The voucher form makes its uuid when it opens (repo rule:
  never retry with a new id). Resending the same content returns the saved
  voucher; different content under that id is refused. TRA calls are keyed
  the same way.
- **Races.** Numbering uses a row lock on the counter, bills and sources use
  advisory locks, and every master has a `version` check. A failed post
  rolls back its number, so numbering has no gaps.
- **Rounding.** VAT is rounded per line, as on the Pro forma.
  **Confirm with the accountant** that TRA's receipt total uses the same
  rounding; if it rounds on the total instead, change the rule in
  `post_voucher` before M4.
- **Report speed.** M1's Trial Balance sums every entry. That's fine for a
  few hundred thousand lines. At M6, add monthly closing-balance snapshots,
  written when a period is locked, if `explain analyze` shows it slow on a
  copy of real data.
- **Offline.** If TRA's VFD is down, sales still post. The fiscal receipt
  waits in the queue, and the printed invoice is held as "fiscal receipt
  pending" until TRA accepts it.
- **One company or several?** The schema assumes **one legal entity**.
  If Anudha keeps more than one company in Tally, add `company_id` to every
  table **before M1 becomes a migration**. Adding it later means rewriting
  every row.
- **Deletion.** Books are never deleted. Retention and any data-protection
  requests are answered with reversals and access controls.

## Build order

1. **M1 Vertical slice: ledger core** (designed and tested; ships as a
   migration once the accountant confirms the groups and the single-company
   question).
   Screens: S01 home, S04 chart, S05 group, S06 ledger, S08 voucher entry
   (payment, receipt, contra, journal), S13 Day Book, S14 ledger statement,
   S15 Trial Balance, S26 edit log (read-only).
   Tables: all 12 above. Calls: the M1 rows of the API table.
   The slice: the owner opens FY 2026-27, accounts create a bank, a customer
   and an income ledger, post a receipt, and see it in the Day Book and the
   Trial Balance.
2. **M2 Invoices from the ERP:** S09, S10, S11, S19, plus a party statement.
   `post_sales_invoice` from the accepted Pro forma (replaces the
   `tally-export.js` round trip), `post_purchase_bill` from the purchase
   order, credit/debit notes, receivables and payables with ageing, and a
   credit-limit warning.
3. **M3 Migration and parallel run:** S31. Import Tally masters, opening
   balances and open bills from XML (reusing the `tally-invoices.js`
   parser), plus a Tally-vs-ERP Trial Balance comparison. **Gate:** the TBs
   match to the shilling on the cut-over date.
4. **M4 VAT and TRA VFD:** S23, `fiscal_receipts`, `vfd_daily_reports`, the
   `tra-vfd` jobs and `vat_return`. **Gate:** TRA registration and approval
   of the integration (LEG-032).
5. **M5 Banking:** S18, S20, bank dates, statement CSV import and matching.
6. **M6 Statements and close:** S16 P&L, S17 Balance Sheet, S21 cash flow,
   S27 exceptions, S30 year close, Excel/PDF export.
   **Gate for switching Tally off:** one full VAT month in parallel with
   matching TB, VAT return and receivables, plus accountant sign-off
   (LEG-033, LEG-082).
7. **M7 Should/could:** cost centres, multi-currency and forex, budgets,
   interest, cheque printing, ratio analysis, recurring vouchers, fixed
   asset register.
8. **Fixes from `/replica-entrepreneur`:** after it runs.

## Open questions for Anudha's accountant (before M1 becomes a migration)

1. Is there one legal entity in Tally, or several companies?
2. Do the 28 standard group names match Anudha's Tally company, or have they
   been renamed?
3. When does the financial year start? The tests assume 1 July; confirm.
4. Is VAT rounded per line or on the invoice total on TRA receipts?
5. Is the VAT return due on the 20th or the 25th?
