# Service creation retry diagnostic

Selected baseline: 7430812; actual create_service_case function extracted unchanged from migration008. Disposable PGlite with minimal prerequisite schema and active-staff/auth fixture helpers; no production access.

Command: `PGLITE_MODULE=<local PGlite module> node tests/service-create-retry-diagnostic.mjs`.

Verified first save creates one case and event. Both identical-ID and fresh-ID retries fail with “This machine already has open service work”. Counts remain one case and one event. Therefore the inspected sequential open-case path prevents duplicate jobs, but a lost successful response is not recovered as successful on retry. The frontend currently generates a fresh UUID for every submission; merely preserving it will not fix the database's early open-case rejection.

Next implementation requires a forward migration with same-ID, same-creator and normalized-content comparison before returning the existing record, plus a frontend stable submission identity. Changed payloads must not silently succeed as the old request. Preserve asset locking, active-staff access and current contact validation. Independently verify current deployed definition before activation.

Not tested: full production trigger/RLS chain, MFA, concurrent connections, closed-case replay or browser recovery. This diagnostic confirms current behavior, not release readiness. No application fix, migration, live records or deployment in this run.
