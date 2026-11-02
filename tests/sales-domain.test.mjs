import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync('sales-domain.js','utf8');
const context={Intl,Error,Number,String,Math};vm.createContext(context);vm.runInContext(source+';this.api={moneyMinor,moneyDisplay,moneyExactDisplay,proformaLineTotal,proformaNextActions,deliveryNextActions,remainingDeliveryQuantity}',context);
const {moneyMinor,proformaLineTotal,proformaNextActions,deliveryNextActions,remainingDeliveryQuantity}=context.api;

assert.equal(moneyMinor('1250.50'),125050);
assert.equal(context.api.moneyDisplay(125000000,'TZS').replace(/\s/g,' '),'TZS 1,250,000');
assert.equal(context.api.moneyDisplay(125050,'USD').replace(/\s/g,' '),new Intl.NumberFormat('en-TZ',{style:'currency',currency:'USD',minimumFractionDigits:2}).format(1250.50).replace(/\s/g,' '));
assert.equal(context.api.moneyDisplay(125050,'TZS').replace(/\s/g,' '),'TZS 1,251');
for(const [minor,expected] of [[0,'TZS 0.00'],[1,'TZS 0.01'],[-1,'-TZS 0.01'],[12345,'TZS 123.45'],[Number.MAX_SAFE_INTEGER,'TZS 90,071,992,547,409.91'],['18014398509481982','TZS 180,143,985,094,819.82'],[-9007199254740991n,'-TZS 90,071,992,547,409.91']])assert.equal(context.api.moneyExactDisplay(minor).replace(/\s/g,' '),expected);
assert.equal(context.api.moneyExactDisplay(125050,'USD'),new Intl.NumberFormat('en-TZ',{style:'currency',currency:'USD',minimumFractionDigits:2,maximumFractionDigits:2}).format(1250.50));
for(const invalid of [null,undefined,'',false,1.5,'1.5','1e3',NaN,Infinity,Number.MAX_SAFE_INTEGER+1])assert.equal(context.api.moneyExactDisplay(invalid),'Invalid amount');
assert.throws(()=>moneyMinor('1.234'),/two decimal/);
assert.deepEqual({...proformaLineTotal({quantity:2,unitPriceMinor:10000,discountBasisPoints:1000,taxBasisPoints:1800})},{gross:20000,discount:2000,tax:3240,total:21240});
assert.deepEqual([...proformaNextActions('sent')],['accept','revise','reject','cancel']);
assert.deepEqual([...deliveryNextActions('accounts_approved')],['tax_invoice','cancel']);
assert.deepEqual([...deliveryNextActions('tax_invoice_created')],['send_to_sales','cancel']);
assert.deepEqual([...deliveryNextActions('sent_to_sales')],['start_packing','cancel']);
assert.deepEqual([...deliveryNextActions('packing')],['ready','cancel']);
assert.deepEqual([...deliveryNextActions('out_for_delivery')],['deliver']);
assert.equal(remainingDeliveryQuantity({id:'L',quantity:10},[{delivery_note_id:'D1',proforma_line_id:'L',quantity:4},{delivery_note_id:'D2',proforma_line_id:'L',quantity:6}],[{id:'D1',status:'ready'},{id:'D2',status:'cancelled'}]),6);
console.log('PASS: sales money, status actions and split-delivery balances are deterministic.');
