import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const load=()=>{const ctx=vm.createContext({orgIndex:new Map([['o',{name:'Aga Khan',location:'Dar'}]]),Date,Math});vm.runInContext(readFileSync(new URL('../travel.js',import.meta.url),'utf8'),ctx);return ctx;};
const h=n=>new Date(Date.UTC(2026,9,10,n)).toISOString();
test('trip length, place and state read plainly',()=>{
 const ctx=load();
 assert.equal(ctx.travelDuration(h(8),h(17)),'9 h');assert.equal(ctx.travelDuration(h(8),h(8+33)),'1 day 9 h');assert.equal(ctx.travelDuration(h(8),h(8+48)),'2 days');
 assert.equal(ctx.travelPlace({organization_id:'o'}),'Aga Khan · Dar');assert.equal(ctx.travelPlace({destination:'Dodoma'}),'Dodoma');
 const now=Date.parse(h(10));
 assert.equal(ctx.travelState({status:'approved',depart_at:h(8),return_at:h(17)},now)[1],'Away now');
 assert.equal(ctx.travelState({status:'requested',depart_at:h(8),return_at:h(17)},now)[1],'Waiting for approval');
});
test('filters: upcoming, waiting, mine and past',()=>{
 const ctx=load(),now=Date.parse(h(10));
 const rows=[{id:'a',status:'requested',created_by:'me',travellers:['me'],depart_at:h(20),return_at:h(22)},{id:'b',status:'approved',created_by:'x',travellers:['y'],depart_at:h(8),return_at:h(17)},{id:'c',status:'done',created_by:'x',travellers:['me'],depart_at:h(1),return_at:h(2)},{id:'d',status:'approved',created_by:'x',travellers:['y'],depart_at:h(1),return_at:h(2)}];
 const ids=f=>ctx.travelVisible(rows,f,'me',now).map(r=>r.id);
 assert.deepEqual(ids('upcoming'),['b','a']);assert.deepEqual(ids('waiting'),['a']);assert.deepEqual(ids('mine'),['c','a']);assert.deepEqual(ids('past'),['c','d']);
});
test('menu and router include Travel requests',()=>{
 assert.match(readFileSync(new URL('../workspace-navigation.js',import.meta.url),'utf8'),/\['Travel requests','travel'\]/);
 assert.match(readFileSync(new URL('../app.js',import.meta.url),'utf8'),/view==='travel'\)return travelWorkspace\(\)/);
});
test('travel report counts approved and finished trips per traveller',()=>{
 const ctx=vm.createContext({products:[],employeeName:id=>id,Date,Math,Number,String,Object,Map,Set});
 vm.runInContext(readFileSync(new URL('../reports.js',import.meta.url),'utf8'),ctx);
 const rows=ctx.reportTravel([{status:'approved',travellers:['a','b'],organization_id:'o',depart_at:h(0),return_at:h(36)},{status:'done',travellers:['a'],destination:'Dodoma',depart_at:h(0),return_at:h(12)},{status:'declined',travellers:['a'],depart_at:h(0),return_at:h(99)}]);
 assert.deepEqual({...rows[0]},{actor:'a',trips:2,days:2,places:2});assert.deepEqual({...rows[1]},{actor:'b',trips:1,days:1.5,places:1});
});

