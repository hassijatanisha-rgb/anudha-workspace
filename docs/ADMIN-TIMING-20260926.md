# Admin deletion and order timing

Status: local implementation tested; migration activation and public deployment pending.

- Existing owner role represents admin. Products and draft proformas use recoverable archive/restore, without a reason field. Staff are rejected in RPCs and database triggers, including direct CRM archive writes. Permanent deletes are blocked.
- Products with nonzero stock (including negative balances) or open transfers must be resolved before archive. Delivery-linked/non-draft proformas cannot be archived. Historical rows remain readable.
- Client/contact legacy RPCs keep their original bodies except the owner gate now applies to both kinds.
- Active catalogs and new-product selectors exclude archived products; historical product lookup retains them. Deleted Items includes products and draft proformas for owners.
- Sales progress offers per-record complete history retrieval, transition timestamps/actors, visit durations, current waiting and total elapsed. Refresh timing for an updated elapsed figure. Missing history displays Unknown; times are not invented. Service/installation timing is not included in this sales timing scope.

Evidence: admin-delete UI tests initially failed for missing implementation, then passed. Database test passed owner/staff/anonymous gates, archive/restore, version guards, history retention and inventory guards. Order timing tests passed missing-history, reversals, repeated events, cancellation and pagination cases. Combined focused test run: 18 passed, zero skipped. This does not constitute a production end-to-end test or launch approval. Concurrent database sessions and live archive/restore require separate verification.

Activation must precede frontend deployment because product loading now requests deleted_at. No real business records should be deleted as part of activation.
