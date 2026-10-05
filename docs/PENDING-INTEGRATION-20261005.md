# Pending expiry + session compatibility

Local integration candidate only: merge 93b8df1 combines PR34 head167a382 with expiry head1709531 (PR10). Neither source worktree changed. No production deployment, migration or data mutation.

Resolved two pending-stock.js conflict regions by preserving both fixes: cleanup invalidates render/load generations and clears availability day/private filters; loader requests expiry_date, uses company date, and guards all successful/error cache writes by actor and epoch. Reopening after a date change reloads availability; stale errors cannot overwrite a newer render. No cancellation, retry RPC or fiscal behavior changes.

Verification against actual combined code:
- Native Node `--test tests/*.test.mjs`: 270 pass, 40 skipped, zero failures.
- `git diff --check`: clean.
- Isolated Chrome `tests/pending-session-browser.mjs`: four scenarios pass, zero page errors.
- Isolated Chrome `tests/pending-expiry-browser.mjs`: actual renderer shows only unexpired availability; prior-day data becomes unavailable on render.

Git-workflow and browser-QA skills used to preserve feature history and check combined behavior in disposable fictional fixtures. No live auth/database, coverage percentage, visual baseline, accessibility or performance certification. Independent Claude review of the resolved diff remains required before main integration. Pending cancel/retry branches remain separate; live RLS and full workflow acceptance remain outstanding.
