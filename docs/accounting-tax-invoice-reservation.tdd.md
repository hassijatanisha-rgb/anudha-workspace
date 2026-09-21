# Accounting Tax Invoice reservation — TDD evidence

## User journey

As Mujtaba, I receive an accepted Pro forma, create its Tax Invoice, and immediately remove those quantities from stock available to other orders. Physical stock remains in Haadi until dispatch, and cancellation releases the reservation.

## RED and GREEN evidence

| Guarantee | Test | RED evidence | GREEN evidence |
| --- | --- | --- | --- |
| Tax Invoice creation locks the order and Haadi lots, allocates expiring stock first, reserves every quantity, and fails atomically on shortages | `tests/accounting-tax-invoice-reservation.test.mjs` | Failed because migration 010 did not exist | Passed after the reservation RPC and database guard were added |
| Cancellation before packing releases reserved units | `tests/accounting-tax-invoice-reservation.test.mjs` | Missing migration | Passed with the cancellation-release trigger |
| Existing packing can use Tax Invoice reservations | `tests/accounting-tax-invoice-reservation.test.mjs` | Missing migration and UI calls | Passed with the reserved-packing RPC and updated sales UI |
| Existing ERP behavior remains intact | `node --test tests/*.test.mjs` | Regression gate | 20 passed, 0 failed, 0 skipped |

The repository uses direct Node assertions rather than an instrumented coverage runner. Live database application and an authenticated browser acceptance test remain required before this workflow is released.
