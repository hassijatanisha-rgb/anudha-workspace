import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync('inventory-import.js','utf8');
const context={String,Array,Object,Map,Set,Error,JSON};
vm.createContext(context);
vm.runInContext(source+';this.api={inventoryImportPlan,inventoryImportHasQuantity};',context);
const {inventoryImportPlan,inventoryImportHasQuantity}=context.api;

const payload={
 metadata:{kind:'inventory-product-list',source_file:'Book2.xlsx',quantities_supplied:false},
 products:[
  {id:'a',name:'  CBC   Reagent  ',sku:'',source:{source_file:'Book2.xlsx',source_rows:[13,18]}},
  {id:'b',name:'CBC Reagent',sku:'',source:{source_file:'Book2.xlsx',source_rows:[22]}},
  {id:'c',name:'New Machine',sku:'',source:{source_file:'Book2.xlsx',source_rows:[24]}}
 ]
};

const plan=inventoryImportPlan(payload,[{id:'saved',name:'cbc reagent',sku:'R-1'}]);
assert.equal(plan.sourceRows,3);
assert.equal(plan.uniqueNames,2);
assert.equal(plan.existingMatches.length,1);
assert.equal(plan.newProducts.length,1);
assert.equal(plan.newProducts[0].name,'New Machine');
assert.deepEqual(Array.from(plan.duplicateGroups[0].sourceRows),[13,18,22]);
assert.equal(inventoryImportHasQuantity(payload),false);

assert.throws(()=>inventoryImportPlan({...payload,metadata:{...payload.metadata,quantities_supplied:true}},[]),/quantity/i);
assert.throws(()=>inventoryImportPlan({...payload,products:[{...payload.products[0],closing_balance:12}]},[]),/quantity/i);
assert.throws(()=>inventoryImportPlan({products:[]},[]),/prepared inventory product list/i);

const ui=fs.readFileSync('inventory-operations.js','utf8');
assert.match(ui,/Prepare Book2 product import/);
assert.match(ui,/Import new product names only/);
assert.match(ui,/Existing exact-name matches will not be duplicated/);
assert.match(ui,/inventoryImportPlan/);
assert.match(ui,/import_records/);

console.log('PASS: Book2 import groups repeated rows, skips existing products and refuses invented quantities.');
