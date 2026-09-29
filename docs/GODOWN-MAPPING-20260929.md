# Godown mapping database boundary — isolated only

RED checkpoint efc773b: actual predecessor migrations loaded, new save RPC missing (42883). New additive migration 041 implements exact source-label to active ERP-location reviews, nullable location for unresolved decisions, owner-only saves, active-staff reads, immutable history, expected versions and actor/payload-bound request replay. No auto-matching and no stock writes.

Validation: Node tests/godown-mapping-database.mjs with PGlite and actual migrations 001/002/018 passes. Checks owner/staff/inactive/anonymous permissions, stale versions, changed request payload, unknown source/location, inactive location, unresolved revisions, immutable history, unchanged negative source and zero operational lots.

Not live. UI, real multi-connection PostgreSQL race tests, production-sized migration check and preview approval remain. Source label has no foreign key because distinct source labels span many immutable source rows; RPC requires an existing exact label. Location state must be revalidated by eventual stock-import transaction, not trusted from an old review. Rollback is a forward RPC permission revocation preserving audit rows. No production migration was applied. Accounting paused.
