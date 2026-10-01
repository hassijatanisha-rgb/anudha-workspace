# Inventory route restoration

Review candidate based on main1030475; not deployed. No SQL, access or record changes.

User journey: reloading the existing #/inventory link, or navigating back to that hash, must render inventory instead of silently switching to clients. Existing profile routes and unauthenticated render guards remain unchanged.

RED f71e507: two executed Node/VM tests returned contacts instead of inventory. GREEN 53fb30f: initialize the view from the exact inventory hash and recognize that hash in the existing profile hash listener. Four route cases and the sidebar test pass, including trailing slash, profile/unknown fallback and no protected render without a session.

Commands: `node --test tests/inventory-route.test.mjs tests/workspace-navigation.test.mjs`; `node --test tests/*.test.mjs`; `node --check app.js`; `node --check client-profile-pages.js`; `git diff --check`.

Combined suite: 247 passed, zero failed, 40 browser opt-in cases skipped. No numerical coverage measurement or new browser fixture performed; current proof executes real initialization/hash-handler code with a stub renderer, not full authenticated loading. Live reload reproduction was recorded in SYSTEM-CHECK-20261001.md outside the repository. Independent review and preview/browser verification remain required before merge and production verification.

Scope intentionally excludes general routing, section persistence and ignored navigation clicks while global busy is true. Does not change invoice/stock behavior or resume accounting. Preserve concurrent app.js cleanup hooks when integrating. Rollback is a frontend revert but reintroduces the wrong-screen defect.

## 13:44 UTC browser follow-up

Ran `node tests/inventory-route-fixture.mjs` on loopback with real app initialization and profile hash listener, fictional session and stub screen renderer. In the in-app browser: initial inventory heading, reload retaining inventory, client link showing clients, browser Back restoring inventory all passed. Fixture has no database/config/credentials and disallows connections via CSP. Closed the disposable browser afterward. This is browser routing proof, not authenticated inventory loading, responsive/accessibility acceptance or production verification. PR22 remains open with no comments/reviews at this check; no merge or deployment.
