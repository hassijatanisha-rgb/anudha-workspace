import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const c=vm.createContext({});vm.runInContext(readFileSync(new URL('../tally-stock-review.js',import.meta.url),'utf8'),c);
const locations=[{id:'one',name:'Warehouse One',active:true},{id:'off',name:'Closed',active:false}];
test('location check requires an exact source label and an active saved target',()=>{
 const reviews=[{source_godown:'A',version:1,location_id:'one'}];
 assert.equal(c.tallyGodownLocationStatus('A',reviews,locations).ready,true);
 assert.equal(c.tallyGodownLocationStatus('A',reviews,locations).label,'Warehouse One');
 assert.equal(c.tallyGodownLocationStatus('a',reviews,locations).ready,false);
 assert.equal(c.tallyGodownLocationStatus('',reviews,locations).ready,false);
});
test('newest unresolved or inactive mapping overrides older valid mapping',()=>{
 for(const target of [null,'off','missing']){
  const reviews=[{source_godown:'A',version:2,location_id:target},{source_godown:'A',version:1,location_id:'one'}];
  assert.equal(c.tallyGodownLocationStatus('A',reviews,locations).ready,false);
  assert.equal(c.tallyGodownLocationStatus('A',reviews,locations).version,2);
 }
});
test('unavailable mapping data fails closed and input history is not changed',()=>{
 const reviews=[{source_godown:'A',version:1,location_id:'one'},{source_godown:'A',version:2,location_id:null}];
 const before=JSON.stringify(reviews);
 assert.equal(c.tallyGodownLocationStatus('A',null,locations).ready,false);
 assert.equal(c.tallyGodownLocationStatus('A',reviews,null).ready,false);
 c.tallyGodownLocationStatus('A',reviews,locations);
 assert.equal(JSON.stringify(reviews),before);
});
