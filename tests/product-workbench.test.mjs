import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync,existsSync} from 'node:fs';
const ctx=vm.createContext({esc:s=>String(s??'').replaceAll('<','&lt;').replaceAll('"','&quot;'),catalogProductIssues:()=>['Missing specification'],catalogCategoryOf:()=> 'machines',catalogLabel:()=> 'Machines',canEditRecords:()=>true});
const file=new URL('../product-workbench.js',import.meta.url);
if(existsSync(file))vm.runInContext(readFileSync(file,'utf8'),ctx);
test('Workbench shows one opener per existing product and keeps product identity escaped',()=>{
 const html=ctx.productWorkbenchTable([{id:'existing-id',name:'<Machine>',sku:'SKU',source:{company:'Maker',model:'M1',sale_status:'active'}}]);
 assert.match(html,/existing-id/);assert.equal((html.match(/<button/g)||[]).length,1);assert.match(html,/data-workbench-detail="existing-id"/);assert.match(html,/&lt;Machine>/);assert.doesNotMatch(html,/<Machine>/);
});
test('No price or hidden source data is rendered by the workbench',()=>{
 const html=ctx.productWorkbenchTable([{id:'p',name:'P',source:{price:999456,secret:'private-source'}}]);
 assert.doesNotMatch(html,/999456|private-source/);assert.match(html,/Needs review/);
});
test('Empty shared catalog shows an honest empty state',()=>{
 assert.match(ctx.productWorkbenchTable([]),/No products match/);
});
test('list uses the same product opener for data editors and other permitted viewers',()=>{
 const row=[{id:'p',name:'P',source:{}}];
 for(const allowed of [true,false]){ctx.canEditRecords=()=>allowed;const html=ctx.productWorkbenchTable(row);assert.match(html,/data-workbench-detail="p"/);assert.doesNotMatch(html,/data-product-edit|data-product-review|data-workbench-stock/);}
});
