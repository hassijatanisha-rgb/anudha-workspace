# Anudha ERP completion checklist

Status key: **Working**, **Partial**, **Not started**, **Server week**.

## Old ERP vs new ERP feature matrix

| Business feature | Old ERP had | New ERP has now | New ERP still needs |
| --- | --- | --- | --- |
| Staff login and access | Individual logins, roles and permissions; some permission screens were frontend-only | **Working:** individual Supabase login, active staff check, owner/staff access | Staff roster, departments, job roles, location permissions, MFA, password reset and offboarding |
| Client groups and branches | Customer directory and portfolio screens; several histories used sample data | **Working:** real client groups, branches, contacts, search, approval and revision flags | Server-side search/paging and final data cleanup |
| Contact cleanup | Contact viewing/editing with duplicate review | **Working:** one Needs revision queue, exact error reasons, edit, complete, recoverable delete and restore | Bulk assignment, progress reporting and manager review |
| Leads and opportunities | Lead stages, assignment and conversion screens; conversion had previously required repair | **Not started:** branch tab is present only | Real lead records, owner, stage, value, next action, history and conversion into Pro forma without retyping |
| Pro forma invoice | Pro forma workflow, approvals and stock-check steps; earlier lifecycle bugs were repaired in the old codebase | **Working:** database-backed draft/revision/send/accept/reject/cancel, printable document and acceptance proof | Create from a lead, approval limits, attachments and customer-send connector |
| Sales order and stock reservation | Order handoff, stock check, packing and delivery workflows | **Partial:** accepted Pro forma feeds delivery; Haadi lot availability is checked | Explicit sales order, reservation before dispatch, partial shortage workflow and supplier-order handoff |
| Delivery | Packing checklist, dispatch, delivery proof and customer delivery views | **Working:** accepted Pro forma → Accounts reference → Haadi lot selection → ready → dispatch → signed proof | Durable photo/file uploads, route/driver fields, customer notification and returns link |
| Products | Product directory, compatibility and packing rules; parts of inventory used static data | **Working:** 4,247 imported products, source review, categories and stock-code editing | Complete classification, verified carton sizes, machine compatibility and serial tracking |
| Inventory and godowns | Stock lookup/history, packing, receipt and godown views; some screens were static | **Working foundation:** locations, physical counts, transfers, Haadi receipt, carton opening, client issue, quarantine and movement history | Opening counts, reservations, serials, cycle counts, expiry/damage resolution, reorder alerts |
| Customer consumption history | Customer portfolio purchase/history views, some backed by fixed examples | **Working:** branch history queries real issued/delivered items and totals them by month, machine, reagent, consumable and spare | Server-side export and longer-history paging after the server move |
| Service and installation | Service cases, engineer tasks, reports, signatures and maintenance; core service handler passed isolated tests | **Not started:** branch tab is present only | Delivery-created installation case, assignment, checklist, parts/labour, signatures, approved PDF and maintenance schedule |
| Purchasing and suppliers | Purchasing/escalation screens; some actions only saved activity summaries | **Not started** | Supplier master, purchase request, RFQ comparison, LPO, receipt/inspection, three-way invoice matching and history |
| Returns | Return screens and printable output; stock movement was not fully connected in old UI | **Not started** | Linked return request, approval, quarantine/stock movement, replacement/credit outcome and PDF |
| Finance and accounting | Balanced journals, invoice/payment primitives and reports; not a complete accounting package | **Partial:** Accounts/tax-invoice reference gates delivery | Decide Tally/Sangam/ERP source of truth, mappings, posting, reconciliation, ageing, credit limits and approved tax reporting |
| Tasks and notifications | Company tasks, assignments, calendar and queued messages; several dashboard totals were static | **Not started** | Live role queues, due dates, escalation, record links, email/WhatsApp connectors and delivery status |
| Documents and attachments | Pro forma, delivery, return and service PDFs plus evidence/photo screens | **Partial:** printable Pro forma and delivery records | Durable private file storage, approved templates, versioning, access rules and searchable attachments |
| Dashboards and reports | Role dashboards and weekly/customer reports; some used samples | **Not started** | Sales, stock, service, purchasing and finance dashboards using live data only |
| Audit, backup and server operations | Audit/security foundations and deployment documents | **Partial:** inventory and sales transition histories exist | Management audit viewer/export, full write audit, monitoring, encrypted backups, restore drill and 70-user load proof |

### Connected build sequence

1. Leads → Pro forma invoice without retyping.
2. Accepted Pro forma → sales order → stock reservation/shortage.
3. Haadi pick/pack → dispatch → delivery proof → client consumption history.
4. Delivered machine → installation/service case → engineer report → equipment history.
5. Stock shortage → purchase request → supplier order → receipt → inventory.
6. Approved sales/purchase events → Tally/Sangam handoff → reconciliation.
7. Live tasks, notifications, dashboards, audit and reports across every workflow.

## What is working now

- **Working — Individual login:** no public signup; active staff membership is checked before business data loads.
- **Working — Client directory:** client groups, branches, contacts, search, revision queue, approval, edit, recoverable delete and restore.
- **Working — Product master:** 4,247 imported product records, source review, duplicate review, category confirmation and stock-code editing.
- **Working — Inventory foundation:** locations, carton definitions, physical opening counts, count corrections, transfers, Haadi receipt, carton opening, individual client issues, quarantine and immutable movement history.
- **Working — Concurrent inventory writes:** stock-changing database functions lock rows and reject stale versions instead of silently overwriting another employee's work.
- **Partial — Permissions:** owner and staff exist, but department, job-role and godown-specific access do not.
- **Partial — Audit:** inventory movements and changes are recorded; management audit screens and exports are incomplete.
- **Partial — Recovery:** deleted clients and contacts can be restored; full database backup and disaster recovery are not yet proven.

## Required before 70 employees go live

### Application and data

- [ ] Finish client/contact cleanup and approve the records staff may use.
- [ ] Confirm every real godown and dispatch location; do not create guessed locations.
- [ ] Classify the active product list and assign clear stock codes.
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
