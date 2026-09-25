# Service report completion fix — live verification

Applied migration `202609250028_service_report_recordset.sql` through the Anudha Supabase SQL editor on 2026-09-25.

Project: `udncxdbrbaptcefvjucj`.

The live function body matched the tested original before deployment:
`73d4279a3ade05908d5ebe6d4b6ca4e7`.

After successful execution, the live body matched the tested replacement:
`8f83d487532b0fbc400291b64e8a4708`.

OID 39528, owner postgres, security-definer flag, search_path and execute grants were unchanged. No customer records, stock quantities or memberships were changed by this migration.

Disposable database regression passed through signed delivery, installation completion and maintenance scheduling. It verified exactly-once stock deduction, retry rejection, shortage rollback and expired-stock rejection. This is not a real signed-in production workflow test.

Remaining invoice blocker: live `create_tax_invoice_and_reserve_stock(uuid,integer,text)` is absent; saved accounting drafts are not linked to an issued invoice. Internal PREP migration alone cannot release fulfillment and must not be presented as fiscal issuance.
