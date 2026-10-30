import {workspacePageHeader} from './helpers/page-header.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const read=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8');
function fixture(length=0){
 const calls=[],rows=Array.from({length},(_,id)=>({id:String(id)}));
 const ctx=vm.createContext({workspacePageHeader,view:'reports',me:{user_id:'owner',role:'owner'},employeeName:id=>id,syncWorkspaceNavigation(){},$:()=>({innerHTML:''}),listsLoaded:false,listsLoading:null,orgIndex:new Map(),
  client:{rpc:async name=>{calls.push({name});return {data:[]}},from:table=>{
   let start=0,end=999;const request={table,filters:[],orders:[]};
   const query={select:()=>query,gte:(...args)=>{request.filters.push(['gte',...args]);return query},lt:(...args)=>{request.filters.push(['lt',...args]);return query},eq:(...args)=>{request.filters.push(['eq',...args]);return query},order:key=>{request.orders.push(key);return query},range:(a,b)=>{start=a;end=b;return query},then:resolve=>{calls.push({...request,start,end});return Promise.resolve({data:rows.slice(start,end+1),count:rows.length}).then(resolve)}};return query;
  }}
 });
 vm.runInContext(read('app.js').split('\n').find(line=>line.startsWith('async function all(')),ctx);
 vm.runInContext('function workspaceSkeleton(kind,label)'+readFileSync(new URL('../workspace-refresh.js',import.meta.url),'utf8').split('function workspaceSkeleton(kind,label)')[1].split('function workspaceLoading')[0],ctx);vm.runInContext(read('reports.js'),ctx);ctx.renderReports=()=>{};
 return {ctx,calls};
}
test('work and activity each use one aggregate read without shared client or product lists',async()=>{
 const f=fixture();await f.ctx.reportsWorkspace();assert.equal(f.calls.length,1);
 assert.equal(f.calls[0].name,'report_work_summary');
 vm.runInContext("reportTab='activity'",f.ctx);await f.ctx.reportsWorkspace();assert.equal(f.calls.length,2);assert.equal(f.calls[1].name,'report_activity_summary');
});
test('a small report range reads one page and retains exact date and caller filters',async()=>{
 const f=fixture(25),result=await f.ctx.reportFetchRange('events','id','recorded_at','2026-10-01','2026-11-01',q=>q.eq('status','done'));
 assert.equal(result.length,25);assert.equal(f.calls.length,1);assert.deepEqual(f.calls[0].orders,['recorded_at','id']);
 assert.deepEqual(f.calls[0].filters,[['gte','recorded_at',new Date('2026-10-01T00:00:00').toISOString()],['lt','recorded_at',new Date('2026-11-01T00:00:00').toISOString()],['eq','status','done']]);
});
test('busy report ranges continue without missing or duplicating the first parallel batch',async()=>{
 const f=fixture(5500),rows=await f.ctx.reportFetchRange('events','id','created_at','2026-10-01','2026-11-01');
 assert.equal(rows.length,5500);assert.equal(new Set(rows.map(row=>row.id)).size,5500);assert.deepEqual(f.calls.map(call=>call.start),[0,1000,2000,3000,4000,5000,6000,7000,8000]);
});
test('the report safety ceiling fails visibly instead of silently clipping totals',async()=>{
 const f=fixture(50001);await assert.rejects(f.ctx.reportFetchRange('events','id','created_at','2026-10-01','2026-11-01'),/50,000 records/);
 assert.equal(f.calls.length,51);assert.equal(f.calls.at(-1).end,50999);
 const boundary=fixture(50000);assert.equal((await boundary.ctx.reportFetchRange('events','id','created_at','2026-10-01','2026-11-01')).length,50000);
});

test('the report dropdown now requests joined summary labels without hydrating shared lists',async()=>{
 const f=fixture(),events=[];f.ctx.companyDate=()=> '2026-10-29';f.ctx.loadLists=async()=>{throw Error('Unexpected shared lists')};f.ctx.renderReports=(_range,error)=>{assert.equal(error,undefined);events.push('render')};
 f.ctx.client.rpc=async(name,args)=>{f.calls.push({name,args});return {data:name==='report_work_summary'?[]:{kind:args.p_kind,total:0,page:0,pages:1,totals:args.p_kind==='deliveries'?{days:0}:{count:0,pieces_in:0,pieces_out:0,net:0},rows:[]}}};
 await f.ctx.reportsWorkspace();for(const tab of ['deliveries','movements']){vm.runInContext(`reportTab='${tab}'`,f.ctx);await f.ctx.reportsWorkspace();}
 assert.deepEqual(events,['render','render','render']);assert.deepEqual(f.calls.map(call=>call.name),['report_work_summary','report_period_page','report_period_page']);assert.equal(f.ctx.listsLoaded,false);
});
