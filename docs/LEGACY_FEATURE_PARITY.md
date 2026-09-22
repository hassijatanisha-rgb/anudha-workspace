# Old ERP → GitHub product acceptance checklist

Source: ../anudha-erp/ADMIN_PORTAL_CHECKLIST.md. All 82 reference items are retained below. Old checkmarks describe demo behaviour, not evidence for this product. Each new checkmark requires the implemented screen, persisted behaviour, permissions and handoff to be verified. “Unverified” does not mean absent.

## Latest decisions override historical wording

- One Anudha platform and shared database, individual logins and department-specific views—not one shared Admin login.
- Lead and opportunity are one entity labelled Lead / opportunity.
- Pro forma → Mujtaba invoices available quantities → immediate shared-stock reservation → Jagroop assigns packing. Notify the creator. Shortages stay separately in Pending stock; dispatch records physical issue.
- RF scanning remains unavailable until hardware/IDs are ready; no pretend scan success.
- Do not copy demo balances, people, bank numbers or external-connection claims.
- Accounting access restrictions are required; older notes deferring them do not grant permission to expose money to all staff.

## Current delivery order

1. Original logo/palette and simple navigation without disrupting existing screens.
2. Shared accounting handoff: fix authorization, expired-lot eligibility, partial invoice totals and outstanding-order visibility before activation.
3. Jagroop assignment, creator notification and pending-stock follow-up.
4. Lead / opportunity conversion and Pro forma layout parity.
5. Verify connected delivery → installation/service and document exports.
6. Remaining reference features below, each with separate release evidence. External integrations remain explicitly disconnected until configured.

## Evidence rules

Record source commit, test, database activation and browser result for each completed item. No overall completion percentage from local test count. A print button alone does not prove correct invoice values or retained PDFs.


## Portal and access

- [ ] LEG-001 — Exactly one portal and one login: Admin. **New ERP: unverified.**
- [ ] LEG-002 — Admin can see the entire company process in one place. **New ERP: unverified.**
- [ ] LEG-003 — Everyone is read-only by default; Admin grants create, edit, approve, invoice, and complete rights by employee and area. **New ERP: unverified.**
- [ ] LEG-004 — Employee permission records are managed inside Admin; they are not separate demo login accounts. **New ERP: unverified.**
- [ ] LEG-005 — Every visible button opens a page, form, filter, download, or action; decorative elements are not styled as buttons. **New ERP: unverified.**
- [ ] LEG-006 — Desktop sidebar and page content can scroll independently; mobile navigation scrolls horizontally. **New ERP: unverified.**

## CRM, calls, leads, and reporting

- [ ] LEG-007 — Inquiry/visit → lead → opportunity → quotation → pro forma invoice. **New ERP: unverified.**
- [ ] LEG-008 — Assign and reassign leads and work with owner, creator, next step, due date, and history. **New ERP: unverified.**
- [ ] LEG-009 — Track opportunities for weeks, months, or years with next follow-up and won/lost status. **New ERP: unverified.**
- [ ] LEG-010 — Weekly, monthly, yearly, employee, and company sales reporting. **New ERP: unverified.**
- [ ] LEG-011 — Field-visit reports by employee, customer, city, and region with findings, opportunities, equipment down, missing reagents, challenges, actions, and way forward. **New ERP: unverified.**
- [ ] LEG-012 — Shared/searchable visit history so the next employee does not restart discovery. **New ERP: unverified.**
- [ ] LEG-013 — Incoming, answered, missed, invalid, and converted-to-lead call reporting across six office numbers. **New ERP: unverified.**
- [ ] LEG-014 — Incorrect-number work cannot close until the number is corrected or the account is changed. **New ERP: unverified.**
- [ ] LEG-015 — Connect caller ID/telephony provider. **New ERP: unverified.**
- [ ] LEG-016 — Connect WhatsApp and email production accounts. **New ERP: unverified.**

## Customers and data quality

