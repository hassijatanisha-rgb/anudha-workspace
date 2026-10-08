# Service loader review candidate

Base: `45bf107`, branch `fix/purchasing-session-20261006`. Not deployed.

## Scoped correction

- Bind service cache to the current staff object; replacement sessions reload.
- Discard outdated loads, errors and rendering after navigation/session change or a newer request.
- Clear current failed-load rows; render an actionable retry screen instead of falsely prescribing schema migrations for every network/access failure.
- No service mutation, database permission, invoice/payment or stock-transition change.

## Reproduction and checks

Four initial VM regressions failed before loader correction: off-view callback, late navigation, replacement session and stale rejected refresh. Three error-screen regressions failed before message correction. Current coverage:

- 18 non-browser service tests passed with zero skips (session, failure text/escaping, domain, print cleanup, UI/schema structural suites).
- Three opt-in real Chrome tests passed with zero skips/page errors: bound Refresh recovery, actual DOM navigation preservation, overlapping refresh/replacement cache.
- `git diff --check` passed.

```sh
node --test tests/service-domain.test.mjs tests/service-load-message.test.mjs tests/service-print-cleanup.test.mjs tests/service-session.test.mjs tests/service-workflow-schema.test.mjs tests/service-workflow-ui.test.mjs
SERVICE_BROWSER_QA=1 CHROME_EXECUTABLE='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' node --test tests/service-session-browser.test.mjs
```

Browser tests require Playwright (`PLAYWRIGHT_MODULE` can specify its module) and Chrome. They use fresh contexts, block service workers and abort page network requests. Reads are fictional mocks, not real Supabase auth/SQL/storage. No production test records or messages.

## Remaining gates

Independent Claude review before integration. No full service-journey, real login, 20-user load, visual baseline or accessibility acceptance is claimed. Service write callbacks, retry identity persistence and cache clearing on logout require separate work. Isolated backend installation/staging decision remains pending. Accounting remains paused; these changes cannot bypass invoice/payment prerequisites.
