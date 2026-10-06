# Recon map: Jobber (web + Android/iOS)

Scope: the core field-service loop: request → quote → job → visit → invoice → paid. Built for the Dar es Salaam market.
For: a product we sell to service businesses in Dar es Salaam (AC/HVAC, solar, generators, lab/medical equipment servicing, security systems, cleaning, pest control).
Date: 2026-10-06
Method: clean-room, public sources only. getjobber.com and help.getjobber.com are blocked by this environment's network policy, so the evidence below comes from third-party listings and reviews. Confirm the screen list against Jobber's own help center and the store listing from a normal browser before the build.

## Sources

| # | source | URL | notes |
| --- | --- | --- | --- |
| 1 | pricing (3rd party) | https://www.getonecrew.com/post/jobber-pricing | tiers Core / Connect / Grow / Plus |
| 2 | pricing (3rd party) | https://costbench.com/software/field-service-management/jobber/ | user caps per tier |
| 3 | pricing (3rd party) | https://schedulingkit.com/pricing-guides/jobber-pricing | gating of QuickBooks, job costing, 2-way SMS |
| 4 | feature overview | https://erpresearch.com/erp-add-ons/field-service/jobber | quote builder, quote → job, Client Hub |
| 5 | how it works | https://www.workyard.com/answers/how-does-jobber-work | lifecycle request → quote → job → invoice |
| 6 | review site | https://softwareconnect.com/reviews/jobber/ | feature list, mobile app |
| 7 | app store listing | https://apps.apple.com/us/app/1014146758 | mobile: visits, create client/quote/job/invoice/expense/task |
| 8 | reviews | https://www.capterra.com/p/127994/Jobber/reviews/ | complaints: price per user, weak mobile app, hard-to-find settings, reporting |
| 9 | own code | this repo: `service-workflow.js`, `sales-delivery.js`, `work-assignments.js`, `tally-invoices.js` | Anudha ERP: what we already have that can be reused (see note at end) |

## Core loop

A business owner turns a customer's request into a quote, a quote into a scheduled job, sends a technician, and gets paid. In Jobber that payment is by card. Ours: **M-Pesa / Mixx by Yas / Airtel Money, with a TRA-compliant receipt.**

## Screens

| ID | screen | route / how to reach | purpose | key components | states seen |
| --- | --- | --- | --- | --- | --- |
| S01 | Sign up / log in | / | account + business setup | form, phone OTP | empty, error |
| S02 | Home / dashboard | /home | today's visits, money owed, to-do counts | stat tiles, visit list | empty, filled |
| S03 | Clients list | /clients | CRM directory | table, search, tags | empty, filled |
| S04 | Client detail | /clients/:id | properties, history, balance | tabs, timeline | filled |
| S05 | Requests list | /requests | inbound work requests | table, status pill | empty, filled |
| S06 | Request detail / new | /requests/:id | capture need, assess on site | form, photos | new, filled |
| S07 | Quotes list | /quotes | drafts, sent, approved, converted | table, filters | empty, filled |
| S08 | Quote builder | /quotes/:id | line items, options, photos, send | line-item editor, totals, send dialog | draft, sent, approved, declined |
| S09 | Jobs list | /jobs | active, recurring, requires invoicing | table, filters | empty, filled |
| S10 | Job detail | /jobs/:id | visits, line items, notes, costing | tabs, visit list | one-off, recurring, closed |
| S11 | Schedule / calendar | /schedule | drag-drop dispatch per technician | day/week/month, map view | empty, conflicts |
| S12 | Visit (technician mobile) | app: visit | today's visits, check-in, checklist, photos, signature | checklist, camera, signature pad | assigned, on site, complete, offline |
| S13 | Job form / checklist | inside S12 | service report | dynamic form | blank, filled |
| S14 | Invoices list | /invoices | owed, overdue, paid | table, batch create | empty, filled |
| S15 | Invoice detail | /invoices/:id | send, record payment, reminders | line items, payment dialog | draft, sent, overdue, paid |
| S16 | Client Hub (customer portal) | public link | approve quote, request work, pay invoice | public page, pay button | quote, invoice, paid |
| S17 | Reports | /reports | revenue, jobs, aged receivables | charts, tables | empty, filled |
| S18 | Team / users | /settings/team | invite staff, roles, permissions | table, role select | filled |
| S19 | Settings | /settings | business details, tax, templates, notifications | forms | filled |
| S20 | Timesheets / expenses | /timesheets | tech time and job costs | table | empty, filled |

## Flows