- [ ] LEG-017 — Portfolio for each hospital/company: contacts, current orders, credit, balances, invoices, taxes, payments, past purchases, products, installations, and service. **New ERP: unverified.**
- [ ] LEG-018 — Every form includes the customer and a specific contact person. **New ERP: unverified.**
- [ ] LEG-019 — One person can be linked to multiple facilities with dates and a primary workplace. **New ERP: unverified.**
- [ ] LEG-020 — Periodic contact verification for employer, role, phone, email, active/retired/deceased status. **New ERP: unverified.**
- [ ] LEG-021 — Duplicate warning for customer, contact, phone, email, product, serial, and batch. **New ERP: unverified.**
- [ ] LEG-022 — Preserve history when merging or correcting records. **New ERP: unverified.**
- [ ] LEG-023 — Clean and approve source data before production import. **New ERP: unverified.**

## Quotations, orders, and accounting

- [ ] LEG-024 — Public, private, mission, trader, and pharmacy customer routes. **New ERP: unverified.**
- [ ] LEG-025 — Accept LPO/PO, written confirmation, or payment proof as appropriate. **New ERP: unverified.**
- [ ] LEG-026 — Editable quotation and pro forma invoice forms with revision history. **New ERP: unverified.**
- [ ] LEG-027 — Convert accepted pro forma invoice to sales order without retyping; allow controlled omissions and edits. **New ERP: unverified.**
- [ ] LEG-028 — Carry item name, size, specification, description, quantity, price, tax, and notes through every stage. **New ERP: unverified.**
- [ ] LEG-029 — Forms include ISO details, contact numbers, bank details, goods delivery period, E. & O.E., and prepared-by employee. **New ERP: unverified.**
- [ ] LEG-030 — VAT/tax invoice, ledger, receivable, payable, cash, memo, and credit views. **New ERP: unverified.**
- [ ] LEG-031 — Invoice/cash authority can be restricted to approved Admin employees. **New ERP: unverified.**
- [ ] LEG-032 — Configure and certify TRA/fiscal integration on the in-house server. **New ERP: unverified.**
- [ ] LEG-033 — Validate opening balances, chart of accounts, taxes, fiscal documents, and statutory reports with the accountant. **New ERP: unverified.**

## Order A-to-Z

- [ ] LEG-034 — Sales order → godown stock verification → accounts/invoice → picking → checking → packing → dispatch → delivery → installation/service. **New ERP: unverified.**
- [ ] LEG-035 — Every employee can see the exact stage, owner, elapsed time, ETA, and next step. **New ERP: unverified.**
- [ ] LEG-036 — Reason for delay, waiting time, expected date, and confirmed date. **New ERP: unverified.**
- [ ] LEG-037 — Hospital pending orders distinguish in-stock, partially available, ordered, and unavailable items. **New ERP: unverified.**
- [ ] LEG-038 — Supplier LPO tracker separately shows orders Anudha placed with manufacturers/suppliers. **New ERP: unverified.**
- [ ] LEG-039 — Out-of-stock manufacturer orders can be escalated to the Managing Director. **New ERP: unverified.**
- [ ] LEG-040 — Haadi consolidation/packing stage for items arriving from multiple godowns and customers. **New ERP: unverified.**
- [ ] LEG-041 — Completed and incomplete work by employee, department, and whole company. **New ERP: unverified.**
- [ ] LEG-042 — Connect daily overdue reminder scheduler. **New ERP: unverified.**

## Inventory and godowns

- [ ] LEG-043 — Canonical product/SKU master with searchable aliases and duplicate detection. **New ERP: unverified.**
- [ ] LEG-044 — Specifications and descriptions remain attached to the correct line item. **New ERP: unverified.**
- [ ] LEG-045 — Receiving captures quantity, serial, batch, expiry, supplier, and godown from day one. **New ERP: unverified.**
- [ ] LEG-046 — Existing serial numbers can be entered; serial is mandatory for equipment dispatch. **New ERP: unverified.**
- [ ] LEG-047 — Serial/warranty/recall history and double-allocation prevention. **New ERP: unverified.**
- [ ] LEG-048 — Stock movement and transfer history across all godowns; exact number of active locations remains configurable. **New ERP: unverified.**
- [ ] LEG-049 — Godown-by-godown physical count, two-person verification, variance, and mandatory variance reason. **New ERP: unverified.**
- [ ] LEG-050 — Short-expiry disclosure, price adjustment, named customer approval, or selection of longer-expiry stock. **New ERP: unverified.**
- [ ] LEG-051 — Inventory analysis: expiring batches, best sellers, slow/non-moving items, items to push, stock recommendations, and hospital demand by location. **New ERP: unverified.**
- [ ] LEG-052 — Reconcile starting physical stock and assign operational stock accountability. **New ERP: unverified.**
- [ ] LEG-053 — Add RF/barcode hardware for intake, picking, expiry, serial, and storage scanning. **New ERP: unverified.**

