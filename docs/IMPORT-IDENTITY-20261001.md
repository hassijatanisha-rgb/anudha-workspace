# Product import identity guard — not deployed

Base c9cff60; independent branch fix/import-identity-20261001.
User rule: different manufacturers are different stock items. This bounded fix
stops conflicting name-only imports; it does not implement operational stock import.

RED d3f433f: three tests fail because different manufacturers/specifications and
ambiguous existing matches silently collapse. GREEN 89638d7: planner rejects the
whole file before any RPC when same-name candidates have different manufacturer,
specification/model, known SKU, or multiple existing matches. Case/whitespace are
normalized; punctuation in identity fields is preserved. Known vs missing company
or specification is also flagged. Same-identity provenance is retained.

RED 79908f7: rejected replacement file leaves previous import plan actionable.
Fix clears preview and disables commit before reading; validation errors are shown
as text. No SQL, stock, credentials or production records changed.

Executed: node --test tests/inventory-import-identity.test.mjs
tests/inventory-import-workflow.test.mjs: six pass, zero skipped. Both changed JS
files pass node --check; git diff --check clean.

Limits: isolated fixtures, no production test yet.
This is a conservative stop-for-review, not automatic separation/import of legitimate
same-name variants. Two entirely unknown identities retain legacy name-only behavior;
that is not evidence of verified identity. Raw product source is used; reviewed
identity overlays, concurrent file selections, stale catalogue between preview and
commit, and server-side import validation still need review. No measured coverage
percentage or complete import acceptance is claimed. Independent review required.

## 05:18 UTC browser check

Executed `CHROME_EXECUTABLE=<installed Chrome> node tests/inventory-import-browser.mjs`:
PASS. Actual file-input selection loads a valid fictional list, then a conflicting
replacement and malformed JSON. Both reject with the prior commit disabled and no
RPC call. A corrected file can then be selected; clicking its real commit control
submits only that corrected manufacturer's record to a fixture RPC. All browser
network requests are blocked. The real import panel, binder and planner run; the
surrounding stock page, auth, load and RPC are fixtures. This is not live Supabase
persistence or cross-account acceptance. No application code changed in this run.
