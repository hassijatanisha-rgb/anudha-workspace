import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
test('service print failure cleans up temporary report and print styling',()=>{
 const classes=new Set();let removed=false;
 const card={insertAdjacentHTML(){},classList:{add:x=>classes.add(x),remove:x=>classes.delete(x)},querySelector:()=>({remove(){removed=true}})};
 const ctx=vm.createContext({CSS:{escape:x=>x},document:{querySelector:()=>card},window:{print(){throw Error('Printer unavailable')},addEventListener(){}}});
 vm.runInContext(fs.readFileSync('service-workflow.js','utf8'),ctx);
 vm.runInContext("serviceCase=()=>({id:'test'});servicePrintReport=()=>'<section>Report</section>'",ctx);
 assert.throws(()=>ctx.printServiceReport('test'),/Printer unavailable/);
 assert.equal(classes.size,0);assert.equal(removed,true);
});
