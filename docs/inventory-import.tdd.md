# Book2 inventory product import — TDD evidence

## User journeys

1. As the inventory owner, I can preview a prepared Book2 product list before anything is saved.
2. As the inventory owner, I can import only product names that do not already have an exact normalized match.
3. As a manager, I can see repeated Book2 rows grouped for review without turning them into stock.
4. As a stock controller, I am protected from importing Book2 quantities because the source Closing Balance column is empty.

## RED and GREEN evidence

| Guarantee | Test | RED evidence | GREEN evidence |
| --- | --- | --- | --- |
| Repeated rows are grouped, existing names are skipped and quantity-bearing files are rejected | `tests/inventory-import-workflow.test.mjs` | Failed because `inventory-import.js` did not exist | Passed after the import planner and guarded inventory UI were added |
| Existing inventory, sales and service behavior remains intact | `node --test tests/*.test.mjs` | Not applicable; regression gate | 19 passed, 0 failed, 0 skipped |

The repository uses direct Node assertions and does not currently have an instrumented coverage runner. The import button still requires the owner to choose the prepared JSON file and approve the on-screen confirmation. No Book2 products or quantities were written to the live database during this change.
