# Staff access query failure — review candidate

Base main37c44cb. User journey: an authenticated employee encountering a database timeout must not be told their membership was revoked or have the authentication session signed out, but the workspace must remain blocked until access can be verified.

RED392c76b: actual load() in isolated Node/VM receives a staff lookup error and incorrectly signs out with the inactive-membership message. Three denial/MFA/success control cases already pass. GREEN75f2c92: use maybeSingle to distinguish no staff row from query failure; on returned query error clear cached workspace identity/data/UI and throw a retryable explanation without invoking auth.signOut. No membership or backend-policy changes. Missing/inactive rows still sign out. Two-step challenge still precedes staff and business reads.

Validation: four new runtime cases plus three existing two-step cases pass; app syntax and diff checks clean. Tests exercise actual load() with stub SDK responses, not live sessions. Numeric coverage, browser recovery and production error handling remain unverified. This does not fix the underlying database timeout, add automatic retries or prove all transport rejection paths. Reload remains the retry action. No credentials, auth configuration, SQL, accounting or stock changed.

Shared app.js edit requires independent Claude review; preserve PR22/26 routing and PR27 pagination changes during integration. Do not classify review-branch publication as deployed.
