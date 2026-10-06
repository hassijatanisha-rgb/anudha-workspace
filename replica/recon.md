# Recon map: TallyPrime accounting (Windows desktop)

Scope: TallyPrime's **accounting core**: chart of accounts, ledgers, vouchers,
bill-wise receivables and payables, banking, VAT for Tanzania, and the
financial reports. It is rebuilt inside the Anudha ERP (static JS + Supabase)
so the ERP becomes the books of account and Tally can be retired.
For: Anudha's own Accounts team in Tanzania (TZS, 18% VAT, TRA fiscalisation).
Not a product for sale.
Date: 2026-10-06

## Why TallyPrime and not Zoho Books

- Anudha's Accounts team already runs TallyPrime. The ERP already exports
  Pro formas to it (`tally-export.js`) and imports its sales invoices
  (`tally-invoices.js`, `tally-stock-review.js`), and the product master came
  from a Tally export. The ledger names, voucher habits and opening balances to
  migrate are all in Tally.
- Rebuilding what the accountants already use means less retraining and a
  side-by-side check against real Tally numbers during the parallel run (see
  "Cut-over" below).
- Zoho Books is a hosted product with its own Tanzania gaps. Building on its
  ideas would add a second mental model and no migration source.
- Where TallyPrime is weak (the desktop UI, editing posted vouchers in place,
  single-user licences, no browser access), we do not copy it. See
  "Deliberate differences".

## The rules this recon followed

- Public sources only: TallyPrime's public help centre, Tally's marketing
  site, tax-authority and adviser material. No Tally binaries, TDL source,
  private APIs or data files were opened.
- Tally's XML import format is already used by the ERP for its documented
  Import Data interface. That is interoperability, not cloning.
- We rebuild the **accounting behaviour** (double entry, groups, bill-wise
  tracking, reports), which is standard bookkeeping and not owned by Tally.
  Tally's name, logo, F-key layout, screen copy and TDL are not used.

## Sources

`help.tallysolutions.com` and `tallysolutions.com` are blocked by this
session's network policy. Rows marked *search* were read through search-engine
summaries of the page, not the page itself. Re-check them when the domain is
allowed.

| # | source | URL | notes |
| --- | --- | --- | --- |
| 1 | help: ledgers and groups | https://help.tallysolutions.com/ledgers-and-groups-in-tallyprime/ | *search*. 28 predefined groups (15 primary, 13 sub), 2 predefined ledgers (Cash, Profit & Loss) |
| 2 | help: groups | https://help.tallysolutions.com/tally-prime/accounting/groups-in-tallyprime/ | *search*. Group names and their Balance Sheet / P&L placement |
| 3 | help: voucher types | https://help.tallysolutions.com/tally-prime/accounting/voucher-types-tally/ | *search*. 24 predefined voucher types; custom types inherit from a base type; Debit/Credit Note inactive by default |
| 4 | help: accounting in TallyPrime | https://help.tallysolutions.com/accounting-in-tally-prime/ | *search*. Report list: Day Book, TB, BS, P&L, cash/fund flow, ratio analysis, cash/bank books |
| 5 | help: outstandings | https://help.tallysolutions.com/tally-prime/analysis-verification-tally/outstandings-tally/ | *search*. Receivables, payables, ageing |
| 6 | help: banking / BRS | https://help.tallysolutions.com/banking/ , https://help.tallysolutions.com/bank-recon-reports/ | *search*. Bank reconciliation, BRS summary, banking activities |
| 7 | help: multi-currency | https://help.tallysolutions.com/multi-currency/ | *search*. Rates per currency, forex gain/loss |
| 8 | help: budgets | https://help.tallysolutions.com/tally-prime/financial-controlling/budgets-tally/ | *search*. Budgets and variance |
| 9 | help: VAT returns summary | https://help.tallysolutions.com/vat-returns-summary-tally/ | *search*. Returns summary classifies vouchers by VAT effect (MENA editions; no Tanzania-specific page found) |
| 10 | marketing: audit trail / edit log | https://tallysolutions.com/tally/audit-trail-edit-log-compliance/ | *search*. Edit log records alterations with user and time |
| 11 | marketing: security (SSA) | https://tallysolutions.com/ssa/features/enhanced-security-management/ | *search*. Users, security levels, voucher-type rights |
| 12 | Tally SSA: Tanzania VAT return | https://tallysolutions.com/ssa/vat/how-to-file-vat-return-in-tanzania | *search*. Monthly return to TRA |
| 13 | TRA VFD client (public package) | https://root.packagist.org/packages/taitech/travfd-php | VFD flow: register TIN, token, post receipt/invoice, daily Z report, verify |
| 14 | Tanzania VAT overview | https://lookuptax.com/docs/country/tanzania-vat-guidelines-indirect-tax | 18% standard; VFD/EFDMS near-real-time; 2025/26 budget pre-clearance proposal (no effective date) |
| 15 | PKF: input VAT needs fiscal receipt | https://www.pkfea.com/media/mxxnx211/article-vat-on-input-vat-claim.pdf | Input VAT only with a valid EFD/VFD receipt or tax invoice (verification code + buyer TIN) |
| 16 | the ERP itself | `tally-export.js`, `tally-invoices.js`, `supabase/migrations/202610010050_tally_sales_invoices.sql`, `202610010052_tally_export.sql` | Voucher XML shape the team already uses: Sales Order, party ledger, sales ledger, VAT ledger, Order No. link |
| 17 | **Anudha's own TallyPrime company** | Accounts PC | **Not yet read.** The best source there is: the real groups, ledgers, voucher types, numbering and opening balances. See "Next actions". |

