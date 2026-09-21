# Anudha ERP completion checklist

Status key: **Working**, **Partial**, **Not started**, **Server week**.

## What is working now

- **Working — Individual login:** no public signup; active staff membership is checked before business data loads.
- **Working — Client directory:** client groups, branches, contacts, search, revision queue, approval, edit, recoverable delete and restore.
- **Working — Product master:** 4,247 imported product records, source review, duplicate review, category confirmation and SKU editing.
- **Working — Inventory foundation:** locations, carton definitions, physical opening counts, count corrections, transfers, Haadi receipt, carton opening, individual client issues, quarantine and immutable movement history.
- **Working — Concurrent inventory writes:** stock-changing database functions lock rows and reject stale versions instead of silently overwriting another employee's work.
- **Partial — Permissions:** owner and staff exist, but department, job-role and godown-specific access do not.
- **Partial — Audit:** inventory movements and changes are recorded; management audit screens and exports are incomplete.
- **Partial — Recovery:** deleted clients and contacts can be restored; full database backup and disaster recovery are not yet proven.

## Required before 70 employees go live

### Application and data

- [ ] Finish client/contact cleanup and approve the records staff may use.
- [ ] Confirm every real godown and dispatch location; do not create guessed locations.
- [ ] Classify the active product list and assign canonical SKUs.
- [ ] Verify carton/unit definitions from supplier labels or approved documentation.
- [ ] Enter opening stock from signed physical counts, including batch and expiry where applicable.
- [ ] Add serial-number tracking for machines and serialized spares.
- [ ] Add two-person stock-count verification and variance approval.
- [ ] Add stock reservations so two orders cannot promise the same quantity.
- [ ] Add returns, damaged stock, expired stock and quarantine resolution.
- [ ] Add low-stock and expiry alerts after reliable movement history exists.

### Staff and security

- [ ] Create one login per employee; never share accounts.
- [ ] Import employee name, department, manager, branch/godown and active status.
- [ ] Replace owner/staff with permissions for sales, inventory, Haadi, service, purchasing, accounts and administration.
- [ ] Restrict staff to the locations and actions required for their jobs.
- [ ] Require MFA for owners, accounts and administrators.
- [ ] Add session timeout, password reset, staff-disable and offboarding procedures.
- [ ] Test database row-level security for anonymous, disabled, ordinary and owner users.

### Server week

- [ ] Put search, filtering and pagination on the server; never download every client/contact/product at login.
- [ ] Add indexed read models for Clients, Needs revision, Products, Stock and activity history.
- [ ] Keep all stock, approval, invoice and accounting transitions inside atomic database transactions.
- [ ] Add connection pooling, request timeouts, retry rules and idempotency keys.
- [ ] Create staging and production environments with separate credentials and data.
- [ ] Store every database migration in the repository, including the existing client/contact/product schema.
- [ ] Add continuous integration for syntax, unit, database-policy and end-to-end tests.
- [ ] Add structured error logs, uptime monitoring, slow-query monitoring and alerts.
- [ ] Automate daily encrypted backups and complete a documented restore test.
- [ ] Document deployment, rollback, incident response and the responsible people.
- [ ] Run a 70-concurrent-user test, a 150-user burst test and a four-times-current-data test.

Launch targets: p95 screen/API response under 2 seconds for normal work, less than 1% request failure, no lost or double-applied writes, and a successful backup restoration.

“Unlimited” is an architecture goal, not a literal capacity. The software must avoid hard-coded employee limits and scale by adding server/database resources. Every production system still has measured CPU, memory, storage, connection and bandwidth limits.

## Complete ERP business workflows

### 1. CRM and sales

- [ ] Lead and opportunity pipeline with owner, stage, value, next action and history.
- [ ] Quotation and pro forma invoice with revision, approval, PDF and customer acceptance.
- [ ] Sales order created from the accepted pro forma invoice without retyping lines.
- [ ] Stock check and reservation, including partial availability and supplier-order shortages.
- [ ] Tax invoice handoff to the approved accounting process.
- [ ] Haadi packing, dispatch, delivery note and proof of delivery.
- [ ] Customer history by machine, reagent, consumable, spare, branch and month.

### 2. Purchasing and suppliers

- [ ] Supplier master, contacts, terms, currencies and approved product relationships.
- [ ] Purchase request, approval, request for quotation and supplier comparison.
- [ ] Local purchase order with revisions and approval limits.
- [ ] Incoming shipment, goods receipt, inspection, variance and quarantine.
- [ ] Supplier invoice matching against PO and receipt before accounts payment.
- [ ] Lead-time, fill-rate and price history.

### 3. Inventory and godowns

- [x] Product, carton and individual-unit model.
- [x] Godown-to-Haadi transfer and receipt model.
- [x] Haadi carton opening and individual client issue.
- [ ] Complete godown master and opening physical counts.
- [ ] Machine serials, warranties and ownership history.
- [ ] Reservations, picking, packing and dispatch linkage to sales orders.
- [ ] Cycle counts, full stock counts, variance approval and stock reconciliation.
- [ ] Returns, expiry, damage, quarantine release and disposal.
- [ ] Reorder levels, purchase suggestions and demand planning after clean history exists.

### 4. Service and engineering

- [ ] Installation case created from delivered equipment.
- [ ] Engineer assignment, schedule and customer/site contacts.
- [ ] Installation checklist, photos, serial numbers and customer signature.
- [ ] Service request, diagnosis, parts used, labour and visit history.
- [ ] Service report PDF based on the existing approved form.
- [ ] Warranty, preventive maintenance schedule and equipment service history.

### 5. Finance and integrations

- [ ] Confirm which system is the accounting source of truth: Tally, Sangam or ERP.
- [ ] Define approved mappings for customers, suppliers, items, taxes, ledgers and document numbers.
- [ ] Post invoices, receipts, supplier bills, payments and stock value without duplicate entries.
- [ ] Reconciliation queue for rejected or mismatched postings.
- [ ] Credit limits, ageing, receivables and payable reports.
- [ ] Tax and statutory reports reviewed by the responsible accountant.

### 6. Management and operations

- [ ] Role-specific home screens and task queues.
- [ ] Notifications and escalations with ownership and due dates.
- [ ] Searchable attachments for quotations, delivery, installation, service, returns and counts.
- [ ] Sales, inventory, service, purchasing and finance dashboards.
- [ ] Export controls and personally identifiable information access logs.
- [ ] Training material, user acceptance testing, sign-off and phased rollout.

## Recommended delivery order

1. Finish clean clients, products, godowns and verified opening inventory.
2. Complete server migration and prove the 70-user launch targets.
3. Build lead → pro forma → acceptance → order → stock reservation.
4. Build Haadi packing → dispatch → delivery.
5. Build service and installation reports.
6. Build purchasing → receiving → supplier invoice matching.
7. Integrate the approved accounting source of truth.
8. Add forecasting and management analytics only after transaction history is reliable.

## Information still needed from management

- Complete employee list with role, department, manager and allowed locations.
- Complete godown list and the person responsible for each location.
- Signed opening-stock count sheets and verified carton sizes.
- Approved pro forma invoice, tax invoice, delivery note and service-report samples.
- Approval limits for discounts, purchases, inventory corrections and write-offs.
- Written decision on Tally/Sangam/ERP ownership of each accounting record.
