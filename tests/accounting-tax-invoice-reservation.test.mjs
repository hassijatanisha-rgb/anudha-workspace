import assert from 'node:assert/strict';
import fs from 'node:fs';

const sql=fs.readFileSync('supabase/migrations/202609210010_accounting_tax_invoice_reservation.sql','utf8');
const ui=fs.readFileSync('sales-delivery.js','utf8');

assert.match(sql,/create or replace function public\.create_tax_invoice_and_reserve_stock/i);
assert.match(sql,/status='accounts_approved'.*for update/is,'Tax invoicing must lock the order at the expected stage.');
assert.match(sql,/is_dispatch_hub=true/is,'Only Haadi dispatch stock may be reserved.');
assert.match(sql,/for update of lot/is,'Candidate lots must be locked before availability is consumed.');
assert.match(sql,/order by lot\.expiry_date nulls last/is,'Automatic allocation must use expiring stock first.');
assert.match(sql,/reserved_units=reserved_units\+/is,'Tax invoicing must reserve stock atomically.');
assert.match(sql,/insert into public\.sales_delivery_lines/is,'Reserved lot allocations must be retained for packing and dispatch.');
assert.match(sql,/not enough available stock/i,'The whole transaction must fail on shortage.');
assert.match(sql,/create or replace function public\.start_reserved_sales_delivery_packing/i);
assert.match(sql,/old\.status in \('tax_invoice_created','sent_to_sales'\)/i,'Cancelling before packing must release the Tax Invoice reservation.');
assert.match(sql,/reserved_units=reserved_units-/i);
assert.match(sql,/tax invoice must reserve stock/i,'The legacy status action must not bypass reservation.');

assert.match(ui,/create_tax_invoice_and_reserve_stock/);
assert.match(ui,/start_reserved_sales_delivery_packing/);
assert.match(ui,/Stock is reserved when the Tax Invoice is created/);

console.log('PASS: Tax Invoice creation reserves Haadi stock and cancellation releases it before dispatch.');
