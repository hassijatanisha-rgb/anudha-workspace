import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const read=n=>readFileSync(new URL('../'+n,import.meta.url),'utf8');
function load(){const ctx=vm.createContext({Date,Math,Map,Set,Number,String,Object});vm.runInContext(read('reports.js'),ctx);return ctx;}
const H=3600000,now=Date.parse('2026-10-05T12:00:00Z'),at=h=>new Date(now-h*H).toISOString();
test('finished steps, average time, open, overdue, longest wait and delays per person, with department subtotals',()=>{
 const c=load(),r=c.reportWork({now,departments:new Map([['m','accounts'],['j','stores'],['n','stores']]),
  finished:[{assignee_user_id:'m',status:'done',created_at:at(30),closed_at:at(20)},{assignee_user_id:'m',status:'handed_on',created_at:at(10),closed_at:at(8)},{assignee_user_id:'m',status:'cancelled',created_at:at(10),closed_at:at(1)},{assignee_user_id:'j',status:'done',created_at:at(5),closed_at:at(1)}],
  open:[{id:'o1',assignee_user_id:'j',created_at:at(60)},{id:'o2',assignee_user_id:'j',created_at:at(2)},{id:'o3',assignee_user_id:'n',created_at:at(1)}],
  delays:[{assignee_user_id:'j'},{assignee_user_id:'j'},{assignee_user_id:undefined}],overdue:row=>row.id==='o1'});
 const p=Object.fromEntries([...r.people].map(x=>[x.actor,x]));
 assert.equal(p.m.finished,2,'cancelled steps are not counted');assert.equal(p.m.avgMs/H,6);assert.equal(p.m.open_now,0);
 assert.equal(p.j.finished,1);assert.equal(p.j.open_now,2);assert.equal(p.j.overdue_now,1);assert.equal(p.j.longestMs/H,60);assert.equal(p.j.delays,2);
 const d=Object.fromEntries([...r.departments].map(x=>[x.department,x]));
 assert.equal(d.stores.people,2);assert.equal(d.stores.open_now,3);assert.equal(d.stores.overdue_now,1);assert.equal(d.stores.longestMs/H,60);assert.equal(d.accounts.finished,2);
 assert.deepEqual([...r.departments].map(x=>x.department),['accounts','stores'],'fixed department order');
});
test('hours read naturally and the report is the default tab with a subtotal-safe total',()=>{
 const c=load();assert.equal(c.reportHours(null),'—');assert.equal(c.reportHours(6*H),'6.0 h');assert.equal(c.reportHours(72*H),'3.0 days');
 const src=read('reports.js');assert.match(src,/let reportTab='work'/);assert.match(src,/filter\(row=>!row\._subtotal\)/);assert.match(src,/work-by-person/);
 assert.match(read('employee-login.js'),/set_staff_department/);
});
