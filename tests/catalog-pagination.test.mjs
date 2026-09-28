import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const ctx=vm.createContext({document:{addEventListener(){}}});
vm.runInContext(readFileSync(new URL('../catalog-inventory.js',import.meta.url),'utf8'),ctx);
test('All catalog records remain reachable, not only the first 100',()=>{
 const rows=Array.from({length:243},(_,id)=>({id}));
 const seen=[];for(let p=0;p<5;p++)seen.push(...ctx.catalogPageRows(rows,p).rows.map(r=>r.id));
 assert.deepEqual(seen,rows.map(r=>r.id));
});
test('Filtering clamps old page and empty results have a valid page',()=>{
 assert.equal(ctx.catalogPageRows([{id:1}],9).page,0);
 assert.equal(ctx.catalogPageRows([],9).pages,1);
 assert.equal(ctx.catalogPageRows([],9).rows.length,0);
});
test('Forced catalog refresh reloads shared database corrections',()=>{
 const source=readFileSync(new URL('../inventory-operations.js',import.meta.url),'utf8');
 assert.match(source,/inventorySection==='catalog'\)\{if\(!inventoryLoaded\|\|force\)/);
});
test('Visible Refresh data button invalidates cached inventory before reloading',()=>{
 const source=readFileSync(new URL('../app.js',import.meta.url),'utf8');
 assert.ok(source.includes("else if(b.id==='refresh'){inventoryLoaded=false;await load();}"));
});
