# Sidebar clicks during busy operations

Base main18d9d92. Local candidate only; no SQL, data or permissions changed.

System-check reproduction: clicking another menu section while Pending stock was loading silently left the previous screen displayed. Both capture and bubble handlers discarded clicks when global busy was true.

RED dd4d39e: executed real navigation listener and app run wrapper in a VM event fixture; expected inventory render after completion, observed none. GREEN29d11e7 queues only the latest sidebar button and replays its normal click after successful completion. Current operation is not cancelled and mutating action buttons are not replayed. Failed operations discard the choice to preserve the form/error; removed controls and changed session identity discard it too. Contact editor's separate busy path has the same completion behavior.

Six focused cases pass, including existing sidebar test and contact success/failure. Full Node suite:256 passed, zero failed,40 browser-opt-in skips. Diff check clean. No numeric code-coverage claim. Tests use actual handlers with fixture nodes/promises, not a full browser or live auth. Real browser click/keyboard interaction remains an acceptance gate before release.

No general route rewrite or concurrent request cancellation. If an operation refreshes the session object, the queued choice is conservatively discarded. Page-specific asynchronous callbacks outside global run are not covered. Independent Claude review remains required; preserve other app.js changes when integrating. PR22 separately handles inventory reload/back and is not included here.

Validation: `node --test tests/queued-navigation.test.mjs tests/workspace-navigation.test.mjs`; `node --test tests/*.test.mjs`; `git diff --check`.

## Browser evidence — 1 October, 17:12 UTC cycle

Executed `tests/queued-navigation-fixture.mjs` on a temporary loopback port. It serves actual sidebar and app run/event handlers with fictional actor, simulated save promises and stub screen renderer. CSP blocks backend connections; no credentials or business data.

Earlier success-path walkthrough: while pending, Service then Stock choices left contacts displayed; successful completion opened only inventory/stock. This cycle closed the interrupted failure-path check: Start save -> Stock -> Reject kept contacts displayed, showed `Fixture save rejected`, and finished the operation. Starting and successfully finishing a subsequent save without a new navigation choice still left contacts displayed, proving the discarded choice was not replayed.

Temporary tab closed and server stopped. These are click-path runtime checks, not real persistence, keyboard/accessibility, responsive visuals, or production acceptance. No application code changed this cycle. PR26 remains open with no independent review; do not merge automatically.
