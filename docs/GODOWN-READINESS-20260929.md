# All-godown reconciliation checklist

Deployed on 2026-09-30 via reviewed PR #5, merge 074bcc3. Source quantities unchanged; no migration or stock RPC added.

Journey: review all eight source godowns independently and distinguish a saved correction from completed field/physical-count checks. Empty godown and unmapped products remain blocked; original negative balances remain visible even after correction. Counts are rows, never summed quantities across mixed units/products.

RED: 5fd8f20 adds two executing tests which fail because tallyGodownReadiness is missing.
GREEN: same tests pass; focused godown/review suite 9/9. Complete Node suite: 205 entries, 165 pass, 40 skipped, zero failures. Skips are not evidence of browser/database success. Dedicated isolated Chrome fixture verifies rendering, filtering, search/focus, pagination and checklist rows; passed on retry after first browser setContent startup timed out. No live writes. Coverage percentage not measured.

Remaining: reviewed source-to-product/location mapping and guarded operational import, batch/expiry and conversion validation, real reconciliation and production verification. This checklist is not an operational import and is not proof all godowns are done. Accounting remains paused.

## Deployment verification, 30 September

GitHub Pages reported built for 074bcc3. Served `tally-stock-review.js` matched the tested source byte-for-byte (SHA256 b4c7c8737fc5cd1bbb2a3fe615ff9b78fed65b3b08969358d9d0af2d7cf8fb57). Signed-in owner walkthrough showed the new checklist, eight godowns, 2,405 source rows and 354 original negatives. Filtering City Printer Godown 2 showed 285 rows; searching `bag` reduced it to four and retained focus. Clearing restored 285. No live records or quantities were changed. Cross-account save tests are not established by this read-only walkthrough.

## Browser runner portability

Reviewer requested replacing Mac-specific paths with `PLAYWRIGHT_MODULE` and `CHROME_EXECUTABLE`, matching existing browser tests. RED 79bb580: both runtime override tests failed because the old runner ignored the supplied module and launched its hard-coded browser. GREEN: both probe tests passed and the real isolated Chrome inventory test passed with `CHROME_EXECUTABLE` supplied. The probe never launches a browser; it checks injected module selection and exact launch options, including allowing Playwright's default browser selection. Coverage percentage not measured. This follow-up changes testing infrastructure, not product behavior.
