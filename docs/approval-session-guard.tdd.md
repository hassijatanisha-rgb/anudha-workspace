# Approval session guard — 2026-09-22 10:40 UTC checkpoint

Journey: an owner opens a decision form, then the session or page changes. The old form must not submit using the new session.

Runner: bundled Node's native `node --test`, established from the existing `.mjs` tests; no package manager or framework was introduced.

- RED: `node --test tests/project-approvals.test.mjs` ran 8 tests: 6 passed, 2 failed. Both new cases observed one RPC call instead of zero after changing the actor or navigating away.
- RED checkpoint: `aa5da18` on main.
- Fix: reject submission when actor, role, view or page-generation differs from the rendered form.
- GREEN: `node --test tests/*.test.mjs` ran 28 tests: 28 passed, no failures/skips.
- GREEN checkpoint: `146f124` on main. Local only, not pushed.

Tests use a small DOM/client harness. They prove the submission guard and existing retry behaviour, not browser layout, Supabase authorization or successful live deployment. Node coverage of the harness does not establish 80% application coverage for VM-evaluated browser code.

Live activation remains awaiting explicit database-change approval. Neither approval migration has been applied by this task. Accounting migration 010 is also unverified live; no imports or accounting actions were performed.

Next hour: after approval, validate approval migrations with rollback-only fixtures, activate them, publish only reviewed changes, then verify the actual owner page. Until then remain on this feature; do not label it complete or begin another business module.
