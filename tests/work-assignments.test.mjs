import {installDisclosureMotion} from './helpers/disclosure-motion.mjs';
import {workspacePageHeader} from './helpers/page-header.mjs';
import {installLeaveContext} from './helpers/leave-context.mjs';
import {statusTone} from './helpers/status-ui.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
function load(overrides={}){
 const ctx=vm.createContext({workspacePageHeader,statusTone,esc:s=>String(s??'').replace(/[&<>"']/g,c=>'&#'+c.charCodeAt(0)+';'),employeeName:id=>({a:'Asha',b:'Baraka'}[id]||'Employee name not set'),Date,Math,Number,String,...overrides});
 installDisclosureMotion(ctx);
 vm.runInContext(readFileSync(new URL('../work-assignments.js',import.meta.url),'utf8'),ctx);installLeaveContext(ctx);return ctx;
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
 for(const file of ['sales-delivery.js','service-workflow.js','pending-stock.js','purchasing.js']){assert.match(read(file),/typeof decorateWorkHandoffs==='function'/,file);assert.match(read(file),/decorateWorkHandoffs\((?:cards\[0\])?\)/,file);}
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
 const handlers=new Map(),box={dataset:{},isConnected:true,closest:()=>card,classList:{toggle(){}},innerHTML:'',querySelectorAll:()=>[],querySelector(selector){return this.innerHTML.includes(selector.slice(1,-1))?{addEventListener:(event,handler)=>handlers.set(selector,handler)}:null;}};
 const card={querySelector:selector=>selector==='[data-work-handoff]'?box:{before(){}}};
 const ctx=load({me:{user_id:'a',active:true,role:'staff',access:['deliveries']},employeeDirectory:new Map([['b',{user_id:'b',active:true}]]),document:{createElement:()=>box},
  actionForm:(title,fields,submit)=>{form={title,fields,submit};},crypto:{randomUUID:()=>`request-${++request}`},render:async()=>{},message:()=>{},
  client:{rpc:async(name,payload)=>{calls.push({name,payload});return ++attempt===1?{error:{message:'Response lost'}}:{data:{id:payload.p_id}};}}});
 ctx.workRecordCards=()=>[{card,type:'delivery',id:'delivery-1',label:'DN-1'}];
 ctx.loadRecordWork=async()=>({open:new Map([['delivery-1',current]]),history:[],delays:[]});
 await ctx.decorateWorkHandoffs();
 assert.match(box.innerHTML,/data-work-self="delivery-1">Assign this step to me/);
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
 const box={dataset:{},isConnected:true,classList:{toggle(){}},innerHTML:'',querySelectorAll:()=>[],querySelector:()=>null};
 const card={querySelector:selector=>selector==='[data-work-handoff]'?box:{before(){}}};
 const ctx=load({me:{user_id:'a',active:true,role:'owner'},document:{createElement:()=>box}});
 for(const [type,status] of [['proforma','cancelled'],['proforma','rejected'],['delivery','delivered'],['delivery','cancelled'],['service','completed'],['service','cancelled']])assert.equal(ctx.workRecordClosed(type,{status}),true);
 assert.equal(ctx.workRecordClosed('proforma',{status:'accepted'}),false);
 assert.equal(ctx.workRecordClosed('delivery',{status:'packing'}),false);
 ctx.workRecordCards=()=>[{card,type:'delivery',id:'delivery-1',label:'DN-1',closed:true}];
 ctx.loadRecordWork=async()=>({open:new Map(),history:[{id:'old',record_id:'delivery-1',assignee_user_id:'a',task:'Deliver the order',status:'done',created_at:'2026-10-18T09:00:00Z',closed_at:'2026-10-18T10:00:00Z'}],delays:[]});
 await ctx.decorateWorkHandoffs();
 assert.doesNotMatch(box.innerHTML,/data-work-self|data-work-assign/);
 assert.match(box.innerHTML,/Deliver the order/);assert.match(box.innerHTML,/Handoff task: <strong class="chip chip--neutral">closed/);
});

test('task layout loads handoffs in their own column and related notices below, with unowned work for owners',async()=>{
 for(const role of ['owner','staff']){
  const nodes=new Map(),node=()=>({innerHTML:'',isConnected:true,querySelectorAll:()=>[],querySelector:()=>({})}),targets=[];
  for(const key of ['#content','#manualTasks','#teamTaskFinished','#orderSteps','#teamTaskRelated','#teamTaskRefresh','#teamTaskNew'])nodes.set(key,node());
  const ctx=load({workspaceRefreshRetaining:()=>false,me:{user_id:'a',role},view:'personal',personalSection:'task',$:selector=>nodes.get(selector),document:{querySelectorAll:()=>[]},client:{rpc:async()=>({data:{groups:Object.fromEntries(['forMe','gave','results','finished'].map(key=>[key,{rows:[],total:0,page:0,pages:1}]))}})},run:fn=>fn()});
  vm.runInContext('function workspaceSkeleton(kind,label)'+readFileSync(new URL('../workspace-refresh.js',import.meta.url),'utf8').split('function workspaceSkeleton(kind,label)')[1].split('function workspaceLoading')[0],ctx);vm.runInContext(readFileSync(new URL('../team-tasks.js',import.meta.url),'utf8'),ctx);
  ctx.renderMyHandoffs=async target=>{targets.push(['handoffs',target]);return true;};ctx.renderWorkNotices=async target=>targets.push(['notices',target]);ctx.renderUnownedWork=async (...args)=>targets.push(['unowned',...args]);
  await ctx.teamTasksWorkspace();assert.match(nodes.get('#content').innerHTML,/team-task-columns/);
  assert.equal(targets.find(([name])=>name==='handoffs')[1],nodes.get('#orderSteps'));assert.equal(targets.find(([name])=>name==='notices')[1],nodes.get('#teamTaskRelated'));
  if(role==='owner'){const unowned=targets.find(([name])=>name==='unowned');assert.equal(unowned[1],nodes.get('#teamTaskRelated'));assert.deepEqual(unowned.slice(2),['',true]);}else assert.equal(targets.some(([name])=>name==='unowned'),false);
 }
});

test('My tasks refresh retains the loaded shell and tasks while independent handoffs start immediately',async()=>{
 const nodes=new Map(),node=html=>({innerHTML:html,isConnected:true,querySelectorAll:()=>[],querySelector:()=>({})});
 for(const key of ['#content','#manualTasks','#teamTaskFinished','#orderSteps','#teamTaskRelated','#teamTaskRefresh','#teamTaskNew'])nodes.set(key,node('Previous '+key));
 let release;const pending=new Promise(resolve=>release=resolve),started=[];
 const ctx=load({workspaceRefreshRetaining:()=>true,me:{user_id:'a',role:'staff'},view:'personal',personalSection:'task',$:selector=>nodes.get(selector),document:{querySelectorAll:()=>[]},run:fn=>fn()});
 vm.runInContext('function workspaceSkeleton(kind,label)'+readFileSync(new URL('../workspace-refresh.js',import.meta.url),'utf8').split('function workspaceSkeleton(kind,label)')[1].split('function workspaceLoading')[0],ctx);vm.runInContext(readFileSync(new URL('../team-tasks.js',import.meta.url),'utf8'),ctx);ctx.syncTeamTaskActor();
 ctx.loadTeamTasks=()=>pending;ctx.renderMyHandoffs=async()=>{started.push('handoffs');return true;};ctx.renderWorkNotices=async()=>{};
 const refreshing=ctx.teamTasksWorkspace();
 assert.equal(nodes.get('#content').innerHTML,'Previous #content');assert.equal(nodes.get('#manualTasks').innerHTML,'Previous #manualTasks');assert.deepEqual(started,['handoffs']);
 release(Object.fromEntries(['forMe','gave','results','finished'].map(key=>[key,{rows:[],total:0,page:0,pages:1}])));await refreshing;
 assert.match(nodes.get('#manualTasks').innerHTML,/No tasks in this group/);assert.equal(nodes.get('#content').innerHTML,'Previous #content');
});

function pendingResponsibleFixture(){
 const box={dataset:{},isConnected:true,classList:{toggle(){}},innerHTML:'',querySelectorAll:()=>[],querySelector:()=>null},placements=[];
 const card={querySelector:selector=>selector==='[data-work-handoff]'?box:{before:node=>placements.push(node)}};
 const ctx=load({me:{user_id:'a',active:true,role:'staff',access:[]},document:{createElement:()=>box}});
 ctx.workRecordCards=()=>[{card,type:'delivery',id:'delivery-1',label:'DN-1'}];
 let resolve,reject;ctx.loadRecordWork=()=>new Promise((ok,fail)=>{resolve=open=>ok({open,history:[],delays:[]});reject=fail});
 return {ctx,box,placements,resolve:value=>resolve(value),reject:error=>reject(error)};
}
test('responsible person skeleton reserves its existing position and resolves to named owner, task and sender',async()=>{
 const f=pendingResponsibleFixture(),work=f.ctx.decorateWorkHandoffs();
 assert.equal(f.placements[0],f.box);assert.match(f.box.innerHTML,/role="status" aria-label="Loading responsible person"/);assert.match(f.box.innerHTML,/class="work-responsible-skeleton" aria-hidden="true"/);assert.doesNotMatch(f.box.innerHTML,/Responsible: loading|Asha|Baraka/);
 f.resolve(new Map([['delivery-1',{id:'assignment',assignee_user_id:'a',assigned_by:'b',task:'Pack the order',created_at:new Date().toISOString(),status:'open'}]]));await work;
 assert.match(f.box.innerHTML,/Current step owner: <strong>Asha/);assert.match(f.box.innerHTML,/Pack the order/);assert.match(f.box.innerHTML,/sent by Baraka/);assert.doesNotMatch(f.box.innerHTML,/work-responsible-skeleton/);
});
test('responsible skeleton failure remains an escaped alert',async()=>{
 const f=pendingResponsibleFixture(),work=f.ctx.decorateWorkHandoffs();f.reject(Error('<offline>'));await work;
 assert.match(f.box.innerHTML,/role="alert"/);assert.match(f.box.innerHTML,/Responsible person could not load: &#60;offline&#62;/);assert.doesNotMatch(f.box.innerHTML,/work-responsible-skeleton|<offline>/);
});
test('responsible skeleton never resolves an earlier session or detached card',async()=>{
 for(const change of [f=>{f.ctx.me={user_id:'b'}},f=>{f.ctx.clearWorkAssignments()},f=>{f.box.isConnected=false}]){
  const f=pendingResponsibleFixture(),work=f.ctx.decorateWorkHandoffs(),pending=f.box.innerHTML;change(f);f.resolve(new Map());await work;assert.equal(f.box.innerHTML,pending);
 }
 const f=pendingResponsibleFixture(),work=f.ctx.decorateWorkHandoffs(),pending=f.box.innerHTML;f.box.isConnected=false;f.reject(Error('late failure'));await work;assert.equal(f.box.innerHTML,pending);
});

function scopedHandoffFixture(){
 const pending=[],cards=[];
 const card=id=>{const item={dataset:{documentCard:id},isConnected:true,box:null,matches:selector=>selector==='[data-document-card]',querySelectorAll:()=>[],querySelector(selector){return selector==='[data-work-handoff]'?this.box:selector==='.actions'?{before:box=>{this.box=box;}}:null;}};cards.push(item);return item;};
 const first=card('first'),second=card('second'),changed=card('changed');
 const document={querySelectorAll:selector=>selector==='[data-document-card]'?[first,second]:[],createElement:()=>({dataset:{},isConnected:true,classList:{toggle(){}},innerHTML:'',querySelectorAll:()=>[],querySelector:()=>null})};
 const ctx=load({document,me:{user_id:'a',role:'owner'},salesProforma:()=>null,salesDeliveryNotes:cards.map(item=>({id:item.dataset.documentCard,delivery_number:item.dataset.documentCard,status:'packing'}))});
 ctx.loadRecordWork=async(type,ids)=>new Promise(resolve=>pending.push({ids,resolve:open=>resolve({open,history:[],delays:[]})}));
 return {ctx,document,first,second,changed,pending};
}
test('scoped handoff refresh includes its root card without cancelling unrelated pending owner lookups',async()=>{
 const f=scopedHandoffFixture(),full=f.ctx.decorateWorkHandoffs(),epoch=vm.runInContext('workEpoch',f.ctx),scoped=f.ctx.decorateWorkHandoffs(f.changed);
 assert.equal(vm.runInContext('workEpoch',f.ctx),epoch);assert.deepEqual(Array.from(f.pending[0].ids),['first','second']);assert.deepEqual(Array.from(f.pending[1].ids),['changed']);
 f.pending[1].resolve(new Map());await scoped;assert.match(f.changed.box.innerHTML,/unassigned/);
 f.pending[0].resolve(new Map());await full;assert.match(f.first.box.innerHTML,/unassigned/);assert.match(f.second.box.innerHTML,/unassigned/);
});
test('scoped owner results cannot update a detached root or replacement actor',async()=>{
 for(const change of [f=>{f.changed.isConnected=false;},f=>{f.ctx.me={user_id:'a',role:'owner'};}]){
  const f=scopedHandoffFixture(),load=f.ctx.decorateWorkHandoffs(f.changed),before=f.changed.box.innerHTML;change(f);f.pending[0].resolve(new Map());await load;assert.equal(f.changed.box.innerHTML,before);
 }
 const f=scopedHandoffFixture();f.changed.isConnected=false;await f.ctx.decorateWorkHandoffs(f.changed);assert.equal(f.pending.length,0);
});