## Core loop

Every business event becomes one **balanced voucher** posted to ledgers. The
same postings give the party balances, bill-wise outstandings, VAT due and
the Trial Balance, Profit & Loss and Balance Sheet, with no re-entry.

## Screens

TallyPrime is keyboard-driven: one home menu, master forms, voucher entry
forms and drill-down reports. Each row below is one screen we need. Routes are
the ERP's future `view` names.

| ID | screen | how you reach it in Tally / ERP route | purpose | key components | states seen |
| --- | --- | --- | --- | --- | --- |
| S01 | Accounting home | Gateway of Tally / `accounting` | Entry point: create masters, enter vouchers, open reports | menu list, period selector, company + FY banner | filled, no-access |
| S02 | Company and financial year | Company create/alter / `accounting-settings` | Name, TIN, VRN, base currency TZS, books-from date, FY | form | first-run empty, filled |
| S03 | Feature switches | F11 Features / `accounting-settings` | Turn on bill-wise, cost centres, multi-currency, VAT, budgets, interest | toggles | on, off |
| S04 | Chart of accounts | Chart of Accounts / `accounting-coa` | Tree of groups and ledgers with balances | tree table, search, multi-create | filled, filtered, empty search |
| S05 | Group form | Create/Alter Group / `accounting-group` | Name, parent, nature, behaves-like-subledger, nett balances, used in VAT/calc | form | new, alter, predefined (read-only delete) |
| S06 | Ledger form | Create/Alter Ledger / `accounting-ledger` | Group, opening balance Dr/Cr, bill-wise on/off, credit days, credit limit, party link, bank details, VAT class, currency | form, party picker | new, alter, has-postings (delete blocked) |
| S07 | Voucher type form | Create/Alter Voucher Type / `accounting-voucher-type` | Base type, abbreviation, numbering (auto/manual/none), prefix/suffix per period, restart yearly, prevent duplicates, print after save, default narration | form | predefined, custom, inactive |
| S08 | Accounting voucher entry | Payment / Receipt / Contra / Journal / `accounting-voucher` | Dr/Cr lines, single-entry or double-entry mode, narration, cheque/ref | line grid, ledger picker, running Dr/Cr totals | new, unbalanced (cannot save), saved, reversed |
| S09 | Invoice entry | Sales / Purchase in invoice mode / `accounting-invoice` | Party, items or service ledgers, VAT, totals; links to ERP Pro forma / PO | item grid, VAT summary, party balance hint | new, credit-limit warning, saved, fiscalised, reversed |
| S10 | Credit / Debit Note | Credit Note / Debit Note / `accounting-invoice` | Sales return or price adjustment against an original invoice | same as S09 + original bill picker | new, saved |
| S11 | Bill-wise allocation | sub-screen on party lines | New Ref / Agst Ref / Advance / On Account, due date | allocation grid, pending-bills list | full, partial, on-account |
| S12 | Cost centre allocation | sub-screen on P&L lines | Split an amount across cost centres (branch, department, project) | allocation grid | full, partial (blocked) |
| S13 | Day Book | Day Book / `accounting-daybook` | All vouchers for a day or period | register table, filters, drill-down | empty day, filled |
| S14 | Ledger statement | Ledger Vouchers / `accounting-ledger-statement` | One ledger's postings with running balance | register, opening/closing | empty, filled |
| S15 | Trial Balance | Trial Balance / `accounting-tb` | Group/ledger closing balances; Dr = Cr | collapsible tree, period, detailed/condensed | balanced, difference-in-opening shown |
| S16 | Profit & Loss | P&L A/c / `accounting-pl` | Gross profit (direct) then net profit (indirect) | two-column statement, drill-down | filled |
| S17 | Balance Sheet | Balance Sheet / `accounting-bs` | Liabilities vs assets, P&L carried in | two-column statement | balanced |
| S18 | Cash and bank books | Cash/Bank Books / `accounting-cashbank` | Day-wise movements for Cash-in-hand and Bank ledgers | register | filled |
| S19 | Outstandings | Receivables / Payables / Ledger outstandings / `accounting-outstanding` | Pending bills by party, due date, overdue days, ageing buckets | table, ageing columns, party drill | none due, overdue |
| S20 | Bank reconciliation | Banking → BRS / `accounting-brs` | Set bank date on each book entry, or match imported statement lines; reconciled vs unreconciled | two-pane match, bank-date column, summary | unreconciled, matched, differences |
| S21 | Cash flow / Funds flow | Cash Flow / Funds Flow / `accounting-cashflow` | Monthly inflow/outflow by group | table, month columns | filled |
| S22 | Ratio analysis | Ratio Analysis / `accounting-ratios` | Working capital, current ratio, receivable turnover days, etc. | KPI list | filled |
| S23 | VAT return | VAT reports / `accounting-vat` | Output VAT, input VAT, exempt and zero-rated supplies for a month; uncertain transactions | summary, exception list, export | ready, exceptions present |
| S24 | Cost centre reports | Cost Centre / Category summary / `accounting-costcentre` | Income and expense by cost centre | tree table | filled |
| S25 | Budgets and variance | Budgets / `accounting-budgets` | Budget per group/ledger/cost centre and actual vs budget | form, variance table | over, under |
| S26 | Edit log / audit | Edit Log / `accounting-audit` | Who created, altered, reversed what and when | event list, before/after | filled |
| S27 | Exceptions | Exception Reports / `accounting-exceptions` | Negative cash/stock, optional, post-dated and memorandum vouchers, unbalanced imports | lists | none, some |
| S28 | Users and rights | Security Control / existing staff admin | Who may create, alter, view which voucher types and reports | role matrix | — |
| S29 | Interest | Interest Calculation / `accounting-interest` | Interest on overdue receivables or loans | report, post-interest action | — |
| S30 | Period close and new year | Period lock, split company / `accounting-close` | Lock a period, close a year, carry forward balances | wizard | open, locked |
| S31 | Import / export | Import Data / Export / `accounting-import` | Bring in Tally masters and vouchers (XML), export reports (Excel/PDF) | upload, preview, result | valid, rejected rows |
| S32 | Cheque printing / payment advice | Cheque Printing / `accounting-voucher` print | Print cheques and payment advices | print layout | — |

