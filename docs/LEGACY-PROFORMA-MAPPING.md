# Original ERP reference → current product

The old `anudha-erp` is a reference, not the deployment target. Current product: `anudha-workspace`.

## Branding implemented locally

Reuse the identical existing Anudha SVG instead of the header's letter A. Original palette: lime #72ad3d, deep green #315c32, ink #243128, canvas #f4f7f3. Keep darker green behind white button text for readability. Preserve current navigation handlers and print styles.

## Pro forma reference

Source: `../anudha-erp/app/page.tsx`, Pro forma editor, approximately lines 1210–1370.

Already present in current sales document: client branch, named contact, validity, revision, product description, quantity, price, discount, tax, delivery period, payment terms, notes, acceptance reference and Print/PDF.

Needs connected implementation/verification: item specifications; cash/memo/credit type; read-only actual preparer; assigned review owner; company contact/certification footer; verified bank details; E. & O.E.; document-specific immutable snapshots; complete PDF layout.

Do not copy the old hard-coded example contact/preparer, bank numbers, certification or tax identifiers into live records without checking the authoritative company forms. Visual and field parity does not establish backend or accounting correctness.

Confirmed handoff: Pro forma creator → Mujtaba invoices available quantities → shared stock reservation → Jagroop assigns packing → dispatch physically issues stock. Notify creator; unfilled quantities remain Pending stock. Current accounting code requires partial-quantity totals, expiry and permission fixes before release.
