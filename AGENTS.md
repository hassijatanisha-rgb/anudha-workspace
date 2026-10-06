# Rules for coding agents (Codex and others)

Read `.ai-style-rules.md` too. Those rules cover how the code is written. This file covers how work gets shipped. Breaking any rule below means the work is rejected.

## Why this file exists

An audit on 2026-10-06 found 19 agent branches that were never merged. Some were a week old. 9 of them were already fully contained in `main` or another branch. On the biggest branch, test and docs "evidence" commits outnumbered real fixes by more than 2 to 1 (54 against 24). All of those branches passed the tests, so quality was not the problem. Shipping was. The work never reached `main` or the live database.

## Hard rules

1. **One task, one branch, one pull request.** Start every branch from the latest `origin/main` and name it `codex/<short-task>`. As soon as the first real fix commit exists, open a pull request to `main`. No more `verify/`, `release/` or `fix/*-YYYYMMDD` side branches.
2. **Never stack branches.** Do not merge one unmerged branch into another to "verify them together". If two fixes depend on each other, they go in one pull request.
3. **Keep at most 2 of your pull requests open at a time.** Finish or close one before you start a third.
4. **A task is done only when its pull request is merged or closed.** "Recorded evidence" does not count as done. Neither does a pushed branch.
5. **No docs-only evidence commits.** Do not write `docs: record ... evidence/acceptance/verification`. Put the test result in the pull request description. A docs file is allowed only when a human will read it to run the business.
6. **Every fix needs a test that fails without the fix.** Put the test and the fix in the same pull request. One `test:` commit per fix is enough, not five.
7. **Before every push**, merge in the latest `origin/main`. Then run `node --test tests/*.test.mjs` and get 0 failures. Paste the pass/fail line into the pull request.
8. **Migration names:** use `supabase/migrations/YYYYMMDD00NN_name.sql`. `NN` is one higher than the highest number on `main` and on any open pull request. Never use a 14-digit timestamp. Never give a new file a date older than the newest migration already applied (see the list in the Supabase project).
9. **Do not apply migrations to the live database yourself.** Say in the pull request that a migration needs applying. A human or Claude applies it after merge.
10. **Do only what the task says.** No drive-by refactors and no new features nobody asked for. If you spot something else, write it in the pull request description under "Noticed, not done".
11. **If you are stuck for 2 attempts, stop.** Push what you have to the open pull request. State exactly what is blocking. Do not keep committing around the problem.
12. **Delete your branch once its pull request is merged or closed.**

## Pull request description template

```
What: <one sentence a non-programmer understands>
Why: <the bug or request>
Test: node --test tests/*.test.mjs -> # pass N # fail 0
New test that failed before the fix: tests/<file>
Migration to apply after merge: <file or "none">
Noticed, not done: <or "nothing">
```

## Work queue (2026-10-06)

Lanes in the same wave touch separate files, so they can run at the same time. Do not start a wave until the wave before it is merged.

### Wave 1: run all three at once

- **Lane A: done by Claude** in branch `claude/dreamy-mayer-sopnj3` (migrations 0064 and 0065; department heads can cancel pending requests too).
- **Lane B: ship `fix/stock-count-retry-20261001`.** Rename its migration to `202610060066_stock_count_retry_content.sql`. It only touches the migration and its tests. Open the pull request.
- **Lane C: decide on `test/stock-timing-acceptance-20261001` and `release/inventory-live-20260929`.** No code changes. For each one, say in a pull request comment or to the user whether it is still needed. If `godown-mapping-activation` or `main` already replaced it, close it and delete the branch.

### Wave 2: after Lane A is merged, run all three at once

- **Lane D: `fix/import-identity-20261001`.** Touches `inventory-import.js` and `inventory-operations.js`.
- **Lane E: `release/godown-mapping-activation-20260930`.** Touches `tally-stock-review.js`. Its migration `202609290041_godown_mapping_reviews.sql` was never applied, so rename it to the next free number.
- **Lane F: one pull request for the startup and navigation fixes in `app.js`.** These are `fix/queued-navigation-20261001`, `fix/staff-read-failure-20261001`, `fix/startup-read-bounds-20261001`, `fix/uncertain-save-message-20261003` and `fix/inventory-route-20261001`. The first three conflict with `main` in `app.js`. Resolve them by hand and keep the behaviour on `main`.

### Dead branches to delete (already fully merged into `main` or the integration branch)

`fix/godown-browser-portability-20260930`, `release/godown-readonly-20260930`, `fix/inventory-session-20261003`, `fix/pending-cancel-20261001`, `fix/pending-expiry-20261001`, `fix/pending-retry-20261001`, `fix/pending-session-20261005`, `fix/service-session-20261001`, `verify/pending-integration-20261005`. Delete the ones contained only in the integration branch after Lane A merges.
