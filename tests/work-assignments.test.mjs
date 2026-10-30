import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
function load(overrides={}){
 const ctx=vm.createContext({esc:s=>String(s??'').replace(/[&<>"']/g,c=>'&#'+c.charCodeAt(0)+';'),employeeName:id=>({a:'Asha',b:'Baraka'}[id]||'Employee name not set'),Date,Math,Number,String,...overrides});
 vm.runInContext(readFileSync(new URL('../work-assignments.js',import.meta.url),'utf8'),ctx);return ctx;
}
test('opening a Sales handoff or update refreshes its cached record after the editor leave guard',async()=>{
 let leave=false,renders=0;
 const ctx=load({view:'sales',salesLoaded:true,salesSection:'proformas',salesEditing:'draft',salesFocusedProforma:'original',salesFocusedDelivery:'',salesConfirmLeave:()=>leave,render:async()=>{renders++;}});
 await ctx.workOpenRecord({record_type:'delivery',record_id:'dn-1'});
 assert.equal(ctx.salesLoaded,true);assert.equal(ctx.salesEditing,'draft');assert.equal(ctx.salesFocusedProforma,'original');assert.equal(renders,0);
 leave=true;await ctx.workOpenRecord({record_type:'delivery',record_id:'dn-1'});
 assert.equal(ctx.salesLoaded,false);assert.equal(ctx.salesEditing,'');assert.equal(ctx.salesFocusedDelivery,'dn-1');assert.equal(renders,1);
 ctx.salesLoaded=true;await ctx.workOpenRecord({record_type:'proforma',record_id:'pf-1'});
 assert.equal(ctx.salesLoaded,false);assert.equal(ctx.salesFocusedProforma,'pf-1');assert.equal(ctx.salesFocusedDelivery,'');assert.equal(renders,2);
});
test('elapsed time reads in minutes, hours, then days',()=>{
 const ctx=load(),now=Date.parse('2026-09-30T12:00:00Z');
 assert.equal(ctx.workSince('2026-09-30T11:45:00Z',now),'15 min');
 assert.equal(ctx.workSince('2026-09-30T02:00:00Z',now),'10 h');
 assert.equal(ctx.workSince('2026-09-25T12:00:00Z',now),'5 days');
 assert.equal(ctx.workSince('2026-10-01T12:00:00Z',now),'0 min','clock skew never shows negative time');
});
test('only open handoffs past their due date are overdue',()=>{
 const ctx=load();
 assert.equal(ctx.workOverdue({status:'open',due_on:'2026-09-29'},'2026-09-30'),true);
 assert.equal(ctx.workOverdue({status:'open',due_on:'2026-09-30'},'2026-09-30'),false);
 assert.equal(ctx.workOverdue({status:'done',due_on:'2026-01-01'},'2026-09-30'),false);
 assert.equal(ctx.workOverdue({status:'open',due_on:null},'2026-09-30'),false);
});
test('responsible line names assignee, task and sender and escapes text',()=>{
 const ctx=load();
 assert.match(ctx.workResponsibleHtml(null),/unassigned/);
 const html=ctx.workResponsibleHtml({assignee_user_id:'a',assigned_by:'b',task:'<b>Pack</b>',due_on:null,created_at:new Date().toISOString(),status:'open'});
 assert.match(html,/Asha/);assert.match(html,/sent by Baraka/);assert.match(html,/&#60;b&#62;Pack/);assert.doesNotMatch(html,/<b>Pack/);
});
test('every workflow screen, the task list, sign-out and print are wired',()=>{
 const read=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8');
 for(const file of ['sales-delivery.js','service-workflow.js','pending-stock.js','purchasing.js'])assert.match(read(file),/typeof decorateWorkHandoffs==='function'\)decorateWorkHandoffs\(\)\.catch/,file);
 assert.match(read('team-tasks.js'),/renderMyHandoffs\(steps\)/);assert.match(read('personal-workspace.js'),/personalSection==='task'&&typeof teamTasksWorkspace==='function'/);
 assert.match(read('app.js'),/renderWorkStepOwners\(/);
 assert.match(read('app.js'),/typeof clearWorkAssignments==='function'\)clearWorkAssignments\(\)/);
 assert.match(read('style.css'),/@media print\{\.work-handoff\{display:none!important\}\}/);
 const html=read('index.src.html');assert.ok(html.indexOf('work-assignments.js')>html.indexOf('pending-stock.js')&&html.indexOf('work-assignments.js')<html.indexOf('app.js'));
});
test('current-step assignment controls follow the signed-in employee areas',()=>{
 const ctx=load({me:{user_id:'a',active:true,role:'staff',access:['proformas','deliveries']}});
 for(const type of ['proforma','delivery','tally_invoice','pending'])assert.equal(ctx.workCanAssign(type),true,type);
 for(const type of ['service','lead','purchase','unknown'])assert.equal(ctx.workCanAssign(type),false,type);
 ctx.me={user_id:'a',active:true,role:'owner',access:[]};assert.equal(ctx.workCanAssign('service'),true);
 ctx.me.active=false;assert.equal(ctx.workCanAssign('service'),false);
 ctx.me=null;assert.equal(ctx.workCanAssign('proforma'),false);
});
test('Assign to me opens a prefilled current-step form, then records a retry-safe handoff',async()=>{
 let form,calls=[],attempt=0,request=0;
 const current={id:'previous',record_id:'delivery-1',assignee_user_id:'b',task:'Pack <carefully>',created_at:new Date().toISOString(),assigned_by:'b',status:'open'};
 const handlers=new Map(),box={dataset:{},isConnected:true,classList:{toggle(){}},innerHTML:'',querySelector(selector){return this.innerHTML.includes(selector.slice(1,-1))?{addEventListener:(event,handler)=>handlers.set(selector,handler)}:null;}};
 const card={querySelector:selector=>selector==='[data-work-handoff]'?box:{before(){}}};
 const ctx=load({me:{user_id:'a',active:true,role:'staff',access:['deliveries']},employeeDirectory:new Map([['b',{user_id:'b',active:true}]]),document:{createElement:()=>box},
  actionForm:(title,fields,submit)=>{form={title,fields,submit};},crypto:{randomUUID:()=>`request-${++request}`},render:async()=>{},message:()=>{},
  client:{rpc:async(name,payload)=>{calls.push({name,payload});return ++attempt===1?{error:{message:'Response lost'}}:{data:{id:payload.p_id}};}}});
 ctx.workRecordCards=()=>[{card,type:'delivery',id:'delivery-1',label:'DN-1'}];
 ctx.loadRecordWork=async()=>({open:new Map([['delivery-1',current]]),history:[current],delays:[]});
 await ctx.decorateWorkHandoffs();
 assert.match(box.innerHTML,/data-work-self>Assign this step to me/);
 handlers.get('[data-work-self]')();
 assert.equal(calls.length,0,'click requires the employee to review and submit the form');
 assert.equal(form.title,'Assign this step to me');
 assert.match(form.fields,/<option value="a" selected>Asha<\/option>/,'self remains selectable when the directory does not include them');
 assert.match(form.fields,/value="Pack &#60;carefully&#62;"/);
 assert.match(form.fields,/current step/);assert.match(form.fields,/Assign the packer.*separately/);
 const values={assignee:'a',task:current.task,due:'',note:'I will handle packing'};
 await assert.rejects(form.submit(values),/Response lost/);
 await form.submit(values);
 assert.equal(calls.length,2);assert.equal(calls[0].name,'hand_off_work');
 assert.equal(calls[0].payload.p_id,calls[1].payload.p_id,'lost response retries keep their request ID');
 assert.equal(calls[1].payload.p_expected_open_id,'previous');assert.equal(calls[1].payload.p_assignee_user_id,'a');
 assert.equal(calls[1].payload.p_task,current.task);assert.equal(calls[1].payload.p_record_type,'delivery');
 ctx.me={user_id:'b',active:true,role:'staff',access:['deliveries']};
 await assert.rejects(form.submit(values),/Login changed/);assert.equal(calls.length,2,'an old form cannot save as a different employee');
});
test('new handoffs select self by default and unowned self-assignment suggests the current work',()=>{
 let form;
 const ctx=load({me:{user_id:'a',active:true,role:'staff',access:['service']},employeeDirectory:new Map(),message:()=>{},actionForm:(title,fields)=>{form={title,fields};}});
 ctx.openWorkHandoff({type:'service',id:'service-1',label:'SC-1',current:null});
 assert.match(form.fields,/<option value="a" selected>Asha<\/option>/);
 ctx.openWorkHandoff({type:'service',id:'service-1',label:'SC-1',current:null,self:true});
 assert.match(form.fields,/value="Assign engineer"/);assert.match(form.fields,/engineer and work date separately/);
});
test('finished delivery and service records retain history without offering new current-step work',async()=>{
 const box={dataset:{},isConnected:true,classList:{toggle(){}},innerHTML:'',querySelector:()=>null};
 const card={querySelector:selector=>selector==='[data-work-handoff]'?box:{before(){}}};
 const ctx=load({me:{user_id:'a',active:true,role:'owner'},document:{createElement:()=>box}});
 for(const [type,status] of [['proforma','cancelled'],['proforma','rejected'],['delivery','delivered'],['delivery','cancelled'],['service','completed'],['service','cancelled']])assert.equal(ctx.workRecordClosed(type,{status}),true);
 assert.equal(ctx.workRecordClosed('proforma',{status:'accepted'}),false);
 assert.equal(ctx.workRecordClosed('delivery',{status:'packing'}),false);
 ctx.workRecordCards=()=>[{card,type:'delivery',id:'delivery-1',label:'DN-1',closed:true}];
 ctx.loadRecordWork=async()=>({open:new Map(),history:[{id:'old',record_id:'delivery-1',assignee_user_id:'a',task:'Deliver the order',status:'done',created_at:'2026-10-18T09:00:00Z',closed_at:'2026-10-18T10:00:00Z'}],delays:[]});
 await ctx.decorateWorkHandoffs();
 assert.doesNotMatch(box.innerHTML,/data-work-self|data-work-assign/);
 assert.match(box.innerHTML,/Deliver the order/);assert.match(box.innerHTML,/Handoff task: <strong>closed/);
});

test('task layout loads handoffs in their own column and related notices below, with unowned work for owners',async()=>{
 for(const role of ['owner','staff']){
  const nodes=new Map(),node=()=>({innerHTML:'',isConnected:true,querySelector:()=>({})}),targets=[];
  for(const key of ['#content','#manualTasks','#teamTaskFinished','#orderSteps','#teamTaskRelated','#teamTaskRefresh','#teamTaskNew'])nodes.set(key,node());
  const ctx=load({me:{user_id:'a',role},view:'personal',personalSection:'task',$:selector=>nodes.get(selector),all:async()=>[],run:fn=>fn()});
  vm.runInContext(readFileSync(new URL('../team-tasks.js',import.meta.url),'utf8'),ctx);
  ctx.renderMyHandoffs=async target=>{targets.push(['handoffs',target]);return true;};ctx.renderWorkNotices=async target=>targets.push(['notices',target]);ctx.renderUnownedWork=async target=>targets.push(['unowned',target]);
  await ctx.teamTasksWorkspace();assert.match(nodes.get('#content').innerHTML,/team-task-columns/);
  assert.equal(targets.find(([name])=>name==='handoffs')[1],nodes.get('#orderSteps'));assert.equal(targets.find(([name])=>name==='notices')[1],nodes.get('#teamTaskRelated'));
  if(role==='owner')assert.equal(targets.find(([name])=>name==='unowned')[1],nodes.get('#teamTaskRelated'));else assert.equal(targets.some(([name])=>name==='unowned'),false);
 }
});
test('responsible-person details load in one request per 100 records, all sent together',async()=>{
 const calls=[];let inFlight=0,most=0;
 const query=chunk=>{const q={ids:[],select(cols){q.cols=cols;return q},eq(){return q},in(_c,ids){q.ids=ids;return q},order(){return q},range(){return q},
  then(ok,bad){inFlight++;most=Math.max(most,inFlight);calls.push(q);return new Promise(r=>setTimeout(r,5)).then(()=>{inFlight--;return {data:q.ids.flatMap(id=>id==='r0'?[
   {id:'w-old',record_id:'r0',status:'done',created_at:'2026-10-01T00:00:00Z',work_delays:[{id:'d-old',assignment_id:'w-old',recorded_at:'2026-10-01T01:00:00Z'}]},
   {id:'w-now',record_id:'r0',status:'open',created_at:'2026-10-02T00:00:00Z',work_delays:[{id:'d-now',assignment_id:'w-now',recorded_at:'2026-10-02T01:00:00Z'}]}]:[])}}).then(ok,bad)}};return q};
 const ctx=load({me:{user_id:'a'},client:{from:()=>query()}});
 const ids=Array.from({length:250},(_,i)=>'r'+i);
 const work=await ctx.loadRecordWork('delivery',ids);
 assert.equal(calls.length,3,'250 records = 3 requests');assert.equal(most,3,'all three sent together');
 assert.match(calls[0].cols,/work_delays\(/,'delays come back inside the same request');
 assert.equal(work.open.get('r0').id,'w-now');assert.equal(work.history.length,2);
 assert.ok(work.history.every(row=>!('work_delays' in row)));
 assert.equal(JSON.stringify(work.delays.map(d=>d.id)),'["d-now"]','only the open step\'s delays');
});
