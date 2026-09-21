import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync('sales-domain.js','utf8');
const context={Intl,Error,Number,String,Math};vm.createContext(context);vm.runInContext(source+';this.api={moneyMinor,moneyDisplay,proformaLineTotal,proformaNextActions,deliveryNextActions,remainingDeliveryQuantity}',context);
const {moneyMinor,proformaLineTotal,proformaNextActions,deliveryNextActions,remainingDeliveryQuantity}=context.api;

assert.equal(moneyMinor('1250.50'),125050);
assert.throws(()=>moneyMinor('1.234'),/two decimal/);
assert.deepEqual({...proformaLineTotal({quantity:2,unitPriceMinor:10000,discountBasisPoints:1000,taxBasisPoints:1800})},{gross:20000,discount:2000,tax:3240,total:21240});
assert.deepEqual([...proformaNextActions('sent')],['accept','revise','reject','cancel']);
assert.deepEqual([...deliveryNextActions('out_for_delivery')],['deliver']);
assert.equal(remainingDeliveryQuantity({id:'L',quantity:10},[{delivery_note_id:'D1',proforma_line_id:'L',quantity:4},{delivery_note_id:'D2',proforma_line_id:'L',quantity:6}],[{id:'D1',status:'ready'},{id:'D2',status:'cancelled'}]),6);
console.log('PASS: sales money, status actions and split-delivery balances are deterministic.');
