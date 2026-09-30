# Anudha shared delivery brief

Updated 2026-09-30. User-authorized collaboration between Codex and Claude.

## Product and acceptance

- Official product: https://hassijatanisha-rgb.github.io/anudha-workspace/
- GitHub Pages serves the frontend from **main**; Supabase provides persistence, authentication and private storage.
- Old ERP is a design/forms blueprint, not a separate deliverable.
- Friday 2 October, 17:00 Africa/Dar_es_Salaam is the requested non-accounting deadline, not a verified readiness guarantee.
- Accounting and Tally API integration are deferred. Do not invent a Tally endpoint or show a fake connected state.
- Done means reviewed, tested, deployed and verified on the official product, including refresh and authorized cross-account persistence. Local code is not live delivery.
- Do not modify production stock or business records for testing. Use isolated fictional fixtures. No secrets, credentials or private records in this repository or cross-agent prompts.

## Collaboration and file ownership

Claude is the user-designated supervisor and independently reviews Codex changes. Codex independently reviews Claude changes. Human user decisions and access approvals remain authoritative.

| Lane | Implementer | Reviewer | Ownership |
| --- | --- | --- | --- |
| Inventory, feature/backend completion | Codex | Claude | tally-stock-review.js, godown tests, proposed inventory migrations |
| Bugs, documents, interface | Claude | Codex | document-attachments.js and its tests initially |
| Shared app.js, index.html, styles | Assigned per change | Other agent | Propose focused diffs before overlapping edits |
| Release integration | Codex | Claude | Only reviewed commits, no force pushes or automatic main merge |

Use the remote review branch `release/inventory-live-20260929` as the common inventory baseline. Each agent works on a separate branch. Preserve existing uncommitted work and local commits. Do not reset either checkout to obtain this branch.

Claude's last reported branch is `claude/friendly-volta-3lwcib`; its reported commits `24da7b7` and `a32c6eb` have not been independently reviewed here. If push remains forbidden, export patches; do not weaken permissions or repeatedly retry.

## Confirmed business rules

- Same manufacturer reagent shared by multiple machines = one canonical stock item with multiple compatibility links. Different manufacturers = distinct items.
- Eight source godown labels stay distinct until reviewed mapping to actual locations. Do not invent physical mappings.
- Source stock snapshot and product-allocation example serve different purposes. Preserve source provenance, negatives and unknown fields; flag for correction instead of guessing.
- Required product review: name, manufacturer, specification/version, sale/service status, verified pieces, units/pack conversion and batch/expiry/serial where applicable.
- Lead/Opportunity -> proforma -> customer acceptance -> authorized invoice -> packing -> dispatch -> delivery -> installation/service.
- Quoted stock is held, not physically deducted. Revisions replace reservations atomically. Release rejected/resolved quantities.
- Physical deduction happens ONCE at invoice issuance, never again at dispatch. Deferring accounting does not authorize bypassing this rule. External-invoice handoff needs explicit design and verification.
- Outcomes: invoice all, split remainder into pending, resolve, extend. Pending is stock-waiting work, separate from ordinary tasks; closure after six months, with audited extensions where applicable.
- Each handoff has an accountable assignee, task notification and stage timestamp. Preserve sender attribution.
- Forms/PDFs must retain required reference-form fields and approved branding/bank terms. Buyer TIN, not CST. VAT added on top. Never invent bank details.
- Private uploads/downloads must enforce access server-side. Posted financial history remains immutable. Admin archive/restore does not permit staff deletion.
- Main calendar: green company events, white personal events. Service calendar stays under Service. Search must retain typing focus and cursor position.

## Current evidence and work queue

| Item | Evidence/status | Next acceptance gate |
| --- | --- | --- |
| Source godown scope/search | Last verified live baseline 4b572fd | Recheck current official version before release |
| Godown mapping/history, migration 041 | Local code/tests on this review branch; NOT activated | Claude review, preview approval, migration validation and live permission test |
| Location readiness display | c316f11; 13 focused tests and isolated Chrome passed | Independent code review; unavailable reads must remain fail-closed |
| Source review -> operational stock | Missing | Transactional idempotent import, exact mapping, verified units/lots and reconciliation tests |
| Attachment retry/download/pagination fixes | Claude reports a32c6eb | Obtain actual diff, reproduce tests and review before integration |
| Complete sales/delivery/service flow | Not fully verified | Test current migrations and stage transitions; no double deduction |
| Accounts, client data, tasks, settings | Require current audit | Saved data, cross-account permissions and realistic error paths |
| Production recovery | Not proven complete | Isolated restore including private attachments; no live overwrite |

## Release procedure

1. Implementer records exact diff, tests, skipped cases and known limitations.
2. Other agent reviews actual code against this brief; no summary-only approvals.
3. Integrate accepted commits on a review branch and rerun combined regression tests.
4. Obtain any required production activation approval. Review-branch push is not activation.
5. Deploy deliberately; confirm official version, persistence, permissions and workflow.
6. Update evidence. Never label a feature done solely because a table exists or a mock test passes.

This file is a coordination baseline, not evidence that omitted features are implemented. Background automation is paused; no unattended progress is promised.
