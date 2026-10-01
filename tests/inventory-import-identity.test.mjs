import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const ctx=vm.createContext({});
vm.runInContext(fs.readFileSync('inventory-import.js','utf8'),ctx);
const item=(company,specification='500 ml',sku='')=>({name:'CBC Reagent',sku,source:{company,specification}});
const plan=(products,existing=[])=>ctx.inventoryImportPlan({metadata:{kind:'inventory-product-list',quantities_supplied:false},products},existing);
test('different manufacturers cannot collapse into one incoming product',()=>{
 assert.throws(()=>plan([item('Maker A'),item('Maker B')]),/identity.*review/i);
});
test('different specifications and known SKUs cannot collapse',()=>{
 assert.throws(()=>plan([item('A','500 ml'),item('A','50 ml')]),/identity.*review/i);
 assert.throws(()=>plan([item('A','500 ml','A'),item('A','500 ml','B')]),/identity.*review/i);
});
test('existing conflicting or ambiguous product cannot be silently chosen',()=>{
 assert.throws(()=>plan([item('A')],[item('B')]),/identity.*review/i);
 assert.throws(()=>plan([item('A')],[{id:'1',...item('A')},{id:'2',...item('A')}]),/identity.*review/i);
 assert.throws(()=>plan([item('')],[item('A')]),/identity.*review/i);
});
test('same identity normalizes whitespace and case, retaining provenance',()=>{
 const a=item('Maker A');a.source.source_rows=[3];
 const b=item(' maker  a ','500 ML');b.source.source_rows=[5];
 const result=plan([a,b]);
 assert.equal(result.newProducts.length,1);
 assert.deepEqual(Array.from(result.newProducts[0].source.source_rows),[3,5]);
 assert.equal(plan([a],[{id:'saved',...b}]).existingMatches.length,1);
});
test('a rejected replacement file cannot leave the old import plan actionable',async()=>{
 const nodes={'#inventoryProductImport':{},'#inventoryImportCommit':{},'#inventoryImportStatus':{}};
 const c=vm.createContext({document:{querySelectorAll:()=>[]},$:key=>nodes[key],run:fn=>fn(),products:[],inventoryImportPlan:()=>{throw Error('Product identity needs review');}});
 vm.runInContext(fs.readFileSync('inventory-operations.js','utf8'),c);
 vm.runInContext("inventoryImportPreview={newProducts:[{name:'Old file'}]};inventoryImportFileName='old.json';bindInventoryWorkspace()",c);
 await assert.rejects(nodes['#inventoryProductImport'].onchange({target:{files:[{name:'new.json',text:async()=>'{}'}]}}),/identity needs review/);
 assert.equal(vm.runInContext('inventoryImportPreview',c),null);
 assert.equal(nodes['#inventoryImportCommit'].disabled,true);
 assert.match(nodes['#inventoryImportStatus'].textContent,/identity needs review/);
});
