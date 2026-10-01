# Service workspace session isolation

Status: locally tested; NOT deployed. Base c9cff60. No SQL or permission changes.

RED 8ae3c9e reproduced three failures: a previous account's pending response populated the cache, service loading overwrote the Client screen after navigation, and no service clear hook existed.

GREEN f921301 adds actor/request-generation checks, a cache-owner identifier, and a sign-out clearing hook. `app.js` changes only the shared `clear()` hook; reviewer should preserve all concurrent hooks when integrating. No other app routing or authentication behavior is replaced.

Validation command: `node --test tests/service-session.test.mjs tests/service-domain.test.mjs tests/service-workflow-ui.test.mjs tests/service-print-cleanup.test.mjs` — eight test-runner cases pass. The session fixture covers account switching, navigation during loading, clear with a request in flight, overlapping requests completing out of order, and a current-account query error. Existing date/progress, print cleanup and UI source checks also pass. `git diff --check` passes.

These are isolated JavaScript tests with mocked query results, not live permission or browser acceptance tests. Numerical coverage is not measured. Actual signed-in browser switching and deployed-byte verification remain required. This does not establish service scheduling/payment prerequisites or fix mutation callbacks that may complete after navigation; those require their own review.

Review before merging. No migration or new membership is needed. A frontend rollback may revert these scoped commits but restores the stale-session behavior; prefer fixing forward. Accounting stays paused.

01:39 UTC browser follow-up: `tests/service-session-browser.mjs` passed in actual isolated Chrome with configured PLAYWRIGHT_MODULE/CHROME_EXECUTABLE. Clicking the fixture's Clients/account-switch controls while queries were pending left those screens intact after old responses arrived; the cleared cache stayed empty, and the second simulated account subsequently loaded normally. Query results, account identities and renderer contents are fixtures. This tests the real service loader/render coordinator in a browser, not Supabase authentication/RLS or full service-card UI; live signed-in acceptance remains outstanding. No production code changed in this follow-up.
