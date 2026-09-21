import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
const context={products:[],document:{addEventListener(){}},esc:String,$(){return{};}};vm.createContext(context);vm.runInContext(fs.readFileSync('catalog-inventory.js','utf8'),context);
assert.equal(typeof context.catalogProductIssues,'function');
assert.deepEqual(Array.from(context.catalogProductIssues({name:'',sku:'',source:{category:'machines'}})),['Product name is missing','SKU / part number is missing','Machine company is missing','Machine model is missing']);
assert.deepEqual(Array.from(context.catalogProductIssues({name:'Reagent A',sku:'R-1',source:{category:'reagents',machine_ids:[]}})),['No compatible machine is linked']);
assert.deepEqual(Array.from(context.catalogProductIssues({name:'Machine A',sku:'M-1',source:{category:'machines',company:'Maker',model:'X'}})),[]);
console.log('PASS: inventory review flags incomplete machine and related-product master data.');
