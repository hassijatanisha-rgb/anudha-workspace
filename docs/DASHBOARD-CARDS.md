# Dashboard cards: where each number comes from

Screen: `dashboard.js` (menu **Main → Dashboard**, the first screen after sign-in).
Data: one call to `public.dashboard_counts(periodic_from, periodic_to, result_from, result_to)`, migration
`202610060067_activity_dashboard.sql`. The function is `security invoker`: every count runs under the signed-in
person's own read rules, so nobody sees a number for records they could not already list. When the person has no
access to an area, the count is returned as `null` and the card is left out rather than shown as 0. Counts only;
no amount, price or value column is read.

**Days** are Dar es Salaam days (Africa/Dar_es_Salaam, UTC+3). "Today" is the server's date in Dar es Salaam. A period
runs from 00:00 on its first day to 00:00 after its last day, Dar es Salaam time. Periods are at most one year.
One period, chosen with a button at the top of the page, feeds Periodic, Result and Team tasks: Today (the default),
This week (Monday to today), This month (1st to today), This quarter (1 Jan/Apr/Jul/Oct to today), This year (1 January
to today) or Custom (two dates). The choice is kept per person on that device (`localStorage`
`anudha.dashboard.period.<user id>`); blocked storage just means the page starts on Today.

**Access** (from migrations 060 and 062): Leads = `has_access('leads')`; Service = `has_access('service')`;
Quotes = `has_access('proformas')`; Accounts and contacts = any active staff; team tasks = the person given the task,
the person who gave it, or the owner; order steps (handoffs) = any active staff.

## Open (everything open now)

| Card | Table and filter | Access | Click opens |
|---|---|---|---|
| Overdues | Sum of four parts, each due **before today**: open leads (`sales_leads.stage` not won/lost) with `next_action_on`; open `team_tasks` by the Dar es Salaam date of `due_at`; open `work_assignments` by the latest `work_delays.expected_on`, else `due_on`; `service_cases` with status `scheduled` by `scheduled_for`. The card lists the non-zero parts. | Each part by its own area; hidden parts are left out of the sum | Not clickable (spans several lists) |
| Due Today | Same four parts, due **today** | as above | Not clickable |
| Opportunities | `sales_leads` with stage `inquiry`, `lead` or `opportunity` (= the Leads "Open" tab) | Leads | Leads, Open |
| Cases | `service_cases` with `case_type='service'`, `source_case_id is null` (requested repairs/service, not planned maintenance), status not completed/cancelled | Service | Service & maintenance schedule |
| Accounts | `organizations` not deleted, top level only (`parent_id is null`; branches are not counted, as in the client directory) | Active staff | Client accounts |
| Scheduled Service Activities | `service_cases` with `case_type='service'` and status `scheduled` (includes planned preventive maintenance) | Service | Service & maintenance schedule |
| Quotes | `sales_proformas` not deleted, status `draft` or `sent` | Pro formas | Current orders (all Pro formas; the list has no single "open" tab) |
| Webqueries | `customer_requests` with kind `inquiry` or `quote`, status `received` or `in_progress` | Leads | Website inquiries, Open |
| Contacts | `contacts` not deleted, status not `incorrect` | Active staff | Not clickable (no all-contacts list) |
| Tasks | `team_tasks` with status `open` | Own tasks; owner sees all | My tasks |

## Periodic (created in the chosen period)

None of these are clickable: no existing list can be filtered by creation date.

| Card | Table and filter | Access |
|---|---|---|
| Opportunities | `sales_leads.created_at` in the period (every stage; website inquiries also open a lead) | Leads |
| Cases | `service_cases.created_at` in the period, `case_type='service'`, `source_case_id is null` | Service |
| Scheduled Service Activities | Distinct service jobs (`case_type='service'`) with a `service_case_events` row to `scheduled` in the period; changing the engineer of an already scheduled job (scheduled → scheduled) is not counted | Service |
| Quotes | `sales_proformas.created_at` in the period, not deleted | Pro formas |
| Webqueries | `customer_requests.created_at` in the period, kind `inquiry` or `quote` | Leads |
| Tasks | `team_tasks.created_at` in the period | Own tasks; owner sees all |

