# Purchasing read/session guard — local candidate

6 October 08:27 UTC: five isolated Chrome cases now pass using actual purchasing renderer and deferred fictional reads: current load, navigation away, same-ID actor replacement, same-actor clear with late error, newer successful refresh followed by old error. Zero page errors; all external requests blocked. Browser-QA used, syntax/diff checks pass. This verifies read/render behavior only; not real auth, purchase mutations, full workflow, visual/a11y or deployment. Prior353pass/40skip remains last native suite evidence.

6 October 07:55 UTC: five actual-module VM checks, initially four failures. Reproduced off-view loading replacing Clients, same-ID replacement actor receiving old rows, old error overriding newer success, and same-actor cleanup accepting an old error.

Scoped fix: capture actor object and ID in loader; render epoch plus view/actor checks before loading and after completion; cleanup invalidates render epoch and clears load error. Five focused checks pass; full353pass/40skip/0fail, diff clean.

No purchase mutation, inventory transaction, migration, access change or deployment. Real browser/read permissions and purchase/supplier save callbacks remain separate checks. Independent review required. Existing PR35 baseline preserved; new changes local only at this checkpoint.
