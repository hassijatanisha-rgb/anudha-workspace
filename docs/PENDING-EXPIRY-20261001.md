# Pending availability expiry correction

Status: locally tested; review and live deployment not complete. Base c9cff60.

## Failure and fix

The pending-order availability query omitted `expiry_date` and counted expired lots as available. RED 0b92713 reproduced 50 pieces rather than 10, omitted query data, and the UTC/company-date boundary mismatch. GREEN c902e32 requests expiry and excludes invalid, expired and expires-today lots, matching the existing product-review policy. Pending dates now use Africa/Dar_es_Salaam explicitly. Null/absent expiry preserves existing optional-expiry behavior.

Validation: nine pending unit checks passed. The actual isolated Chrome renderer (`tests/pending-expiry-browser.mjs`) shows `Partly available: 10 of 20` rather than a false stock-arrived label. Runtime injection uses PLAYWRIGHT_MODULE and optional CHROME_EXECUTABLE. `git diff --check` passed. No real stock, network API or SQL writes occur in these tests.

## Limits and release

This is a read-only advisory display fix, not an allocation/issuance guarantee. Product-specific mandatory expiry, sale status, backend enforcement and live refresh across midnight need separate verification. Cached availability is recomputed on Refresh, not continuously. Numerical coverage is not measured. No live signed-in walkthrough has been performed for this change.

00:27 UTC follow-up: RED 5f632fe reproduced yesterday's arrival claim surviving render and reopening without loading. GREEN d44cdcd records the calculation day, invalidates prior-day availability on the next render, and reloads on reopening. Eleven pending unit tests and the extended real Chrome renderer fixture pass. This does not install an automatic midnight timer: an untouched page still requires interaction/refresh. It does not guarantee freshness against another staff member's same-day stock changes; database allocation must enforce availability separately.

No migration is required. Review actual diff before publishing frontend and verify the deployed asset/version and signed-in Pending Orders. Preserve PR #9's separate cancellation fix when merging both changes; do not replace its whole pending-stock.js with this branch's file. Accounting stays paused. PR #8's pending creation retry migration is independent.