const travelContext=()=>{
 const esc=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
 let sequence=0;const ctx=vm.createContext({orgIndex:new Map([['o',{name:'Aga Khan',location:'Dar'}]]),Date,Math,Intl,Number,String,Object,Map,Set,esc,me:{user_id:'me',role:'staff'},crypto:{randomUUID:()=>`operation-${++sequence}`},employeeName:id=>id,salesOrganizationOptions:()=>'',employeeDirectory:new Map([['me',{user_id:'me',active:true}]])});
 vm.runInContext(readFileSync(new URL('../sales-domain.js',import.meta.url),'utf8'),ctx);
 vm.runInContext(readFileSync(new URL('../travel.js',import.meta.url),'utf8'),ctx);return ctx;
};
const fixtureStop={id:'stop-1',organization_id:'o',destination:'',contact_name:'Dr Mushi',appointment_purpose:'Install and train',appointment_at:'2026-11-01T10:00:00.000Z',preparation:'Review service history',resources:'Tools'};
const stopGroup=stop=>({dataset:{travelStop:stop.id},querySelectorAll:()=>Object.entries(stop).filter(([key])=>key!=='id').map(([key,value])=>({dataset:{stopField:key},value:value||''}))});
test('travel budgets use entered days and exact minor-unit rounding with separate transport costs',()=>{
 const ctx=travelContext();assert.deepEqual({...ctx.travelCosts('1.5',100000,30000,10000)},{perDiem:150000,total:190000});
 assert.deepEqual({...ctx.travelCosts('0.29',50,0,0)},{perDiem:15,total:15});assert.deepEqual({...ctx.travelCosts('0',0,0,0)},{perDiem:0,total:0});
 for(const days of ['-1','1.001','61','NaN','Infinity'])assert.throws(()=>ctx.travelCosts(days,1,0,0),/Allowance days/);
 assert.throws(()=>ctx.travelCosts('1',-1,0,0),/non-negative/);assert.throws(()=>ctx.travelCosts('1',1000000000001,0,0),/non-negative/);
});
test('travel itinerary serializes distinct stops and preserves their order and named preparation fields',()=>{
 const ctx=travelContext(),other={...fixtureStop,id:'stop-2',organization_id:null,destination:'Ministry of Health'};
 const result=ctx.travelReadStops({querySelectorAll:()=>[stopGroup(fixtureStop),stopGroup(other)]});
 assert.equal(result.length,2);assert.equal(result[0].preparation,'Review service history');assert.equal(result[1].organization_id,null);
 assert.equal(ctx.travelPlace({itinerary:result}),'Aga Khan · Dar → Ministry of Health');
 assert.throws(()=>ctx.travelReadStops({querySelectorAll:()=>[]}),/between 1 and 20/);
 assert.throws(()=>ctx.travelReadStops({querySelectorAll:()=>[stopGroup({...other,destination:''})]}),/Name the site/);
 assert.throws(()=>ctx.travelReadStops({querySelectorAll:()=>[stopGroup({...fixtureStop,appointment_at:'bad'})]}),/appointment time/);
});
test('travel cards escape itinerary and report content, retain metadata and show each visit outcome',()=>{
 const ctx=travelContext(),row={id:'trip',request_number:'TR-000001',version:4,status:'done',travellers:['me'],created_by:'me',depart_at:'2026-11-01T08:00:00Z',return_at:'2026-11-03T17:00:00Z',purposes:['installation','training'],itinerary:[{...fixtureStop,contact_name:'<img src=x onerror=alert(1)>'}],post_visit_report:'<script>bad()</script>',visit_outcomes:[{stop_id:fixtureStop.id,outcome:'Installed',follow_up:'Send quote',follow_up_on:'2026-11-04'}],per_diem_days:1.5,per_diem_rate_minor:100000,intercity_transport_minor:30000,local_transport_minor:10000};
 const html=ctx.travelCard(row);assert.match(html,/Standard ERP form/);assert.match(html,/ERP-TRAVEL-01/);assert.match(html,/revision 4/);assert.match(html,/Installation, Training/);assert.match(html,/Send quote/);assert.match(html,/1900\.00|1,900\.00/);assert.match(html,/&lt;script&gt;/);assert.match(html,/&lt;img/);assert.doesNotMatch(html,/<script>|<img/);
});
test('travel editor sends a structured plan and stable operation ID; changed login blocks submission',async()=>{
 const ctx=travelContext(),values={depart:'2026-11-01T08:00',return:'2026-11-03T17:00',perDiemDays:'1.5',perDiemRate:'1000.00',intercity:'300.00',local:'100.00',currency:'TZS',transport:'Car',notes:'Trip notes'};
 const elements=Object.fromEntries(Object.entries(values).map(([key,value])=>[key,{value}])),nodes={'#travelLength':{},'#travelCostTotal':{},'#travelAddStop':{},'#travelStops':{children:[{}]}};
 const groups=[stopGroup(fixtureStop),stopGroup({...fixtureStop,id:'stop-2',organization_id:null,destination:'Ministry of Health'})];
 const form={elements,querySelector:selector=>nodes[selector],querySelectorAll:selector=>selector==='[name="traveller"]:checked'?[{value:'me'}]:selector==='[name="purpose"]:checked'?[{value:'installation'},{value:'training'}]:selector==='[data-travel-stop]'?groups:[]};
 let submit,fields;const requests=[];ctx.actionForm=(title,html,callback)=>{fields=html;submit=callback;return form;};ctx.client={rpc:async(name,payload)=>{requests.push({name,payload});return {data:{request_number:'TR-1'}};}};ctx.travelWorkspace=async()=>{};ctx.message=()=>{};
 ctx.openTravelEditor(null);assert.match(fields,/type="checkbox" name="purpose"/);assert.match(fields,/all travellers combined/);assert.match(fields,/Standard ERP form/);
 await submit(values);await submit(values);
 assert.equal(requests[0].name,'save_travel_visit_plan');assert.equal(requests[0].payload.p_itinerary.length,2);assert.equal(requests[0].payload.p_intercity_transport_minor,30000);assert.equal(requests[0].payload.p_notes,'Trip notes');assert.equal(requests[0].payload.p_purposes.join(','),'installation,training');assert.equal(requests[0].payload.p_operation_id,requests[1].payload.p_operation_id);
 ctx.me={user_id:'other'};await assert.rejects(submit(values),/Login changed/);assert.equal(requests.length,2);
});
test('post-visit form submits report with separate per-stop outcomes and follow-up dates',async()=>{
 const ctx=travelContext(),groups=[{dataset:{travelOutcome:'stop-1'},querySelectorAll:()=>['outcome','follow_up','follow_up_on'].map((field,i)=>({dataset:{outcomeField:field},value:['Installed and trained','Send quote','2026-11-05'][i]}))}];
 let submit,fields,request;ctx.actionForm=(title,html,callback)=>{fields=html;submit=callback;return {querySelectorAll:()=>groups};};ctx.client={rpc:async(name,payload)=>{request={name,payload};return {data:{}};}};ctx.travelWorkspace=async()=>{};ctx.message=()=>{};
 ctx.openTravelAction({id:'trip',version:3,request_number:'TR-1',itinerary:[fixtureStop],depart_at:'2026-11-01T08:00:00Z',return_at:'2026-11-03T17:00:00Z'},'done');
 assert.match(fields,/Follow-up date/);await submit({note:'All planned visits completed.'});assert.equal(request.name,'advance_travel_visit');assert.equal(request.payload.p_expected_version,3);assert.equal(request.payload.p_note,'All planned visits completed.');assert.equal(request.payload.p_outcomes[0].follow_up_on,'2026-11-05');assert.equal(request.payload.p_outcomes[0].stop_id,'stop-1');
});

test('travel summary counts all distinct itinerary sites once per traveller',()=>{
 const ctx=vm.createContext({products:[],employeeName:id=>id,Date,Math,Number,String,Object,Map,Set});vm.runInContext(readFileSync(new URL('../reports.js',import.meta.url),'utf8'),ctx);
 const rows=ctx.reportTravel([{status:'approved',travellers:['a'],organization_id:'o',depart_at:h(0),return_at:h(24),itinerary:[{organization_id:'o'},{destination:'Dodoma'},{organization_id:'o'}]},{status:'done',travellers:['a'],destination:'Mwanza',depart_at:h(0),return_at:h(12)}]);
 assert.deepEqual({...rows[0]},{actor:'a',trips:2,days:1.5,places:3});
 assert.match(readFileSync(new URL('../reports.js',import.meta.url),'utf8'),/depart_at,return_at,itinerary/);
});
