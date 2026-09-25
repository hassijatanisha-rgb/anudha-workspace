# Search stability and buyer TIN

User journeys: type continuously, insert/delete in the middle of a search, clear and retype without cursor reversal or focus-driven scroll jumps; label the buyer identifier TIN in forms and printable output.

RED: `node --test tests/search-stability.test.mjs` executed four failing tests before implementation (old CST label, missing position helper, seven unpatched redraw handlers).

GREEN: same four tests passed. Related company forms, accounting link searches, client review, inventory workspace and navigation checks passed (17 checks). The optional accounting browser suite was not enabled in that command and is not counted as verified.

Isolated installed-Chrome test `tests/search-stability-browser.mjs` passed for text and search fields: continuous typing, middle insertion, backspace, clear/retype, focus and scroll stability. Network was blocked; no company data or sessions were used.

Seven redraw handlers use `renderSearchPreservingPosition`. Accounting link searches and action-form searches already update results without replacing their input and were left unchanged. The existing `buyer_cst` saved-data key is retained for compatibility; its user-facing label is Buyer’s TIN No. in editor and print output. Existing values are not relabelled or rewritten in the database.

Scope: these focused tests do not certify the whole ERP or all browsers. Whole-project coverage has not been measured in this change.
