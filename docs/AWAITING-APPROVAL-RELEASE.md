# Awaiting approval — release gate

Target: `anudha-workspace`, not the older ERP reference repository.

## Completed locally

- Owner-only question/answer UI and guarded database RPC.
- Additive schema migration, separate question seed migration.
- Immutable answer history and optimistic version checks.
- Idempotent request receipt checks (request, question, version, text, actor).
- Immediate saved-answer history display.
- Network retries retain their request while navigating within the open tab.
- Unconfirmed requests warn before leaving/reloading the browser tab.
- Known database rejection offers reload instead of an endless retry.
- Unit tests for receipts, denied access, save/history, retries and rejection.

## Not yet completed

- Execute the schema migration in a rollback-only transaction to verify PostgreSQL syntax and dependencies.
- Exercise owner write, repeat request, stale version, denied non-owner access and history immutability with rollback-only fixtures.
- Apply schema and question seed migrations to the verified Supabase project.
- Update static asset version, publish the scoped changes and verify GitHub Pages delivery.
- Walk through the deployed owner page and verify an actual approved answer persists after reload.

## Live activation update — 2026-09-22

After explicit user approval, both approval migrations were applied successfully through the correct Supabase project SQL editor. A prior schema run completed with rollback. A subsequent rollback-only fixture passed owner save, missing-owner rejection, idempotent repeat, stale-version rejection and immutable-history update rejection. No QA decisions were retained. These checks invoked the RPC as the SQL editor role with JWT subject context; authenticated-role RLS and the deployed browser still need verification.

Website publishing and end-user save/reload verification remain outstanding. Earlier checklist entries above describe the release gates, not a claim of full completion.

## Recovery

Migrations add new tables and do not modify existing business records. After release, disable the navigation entry if necessary; retain decision history. Do not drop populated tables or amend applied migrations. Unconfirmed form attempts are held only in memory, not durable across browser termination. Reconcile saved history before resubmitting after a forced close.
