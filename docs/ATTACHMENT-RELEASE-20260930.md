# Reviewed attachment repair release

Reviewed Claude commits 24da7b7, a32c6eb and 93be2d7 against live baseline 4b572fd.

Included: private storage error normalization, retained-path upload retry without overwrite, readable download failures, and one-extra-row pagination to prevent empty next pages. Supporting tests load the actual vendored Supabase client for storage error shapes. Existing actor/view checks and server access checks remain in place.

Withheld: Help rewrite 93be2d7, reverted in 379f982 because its broad readiness and privacy wording was not independently verified live. No inventory or accounting feature activation, SQL migrations, access grants or business-data mutations.

Independent validation: 208 tests passed, zero failed/skipped with all four browser QA switches enabled and CHROME_EXECUTABLE pointing to installed Chrome. Initial run could not find Playwright's bundled browser; corrected executable selection resolved that environment error. Attachment database fixture test passed with pinned PGlite 0.3.14, including private bucket, owner/MIME/size checks, cross-account denial and overwrite/deletion guards. Syntax and git diff whitespace checks passed.

These isolated checks do not prove live signed-in upload/download end-to-end or overall ERP readiness. Verify published asset identity after Pages completes. Rollback: revert the release commits through a forward commit; previous baseline is 4b572fd62e11130f470f07881e74dd6b6ad03d11. No schema rollback is needed.
