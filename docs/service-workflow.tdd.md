# Service and installation workflow — TDD evidence

## Source plan

The user-approved plan connects signed machine delivery to installation, assignment, official reporting and recurring service scheduling. The implementation reuses the official Anudha Rev 2 installation and service forms and the proven lifecycle concepts from the old ERP.

## User journeys

1. As sales staff, signing a delivery note creates one installation job for every delivered machine unit.
2. As a service lead, I can assign and schedule a job and see who changed it and when.
3. As an engineer, I can move work on site, complete the official report fields and print the saved record.
4. As a service lead, I see the next maintenance job automatically scheduled from the actual completed-work date.
5. As staff, I can record an unscheduled repair against an installed machine without inventing another sale.

## RED and GREEN evidence

| Guarantee | Test | Type | RED evidence | GREEN evidence |
| --- | --- | --- | --- | --- |
| Month calculations clamp leap and month-end dates | `tests/service-domain.test.mjs` | Unit | Failed because `service-domain.js` did not exist | Passed with Jan 31, leap-day and invalid-input cases |
| Delivery handoff, service lifecycle, immutable reports, RLS and legacy backfill are defined | `tests/service-workflow-schema.test.mjs` | Contract/integration | Failed because migrations 008/009 did not exist | Passed after schema and data migrations were added |
| Team UI exposes both queues, plain-language stages, required official fields and print path | `tests/service-workflow-ui.test.mjs` | UI contract | Failed because the service scripts did not exist | Passed after the Service & installation workspace was connected |

RED command:

```text
/Users/tanisha/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test tests/service-domain.test.mjs tests/service-workflow-schema.test.mjs tests/service-workflow-ui.test.mjs
```

Initial result: 3 failed with the intended missing-file errors.

GREEN command:

```text
/Users/tanisha/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test tests/*.test.mjs
```

Final result: 18 passed, 0 failed, 0 skipped.

## Database evidence

- Migration 008 initially failed in Supabase on the structured `WITH ORDINALITY` declaration; the enclosing transaction rolled back without partial schema changes.
- The declaration was corrected and migration 008 returned `Success. No rows returned`.
- Legacy handoff migration 009 returned `Success. No rows returned`.
- A live read-back query confirmed the new service tables are accessible. They currently contain zero jobs because no existing delivered line is both present and classified as a machine.

## Coverage and known gaps

The repository uses direct Node assertions rather than an instrumented coverage runner, so a numeric coverage percentage is unavailable. Unit, schema-contract, UI-contract and full regression tests are green. Authenticated browser acceptance of assignment/report submission requires the deployed build; private signed-file uploads and department/HOD role enforcement remain server-week work.
