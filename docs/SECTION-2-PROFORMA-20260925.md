# Section 2 — Pro forma to accounting

Scope: create and save pro formas, return sent documents for revision, print the saved record with company branding, and submit accepted records to the accounting review queue. No tax-invoice issuance, ledger posting, stock deduction, staff enrollment or automatic customer messaging is introduced.

## Implemented

- Existing save/advance RPCs retained. New-document retry keeps its request ID; an uncertain retry cannot create a second document under another ID in the same form.
- Server response identity/version must confirm saving before the editor closes. Pending saves disable their button. Stale/session/route changes cannot overwrite the replacement page.
- Added line removal works immediately; printing cleans its selection even on an exception.
- Labels distinguish recording a document already sent externally from submitting customer acceptance to accounting.
- Accounting shows a membership-gated, 25-record paginated submitted-proforma register. It includes already processed submissions and says so; this is not a pending-only task queue. Review opens the same saved record, including a targeted fetch for older records outside the latest 200.
- Saved pro forma print uses existing company logo/contact/TIN/VRN branding, document/revision, named client contact, items, totals, terms and preparer ID; E. & O.E. and non-tax-invoice wording included.
- Migration 024 adds NULL/negative version, invalid lines and NULL currency guards to the exact known save function. It preserves function identity and permissions and aborts unknown implementations. It is idempotent; no business rows are altered. Production recovery is a reviewed forward migration, not removal of history.

## Verification

- TDD reproductions: missing handoff labels/brand (2 failures), dynamic row removal/retry identity/save confirmation/loading (6 failures), older-record lookup/error handling (3 failures), print cleanup (1 failure). All now pass. Checkpoint commits preserve the frontend RED/GREEN sequence.
- Complete Node suite with PROFORMA_BROWSER_QA=1, ACCOUNTING_BROWSER_QA=1 and PERSONAL_BROWSER_QA=1: **111 passed, 0 failed, 0 skipped**. Includes 32 real headless-Chrome tests with fictional fixtures and network blocked.
- `tests/proforma-section2-database.mjs` executed using pinned PGlite 0.5.8: exact totals, immutable revisions, stale rejection, acceptance lock/reference, no stock/delivery impact, inactive/anonymous denial, malformed direct authenticated RPC requests, unchanged RPC identity/ACL and idempotent migration all passed. The NULL-version overwrite was reproduced before adding migration 024.
- Changed scripts pass Node syntax checks; git diff whitespace check passes.
- Live Supabase migration 024 executed successfully on 25 September. Read-back: validation marker true, NULL-version guard true, authenticated execute true, anonymous execute false. Live register was reachable and had no pro formas before deployment.

## Boundaries

- Live create/revise/submit verification awaits permission to leave a clearly labelled test record in the audit history. Isolated tests are not live persistence evidence.
- Membership remains on the user's existing approved login; no Mujtaba login was enrolled.
- Print uses current linked customer/contact/product names. Historical revision snapshots preserve IDs and line details, not historical party names. Historical revision selection, issuer/bank/certification snapshots and employee display-name lookup remain separate work; no unverified bank footer was published.
- Existing downstream financial approval/stock workflow is not certified by this slice. Its broader authorization hardening remains a release blocker for operational accounting.
- Reminder/background automation and email/WhatsApp delivery are not enabled by this release.
