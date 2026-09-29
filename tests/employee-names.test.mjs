import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import vm from 'node:vm';
const path=new URL('../employee-names.js',import.meta.url),code=existsSync(path)?readFileSync(path,'utf8'):'';
function fixture(rpc){const c=vm.createContext({me:{user_id:'owner'},client:{rpc}});vm.runInContext(code,c);return c;}
test('names replace identifiers and missing names never expose IDs',async()=>{
 const c=fixture(async()=>({data:{items:[{user_id:'staff-uuid',display_name:'Fatima',name_version:1}],next_after_id:null}}));
 await c.loadEmployeeNames();assert.equal(c.employeeName('staff-uuid'),'Fatima');assert.equal(c.employeeName('unknown-uuid'),'Employee name not set');assert.equal(c.employeeName('owner'),'You');assert.equal(c.employeeName(null),'Unassigned');
});
test('account change discards pending names and clears old directory',async()=>{
 let complete;const c=fixture(()=>new Promise(r=>complete=r));const pending=c.loadEmployeeNames();c.me={user_id:'other'};c.clearEmployeeNames();complete({data:{items:[{user_id:'staff-uuid',display_name:'Private old name'}],next_after_id:null}});assert.equal(await pending,false);assert.equal(c.employeeName('staff-uuid'),'Employee name not set');
});
test('paginated directory and failures fail closed',async()=>{
 let call=0;const c=fixture(async()=>{call++;return call===1?{data:{items:[{user_id:'a',display_name:'Nisha'}],next_after_id:'a'}}:{data:{items:[{user_id:'b',display_name:'Francis'}],next_after_id:null}};});
 assert.equal(await c.loadEmployeeNames(),true);assert.equal(c.employeeName('b'),'Francis');c.client.rpc=async()=>({error:{message:'offline'}});assert.equal(await c.loadEmployeeNames(),false);assert.equal(c.employeeName('b'),'Employee name not set');
});
test('owner saves name against the looked-up account version without changing access',async()=>{
 const calls=[];const c=fixture(async(name,args)=>{calls.push([name,args]);return {data:name==='lookup_staff_display_name'?{user_id:'person',name_version:4}:{}};});c.me.role='owner';
 await c.saveEmployeeNameByEmail('person@example.invalid','Fatima');assert.equal(calls[1][0],'set_staff_display_name');assert.equal(calls[1][1].p_user_id,'person');assert.equal(calls[1][1].p_expected_version,4);assert.equal(calls[1][1].p_display_name,'Fatima');
 c.me.role='staff';await assert.rejects(c.saveEmployeeNameByEmail('person@example.invalid','Other'),/owner/);assert.equal(calls.length,2);
});
