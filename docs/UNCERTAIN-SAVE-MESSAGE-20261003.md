# Lost-response messaging

Base main8618384. One-line change in friendlyError: remove unsupported “Nothing more was saved” and immediate retry advice; explain that the result is unconfirmed and ask staff to reconnect/check the record before submitting again.

RED7a3037d: two tests fail on original wording, including a fictional write followed by a lost-response exception. GREENc414a84: both pass; seven focused tests including existing two-step checks pass. Full suite258pass/40skip/0fail; syntax and diff clean.

Only user-facing text changes. No timeout durations, authorization, SQL, stock, accounting or request behavior changes. Ordinary validation messages remain explicit. This is not server rollback, idempotency implementation or a connection fix. Tests execute the actual run/friendlyError functions with a fictional save; no real database. Numerical coverage and live browser/deployed acceptance unmeasured. Independent review required; not deployed.
