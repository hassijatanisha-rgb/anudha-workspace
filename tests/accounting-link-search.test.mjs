import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const context=vm.createContext({});
vm.runInContext(readFileSync(new URL('../accounting-workspace.js',import.meta.url),'utf8'),context);
const records=Array.from({length:120},(_,i)=>({id:`org-${i}`,name:`Hospital ${i}`,location:i===75?'Dar es Salaam':'Arusha'}));
test('Customer search matches name and branch without case sensitivity',()=>{
 const result=context.accountingSearchLinks(records,' DAR ES ','', 'organization');
 assert.equal(result.matches,1);assert.equal(result.rows[0].id,'org-75');
});
test('Large result lists are capped while the saved selection stays available',()=>{
 const result=context.accountingSearchLinks(records,'','org-119','organization');
 assert.equal(result.matches,120);assert.equal(result.rows.length,51);
 assert.equal(result.rows[0].id,'org-119');
});
test('An unmatched search preserves the selected link without counting it as a match',()=>{
 const result=context.accountingSearchLinks(records,'No such branch','org-8','organization');
 assert.equal(result.matches,0);assert.equal(result.rows.length,1);assert.equal(result.rows[0].id,'org-8');
});
test('Contact lookup supports specific person and excludes deleted records',()=>{
 const contacts=[{id:'1',first_name:'Asha',last_name:'Ali',email:'asha@example.test'},{id:'2',first_name:'Asha',deleted_at:'2026-09-01'}];
 assert.equal(context.accountingSearchLinks(contacts,'ali','','contact').rows[0].id,'1');
 assert.equal(context.accountingSearchLinks(contacts,'example.test','','contact').matches,1);
 assert.equal(context.accountingSearchLinks(contacts,'asha','','contact').matches,1);
});
