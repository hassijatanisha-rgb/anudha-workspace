# All-godown reconciliation checklist

Local implementation; not deployed. Source quantities unchanged; no migration or stock RPC added.

Journey: review all eight source godowns independently and distinguish a saved correction from completed field/physical-count checks. Empty godown and unmapped products remain blocked; original negative balances remain visible even after correction. Counts are rows, never summed quantities across mixed units/products.

RED: 5fd8f20 adds two executing tests which fail because tallyGodownReadiness is missing.
GREEN: same tests pass; focused godown/review suite 9/9. Complete Node suite: 205 entries, 165 pass, 40 skipped, zero failures. Skips are not evidence of browser/database success. Dedicated isolated Chrome fixture verifies rendering, filtering, search/focus, pagination and checklist rows; passed on retry after first browser setContent startup timed out. No live writes. Coverage percentage not measured.

Remaining: reviewed source-to-product/location mapping and guarded operational import, batch/expiry and conversion validation, real reconciliation and production verification. This checklist is not an operational import and is not proof all godowns are done. Accounting remains paused.
