import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const c=vm.createContext({});vm.runInContext(readFileSync(new URL('../tally-stock-review.js',import.meta.url),'utf8'),c);
const rows=[{id:'1',godown:'City Printer',product_name:'Blood bags',quantity:-2,unit:'PCS'},
 {id:'2',godown:'City Printer 2',product_name:'Blood bags',quantity:10,unit:'BOX'},
 {id:'3',godown:'City Printer',product_name:'Reagent A',quantity:null,unit:''},
 {id:'4',godown:'',product_name:'Unknown location',quantity:0,unit:'PCS'}];
test('exact godown scope never combines similarly named warehouses',()=>{
 assert.equal(typeof c.tallyGodownReview,'function');
 const r=c.tallyGodownReview(rows,new Map(),'City Printer','');
 assert.deepEqual(Array.from(r.rows,x=>x.id),['1','3']);assert.equal(r.negative,1);assert.equal(r.missingQuantity,1);
});
test('search stays within godown and retains full godown review metrics',()=>{
 const r=c.tallyGodownReview(rows,new Map([['1',{pieces:0}]]),'City Printer','blood');
 assert.deepEqual(Array.from(r.rows,x=>x.id),['1']);assert.equal(r.total,2);assert.equal(r.reviewed,1);
 assert.equal(r.negative,1); // correction never erases original negative
});
test('all locations preserves blank label and does not mutate or total mixed units',()=>{
 const before=JSON.stringify(rows),r=c.tallyGodownReview(rows,new Map(),'','');
 assert.equal(r.total,4);assert.equal(r.godowns.length,3);assert.ok(r.godowns.includes(''));
 assert.equal(JSON.stringify(rows),before);assert.equal('quantityTotal' in r,false);
});
test('unknown godown and whitespace searches return truthful empty results',()=>{
 assert.equal(c.tallyGodownReview(rows,new Map(),'Missing','').total,0);
 assert.equal(c.tallyGodownReview(rows,new Map(),'City Printer','  REAGENT  ').rows[0].id,'3');
});
