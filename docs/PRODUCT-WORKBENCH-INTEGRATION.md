# Product workbench integration

## Inspected 28 September 2026

Local source: `/Users/tanisha/Desktop/ERP/product-data-manager/`.
The browser loaded 7,430 source records. Edits currently persist only in localStorage and export to CSV. `data.js` contains private source data including prices: never copy it to the public deployment.

## First fixes

ERP catalog pagination replaces the first-100-record cap with navigable 50-record pages. Filtering clamps page bounds. Forced inventory/catalog refresh reloads database corrections. Three regression tests failed before implementation and passed after; four existing search tests also pass.

## Required before calling integration complete

- Port the workbench's table, filters, data-health view and editor into authenticated ERP navigation, without its bundled data or local-only persistence.
- Map local stable source keys to existing ERP product UUIDs; review ambiguous matches. Do not create duplicate master products automatically.
- Preserve and import user corrections explicitly; never reset localStorage during migration.
- Reuse version-checked product review RPCs. Product renaming must retain UUID, source provenance, stock and order links.
- Keep source Tally balances distinct from verified operational stock; godown placement uses audited inventory transactions, not name editing.
- Enforce restricted financial fields at the database/API boundary, not only by hiding columns.
- Verify two independent sessions, reload persistence, conflict rejection, denied writes, and responsive table/form navigation.

Current verdict: integration INCOMPLETE. Local workbench availability and isolated pagination tests are not evidence of shared persistence or launch readiness.