## Flows

```
F01 Invoice a customer (credit sale with VAT)
    ERP tax-invoice step -> S09 invoice (party, lines, 18% VAT) -> S11 New Ref bill, due date -> save -> fiscalise (VFD) -> print
    happy path clicks: ~6 if prefilled from the accepted Pro forma (today: retyped in Tally)
    edge: credit limit exceeded, VAT-exempt or zero-rated line, foreign currency, partial invoice of a Pro forma, VFD offline

F02 Receive a customer payment
    S08 Receipt -> pick bank/cash -> party -> S11 Agst Ref to one or more pending bills -> save
    happy path clicks: ~7
    edge: part payment, overpayment (on account / advance), withholding tax deducted by customer, bank charges, cheque bounces

F03 Record a supplier bill
    S09 Purchase -> supplier, lines, input VAT -> fiscal receipt verification code + supplier TIN -> S11 New Ref -> save
    edge: no valid fiscal receipt (input VAT not claimable: post to cost), link to PO / goods receipt, import with customs VAT

F04 Pay a supplier
    S08 Payment -> bank -> supplier -> S11 Agst Ref -> cheque/transfer ref -> S32 print
    edge: advance payment, FX supplier, partial

F05 Move cash between cash and bank
    S08 Contra -> from/to -> amount
    edge: deposit not yet cleared (BRS)

F06 Adjustment journal
    S08 Journal -> Dr/Cr lines -> S12 cost centres -> narration
    edge: depreciation, accruals, provisions; reversing journal at next period start

F07 Credit note for a return or price fix
    S10 Credit Note -> original invoice -> lines/VAT -> S11 Agst Ref
    edge: ERP stock return linkage, VAT period of original

F08 Reconcile a bank account
    S20 -> import statement or enter bank dates -> match -> post bank charges/interest found only on statement
    edge: duplicates, amount differences, opening BRS items from Tally

F09 File the monthly VAT return
    S23 -> resolve exceptions -> review output/input/exempt -> export for TRA portal -> mark filed -> lock period
    edge: late fiscal receipts, credit notes crossing months

F10 Month-end and year-end close
    S15 TB -> S16 P&L -> S17 BS -> S30 lock period / close year / carry forward
    edge: suspense balance not zero, unreconciled bank, opening-balance difference

F11 Correct a posted voucher
    Tally: alter in place, edit log records it.
    ERP: reverse (exact negative voucher) + post corrected voucher; both visible in S26.
    edge: corrected voucher in a locked period (blocked; correct in an open period)

F12 Migrate from Tally
    S31 import groups + ledgers + opening balances (+ open bills) -> TB must equal Tally's TB on cut-over date
    edge: name collisions, ledgers without ERP party, bills with no due date

F13 Chase overdue customers
    S19 ageing -> party drill -> statement / reminder
    edge: disputed bills, on-account credits
```

