# Service mutation session acceptance

## Action callback fix — local only

RED checkpoint 5ffaff4: expanded executable Node test to eight cases, six behavioral failures and two controls passing. GREEN a13d852: service action forms capture actor identity and a clear-invalidated mutation generation; reject stale submission locally, check context after RPC and refresh, and suppress stale errors/results while preserving current-session errors. An already-sent RPC is not cancelled. No SQL, credentials, access changes or stock writes.

`node --test tests/service-mutation-session.test.mjs tests/service-session.test.mjs tests/service-domain.test.mjs tests/service-workflow-ui.test.mjs tests/service-print-cleanup.test.mjs`: 16 pass. Full `node --test tests/*.test.mjs`: 267 pass, 40 skip, zero failures. Syntax and diff checks pass. The new test is now in the default test glob. Numerical coverage is not measured; these VM/fixture checks do not certify browser sessions or database permissions.

Still required: independent PR11 review, browser/shared-dialog cleanup acceptance, report and new-case callback protection, current-main integration and live verification. Existing loader browser launch failure remains unresolved. No deployment claimed.

## Original diagnostic evidence

12:40 UTC follow-up: new-case submission is now covered by the actual bindServiceWorkflow handler with disposable DOM/FormData/RPC substitutes. REDef154cc reproduced six additional failures; GREEN2544ea3 guards before send and after RPC/refresh, preserving current errors. All24 mutation checks pass. Full suite283pass/40skip/0fail and syntax/diff checks pass. No browser or Supabase permission proof; shared-dialog lifecycle, retry-ID persistence on new-case creation, and live verification remain separate gaps. No changes to stock, fiscal prerequisites or payloads.

Report follow-up full suite:275pass/40skip/0fail; syntax/diff checks pass. Coverage percentage not measured.

08:51 UTC follow-up: report submission now uses the same session guard. RED af3db71 expanded the real callback fixture to action/report variants, reproducing six report failures; GREEN 760dc5e passes all16 mutation checks. Report validation and RPC payload are unchanged. The report renderer and RPC transport remain fixture substitutes; this is not a signed-report database or live permission test. New-case and shared-dialog lifecycle coverage are still outstanding. No production deployment.

Base: 84ded0c, existing PR11 review worktree. No production edits or deployment.

Journey: a save started by one user must not refresh or report its result in a different user's workspace; navigation away must not receive a stale service success notification.

Command: `node --test tests/service-mutation-session.mjs`.
Result: 1 pass, 2 fail. Same-account control passes. After switching accounts, the real openServiceAction callback calls serviceWorkspace under the second actor. After switching to Clients, it still emits “Service job updated: in_progress.”

Initial fixture lacked serviceStatusLabel and failed with ReferenceError; corrected before recording behavioral failures. RPC is deferred and fictional; serviceWorkspace is a spy, not the full renderer. This proves callback dispatch behavior, not unauthorized database access or production data leakage.

Next: capture mutation actor/session and view context, guard before submission and after awaits, cover errors and report/new-case callbacks plus shared dialog cleanup. Preserve concurrent clear hooks. Do not suppress genuine current-session errors or imply an already-sent RPC was cancelled.

Status: reproduced, not fixed, not deployed. Diagnostic intentionally remains outside default `*.test.mjs` glob and must run explicitly; it is not a release pass. Coverage and browser acceptance outstanding.
