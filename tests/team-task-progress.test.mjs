import {installDisclosureMotion} from './helpers/disclosure-motion.mjs';
import {workspacePageHeader} from './helpers/page-header.mjs';
import {statusTone} from './helpers/status-ui.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../team-tasks.js',import.meta.url),'utf8');
const task=(extra={})=>({id:'task',title:'Call clinic',details:'Original instructions',task_number:'TK-1',assigned_by:'giver',assignee_user_id:'worker',status:'open',due_at:'2099-01-01T09:00:00Z',urgency:'normal',version:1,...extra});
function load(extra={}){
 const ctx=vm.createContext({workspacePageHeader,statusTone,workspaceLoading(){},workspaceRefreshRetaining:()=>false,view:'personal',personalSection:'task',me:{user_id:'worker',role:'staff'},employeeName:id=>({giver:'Asha',worker:'Baraka'}[id]||id),esc:s=>String(s??'').replace(/[&<>"']/g,c=>'&#'+c.charCodeAt(0)+';'),crypto:{randomUUID:()=> 'request-1'},...extra});
 installDisclosureMotion(ctx);
 vm.runInContext('function workspaceSkeleton(kind,label)'+readFileSync(new URL('../workspace-refresh.js',import.meta.url),'utf8').split('function workspaceSkeleton(kind,label)')[1].split('function workspaceLoading')[0],ctx);
 vm.runInContext(source+';Object.assign(globalThis,{teamTaskCard,teamTaskProgress,teamTaskAssignments,openTeamTaskComment,teamTasksWorkspace,loadTeamTasks,clearTeamTasks,setEvents:events=>{teamTaskEvents=events;}})',ctx);return ctx;
}
test('cards show the latest four comments and retain the full dated, escaped history',()=>{
 const ctx=load(),comments=Array.from({length:6},(_,i)=>({action:'progress',id:String(i),note:`Progress ${i} <safe>`,actor_user_id:'worker',created_at:`2026-10-${10+i}T10:00:00Z`}));
 ctx.setEvents(new Map([['task',comments]]));const html=ctx.teamTaskProgress(task()),preview=html.split('<details>')[0];
 assert.match(html,/Full progress history · 6/);assert.equal((preview.match(/<li>/g)||[]).length,4);
 assert.match(preview,/Progress 5 &#60;safe&#62;/);assert.doesNotMatch(preview,/Progress 0/);assert.match(html,/Progress 0/);assert.match(html,/Baraka/);assert.match(html,/2026/);
 assert.match(ctx.teamTaskCard(task()),/data-team-task-comment/);
 assert.doesNotMatch(ctx.teamTaskCard(task({status:'done',closed_at:'2026-10-20'})),/data-team-task-comment/);
 ctx.me={user_id:'head',role:'head'};assert.doesNotMatch(ctx.teamTaskCard(task()),/data-team-task-comment/);
});
test('assignment history keeps original title and before/after details and assignees',()=>{
 const ctx=load(),snapshot={title:'Original <title>',details:'Original <details>',assignee_user_id:'worker',assigned_by:'giver',urgency:'normal',due_at:'2026-10-25T10:00:00Z'};
 ctx.setEvents(new Map([['task',[{action:'create',note:'Unchanged original title',actor_user_id:'giver',created_at:'2026-10-20'}, {action:'assignment',note:'Assignment changed',actor_user_id:'giver',created_at:'2026-10-21',old_assignment:snapshot,new_assignment:{...snapshot,details:'Edited details',assignee_user_id:'giver'}}]]]));
 const html=ctx.teamTaskAssignments(task());
 for(const expected of ['Unchanged original title','Original &#60;title&#62;','Original &#60;details&#62;','Edited details','For Baraka','For Asha','Before','After'])assert.ok(html.includes(expected),expected);
});
test('progress retry keeps its request id, does not close the task and rejects an old login or view',async()=>{
 let form;const calls=[];
 const ctx=load({actionForm:(title,fields,submit)=>{form={title,fields,submit};},client:{rpc:async(name,args)=>{calls.push({name,args});return {error:{message:'Response lost'}};}}});
 ctx.openTeamTaskComment(task());assert.match(form.fields,/task stays open/);
 for(let i=0;i<2;i++)await assert.rejects(form.submit({note:' Customer confirmed ' }),/Response lost/);
 assert.equal(calls.length,2);assert.equal(calls[0].name,'append_team_task_progress');assert.deepEqual(calls[0].args,calls[1].args);assert.equal(calls[0].args.p_note,'Customer confirmed');assert.equal(Object.hasOwn(calls[0].args,'p_action'),false);
 ctx.clearTeamTasks();await assert.rejects(form.submit({note:'Old dialog'}),/Login or task view changed/);assert.equal(calls.length,2);
 ctx.openTeamTaskComment(task());ctx.me={user_id:'worker',role:'staff'};await assert.rejects(form.submit({note:'Old session'}),/Login or task view changed/);assert.equal(calls.length,2);
});
test('late progress responses do not refresh or message another login',async()=>{
 let form,resolve;const ctx=load({actionForm:(_,__,submit)=>{form=submit;},client:{rpc:()=>new Promise(r=>{resolve=r;})},message:()=>assert.fail('stale success message')});
 ctx.teamTasksWorkspace=()=>assert.fail('stale refresh');ctx.openTeamTaskComment(task());const pending=form({note:'Waiting for confirmation'});ctx.me={user_id:'other',role:'staff'};resolve({data:{}});await pending;
});
test('leaving the task page during a successful request suppresses the late confirmation',async()=>{
 let form,resolve;const ctx=load({actionForm:(_,__,submit)=>{form=submit;},client:{rpc:()=>new Promise(done=>{resolve=done;})},message:()=>assert.fail('stale success message')});
 ctx.teamTasksWorkspace=()=>assert.fail('full refresh');ctx.openTeamTaskComment(task());const pending=form({note:'Confirmed with the clinic'});ctx.personalSection='notes';resolve({data:{}});await pending;
});
function workspace(extra={}){
 const nodes=new Map(),node=()=>({innerHTML:'',isConnected:true,querySelectorAll:()=>[],querySelector:()=>({})});
 for(const key of ['#content','#manualTasks','#teamTaskFinished','#orderSteps','#teamTaskRelated','#teamTaskRefresh','#teamTaskNew','#teamTaskRetry'])nodes.set(key,node());
 const seen=[],ctx=load({$:selector=>nodes.get(selector),document:{querySelectorAll:()=>[]},client:{rpc:async()=>({data:{groups:Object.fromEntries(['forMe','gave','results','finished'].map(key=>[key,{rows:[],total:0,page:0,pages:1}]))}})},view:'personal',personalSection:'task',run:fn=>fn(),bellMarkSeen:(_,kinds)=>seen.push(...kinds),refreshNotificationBell:async()=>{},...extra});
 return {ctx,nodes,seen};
}
test('handoffs render when manual task loading fails; only successful visible panes mark notifications seen',async()=>{
 let resolveWork;const {ctx,nodes,seen}=workspace({client:{rpc:async()=>{throw Error('Task load failed');}},renderMyHandoffs:async target=>{target.innerHTML='Visible handoff';return new Promise(r=>{resolveWork=r;});}});
 const pending=ctx.teamTasksWorkspace();await new Promise(r=>setImmediate(r));
 assert.match(nodes.get('#manualTasks').innerHTML,/Task load failed/);assert.equal(nodes.get('#orderSteps').innerHTML,'Visible handoff');assert.deepEqual(seen,[]);
 resolveWork(true);await pending;assert.deepEqual(seen,['work']);assert.match(nodes.get('#content').innerHTML,/team-task-columns/);
});
test('failed, detached and superseded handoff loads cannot clear work notifications',async()=>{
 for(const outcome of ['failed','detached','session']){
  let resolveWork;const {ctx,nodes,seen}=workspace({all:async()=>[],renderMyHandoffs:()=>new Promise(r=>{resolveWork=r;})});
  const pending=ctx.teamTasksWorkspace();await new Promise(r=>setImmediate(r));assert.deepEqual(seen,['tasks','results']);
  if(outcome==='detached')nodes.get('#content').isConnected=false;
  if(outcome==='session')ctx.me={user_id:'worker',role:'staff'};
  resolveWork(outcome!=='failed');await pending;assert.deepEqual(seen,['tasks','results']);
 }
});
test('task history loading drops data after a session switch and clearing tasks removes cached comments',async()=>{
 let resolveEvents;
 const ctx=load({all:()=>new Promise(r=>{resolveEvents=r;})});
 const pending=ctx.loadTeamTaskHistory(['task'],ctx.me,vm.runInContext('teamTaskEpoch',ctx));await new Promise(r=>setImmediate(r));ctx.me={user_id:'someone-else'};resolveEvents([{task_id:'task',action:'progress',note:'Private comment'}]);assert.equal(await pending,null);
 ctx.setEvents(new Map([['task',[{action:'progress',note:'Private',created_at:'2026-10-20'}]]]));ctx.clearTeamTasks();assert.equal(ctx.teamTaskProgress(task()),'');
});

test('task and handoff loading refresh the bell once after both panes settle, including failures',async()=>{
 for(const tasksFail of [false,true])for(const handoffsFail of [false,true]){
  let resolveWork;const refreshes=[];
  const {ctx,seen}=workspace({renderMyHandoffs:()=>new Promise(resolve=>{resolveWork=resolve;}),refreshNotificationBell:async forced=>refreshes.push({forced,seen:[...seen]})});
  if(tasksFail)ctx.client.rpc=async()=>{throw Error('Tasks unavailable');};
  const pending=ctx.teamTasksWorkspace();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(refreshes.length,0,'the first completed pane must not trigger a second summary request');
  resolveWork(!handoffsFail);await pending;
  assert.equal(refreshes.length,1);assert.equal(refreshes[0].forced,true);
  assert.deepEqual(refreshes[0].seen.sort(),[...(!tasksFail?['tasks','results']:[]),...(!handoffsFail?['work']:[])].sort());
 }
});

test('a replaced login or departed task page cannot trigger a late bell refresh',async()=>{
 for(const leave of [ctx=>{ctx.me={...ctx.me};},ctx=>{ctx.personalSection='note';},ctx=>ctx.clearTeamTasks()]){
  let finish;const refreshes=[];
  const {ctx}=workspace({renderMyHandoffs:()=>new Promise(resolve=>{finish=resolve;}),refreshNotificationBell:async()=>refreshes.push(true)});
  const pending=ctx.teamTasksWorkspace();await new Promise(resolve=>setImmediate(resolve));leave(ctx);finish(true);await pending;
  assert.deepEqual(refreshes,[]);
 }
});


test('task chips separate overdue or urgent work from completed and cancelled history',()=>{
 const ctx=load();
 const cases=[['normal','open','2099-01-01','neutral','Normal'],['urgent','open','2099-01-01','warning','Urgent'],['do_now','open','2099-01-01','danger','Do now'],['normal','open','2000-01-01','danger','Late · Normal'],['do_now','done','2000-01-01','success','Done'],['urgent','cancelled','2000-01-01','neutral','Cancelled']];
 for(const [urgency,status,due_at,tone,label] of cases){
  const row=task({urgency,status,due_at,closed_at:'2026-10-29'});
  for(const html of [ctx.teamTaskCard(row),ctx.teamTaskSummaryCard(row)])assert.match(html,new RegExp('chip chip--'+tone+'"[^>]*>'+label+'<'),status+' '+urgency);
 }
});
