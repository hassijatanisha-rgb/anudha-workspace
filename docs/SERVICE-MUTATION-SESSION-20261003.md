# Service mutation session acceptance

## Action callback fix — local only

RED checkpoint 5ffaff4: expanded executable Node test to eight cases, six behavioral failures and two controls passing. GREEN a13d852: service action forms capture actor identity and a clear-invalidated mutation generation; reject stale submission locally, check context after RPC and refresh, and suppress stale errors/results while preserving current-session errors. An already-sent RPC is not cancelled. No SQL, credentials, access changes or stock writes.

`node --test tests/service-mutation-session.test.mjs tests/service-session.test.mjs tests/service-domain.test.mjs tests/service-workflow-ui.test.mjs tests/service-print-cleanup.test.mjs`: 16 pass. Full `node --test tests/*.test.mjs`: 267 pass, 40 skip, zero failures. Syntax and diff checks pass. The new test is now in the default test glob. Numerical coverage is not measured; these VM/fixture checks do not certify browser sessions or database permissions.

Still required: independent PR11 review, browser/shared-dialog cleanup acceptance, report and new-case callback protection, current-main integration and live verification. Existing loader browser launch failure remains unresolved. No deployment claimed.

## Original diagnostic evidence

16:08 UTC new-job browser check: tests/service-create-browser.mjs passes four cases using actual serviceScheduleScreen form, contact-option helpers, bind handler and app run/friendlyError. Machine selection enables only same-client contact; generated UUID and selected asset/contact checked; normal success/current error/stale account/navigation outcomes pass. RPC and refresh are fictional. Initial about:blank fixture failed because crypto.randomUUID was unavailable; diagnostics confirmed that error, then locally fulfilled HTTPS test origin restored the production secure-context prerequisite without network. No application fix needed for that fixture failure. No real persistence/permissions, retry recovery or full visual/a11y proof. Pending-dialog privacy clearing and independent review/live verification remain open.

15:23 UTC browser extension: twelve action/service/installation dialog cases pass. Actual installation fields reject training=no and incomplete attendee rows before RPC; valid attendee details and QC/training flags are verified in the fictional payload. Normal result, server denial, navigation and account switching checked for each form type. No production code change. Payment prerequisites, actual signed-record persistence, maintenance creation, auth-driven dialog clearing, new-case browser flow and live deployment remain outside this fixture. Visual/a11y verdict remains inconclusive; this is not a full workflow ship verdict.

14:18 UTC browser follow-up: tests/service-action-browser.mjs now executes eight action/report cases in isolated Chrome. Report cases use the actual reportFields renderer and shared action dialog: empty required fields prevent RPC; filled engineer/signoff/training/charge payload fields are checked; success closes/notifies, current denial remains visible, account-change/navigation results are suppressed. All eight pass, diff clean. No production code changed. Fictional staff/RPC data and blocked network mean no real signature, persistence, RLS, maintenance scheduling or live acceptance claim. Installation-specific training branch, new-case browser behavior, pending-dialog privacy clearing, visual/a11y acceptance and review remain outstanding.

13:44 UTC integration: main8618384 merged without conflict as87e9cdd, preserving Claude's request-timeout and read-policy updates. Full285pass/40skip/0fail. PR11 still had no reviews at check. No Supabase migration applied by this run.

Isolated Chrome now passes the service loader fixture and new tests/service-action-browser.mjs. The latter executes the actual shared dialog initialization/actionForm plus actual service action callback: normal save closes/notifies; account change/navigation suppress stale results; current RPC error stays in the open dialog. Browser uses fictional identities/RPC responses and no live auth. Sandbox Chrome initially aborted; authorized out-of-sandbox isolated runs passed. This clears the earlier launch blocker for these fixtures, not all browser acceptance. Report/new-job browser coverage, auth-driven dialog clearing before response, visual/a11y baseline, real permissions and deployed verification remain unproven. Verdict: do not ship as fully verified service workflow.

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
