# Service transition session guard — review candidate

Base `5b7bcc7`; branch `fix/purchasing-session-20261006`. Not deployed.

`openServiceAction` now captures the opening staff object, rejects submission after identity/page change, and suppresses stale success/denial/transport callbacks before refresh or toast. The existing `advance_service_case` RPC and expected-version arguments remain unchanged. No database permissions, stock or accounting changes.

Three initial VM regressions failed before the fix: previous-session form submission, stale success notification and stale denial propagation. Ten action VM cases now pass, including same-ID identity replacement, transport errors and replacement during refresh. Together with existing service suites: 28 non-browser checks passed, zero skips.

Actual Chrome coverage uses `action-forms.js`: obsolete submission preserves the note and performs no RPC; current save posts once and closes after refresh; stale success/denial/rejection does not refresh or notify the replacement session. Eight browser cases pass, zero skips/page errors. Run using `SERVICE_BROWSER_QA=1` and local Playwright/Chrome with `node --test tests/service-session-browser.test.mjs`. Page requests are aborted; service workers are blocked; mock RPCs contain fictional records only.

Independent Claude review is required before integration. This is not real authentication, database workflow, 20-user concurrency, visual or accessibility acceptance. In-flight writes already submitted may complete under their original authorization; this guard does not cancel or reconcile those writes. Create-service and report callbacks, durable retries and logout cleanup remain separate work. No main merge or production deployment is authorized by this evidence alone.