## Result (finished in the chosen period)

| Card | Table and filter | Access | Click opens |
|---|---|---|---|
| Cases → Canceled Cases | Service requests (as in Cases) now `cancelled`, with the `service_case_events` row to `cancelled` in the period | Service | Not clickable |
| Cases → Resolved Cases | Service requests now `completed`, `completed_at` in the period | Service | Not clickable |
| Opportunities → Closed Won | Leads still `won` with a `sales_lead_events` row `action='won'` in the period | Leads | Leads, Won |
| Opportunities → Closed Lost | Leads still `lost` with a `sales_lead_events` row `action='lost'` in the period (a lost lead that was reopened is not counted) | Leads | Leads, Lost |
| Close Quotes | Pro formas now `accepted`, `rejected` or `cancelled`, with a `sales_proforma_events` row to that status in the period, not deleted | Pro formas | Not clickable (accepted ones are spread over several tabs) |
| Completed Tasks | `team_tasks` with status `done`, `closed_at` in the period | Own tasks; owner sees all | Not clickable |
| Close Webqueries | `customer_requests` kind `inquiry`/`quote`, status `resolved` or `closed`, `closed_at` in the period | Leads | Website inquiries, Resolved or closed |

Lists opened from Won, Lost and Resolved show all such records from the last 6 months, not only those in the chosen
period: the lists have status tabs but no date filter.

## Team tasks (owner and department heads only)

Data: `public.team_task_counts(from, to)` and, when a name is pressed, `public.team_member_tasks(user_id, from, to)`,
migration `202610070070_team_task_counts.sql`. These are `security definer` because `team_tasks` stays readable only
by the giver, the person given the task and the owner; both check who is asking first (`can_see_team_member`): the owner
sees every active person, a head sees active people in their own (named) department, themself included, never the
owner; staff and switched-off heads are refused.

| Number | Filter (tasks given to the person) |
|---|---|
| Open | status `open` and `due_at` before the end of the period (older overdue tasks included) |
| Completed | status `done`, `closed_at` in the period |
| Late | still open after `due_at`, or done in the period after `due_at` |

Cancelled tasks are not counted. Order steps (`work_assignments`) are not part of these numbers.
Tests: `tests/sql/team-task-counts.sql` (who sees whom, counts, refusals).

## Notification bell (header)

`notification-bell.js`. Three count-only reads (`head: true`) under the person's own read rules, refreshed on every
page change (at most every 10 seconds) and every 2 minutes; the short list (5 per kind) loads only when the bell is
pressed. Tasks given to me by someone else and still open; open work (`work_assignments`) handed to me by someone
else; tasks I gave someone else that they finished or that were cancelled, in the last 7 days. "Seen" is a time per
kind kept on the device (`anudha.bell.seen.<user id>`); opening My tasks marks all three seen, pressing an item marks
its kind seen. Device clocks that run fast can hide an item until the next new one arrives.

## Cards from the other CRM that are left out

| Card | Why |
|---|---|
| Today's Calls, Calls | The ERP has no call log. Leads record `source='phone'`, but that is the channel of a new inquiry, not a count of calls. |
| Whatsapps | No WhatsApp messages are stored. `source='whatsapp'` on leads and WhatsApp confirmations on website requests are not message counts. |
| Periodic Accounts, Periodic Contacts | `organizations` and `contacts` have no creation date (checked on the live schema on 6 October 2026). The owner-only `audit_log` might hold it, but its contents were not verified. |

## Notes

- Overlaps are expected, as in the other CRM: a scheduled repair is both a Case and a Scheduled Service Activity; a
  website inquiry is a Webquery and an Opportunity; a lead with an overdue follow-up and an overdue handoff counts once
  in each part of Overdues.
- Installation jobs appear only in the Overdues/Due Today service-visit part (scheduled installation visits). Website
  complaints and support requests are not on any card.
- For the owner, Tasks counts every open team task, while My tasks lists only the owner's own; for everyone else the
  two match.
- Tests: `tests/dashboard.test.mjs` (date ranges, card list, click targets, wiring) and
  `tests/dashboard-database.mjs` (PGlite: counts, Dar es Salaam day edges, per-area access, refusals, function grants).
