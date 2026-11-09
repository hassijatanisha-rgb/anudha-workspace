import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const ctx=vm.createContext({});
vm.runInContext(readFileSync(new URL('../inventory-import.js',import.meta.url),'utf8'),ctx);
const item=(company,specification='500 ml',sku='')=>({name:'CBC Reagent',sku,source:{company,specification}});
const plan=(products,existing=[])=>ctx.inventoryImportPlan({metadata:{kind:'inventory-product-list',quantities_supplied:false},products},existing);

test('same-name imports reject conflicting manufacturer, specification and known stock codes',()=>{
 for(const pair of [[item('Maker A'),item('Maker B')],[item('A','500 ml'),item('A','50 ml')],[item('A','500 ml','A'),item('A','500 ml','B')],[item('A'),item('')]])assert.throws(()=>plan(pair),/identity needs review/i);
});
test('existing conflicting, incomplete or ambiguous identities stop the plan before any product is returned',()=>{
 for(const existing of [[item('B')],[item('A','50 ml')],[item('A'),item('A')],[item('')]])assert.throws(()=>plan([item('A'),{name:'Otherwise new product'}],existing),/identity needs review/i);
 assert.throws(()=>plan([item('A','500 ml','A')],[item('A','500 ml','B')]),/identity needs review/i);
});
test('compatible identities normalize case and whitespace and retain every source row',()=>{
 const a={...item('Maker A'),source:{...item('Maker A').source,source_rows:[3]}},b={...item(' maker  a ','500 ML'),source:{...item(' maker  a ','500 ML').source,source_row:5}};
 const result=plan([a,b]);assert.equal(result.newProducts.length,1);assert.deepEqual(Array.from(result.newProducts[0].source.source_rows),[3,5]);assert.equal(plan([a],[{id:'saved',...b}]).existingMatches.length,1);
 assert.equal(plan([{name:'CBC Reagent',source:{company:'Maker A',model:'500 ml'}}],[a]).existingMatches.length,1);
});
