import {workspacePageHeader} from './helpers/page-header.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../reports.js',import.meta.url),'utf8'),plain=value=>JSON.parse(JSON.stringify(value));
const work=[{actor:'a',department:'stores',finished:2,stepMs:21600000,open_now:2,overdue_now:1,longestMs:172800000,delays:3},{actor:'b',department:'stores',finished:1,stepMs:10800000,open_now:0,overdue_now:0,longestMs:null,delays:0}];
function fixture(data=work){
 const calls=[],renders=[],content={innerHTML:''},form={elements:{report:{},period:{}}};
 const ctx=vm.createContext({workspacePageHeader,Date,me:{user_id:'owner',role:'owner'},view:'reports',employeeName:id=>({a:'Zoe',b:'Amy'}[id]||id),syncWorkspaceNavigation(){},esc:value=>String(value??''),$:selector=>selector==='#reportPeriod'?form:selector==='#reportCsv'?null:content,
  client:{rpc:async(name,args)=>{calls.push({name,args});return {data}},from(){throw Error('Raw records must not be requested')}},listsLoaded:false,loadLists(){throw Error('Shared lists must not be requested')}});
 vm.runInContext('function workspaceSkeleton(kind,label)'+readFileSync(new URL('../workspace-refresh.js',import.meta.url),'utf8').split('function workspaceSkeleton(kind,label)')[1].split('function workspaceLoading')[0],ctx);vm.runInContext(source,ctx);const render=ctx.renderReports;ctx.renderReports=(range,error)=>renders.push({range,error});vm.runInContext("reportPeriod='custom';reportFrom='2026-10-01';reportTo='2026-10-31'",ctx);
 return {ctx,calls,renders,form,render,rows:()=>plain(vm.runInContext('reportRows',ctx))};
}
test('work summary preserves people, weighted department averages and formatted output in one request',async()=>{
 const f=fixture();await f.ctx.reportsWorkspace();assert.equal(f.calls.length,1);assert.equal(f.calls[0].name,'report_work_summary');
 assert.deepEqual(plain(f.calls[0].args),{p_since:new Date('2026-10-01T00:00:00').toISOString(),p_until:new Date('2026-11-01T00:00:00').toISOString(),p_now:f.calls[0].args.p_now,p_today:f.ctx.reportIsoDate(new Date(f.calls[0].args.p_now))});
 assert.deepEqual(f.rows(),[{employee:'Zoe',department:'Stores & delivery',finished:2,avg:'3.0 h',open_now:2,overdue_now:1,longest:'2.0 days',delays:3},{employee:'Amy',department:'Stores & delivery',finished:1,avg:'3.0 h',open_now:0,overdue_now:0,longest:'—',delays:0},{_subtotal:true,employee:'All Stores & delivery (2)',department:'Stores & delivery',finished:3,avg:'3.0 h',open_now:2,overdue_now:1,longest:'2.0 days',delays:3}]);
 assert.equal(f.renders[0].error,undefined);
});
test('activity summary retains every column, totals and name order on ties',async()=>{
 const f=fixture([]),keys=vm.runInContext('reportActivityColumns.map(([key])=>key)',f.ctx),zero=Object.fromEntries(keys.map(key=>[key,0]));
 f.ctx.client.rpc=async(name,args)=>{f.calls.push({name,args});return {data:[{actor:'a',...zero,inquiries:2},{actor:'b',...zero,stepsDone:2}]}};
 vm.runInContext("reportTab='activity'",f.ctx);await f.ctx.reportsWorkspace();assert.equal(f.calls.length,1);assert.equal(f.calls[0].name,'report_activity_summary');assert.deepEqual(Object.keys(f.calls[0].args).sort(),['p_since','p_until']);
 assert.deepEqual(f.rows().map(row=>[row.actor,row.employee,row.total]),[['b','Amy',2],['a','Zoe',2]]);assert.equal(f.rows()[0].pendingFulfilled,0);
});
test('invalid or incomplete summaries fail visibly without rendering invented zero totals',async()=>{
 for(const data of [null,{},[{...work[0],finished:'2'}],[{...work[0],open_now:-1}],[{...work[0],delays:Number.MAX_SAFE_INTEGER+1}],[{...work[0],stepMs:null}],[{...work[0],longestMs:undefined}],[{...work[0],actor:undefined}]]){
  const f=fixture(data);await f.ctx.reportsWorkspace();assert.match(f.renders[0].error,/summary is incomplete/);assert.deepEqual(f.rows(),[]);
 }
 const f=fixture();f.ctx.client.rpc=async()=>({error:{message:'Report access denied'}});await f.ctx.reportsWorkspace();assert.equal(f.renders[0].error,'Report access denied');
});
test('late summaries and errors cannot publish after actor, session, route or report changes',async()=>{
 for(const mutate of [f=>{f.ctx.me={user_id:'other'}},f=>{f.ctx.me={...f.ctx.me}},f=>{f.ctx.view='dashboard'},f=>f.ctx.clearReports()]){
  for(const rejected of [false,true]){
   const f=fixture();let resolve;f.ctx.client.rpc=()=>new Promise(done=>{resolve=done});const pending=f.ctx.reportsWorkspace();mutate(f);resolve(rejected?{error:{message:'late error'}}:{data:work});await pending;assert.equal(f.renders.length,0);assert.deepEqual(f.rows(),[]);
  }
 }
 const f=fixture();let resolve;f.ctx.client.rpc=()=>new Promise(done=>{resolve=done});const first=f.ctx.reportsWorkspace();f.ctx.client.rpc=async()=>({data:[]});await f.ctx.reportsWorkspace();resolve({data:work});await first;assert.equal(f.renders.length,1);assert.deepEqual(f.rows(),[]);
});
test('empty summaries stay empty, and null open-work assignees retain the legacy no-department group',async()=>{
 const f=fixture([]);await f.ctx.reportsWorkspace();assert.deepEqual(f.rows(),[]);assert.equal(f.renders[0].error,undefined);
 assert.deepEqual(plain(f.ctx.reportWorkTotals([{...work[0],actor:null,department:''}])).people[0].actor,null);
});
test('changing report or choosing custom dates invalidates a retained in-flight report immediately',async()=>{
 for(const field of ['report','period']){
  const f=fixture();f.render(null);let resolve;f.ctx.client.rpc=()=>new Promise(done=>{resolve=done});const pending=f.ctx.reportsWorkspace();
  vm.runInContext("reportFrom='';reportTo=''",f.ctx);f.form.elements[field].onchange({target:{value:field==='report'?'activity':'custom'}});
  assert.equal(f.renders.length,1);resolve({data:work});await pending;assert.equal(f.renders.length,1);assert.deepEqual(f.rows(),[]);
 }
});
