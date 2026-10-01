# Sidebar clicks during busy operations

Base main18d9d92. Local candidate only; no SQL, data or permissions changed.

System-check reproduction: clicking another menu section while Pending stock was loading silently left the previous screen displayed. Both capture and bubble handlers discarded clicks when global busy was true.

RED dd4d39e: executed real navigation listener and app run wrapper in a VM event fixture; expected inventory render after completion, observed none. GREEN29d11e7 queues only the latest sidebar button and replays its normal click after successful completion. Current operation is not cancelled and mutating action buttons are not replayed. Failed operations discard the choice to preserve the form/error; removed controls and changed session identity discard it too. Contact editor's separate busy path has the same completion behavior.

Six focused cases pass, including existing sidebar test and contact success/failure. Full Node suite:256 passed, zero failed,40 browser-opt-in skips. Diff check clean. No numeric code-coverage claim. Tests use actual handlers with fixture nodes/promises, not a full browser or live auth. Real browser click/keyboard interaction remains an acceptance gate before release.

No general route rewrite or concurrent request cancellation. If an operation refreshes the session object, the queued choice is conservatively discarded. Page-specific asynchronous callbacks outside global run are not covered. Independent Claude review remains required; preserve other app.js changes when integrating. PR22 separately handles inventory reload/back and is not included here.

Validation: `node --test tests/queued-navigation.test.mjs tests/workspace-navigation.test.mjs`; `node --test tests/*.test.mjs`; `git diff --check`.
