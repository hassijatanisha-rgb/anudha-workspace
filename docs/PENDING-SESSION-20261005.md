# Pending stock read/session isolation

5 October 15:02 UTC cycle: `tests/pending-session-browser.mjs` passed four isolated Chrome scenarios using the actual pending renderer and loader: current rows render, navigation stays on Clients, account cleanup rejects old rows, and a failed old refresh cannot overwrite newer successful results. Zero captured page errors; external network blocked, fictional records only. Browser-QA skill used; no visual baseline, accessibility or Web Vitals claim. Independent review and live acceptance remain required.

Local review candidate, not deployed. Base main d5dd630. No SQL, stock changes, accounting, permission changes or RPC-contract changes. Existing pending cancel/retry/expiry work remains on separate branches.

Journeys: changing account or refreshing must not let an old request repaint the workspace, replace current errors, or retain private search text. Current failures must remain visible.

TDD skill used; native Node runner, no package.json. RED89e72c1: eight tests, six intended failures, two controls passed. GREEN2e28520 changes only loader/session guards and cleanup; it does not cancel server requests.

`node --test tests/pending-session.test.mjs`: eight pass using actual module with fictional deferred reads:
- Loading cannot overwrite another route.
- Stale availability failure cannot replace cache state.
- Replacement session with identical user ID rejects prior rows.
- Old failure cannot overwrite newer successful refresh.
- Cleanup invalidates a failure even when the exact actor is restored.
- Cleanup resets private filters and errors.
- Current load failure stays visible.
- Current availability failure preserves pending requests.

`node --test tests/*.test.mjs`: 265 passed, 40 skipped, zero failures. `git diff --check` clean. Numeric coverage not measured. VM tests are not real browser, RLS or persistence tests. Browser acceptance, independent Claude review and deployment remain required. Mutation callbacks and route-away-and-back without a new render are not certified.
