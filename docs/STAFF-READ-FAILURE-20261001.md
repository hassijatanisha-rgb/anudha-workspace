# Staff access query failure — review candidate

Base main37c44cb. User journey: an authenticated employee encountering a database timeout must not be told their membership was revoked or have the authentication session signed out, but the workspace must remain blocked until access can be verified.

RED392c76b: actual load() in isolated Node/VM receives a staff lookup error and incorrectly signs out with the inactive-membership message. Three denial/MFA/success control cases already pass. GREEN75f2c92: use maybeSingle to distinguish no staff row from query failure; on returned query error clear cached workspace identity/data/UI and throw a retryable explanation without invoking auth.signOut. No membership or backend-policy changes. Missing/inactive rows still sign out. Two-step challenge still precedes staff and business reads.

Validation: four new runtime cases plus three existing two-step cases pass; app syntax and diff checks clean. Tests exercise actual load() with stub SDK responses, not live sessions. Numeric coverage, browser recovery and production error handling remain unverified. This does not fix the underlying database timeout, add automatic retries or prove all transport rejection paths. Reload remains the retry action. No credentials, auth configuration, SQL, accounting or stock changed.

Shared app.js edit requires independent Claude review; preserve PR22/26 routing and PR27 pagination changes during integration. Do not classify review-branch publication as deployed.

## 20:15 UTC transport follow-up

RED6496d84 reproduces a rejected staff-query promise bypassing the returned-error cleanup and retaining old workspace identity. GREEN06a6fb1 catches only the staff query rejection and routes it through the same fail-closed cleanup; later rendering/data errors are not mislabeled as staff failures. Five staff cases plus three MFA cases pass. No authentication revocation on transient rejection and no business-data load; inactive/missing memberships still denied. This closes the thrown staff-query gap, not all boot/auth/employee-name/data-loading exceptions or concurrent session changes. Browser/live acceptance and independent review remain outstanding.

## 20:58 UTC isolated browser acceptance

`tests/staff-read-browser.mjs` passed in isolated headless Chrome with all network routes blocked. Executes actual load(), clear(), login(), message() and field() code; fictional SDK responses only. Returned and thrown errors remove stale core data, identity, fields, navigation and content, show reload guidance, and do not sign out or load more data. Inactive membership signs out and displays the login form and denial message. Browser closed after checks. This closes the local DOM-cleanup gap, not Supabase authentication, all module caches, concurrent-account transitions, visual/accessibility or live acceptance. No application changes this cycle.
