# Inventory loader session diagnostic

20:18 UTC, base ccc3d01 including main d5dd630. Executed actual inventory-operations.js in Node VM with fictional deferred inventory_locations read. Switch me from first to second user while read is pending, then release old response. Assertion fails: inventoryLocations length1, expected0. Old response populates shared cache. No production data, browser exposure or database authorization bypass demonstrated.

Run: node tests/inventory-session-diagnostic.mjs. Deliberately outside default test glob; reproduced, not fixed/deployed. Next implementation should isolate inventory loading by actor and generation, clear inventory caches on auth cleanup, and guard rendering after awaits. Check product corrections/compatibility loaders too; guarding only final assignment is insufficient. Keep independent inventory fix separate from service PR implementation.
