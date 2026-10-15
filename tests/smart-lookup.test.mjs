import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../smart-lookup.js',import.meta.url),'utf8');
const ctx=vm.createContext({HTMLSelectElement:function(){},document:{addEventListener(){},documentElement:{}},MutationObserver:function(){this.observe=()=>{}},requestAnimationFrame(){}});
ctx.HTMLSelectElement.prototype=Object.create(null,{value:{get(){return ''},set(){},configurable:true,enumerable:true}});
vm.runInContext(source,ctx);
const items=['Muhimbili National Hospital · Dar es Salaam','Aga Khan Hospital · Mwanza','Hospital Supplies Ltd','Baby incubator · YP-90A'].map(label=>({value:label,label,search:ctx.lookupNormal(label)}));
test('every typed word must appear, in any order',()=>{
 assert.deepEqual([...ctx.lookupRank(items,'mwanza hospital').rows].map(r=>r.label),['Aga Khan Hospital · Mwanza']);
 assert.equal(ctx.lookupRank(items,'incubator baby').total,1);
});
test('names starting with the typed text come first',()=>{
 assert.equal(ctx.lookupRank(items,'hospital').rows[0].label,'Hospital Supplies Ltd');
});
test('case and punctuation do not matter',()=>{
 assert.equal(ctx.lookupRank(items,'YP90').total,0);
 assert.equal(ctx.lookupRank(items,'yp 90a').total,1);
 assert.equal(ctx.lookupRank(items,'MUHIMBILI').total,1);
});
test('internal record IDs are not shown',()=>{
 assert.equal(ctx.lookupTidy('Autoclave 50L · Acme · Specification needs review · 0d3f2a1e-1111-4222-8333-444455556666'),'Autoclave 50L · Acme');
});
test('task results must say something',()=>{
 const tctx=vm.createContext({});vm.runInContext(readFileSync(new URL('../team-tasks.js',import.meta.url),'utf8').match(/function teamTaskResultProblem[\s\S]*?\n}\n/)[0],tctx);
 for(const bad of ['xxx','XXX XXX XXX','ok done','done','test test test','.....'])assert.ok(tctx.teamTaskResultProblem(bad),bad);
 for(const good of ['Called Nisha, wants 2 ultrasound quotes','Visited Muhimbili, no new needs today'])assert.equal(tctx.teamTaskResultProblem(good),'',good);
});
