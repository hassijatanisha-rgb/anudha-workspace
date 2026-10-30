import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

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

const calls=[],reservationError=new Error('Reservation rejected');let submit;
const ctx=vm.createContext({me:{user_id:'actor'},view:'sales',document:{activeElement:null},esc:String,products:[],
 actionForm:(title,fields,save)=>{submit=save;},
 client:{rpc:async(name,args)=>{calls.push({name,args:{...args}});return {error:reservationError};}}
});
vm.runInContext(fs.readFileSync('row-index.js','utf8'),ctx);
vm.runInContext(ui,ctx);
for(const invoiceReference of ['','INV-0042']){
 calls.length=0;ctx.openDeliveryAction({id:'delivery',version:4,status:'accounts_approved'},'tax_invoice');
 await assert.rejects(submit({invoiceReference}),error=>error===reservationError);
 assert.deepEqual(calls,[{name:'create_tax_invoice_and_reserve_stock',args:{p_id:'delivery',p_expected_version:4,p_tax_invoice_reference:invoiceReference}}],
  'Invoice linkage must reserve atomically and must not fall back to a status-only action when reservation fails.');
}
vm.runInContext("salesDeliveryLines=[{delivery_note_id:'delivery',product_id:'product',quantity:2}];",ctx);
calls.length=0;ctx.openDeliveryAction({id:'delivery',version:5,status:'sent_to_sales'},'start_packing');
await assert.rejects(submit({}),error=>error===reservationError);
assert.deepEqual(calls,[{name:'start_reserved_sales_delivery_packing',args:{p_id:'delivery',p_expected_version:5}}],
 'Packing an invoiced delivery must use its existing reservation, not allocate stock again.');

console.log('PASS: Tax Invoice creation reserves Haadi stock and cancellation releases it before dispatch.');
