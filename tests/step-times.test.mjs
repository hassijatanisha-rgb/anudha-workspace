import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
function load(){const ctx=vm.createContext({esc:s=>String(s??''),employeeName:id=>({a:'Mujtaba',b:'Jagroop'}[id]||id),Date,Math,Number,String,Map});vm.runInContext(readFileSync(new URL('../work-assignments.js',import.meta.url),'utf8'),ctx);return ctx;}
const H=3600000,now=Date.parse('2026-10-05T12:00:00Z'),ago=h=>new Date(now-h*H).toISOString();
test('durations read naturally',()=>{const c=load();assert.equal(c.workDuration(5*60000),'5 min');assert.equal(c.workDuration(30*H),'30 h');assert.equal(c.workDuration(50*H),'2 days 2 h');assert.equal(c.workDuration(72*H),'3 days');});
test('colour: over a day yellow, over two days red; an expected date or due date takes over',()=>{
 const c=load(),open=h=>({created_at:ago(h)});
 assert.equal(c.workAgeLevel(open(5),null,now,'2026-10-05'),'');assert.equal(c.workAgeLevel(open(30),null,now,'2026-10-05'),'yellow');assert.equal(c.workAgeLevel(open(49),null,now,'2026-10-05'),'red');
 assert.equal(c.workAgeLevel(open(100),{expected_on:'2026-10-07'},now,'2026-10-05'),'','late but a future expected date is on track');
 assert.equal(c.workAgeLevel(open(1),{expected_on:'2026-10-04'},now,'2026-10-05'),'red','expected date passed');
 assert.equal(c.workAgeLevel({created_at:ago(100),due_on:'2026-10-06'},null,now,'2026-10-05'),'');assert.equal(c.workAgeLevel({created_at:ago(1),due_on:'2026-10-04'},null,now,'2026-10-05'),'red');
 assert.equal(c.workAgeLevel(null,null,now),'');
});
test('timeline lists every holder in order with each step time and the total',()=>{
 const c=load(),t=c.workTimeline([
  {id:'2',assignee_user_id:'b',task:'Pack',status:'open',created_at:ago(10),closed_at:null},
  {id:'1',assignee_user_id:'a',task:'Invoice in Tally',status:'done',created_at:ago(34),closed_at:ago(10)}],now);
 assert.deepEqual([...t.steps].map(s=>[s.person,s.ms/H]),[['a',24],['b',10]]);assert.equal(t.totalMs/H,34);assert.equal(t.finished,false);
 const done=c.workTimeline([{id:'1',assignee_user_id:'a',task:'x',status:'done',created_at:ago(5),closed_at:ago(2)}],now);assert.equal(done.finished,true);assert.equal(done.totalMs/H,3,'finished records stop the clock');
 const empty=c.workTimeline([],now);assert.equal(empty.steps.length,0);assert.equal(empty.totalMs,0);assert.equal(empty.finished,false);
});
test('latest delay per step wins; card shows waiting, total, expected date and step times',()=>{
 const c=load(),latest=c.workLatestDelays([{assignment_id:'x',reason:'old',expected_on:'2026-10-06',recorded_at:'2026-10-01T00:00:00Z'},{assignment_id:'x',reason:'new',expected_on:'2026-10-09',recorded_at:'2026-10-03T00:00:00Z'}]);
 assert.equal(latest.get('x').reason,'new');
 const open={id:'o',assignee_user_id:'b',assigned_by:'a',task:'Pack PF-1',created_at:new Date(Date.now()-3*H).toISOString()},t=c.workTimeline([{...open,status:'open'},{id:'p',assignee_user_id:'a',task:'Invoice',status:'done',created_at:new Date(Date.now()-27*H).toISOString(),closed_at:new Date(Date.now()-3*H).toISOString()}]);
 const html=c.workResponsibleHtml(open,{expected_on:'2099-01-01',reason:'Waiting for stock'},t);
 assert.match(html,/With <strong>Jagroop<\/strong> · Pack PF-1 · waiting <strong>3 h<\/strong> · 27 h since the start · <strong>expected 2099-01-01<\/strong>: Waiting for stock/);
 assert.match(c.workTimelineHtml(t),/Step times · 2 steps.*Mujtaba.*24 h.*Jagroop.*3 h so far/s);
 assert.match(c.workResponsibleHtml(null,null,c.workTimeline([{id:'1',assignee_user_id:'a',task:'x',status:'done',created_at:new Date(Date.now()-5*H).toISOString(),closed_at:new Date(Date.now()-H).toISOString()}])),/finished · took 4 h in total/);
});
