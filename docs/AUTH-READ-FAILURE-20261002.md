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