## Components

| component | variants | states | used on |
| --- | --- | --- | --- |
| Ledger picker (type-ahead) | any ledger, party-only, bank/cash-only, by group | empty, matches, create-on-the-fly (rights), inactive hidden | S06, S08–S12 |
| Dr/Cr line grid | single-entry, double-entry | balanced, unbalanced (save disabled), over max lines | S08, S09, S10 |
| Amount input | TZS, foreign + rate | invalid, negative blocked | everywhere |
| Bill allocation grid | New Ref, Agst Ref, Advance, On Account | fully allocated, short, over | S11 |
| Cost centre grid | — | full, short | S12 |
| Report table | register, tree (TB/coa), two-column statement | loading, empty, filled, drill-down | S13–S25 |
| Period selector | day, month, FY, custom | locked periods marked | all reports |
| Status tag | draft, posted, reversed, optional, post-dated, fiscalised, locked | — | S08–S10, S13 |
| Print layout | invoice, voucher, statement, cheque | — | S09, S10, S14, S32 |

Existing ERP parts to reuse: `esc()`, `run()` busy guard, status tags,
printable documents, `document-attachments.js`, staff/department roles.

## Inferred data model

Tally stores its own data format. The model below is ordinary double-entry
bookkeeping, shaped by the screens above and the ERP's existing rules
(integer minor units, versions, append-only history, RPC-only writes).

```
AccountGroup   id, name, parent_id (null = primary), nature (asset|liability|income|expense),
               affects_gross_profit (direct vs indirect), is_predefined, sort, version
               evidence: S04, S05, sources 1–2      confidence: high

Ledger         id, name, group_id, opening_minor (signed Dr+/Cr-), currency,
               bill_wise boolean, credit_days, credit_limit_minor,
               organization_id | supplier_id (party link to ERP), bank_details json,
               vat_class (standard|zero|exempt|out_of_scope), tin, vrn, active, version
               evidence: S06, source 1               confidence: high

VoucherType    id, name, base_type (sales|purchase|payment|receipt|contra|journal|credit_note|debit_note|reversing_journal|memorandum),
               numbering (auto|manual|none), prefix, suffix, restart (yearly|never), prevent_duplicates, active
               evidence: S07, source 3               confidence: high

Voucher        id, voucher_type_id, number, date, narration, reference, status (posted|reversed|optional|memorandum|post_dated),
               reverses_voucher_id, source_kind/source_id (proforma, delivery, purchase order, tally import),
               fiscal (vfd receipt number, verification code, qr, z-report date) for sales,
               supplier_fiscal_code for purchases, created_by, created_at, version
               evidence: S08–S10, S13, F11           confidence: high (fiscal fields: medium, from source 13)

VoucherEntry   id, voucher_id, line_no, ledger_id, amount_minor (signed, Dr+), currency, fx_rate, base_amount_minor
               invariant: sum(base_amount_minor) per voucher = 0
               evidence: S08, S15                    confidence: high

BillRef        id, ledger_id, name (bill number), due_date, kind (new|against|advance|on_account),
               entry_id, amount_minor
               pending = sum by (ledger, name)
               evidence: S11, S19, source 5          confidence: high

CostCategory / CostCentre / CostAllocation (entry_id, cost_centre_id, amount_minor)
               evidence: S12, S24                    confidence: medium

TaxRate        id, name, rate_bp (1800 = 18%, the only taxable rate), class, effective_from
               confidence: high (18% confirmed by Anudha)
BankStatementLine  id, ledger_id, date, amount_minor, description, bank_ref, matched_entry_id
               plus bank_date on VoucherEntry for manual BRS
               evidence: S20, source 6               confidence: medium
Currency / ExchangeRate (currency, date, rate)     evidence: source 7     confidence: medium
Budget / BudgetLine (group|ledger|cost centre, period, amount)  evidence: S25, source 8  confidence: medium
PeriodLock     id, through_date, locked_by, locked_at   evidence: S30   confidence: medium
AccountingEvent (append-only audit: voucher/master, action, before, after, actor, at)  evidence: S26, source 10  confidence: high
FiscalYear     id, starts_on, ends_on, closed_at       evidence: S02, S30   confidence: high
```

