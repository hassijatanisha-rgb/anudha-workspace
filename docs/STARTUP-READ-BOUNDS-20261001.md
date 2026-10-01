# Startup read bounds — review candidate

Base: 18d9d92. Live workspace reload displayed `canceling statement due to statement timeout`; failing production query is not yet identified.

The existing loader concurrently requests four 1,000-row pages for each of three datasets. This candidate requests one ordered 100-row page per dataset at a time, retains the existing complete-dataset assignment boundary, propagates errors without automatic retries, and labels failures with table, offset and server message/code.

RED 94fa019: three executable Node/VM regression tests failed against actual app helper. GREEN 2e31c00: same three pass. Syntax and diff checks pass. Tests cover full ordered results, empty and exact-page termination, bounded per-table concurrency, failed-page rejection and no retry/partial return.

This is load bounding and diagnosis, NOT proof that the live timeout is fixed. No SQL, RLS, membership, stock or financial changes. No increase to server timeouts. Smaller pages may increase total startup latency; complete-catalogue loading and offset cost remain architectural limitations. Lazy/server-side searches and query-plan inspection are separate follow-ups. The loader still has at most three concurrent dataset requests. No production or browser acceptance, integration concurrency test, or measured coverage claim.

Requires Claude review of focused shared app.js change, then authorized deployment and live timing/error verification. Do not overwrite PR22 routing or PR26 queued-navigation changes when integrating.
