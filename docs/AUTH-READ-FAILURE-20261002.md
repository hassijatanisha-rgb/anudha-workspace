# Authentication-read failure cleanup

Scope: extend PR29 startup failure handling. No SQL, permissions, credentials, stock or accounting changes.

Journey: a failed authentication transport must block access and clear stale workspace data without claiming membership was revoked. A genuinely absent session must still show login. Two-step authentication remains before staff/business reads.

RED 8588967: two executed regressions failed against the existing load(): returned error silently opened login; rejected getUser escaped without clearing stale data. Tests use actual extracted load() with fictional SDK responses.

GREEN 047f56c: catch only getUser rejection, handle returned errors with clear plus an explicit reload message, preserve login for AuthSessionMissingError or confirmed null user. No automatic sign-out on transport error.

Validation:
- `node --test tests/staff-read-failure.test.mjs tests/two-step*.test.mjs`: 12 passed, zero failed.
- `node --test tests/*.test.mjs`: 263 passed, 40 skipped, zero failed.
- `node tests/staff-read-browser.mjs` with isolated Chrome: passed five returned/thrown staff/auth and inactive-member cases. Actual load/clear/login executed, network blocked, no real account. Confirms nav/identity/core-data cleanup and visible notice. Initial browser run hit sandbox denial; next run exposed a syntax error in the newly edited fixture, corrected before final passing run.
- `node --check app.js` and `git diff --check`: passed before browser-only fixture extension.

Limits: does not fix the underlying network/database outage or place a timeout on a hanging SDK request. No live acceptance, full-module cache/race certification or measured 80% whole-project coverage. Independent review required; PR29 and PR7 remain open without reviews on this run. Main remains 37c44cb. Preserve concurrent app.js fixes when integrating. Not deployed.

## 09:31 UTC follow-up — bounded authentication wait

- RED e316d2d: actual load() lacked a deadline; two new executed tests failed on missing timer and timer cleanup.
- GREEN 4b6819d: a 20,000 ms Promise.race deadline surrounds only getUser; finally clears the timer. Timeout enters the existing blocked-workspace/reload error path, with no forced sign-out. A late fulfilled request cannot resume this load's staff/business queries. The underlying SDK request is not cancelled; no claim that network outage or SDK internal state is repaired.
- Eleven startup cases plus three MFA cases pass. Full suite: 265 passed, 40 skipped, zero failed. Syntax/diff checks pass. Node runner, fictional SDK and manually triggered deadline verify exact configured duration and late completion.
- Isolated Chrome six-case fixture passed, including an unresolved getUser and real browser deadline. Initial run exhausted the fixture's 30-second wait; added per-case/error diagnostics and used a 60-second harness allowance, then passed. The application deadline remains 20 seconds, not 60. Browser scheduling may delay timers; this is not a hard wall-clock guarantee. No live credentials or network.
- Still pending: independent review, actual deployed acceptance, startup's later network phases, underlying production connection failure, broad cache/session races and measured whole-project coverage. No live release.