## Installation and service

- [ ] LEG-054 — Only invoice lines requiring installation create engineering cases. **New ERP: unverified.**
- [ ] LEG-055 — Installation is default for equipment; override requires a reason. **New ERP: unverified.**
- [ ] LEG-056 — Case type is Installation or Service, not Lead/Task. **New ERP: unverified.**
- [ ] LEG-057 — Case includes customer, contact, city, product, serial, issue, expected/confirmed date, Head, engineer, and schedule. **New ERP: unverified.**
- [ ] LEG-058 — Progress: opened → checklist → stock check → schedule → dispatch → on-site → report → closed. **New ERP: unverified.**
- [ ] LEG-059 — Equipment checklist includes machine, UPS/stabilizer, gel, wire, accessories, and required reagents. **New ERP: unverified.**
- [ ] LEG-060 — Packing cannot close until required quantities are ticked or unresolved quantities remain explicitly pending. **New ERP: unverified.**
- [ ] LEG-061 — Partial packs show sent/pending quantity, note, expected arrival, editable dates, and revision history. **New ERP: unverified.**
- [ ] LEG-062 — Record the stores employee who checked each line, serial, and accessory. **New ERP: unverified.**
- [ ] LEG-063 — Engineering receives installation document/invoice and dispatch timing before equipment leaves the godown. **New ERP: unverified.**
- [ ] LEG-064 — Calendar includes installation, service, maintenance, and incoming equipment; 15-day service warning. **New ERP: unverified.**
- [ ] LEG-065 — Service report assignment: Head plus employee, or Head only; findings, parts, and sign-off. **New ERP: unverified.**
- [ ] LEG-066 — Connect WhatsApp/email reminders and server-side calendar scheduler. **New ERP: unverified.**

## Dispatch, delivery, returns, and complaints

- [ ] LEG-067 — Ready for dispatch and Dispatched / out for delivery are distinct states. **New ERP: unverified.**
- [ ] LEG-068 — Carrier/method: bus, courier, Bolt, boda, company driver, or other. **New ERP: unverified.**
- [ ] LEG-069 — Record carrier handoffs, depot transfers, split parcels, tracking reference, expected arrival, and actual arrival. **New ERP: unverified.**
- [ ] LEG-070 — One-day and two-day overdue queues remain open until delivery proof is recorded. **New ERP: unverified.**
- [ ] LEG-071 — Customer-visible processed → handed to carrier → in transit → arrived → delivered status. **New ERP: unverified.**
- [ ] LEG-072 — Dispatch trigger prepares tax invoice PDF and delivery-status message for WhatsApp/email. **New ERP: unverified.**
- [ ] LEG-073 — Signed delivery note photo/upload after delivery. **New ERP: unverified.**
- [ ] LEG-074 — Manual returns with serial/batch, reason, condition, stock adjustment, and PDF report. **New ERP: unverified.**
- [ ] LEG-075 — Complaints capture missing/wrong/damaged items, owner, customer impact, action, resolution, root cause, and monthly trend. **New ERP: unverified.**
- [ ] LEG-076 — Monthly carrier report by method with delays, errors, losses, damage, and corrective action. **New ERP: unverified.**
- [ ] LEG-077 — Connect file storage, messaging, and any courier/GPS APIs. **New ERP: unverified.**

## Production and security

- [ ] LEG-078 — Deploy application, database, files, backups, and integrations to Anudha's in-house servers. **New ERP: unverified.**
- [ ] LEG-079 — Individual authentication/SSO, MFA, least-privilege authorization, session controls, and audit trail. **New ERP: unverified.**
- [ ] LEG-080 — Encryption in transit and at rest; managed keys/secrets and encrypted backups. **New ERP: unverified.**
- [ ] LEG-081 — Restore test, monitoring, incident procedure, retention policy, and access review. **New ERP: unverified.**
- [ ] LEG-082 — TRA/accounting acceptance testing, security review, load testing, and staff user-acceptance testing before live data entry. **New ERP: unverified.**

