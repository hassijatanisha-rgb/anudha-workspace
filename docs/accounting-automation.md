# Accounting automation and opening books

This release adds supplier bills/payments/advances/credits/refunds, customer credit application/refunds, and inventory acquisition cost and cost of sales. It uses the existing TZS ledger and accounting permissions. Recording a payment or refund records a completed bank/cash transaction; it does not transfer money.

## Deployment

Apply migrations 158, 159, and 160 together, in that order, after 156 and 157. Deploy the generated frontend only after the database migration succeeds. Build from `index.src.html` with `node scripts/build-bundle.mjs`. Do not activate costing as part of deployment.

## Opening books

1. Agree the cutover date and retain the approved trial balance, customer/supplier schedules, physical counts, stock acquisition-cost evidence, and bank/cash reconciliations. Review training transactions and correct them through supported reversals.
2. Map ledger codes and import the balanced opening general ledger through Accounts → Import Excel. Compare every imported balance with the approved source.
3. Import outstanding customer invoices and credit balances through Opening receivables. Import outstanding supplier bills and advances through Supplier accounts → Opening payables. Each schedule must match its selected opening ledger and control account exactly. Neither import posts the balance again.
4. Complete stock counts, serial identities, transfers, deliveries, and unresolved returns. Accounts → Stock accounting → Opening stock provides a template containing every positive lot, including quarantine. Enter verified acquisition values and evidence; selling prices and provisional stock counts are not acquisition values.
5. The owner selects the approved FIFO or weighted-average policy and the opening GL batch. Activation uses yesterday's cutover, before any new stock movements or invoices today. FIFO requires original acquisition dates. Activation requires every lot/version/quantity to match and total value to equal the opening and current Inventory control balances. It does not create another journal.
6. Reconcile banks/cash, customer balances, supplier balances, inventory, trial balance, and financial reports. Keep the owner's sign-off and set the approved book-lock date.

An unused opening customer or supplier schedule can be corrected through its correction action. Original schedules remain in history. A schedule with settlement history cannot be silently replaced. Activated stock policy and original valuation remain immutable; use dated supported corrections.

## Daily workflow

- **Buying stock:** create an ordered purchase order with a supplier. Stock accounting → Goods received records actual base units, lot/expiry/inspection, and real machine serials. Supplier accounts → New bill attaches those receipts and the actual net acquisition amounts and recoverable input tax. Include allocated nonrecoverable acquisition charges in net cost. Each receipt can have one active bill cost.
- **Expense bills:** post the supplier's actual expense and input-tax amounts. Record payments, allocate advances, and inspect payable ageing in Supplier accounts. Credits on paid bills release the excess allocation back to the original advance for reapplication or refund.
- **Selling stock:** the existing partial-invoice workflow remains responsible for invoice quantities. After costing activation, invoice posting also posts cost of sales for those units. Dispatch consumes the existing allocation and does not post cost twice. Uncosted received units block new cost consumption for that product until Accounts posts their supplier bill.
- **Customer credit:** Customer credits finds the customer's available overpayment, return credit, and opening credit. Apply it to an invoice or record an actual refund. Applications, refunds and reversals retain their dates and source references.
- **Customer returns:** receive returned goods into quarantine. The return credit restores the original invoiced acquisition cost. Accounts must post that credit before Stores resolves the return. Restocking does not post another GL entry; write-off records the inventory loss. Later consumption/resolution can prevent an ordinary void.
- **Supplier returns:** open the original supplier bill and choose Return stock and issue credit. Actual unreserved loose units and the matching credit post together. Machine returns require the actual serials.
- **Corrections:** use the record's void/reversal action with a date and reason. Physical shortages use Stock count. Found nonserial stock and remaining value corrections require verified acquisition evidence in Stock accounting. Serial identity corrections use Inventory's serial review.

Stock accounting is chronological: subsequent product cost activity can block backdated changes or reversal. The UI retains submitted details after an uncertain response and retries the same request ID. Never recreate an uncertain posting as a new transaction; resolve its saved result first.

## Boundaries

- This is a TZS ledger. Multi-currency revaluation and foreign-exchange accounting are not implemented by this release.
- Historical/external invoice returns without a verified ERP invoice cost allocation require Accounts reconciliation; cost is never inferred from the sale price.
- Supplier input tax is entered from verified supporting documents. Posting is not proof of tax eligibility or statutory/e-invoicing acceptance.
- Deployment does not verify physical quantities, approve opening books, choose a valuation policy, or replace the owner's accounting sign-off.
- Ledger reconciliation shows accounting consistency; it cannot establish that source documents or physical counts are accurate.
