import {installPageHeader} from './helpers/page-header.mjs';
import {statusTone} from './helpers/status-ui.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const read=file=>readFileSync(new URL('../'+file,import.meta.url),'utf8'),deferred=()=>{let resolve,reject;const promise=new Promise((ok,bad)=>{resolve=ok;reject=bad});return {promise,resolve,reject}};
const row=n=>({id:'case-'+n,case_number:'INS-'+n,case_type:'installation',status:'new',version:1,organization_id:'clinic',product_id:'machine',created_at:'2026-10-01T08:00:00Z',updated_at:'2026-10-01T08:00:00Z',assigned_user_id:null,scheduled_for:null,display:{product_name:'Reviewed <machine>',organization_name:'Clinic <site>',organization_location:'Ward',serial_number:'SERIAL'},latest_event:{id:'event-'+n,to_status:'new',actor_user_id:'engineer',created_at:'2026-10-01T08:00:00Z'},report_summary:{actual_work_date:'2026-10-01',next_maintenance_date:'2027-01-01'},coordinator:{status:'open',assignee_user_id:'engineer',assigned_by:'owner',task:'Arrange <visit>',created_at:'2026-10-01T08:00:00Z',due_on:'2026-10-03'},coordinator_delay:{reason:'Waiting <parts>',expected_on:'2026-11-01'},page_summary:true});
const snapshot=(page=0,type='installation')=>({rows:Array.from({length:50},(_,i)=>({...row(page*50+i),case_type:type})),page,pages:200,total:10000,metrics:{awaiting_engineer:9999,awaiting_date:9998,oldest_engineer_days:100,oldest_date_days:90,due_30:10,overdue:5}});
function fixture(){
 const calls=[],loads=[],content={innerHTML:''},controls=new Map(),document={querySelectorAll(selector){if(selector!=='[data-service-card]')return [];return [...content.innerHTML.matchAll(/<article[^>]*data-service-card="([^"]+)"[^>]*>([\s\S]*?)<\/article>/g)].map(match=>({dataset:{serviceCard:match[1]},querySelector:selector=>selector==='[data-work-handoff]'&&match[2].includes('data-work-handoff')?{}:null,querySelectorAll:()=>[]}));},querySelector:()=>null};
 const c=vm.createContext({statusTone,me:{user_id:'owner',role:'owner'},view:'service',document,window:{},CSS:{escape:String},
  esc:value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;'),employeeName:id=>id,inventoryProduct:()=>({name:'Full machine'}),orgIndex:new Map([['clinic',{name:'Clinic'}]]),organizations:[],contacts:[],products:[{id:'shared',name:'Keep full shared product'}],inventoryOption:()=>'',
  listsLoaded:false,listsLoading:null,loadLists:async()=>{loads.push('lists');c.listsLoaded=true;return true;},
  all:async table=>{loads.push(table);if(c.fullError)throw Error(c.fullError);return table==='service_cases'?[row(0),{...row(9999),page_summary:undefined}]:[];},
  client:{rpc:async(name,args)=>{calls.push({name,args});return {data:snapshot(args.p_page,args.p_case_type)};},from:table=>{loads.push(table);return {select(){return this},order:async()=>({data:[]})};}},
  $:selector=>{if(selector==='#content')return content;if(!content.innerHTML.includes('id="'+selector.slice(1)+'"'))return null;if(!controls.has(selector))controls.set(selector,{addEventListener(event,callback){this[event]=callback}});return controls.get(selector)},
  syncWorkspaceNavigation(){},workspaceLoading:text=>{content.innerHTML='Loading: '+text;},run:fn=>fn(),message(){},crypto:{randomUUID:()=> 'request'}
 });
 installPageHeader(c);
 for(const file of ['business-date.js','service-domain.js','work-assignments.js','service-workflow.js'])vm.runInContext(read(file),c);
 const get=code=>vm.runInContext(code,c);return {c,calls,loads,content,controls,get};
}
test('cold Service is one bounded read, with full-scope metrics and no shared/history/form hydration',async()=>{
 const f=fixture();await f.c.serviceWorkspace();
 assert.deepEqual(f.calls.map(call=>call.name),['service_case_page']);assert.equal(f.loads.length,0);assert.equal(f.get('serviceCases.length'),0);assert.equal(f.get('serviceLoaded'),false);assert.equal(f.c.products[0].id,'shared');
 assert.equal((f.content.innerHTML.match(/data-service-card=/g)||[]).length,50);assert.equal((f.content.innerHTML.match(/data-work-handoff/g)||[]).length,50);assert.ok((f.content.innerHTML.match(/<[a-z][^>]*>/g)||[]).length<2000);
 assert.match(f.content.innerHTML,/9999/);assert.match(f.content.innerHTML,/10000 jobs/);assert.match(f.content.innerHTML,/Page 1 of 200/);assert.match(f.content.innerHTML,/Reviewed &lt;machine>/);assert.doesNotMatch(f.content.innerHTML,/Waiting &lt;parts>|<select|<form|workflow-history|service-progress|data-service-action=/);
 assert.equal(f.c.workRecordCards().length,0,'bounded coordinator summaries prevent eager handoff history reads');
 await f.c.serviceWorkspace();assert.equal(f.calls.length,1,'warm page reuse');
});
test('service summaries and details share the same status meaning and retain readable labels',()=>{
 const f=fixture();
 for(const [status,tone] of Object.entries({new:'neutral',assigned:'info',scheduled:'info',on_site:'info',report_required:'warning',completed:'success',cancelled:'neutral'})){
  const record={...row(0),status};
  for(const html of [f.c.serviceSummaryCard(record),f.c.serviceCaseCard(record)]){
   assert.match(html,new RegExp('chip--'+tone+'"'));assert.ok(html.includes(f.c.serviceStatusLabel(status)));
  }
 }
});
test('Service summaries keep identity, customer, status and work date with one open action',async()=>{
 const f=fixture(),page=snapshot();page.rows=page.rows.map(item=>({...item,problem_summary:'Long job instructions '.repeat(2000),coordinator:{...item.coordinator,task:'Long coordination instructions '.repeat(2000)},coordinator_delay:{...item.coordinator_delay,reason:'Long delay explanation '.repeat(2000)}}));f.c.client.rpc=async()=>({data:page});await f.c.serviceWorkspace();
 assert.ok(f.content.innerHTML.replace(/<[^>]*>/g,' ').trim().split(/\s+/).length<3000);assert.doesNotMatch(f.content.innerHTML,/Long job|Long coordination|Long delay|Next step:|Engineer:|Serial:|Latest:|Next maintenance/);
 const item={...row(0),scheduled_for:'2026-11-02',display:{...row(0).display,customer_name:'Customer <clinic>'}},html=f.c.serviceSummaryCard(item);assert.match(html,/INS-0/);assert.match(html,/Reviewed &lt;machine>/);assert.match(html,/Customer &lt;clinic>/);assert.ok(html.includes(f.c.serviceStatusLabel(item.status)));assert.match(html,/Work date: 2026-11-02/);assert.doesNotMatch(html,/Clinic &lt;site>|SERIAL|Arrange &lt;visit>/);assert.equal((html.match(/<button/g)||[]).length,1);assert.match(html,/data-service-open="case-0"/);
 const detail=f.c.serviceCaseCard(item);assert.match(detail,/Next step:/);assert.match(detail,/Assigned engineer/);assert.match(detail,/Serial number/);assert.match(detail,/workflow-history/);assert.match(detail,/Work date/);
});
test('document attachments remain in the full job instead of adding a second summary action',async()=>{
 const f=fixture();await f.c.serviceWorkspace();f.c.openDocumentAttachments=()=>{};f.c.document.createElement=()=>({dataset:{}});f.get('decorateWorkHandoffs=async()=>{}');
 const card=summary=>{const added=[],actions={querySelector:()=>null,append:button=>added.push(button)};return {added,dataset:{serviceCard:'case-0'},querySelector:selector=>selector==='[data-service-open]'?summary?{}:null:selector==='.actions'?actions:null,querySelectorAll:()=>[]};},summary=card(true),detail=card(false);
 f.c.bindServiceCaseCards([summary,detail]);assert.equal(summary.added.length,0);assert.equal(detail.added.length,1);assert.equal(detail.added[0].dataset.documentFiles,'case-0');
});
test('pagination, type selection, forced refresh and static forms retain bounded reads',async()=>{
 const f=fixture();await f.c.serviceWorkspace();f.get('servicePage=1');await f.c.serviceWorkspace();assert.equal(f.calls[1].args.p_page,1);assert.match(f.content.innerHTML,/Page 2 of 200/);
 f.get("serviceSection='schedule';servicePage=0");await f.c.serviceWorkspace();assert.equal(f.calls[2].args.p_case_type,'service');await f.c.serviceWorkspace(true);assert.equal(f.calls.length,4);
 f.get("serviceSection='forms'");await f.c.serviceWorkspace(true);assert.equal(f.calls.length,4);assert.equal(f.loads.length,0);assert.match(f.content.innerHTML,/Open blank official PDF/);
});
test('explicit job opening hydrates complete caches while retaining the independent bounded page',async()=>{
 const f=fixture();await f.c.serviceWorkspace();const page=f.get('servicePageData');f.get('bindServiceWorkflow=()=>{}');await f.c.openServiceJob('case-0');
 assert.deepEqual(f.loads,['lists','equipment_assets','service_cases','service_case_events','service_reports','service_report_accessories','service_training_attendees','staff']);assert.equal(f.get('serviceCases.length'),2);assert.equal(f.get('servicePageData'),page);assert.equal(f.get('serviceSelectedId'),'case-0');assert.match(f.content.innerHTML,/workflow-history/);assert.equal((f.content.innerHTML.match(/service-progress/g)||[]).length,1);assert.equal(f.c.products[0].id,'shared');
});
test('intake alone opens the complete form and failed shared or full prerequisites fail closed',async()=>{
 const f=fixture();await f.c.serviceWorkspace();f.get('bindServiceWorkflow=()=>{}');await f.c.openServiceJob('',true);assert.match(f.content.innerHTML,/<details class="card" open>/);assert.match(f.content.innerHTML,/id="newServiceCase"/);
 for(const failure of ['lists','history']){const broken=fixture();await broken.c.serviceWorkspace();broken.get('bindServiceWorkflow=()=>{}');if(failure==='lists')broken.c.loadLists=async()=>false;else broken.c.fullError='History <offline>';await broken.c.openServiceJob('case-0');assert.equal(broken.get('serviceSelectedId'),'');assert.equal(broken.get('serviceIntakeOpen'),false);assert.match(broken.content.innerHTML,/Service could not load/);assert.doesNotMatch(broken.content.innerHTML,/data-service-action=/);if(failure==='lists')assert.equal(broken.loads.length,0);else assert.match(broken.content.innerHTML,/History &lt;offline>/);}
});
test('same-id actor replacement clears complete context and late page responses cannot overwrite new data',async()=>{
 const f=fixture();await f.c.serviceWorkspace();f.get("serviceCases=[{id:'private'}];serviceLoaded=true;serviceSelectedId='private';serviceIntakeOpen=true");const old=deferred();f.c.client.rpc=()=>old.promise;const pending=f.c.serviceWorkspace(true);f.c.me={user_id:'owner',role:'staff'};f.c.client.rpc=async()=>({data:snapshot(2)});await f.c.serviceWorkspace();const html=f.content.innerHTML;
 old.resolve({data:snapshot(0)});await pending;assert.equal(f.content.innerHTML,html);assert.equal(f.get('serviceSelectedId'),'');assert.equal(f.get('serviceIntakeOpen'),false);assert.equal(f.get('serviceCases.length'),0);assert.equal(f.get('servicePageData.page'),2);
});
test('newer page wins against a late success or late error and leaving Service prevents late rendering',async()=>{
 for(const fail of [false,true]){const f=fixture(),old=deferred();f.c.client.rpc=()=>old.promise;const pending=f.c.serviceWorkspace();f.get('servicePage=1');f.c.client.rpc=async()=>({data:snapshot(1)});await f.c.serviceWorkspace();const html=f.content.innerHTML;if(fail)old.reject(Error('Old error'));else old.resolve({data:snapshot(0)});await pending;assert.equal(f.content.innerHTML,html);assert.equal(f.get('servicePageData.page'),1);}
 const f=fixture(),old=deferred();f.c.client.rpc=()=>old.promise;const pending=f.c.serviceWorkspace();f.c.view='reports';f.content.innerHTML='Reports';old.resolve({data:snapshot()});await pending;assert.equal(f.content.innerHTML,'Reports');assert.equal(f.get('servicePageData'),null);
});
test('late full-context load cannot expose a previous actor or replace a newer view',async()=>{
 for(const change of ['actor','section','view']){const f=fixture();await f.c.serviceWorkspace();const pending=deferred();f.c.loadLists=()=>pending.promise;const opening=f.c.openServiceJob('case-0');if(change==='actor')f.c.me={user_id:'owner',role:'staff'};else if(change==='section')f.get("serviceSection='forms'");else f.c.view='reports';f.content.innerHTML='New workspace';f.c.listsLoaded=true;pending.resolve(true);await opening;assert.equal(f.content.innerHTML,'New workspace');assert.equal(f.loads.length,0);assert.equal(f.get('serviceSelectedId'),'');}
});
test('page failure and oversized response expose no stale jobs and retry performs only the bounded read',async()=>{
 const f=fixture();await f.c.serviceWorkspace();f.c.client.rpc=async()=>({error:{message:'Page <offline>'}});await f.c.serviceWorkspace(true);assert.match(f.content.innerHTML,/Page &lt;offline>/);assert.equal(f.get('servicePageData'),null);assert.doesNotMatch(f.content.innerHTML,/data-service-card=/);
 const oversized=snapshot();oversized.rows.push(row(50));f.c.client.rpc=async()=>({data:oversized});await f.c.serviceWorkspace(true);assert.match(f.content.innerHTML,/could not be confirmed/);assert.equal(f.loads.length,0);
});

test('late responses and clicks from a previous actor cannot reopen its Service page',async()=>{
 const f=fixture(),old=deferred();f.c.client.rpc=()=>old.promise;const pending=f.c.serviceWorkspace();f.c.me={user_id:'owner',role:'staff'};f.c.client.rpc=async()=>({data:snapshot(1)});await f.c.serviceWorkspace();const html=f.content.innerHTML;old.resolve({data:snapshot()});await pending;assert.equal(f.content.innerHTML,html);assert.equal(f.get('servicePageData.page'),1);
 f.c.view='reports';f.content.innerHTML='Reports';await f.c.openServiceJob('case-0');assert.equal(f.content.innerHTML,'Reports');assert.equal(f.loads.length,0);
});
test('late complete-table responses cannot overwrite the replacement actor cache',async()=>{
 const f=fixture();await f.c.serviceWorkspace();f.c.listsLoaded=true;const old=deferred();f.c.all=()=>old.promise;const opening=f.c.openServiceJob('case-0');f.c.me={user_id:'owner',role:'staff'};await f.c.serviceWorkspace();const html=f.content.innerHTML;old.resolve([row(0)]);await opening;assert.equal(f.content.innerHTML,html);assert.equal(f.get('serviceCases.length'),0);assert.equal(f.get('serviceLoaded'),false);
});
