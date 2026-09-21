# Anudha ERP completion checklist

## Current scope: exactly two workflows

This checklist is governed by [TWO_WORKFLOW_SCOPE.md](TWO_WORKFLOW_SCOPE.md). The current connected workflow scope contains only:

1. **Sales:** draft and revisions → customer acceptance → Pro forma submitted → Accounts approved → tax invoice created → downstairs sales/packing queue → packing in progress → ready for delivery → out for delivery → signed delivery note. Every transition records the employee and timestamp, and Pro forma, tax-invoice and delivery-note PDFs are retained. Accounts role restrictions are deferred.
2. **Service:** signed machine delivery → installation created → HOD assignment → installation completion → maintenance schedule → service assignment → service completion. Every transition records the employee and timestamp, and installation, maintenance and service PDFs are retained.

**Out of current workflow scope:** purchasing, general ledger, suppliers and returns. Any related entries below are retained only as historical comparison or launch-readiness context; they are not active connected workflows.

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

### Current two-workflow sequence

1. **Sales:** draft/revisions → customer acceptance → Pro forma submitted → Accounts approved → tax invoice created → downstairs sales/packing queue → packing in progress → ready for delivery → out for delivery → signed delivery note.
2. **Service:** signed machine delivery → installation created → HOD assignment → installation completion → maintenance schedule → service assignment → service completion.

Both workflows must record the responsible employee and timestamp at every transition and retain their required PDFs. Accounts role restrictions are deferred. Purchasing, general ledger, suppliers and returns are not connected build sequences in the current scope.

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

## Current workflow completion checks

### 1. Sales

- [ ] Draft Pro forma supports revisions without losing revision history.
- [ ] Customer acceptance identifies the accepted revision and records the employee and timestamp.
- [ ] Pro forma moves through **Submitted** and **Accounts approved** with employee and timestamp records.
- [ ] Tax invoice is created and retained as a PDF.
- [ ] Approved work enters the downstairs sales/packing queue.
- [ ] Packing moves through **In progress**, **Ready for delivery** and **Out for delivery**, recording employee and timestamp at each transition.
- [ ] Signed delivery note is retained as a PDF and completes delivery.
- [ ] Pro forma and acceptance documents are retained as PDFs.
- [ ] Accounts role restrictions remain deferred and are not a completion condition for this scope.

### 2. Service

- [ ] Signed machine delivery creates an installation record.
- [ ] HOD assignment records the assigned employee and timestamp.
- [ ] Installation completion records the employee and timestamp and retains the installation PDF.
- [ ] Installation completion creates the maintenance schedule.
- [ ] HOD service assignment records the assigned employee and timestamp.
- [ ] Service completion records the employee and timestamp and retains the service PDF.
- [ ] Maintenance records are retained as PDFs.

### Out of current workflow scope

- Purchasing
- General ledger
- Suppliers
- Returns

## Recommended delivery order for the current scope

1. Complete server migration and prove the launch security, backup and load targets.
2. Complete sales draft, revision, acceptance, submission, Accounts approval and PDF records.
3. Complete tax-invoice creation and the downstairs sales/packing queue.
4. Complete packing, ready-for-delivery, out-for-delivery and signed-delivery-note transitions and PDFs.
5. Connect signed machine delivery to installation creation and HOD assignment.
6. Complete installation, maintenance scheduling, service assignment and service completion with employee/timestamp history and PDFs.
7. Run end-to-end acceptance tests for these two workflows only.

## Information still needed from management

- Complete employee list with role, department, manager and allowed locations.
- Complete godown list and the person responsible for each location.
- Signed opening-stock count sheets and verified carton sizes.
- Approved pro forma invoice, tax invoice, delivery note and service-report samples.
- Approval limits for discounts, purchases, inventory corrections and write-offs.
- Written decision on Tally/Sangam/ERP ownership of each accounting record.
