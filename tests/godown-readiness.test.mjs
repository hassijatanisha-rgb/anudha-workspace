import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const c=vm.createContext({});vm.runInContext(readFileSync(new URL('../tally-stock-review.js',import.meta.url),'utf8'),c);
test('all eight godowns get independent reconciliation counts, not quantity sums',()=>{
 const rows=Array.from({length:8},(_,i)=>({id:String(i),godown:'Godown '+i,quantity:i===0?-3:5}));
 const before=JSON.stringify(rows);
 const result=c.tallyGodownReadiness(rows,r=>({product:r.id==='0'?null:{id:'p'},result:{issues:r.id==='0'?['Missing product']:[]}}));
 assert.equal(result.length,8);assert.equal(result[0].blocked,1);assert.equal(result[0].unmapped,1);assert.equal(result[0].negative,1);
 assert.equal(result[1].checked,1);assert.equal(result[1].total,1);assert.equal('pieces' in result[1],false);assert.equal(JSON.stringify(rows),before);
});
test('saved but incomplete reviews stay blocked and blank godowns never appear ready',()=>{
 const rows=[{id:'a',godown:'',quantity:0},{id:'b',godown:'A',quantity:2},{id:'c',godown:'A',quantity:3}];
 const result=c.tallyGodownReadiness(rows,r=>({product:{id:'p'},correction:{pieces:2},result:{issues:r.id==='b'?['Missing batch']:[]}}));
 assert.equal(result[0].blocked,1);assert.equal(result[0].checked,0);
 assert.equal(result[1].blocked,1);assert.equal(result[1].checked,1);assert.equal(result[1].total,2);
 assert.equal(c.tallyGodownReadiness([],()=>{throw Error('not called');}).length,0);
});
