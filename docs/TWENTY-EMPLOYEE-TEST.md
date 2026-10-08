# Isolated twenty-identity workflow test

Run with a locally installed PGlite module:

```sh
PGLITE_MODULE=/absolute/path/to/pglite/dist/index.js node tests/twenty-employee-simulation.mjs
```

Uses an in-memory database and actual migrations042,043,046. No Supabase endpoint, credentials, HTTP client, outbound messages or production records. All prerequisite identities/products/clients are fictional. It closes the database on success or failure.

Verified 7 October2026:20 identities (19active,1inactive),19 lead workflows,19 linked pending requests and19 linked purchasing workflows;228 actor-checked history records. Authenticated database role exercises RPC permissions, inactive RLS, stale writes, owner approval and immutable history. Pending stays waiting; purchases reach ordered state without sending anything. Sentinel stock is unchanged.

Limitations: sequential actor switching, not independent concurrent connections; auth.uid is a test scaffold, not Supabase login. Prerequisite tables are minimal; not a full migration replay. No receipt, invoicing, fiscal, browser, private storage, or production acceptance. Known original046 retry-content weakness remains separately tracked; these scenarios do not certify its repair. Do not serve a cloned frontend against production configuration.

Next: isolated browser-to-database coverage and separate real test authentication setup. Review and deployment gates remain unchanged.
