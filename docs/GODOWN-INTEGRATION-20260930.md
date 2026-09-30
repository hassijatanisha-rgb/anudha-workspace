# Mapping integration release gate

Base: production 074bcc3. Integration keeps the deployed cached checklist while bringing mapping controls and migration 041 forward from the reviewed inventory branch. Migration 041 has not been applied; user activation approval is pending. No stock changes are authorized by this release.

RED: `node tests/godown-review-browser.mjs` failed with 10 calculations versus expected 1. The newly integrated mapping column independently called the full reconciliation calculator on each redraw. Preserve the existing performance test and reuse the cached group list.