Relationships: AccountGroup 1-n AccountGroup (tree), AccountGroup 1-n Ledger,
VoucherType 1-n Voucher, Voucher 1-n VoucherEntry, VoucherEntry 1-n BillRef,
VoucherEntry 1-n CostAllocation, Ledger 0-1 ERP organization or supplier,
Voucher 0-1 ERP source record (Pro forma, delivery, purchase order).

## Deliberate differences from TallyPrime

1. **No altering or deleting posted vouchers.** Tally allows both and logs
   them. The ERP's rule is append-only, so corrections are reverse-and-repost.
   Auditors get a cleaner trail.
2. **No retyping.** Sales invoices come from the accepted Pro forma or
   delivery, purchase bills come from the purchase order, and receipts come
   from pending bills. Today the team types these into Tally.
3. **Browser, multi-user, row-locked writes.** There's no single Tally
   licence PC, and two accountants can't double-post the same bill.
4. **Rights enforced in the database** through `accounting_memberships` and
   departments, not only in the screens.
5. **Fiscalisation built in.** Sales post to TRA VFD from the same save, not
   from a separate device.

## Feature matrix

See `features.csv`. Must: 47, should: 13, could: 9, skip: 9. `parity.py` scores the 62 rows TallyPrime has (40 must-haves). The 7 ERP-only must-haves (no retyping, VFD, parallel-run report) are extras it does not score, but they still gate cut-over.

## Out of scope (cannot or should not be cloned)

- Tally's TDL customisation language, Tally.NET, TallyPrime Server, remote
  access and its licence/edition model. These are their platform, not
  bookkeeping.
- India-only statutory modules: GST, e-way bill, TDS/TCS, Indian payroll
  statutory. Tanzania VAT replaces them.
- Tally's inventory engine (godowns, batches, stock journals). The ERP already
  owns stock, so accounting only receives stock valuation postings.
- Tally's on-disk data format and private connectivity. We use the documented
  XML Import/Export only, for migration.
- Payroll (should be its own later project).
- **Statutory certification is not a feature we can copy.** TRA VFD
  registration, the ERP's own fiscal integration certification and the
  accountant/auditor's sign-off on the chart of accounts and VAT logic are
  approvals Anudha must obtain (LEG-032, LEG-033, LEG-082).

## Size

Screens 32, flows 13, entities 15.

Hard parts:
1. **Ledger integrity under concurrency.** That means balanced vouchers
   enforced in Postgres, bill-wise allocation that never over-settles,
   gap-free numbering per voucher type and year, and locked periods.
2. **TRA fiscalisation (VFD).** It needs TRA registration, tokens, a receipt
   per sale, a daily Z report, offline/retry with idempotency, and the 2025/26
   pre-clearance e-invoicing change still to come. **VAT rate: 18% on every
   taxable line (confirmed by Anudha, 2026-10-06).** No reduced rate is built.
   The rate lives in an effective-dated tax table so a future change is data,
   not code. Still to confirm with the accountant: the return due date
   (sources say 20th or 25th).
3. **Cut-over from Tally.** Opening balances and open bills must tie to
   Tally's Trial Balance to the shilling, followed by a parallel run of at
   least one full VAT month before Tally is switched off.

Size: **L** (a quarter). The ledger, vouchers, bill-wise and core reports are
weeks. VFD certification and the parallel run set the calendar.

## Next actions

1. **Read Anudha's own TallyPrime company** with the Accounts team and record
   the real groups, ledgers, voucher types, numbering, cost centres and
   currencies. Export *Masters* and the *Trial Balance* as XML/Excel into
   `replica/screens/` as reference (not shipped). That file replaces every
   "medium" confidence row above.
2. Allow `help.tallysolutions.com` in the environment's network settings so
   the *search* rows can be checked against the full pages.
3. Run `/replica-architect` to turn the model into Supabase migrations that
   follow `.ai-style-rules.md`.
