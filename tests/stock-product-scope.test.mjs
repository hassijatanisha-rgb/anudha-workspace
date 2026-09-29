import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
let counted=[];
const ctx=vm.createContext({document:{addEventListener(){}},inventoryAvailableTotals:lots=>{counted=lots.map(x=>x.id);return {cartons:0,loose:0}},me:{role:'staff'},esc:String});
vm.runInContext(readFileSync(new URL('../inventory-operations.js',import.meta.url),'utf8'),ctx);
vm.runInContext(`inventoryProduct=id=>({id,name:'Same reagent',sku:id});inventoryLocation=()=>({name:'Warehouse',code:'W'});inventoryHeader=()=>'';inventorySetupProgress=()=>'';inventoryLotCard=x=>'<b>'+x.id+'</b>';inventoryMovementCard=x=>'<i>'+x.id+'</i>';inventoryIssueCard=x=>'<i>'+x.id+'</i>';inventoryProductId='maker-a';inventoryLots=[{id:'a',product_id:'maker-a',stock_status:'available'},{id:'b',product_id:'maker-b',stock_status:'available'},{id:'qa',product_id:'maker-a',stock_status:'quarantine'},{id:'qb',product_id:'maker-b',stock_status:'quarantine'}];inventoryMovements=[{id:'ma',lot_id:'a'},{id:'mb',lot_id:'b'}];inventoryIssues=[{id:'ia',product_id:'maker-a'},{id:'ib',product_id:'maker-b'}];`,ctx);
test('Product stock scope excludes another manufacturer with identical name from lots and history',()=>{
 const html=ctx.inventoryStock();
 for(const id of ['a','qa','ma','ia'])assert.ok(html.includes('>'+id+'<'));
 for(const id of ['b','qb','mb','ib'])assert.ok(!html.includes('>'+id+'<'));
 assert.deepEqual(Array.from(counted),['a']);
});
test('Clearing product scope restores all stock',()=>{
 vm.runInContext("inventoryProductId=''",ctx);
 const html=ctx.inventoryStock();assert.match(html,/>b</);assert.match(html,/>qb</);
});
test('Unknown product scope never falls back to all stock',()=>{
 vm.runInContext("inventoryProductId='missing'",ctx);
 const html=ctx.inventoryStock();assert.doesNotMatch(html,/>a<|>b<|>qa<|>qb</);
 assert.equal(counted.length,0);
});
test('Workbench stock button passes stable product ID, not name',()=>{
 const button={dataset:{workbenchStock:'maker-b'}};
 const ui=vm.createContext({products:[{id:'maker-b',name:'Same reagent'}],document:{querySelectorAll:s=>s==='[data-workbench-stock]'?[button]:[]},run:fn=>fn(),inventoryWorkspace(){}});
 vm.runInContext("let inventoryProductId='',inventorySearch='old',inventorySection='catalog';",ui);
 vm.runInContext(readFileSync(new URL('../product-workbench.js',import.meta.url),'utf8'),ui);
 ui.bindProductWorkbench();button.onclick();
 assert.equal(vm.runInContext('inventoryProductId',ui),'maker-b');
 assert.equal(vm.runInContext('inventorySearch',ui),'');
});
