# Location readiness — local implementation

User journey: staff can distinguish product checks from a saved, active physical location mapping before any operational import.

RED: `node --test tests/godown-location-readiness.test.mjs` executed three tests; all failed because `tallyGodownLocationStatus` did not exist. Checkpoint b5258bf.

GREEN: the same tests plus godown-readiness, godown-review and tally-stock-review: 13 passed, zero skipped. Cases include exact source label, latest unresolved revision, inactive/missing target, unavailable data and nonmutation.

Browser: `node tests/godown-review-browser.mjs` passed in isolated Chrome with fictional data, including missing mapping, valid location display, latest unresolved override, search/focus, pagination and staff import controls. Sandbox launch failed; the approved outside-sandbox run succeeded. No production calls.

Coverage: Node coverage output does not measure the VM-loaded application source; its empty 100% table is not meaningful application coverage. Browser tests verify rendering but full cross-account Supabase behavior is still unverified.

The screen loads mapping history and active locations alongside source data. If mapping reads fail, product review still works and location status is explicitly unavailable. This is an advisory display, not a server-side import authorization. Operational import remains unimplemented. No stock quantities changed. Mapping changes become visible after reloading the review screen.

Deployment: local only; awaiting independent review and existing inventory-preview approval gate. Accounting/Tally API work remains paused.