```
F01 Customer request becomes a quote
    S16 (or S05 by staff) -> S06 -> S08 -> send via WhatsApp/SMS link -> S16 approve
    happy path clicks: ~8
    edge: customer asks for changes (new revision), quote expires, customer declines

F02 Approved quote becomes a scheduled job
    S08 approved -> convert -> S10 -> S11 assign technician + time
    happy path clicks: ~4
    edge: double-booked tech, recurring maintenance contract

F03 Technician does the visit
    S12 open visit -> check in -> S13 checklist + photos -> customer signature -> complete
    happy path taps: ~6
    edge: no data signal (offline), extra parts used, visit needs a follow-up

F04 Invoice and get paid
    S10 complete -> S15 create invoice -> send -> S16 pay via mobile money -> receipt
    happy path clicks: ~4 (customer: ~3)
    edge: part payment, overdue reminders, payment made outside the app (cash/bank)

F05 Recurring maintenance
    S10 recurring job -> visits auto-created -> S11 -> F03 -> F04 per visit or per period
    edge: contract renewal, skipped visit
```

## Components

| component | variants | states | used on |
| --- | --- | --- | --- |
| Button | primary, secondary, ghost, danger | default, focus, disabled, loading | all |
| Status pill | request/quote/job/visit/invoice statuses | — | S05–S15 |
| Line-item editor | product, service, optional item | edit, read-only | S08, S10, S15 |
| Calendar | day, week, month, per-tech, map | drag, conflict | S11 |
| Signature pad | — | empty, signed | S12, S16 |
| Photo picker | camera, gallery | uploading, offline-queued | S06, S12 |
| Share sheet | WhatsApp, SMS, email, copy link | — | S08, S15 |
| Money input | TZS default | — | S08, S15 |

## Inferred data model

```
Business     id, name, tin, vrn, phone, currency (TZS), logo
             evidence: S19; Tanzania needs TIN/VRN for TRA  confidence: high
User         id, business_id, name, phone, role (owner|admin|dispatcher|technician)
             evidence: S18, tier user caps (sources 1-3)  confidence: high
Client       id, business_id, name, phone, whatsapp, email, tags
Property     id, client_id, address, landmark, gps   (Dar addresses are landmark-based)
             evidence: S04  confidence: high
Request      id, client_id, property_id, description, photos, status
Quote        id, request_id?, client_id, revision, status (draft|sent|approved|declined|converted), expires_at
LineItem     id, parent_type (quote|job|invoice), name, qty, unit_price, tax_rate, optional
Job          id, client_id, property_id, quote_id?, type (one_off|recurring), recurrence_rule, status
Visit        id, job_id, assigned_user_ids, start_at, end_at, status, checked_in_at, completed_at
JobForm      id, visit_id, template_id, answers (json), signature, photos
Invoice      id, client_id, job_id, status (draft|sent|partial|paid|overdue), due_at, fiscal_receipt_no
Payment      id, invoice_id, method (mpesa|mixx|airtel|bank|cash), amount, provider_ref, received_at
Timesheet    id, user_id, visit_id, start_at, end_at
             evidence: sources 4–7  confidence: medium (exact Jobber fields unseen)
```

Relationships: Business 1-n User/Client; Client 1-n Property/Request/Quote/Job/Invoice; Quote 1-1 Job; Job 1-n Visit; Visit 1-n JobForm; Invoice 1-n Payment.

## Feature matrix

See `features.csv`. Must: 18, should: 12, could: 6, skip: 3. A further 7 rows marked `original=no` are Dar es Salaam additions. They are the reason to buy this over Jobber.

## Out of scope (cannot or should not be cloned)

- Jobber's name, logo, copy, colours and marketing site.
- Its app marketplace and partner integrations (QuickBooks, Xero, Stripe-based Jobber Payments, Jobber Capital financing).
- Its US marketing services (Google review campaigns, websites) and licensed content.

## Size

Screens 20, flows 5, entities 13.
Hard parts:
1. **Mobile-money collection.** Use one aggregator (e.g. Selcom, AzamPay or ClickPesa; to be confirmed) instead of three direct telco integrations.
2. **TRA fiscal receipts (VFD).** Needs a TRA-registered VFD provider or API. This is a regulatory dependency, so start with "attach the EFD receipt number" and go live with VFD later.
3. **Offline technician app.** Sync and conflicts.

Size: **M** (a few weeks) for the core loop, because the Anudha ERP already has most of the service and invoice workflow.

## Reuse note

The Anudha ERP already has: assignment by HOD, immutable service reports, one-page PDFs, maintenance schedules, pro forma → tax invoice, delivery with signed proof, and Supabase auth and roles. That covers F02, F03, F05 and much of F04.
**Before reusing that code for a product sold to other companies, confirm with the ERP's owner that you have the right to do so.** It was built for a specific client.
