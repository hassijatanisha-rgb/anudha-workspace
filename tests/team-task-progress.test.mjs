import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../team-tasks.js',import.meta.url),'utf8');
const task=(extra={})=>({id:'task',title:'Call clinic',details:'Original instructions',task_number:'TK-1',assigned_by:'giver',assignee_user_id:'worker',status:'open',due_at:'2099-01-01T09:00:00Z',urgency:'normal',version:1,...extra});
function load(extra={}){
 const ctx=vm.createContext({me:{user_id:'worker',role:'staff'},employeeName:id=>({giver:'Asha',worker:'Baraka'}[id]||id),esc:s=>String(s??'').replace(/[&<>"']/g,c=>'&#'+c.charCodeAt(0)+';'),crypto:{randomUUID:()=> 'request-1'},...extra});
 vm.runInContext(source+';Object.assign(globalThis,{teamTaskCard,teamTaskProgress,teamTaskAssignments,openTeamTaskComment,openTeamTaskEditor,teamTaskLocalInput,teamTasksWorkspace,loadTeamTasks,clearTeamTasks,setEvents:events=>{teamTaskEvents=events;}})',ctx);return ctx;
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
test('a login change during the success refresh suppresses the progress confirmation',async()=>{
 let form;const ctx=load({actionForm:(_,__,submit)=>{form=submit;},client:{rpc:async()=>({data:{}})},message:()=>assert.fail('stale success message')});
 ctx.teamTasksWorkspace=async()=>{ctx.me={user_id:'other',role:'staff'};};ctx.openTeamTaskComment(task());await form({note:'Confirmed with the clinic'});
});
function workspace(extra={}){
 const nodes=new Map(),node=()=>({innerHTML:'',isConnected:true,querySelector:()=>({})});
 for(const key of ['#content','#manualTasks','#teamTaskFinished','#orderSteps','#teamTaskRelated','#teamTaskRefresh','#teamTaskNew','#teamTaskRetry'])nodes.set(key,node());
 const seen=[],ctx=load({$:selector=>nodes.get(selector),view:'personal',personalSection:'task',run:fn=>fn(),bellMarkSeen:(_,kinds)=>seen.push(...kinds),refreshNotificationBell:async()=>{},...extra});
 return {ctx,nodes,seen};
}
test('handoffs render when manual task loading fails; only successful visible panes mark notifications seen',async()=>{
 let resolveWork;const {ctx,nodes,seen}=workspace({all:async()=>{throw Error('Task load failed');},renderMyHandoffs:async target=>{target.innerHTML='Visible handoff';return new Promise(r=>{resolveWork=r;});}});
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
 let resolveEvents,calls=0;
 const ctx=load({all:async()=>{calls++;if(calls===1)return [task()];return new Promise(r=>{resolveEvents=r;});}});
 const pending=ctx.loadTeamTasks();await new Promise(r=>setImmediate(r));ctx.me={user_id:'someone-else'};resolveEvents([{task_id:'task',action:'progress',note:'Private comment'}]);assert.equal(await pending,null);
 ctx.setEvents(new Map([['task',[{action:'progress',note:'Private',created_at:'2026-10-20'}]]]));ctx.clearTeamTasks();assert.equal(ctx.teamTaskProgress(task()),'');
});
function recoveryWorkspace(role='owner',directory=[{user_id:'gone',active:false},{user_id:'worker',active:true},{user_id:'unknown'}]){
 const queries=[],rows=[task({id:'recovery',title:'Recover <task>',assignee_user_id:'gone'}),task({id:'mine',assignee_user_id:'owner'}),task({id:'given',assigned_by:'owner',assignee_user_id:'gone'}),task({id:'closed',assignee_user_id:'gone',status:'done',closed_at:new Date().toISOString()}),task({id:'unrelated-active'})];
 const view=workspace({me:{user_id:'owner',role},employeeDirectory:new Map(directory.map(row=>[row.user_id,row])),all:async(table,columns,filter)=>{
  const calls=[],query={or(...args){calls.push(['or',...args]);return this;},in(...args){calls.push(['in',...args]);return this;},order(...args){calls.push(['order',...args]);return this;}};
  filter(query);queries.push({table,calls});
  return table==='team_tasks'?rows:[{id:'event',task_id:'recovery',action:'progress',note:'Retained progress',actor_user_id:'giver',created_at:'2026-10-20'}];
 }});
 return {...view,queries};
}
test('owner retrieves open tasks for explicitly inactive staff and shows their existing Edit action and history',async()=>{
 const {ctx,nodes,queries}=recoveryWorkspace();await ctx.teamTasksWorkspace();
 assert.equal(queries[0].calls[0][1],'assignee_user_id.eq.owner,assigned_by.eq.owner,and(status.eq.open,assignee_user_id.in.(gone))');
 assert.match(queries[0].calls[1][1],/^status\.eq\.open,closed_at\.gte\./);
 assert.ok(queries[1].calls[0][2].includes('recovery'),'recovery tasks retain normal history loading');
 const html=nodes.get('#manualTasks').innerHTML,recovery=html.split('Tasks for inactive staff · 1')[1];
 assert.ok(recovery);assert.match(recovery,/Recover &#60;task&#62;/);assert.match(recovery,/data-team-task-edit="recovery"/);assert.match(recovery,/Retained progress/);
 for(const id of ['mine','given','closed','unrelated-active'])assert.doesNotMatch(recovery,new RegExp(`data-team-task="${id}"`));
 assert.equal((html.match(/data-team-task="given"/g)||[]).length,1,'owner-given tasks stay in their normal group without duplication');
 assert.match(html,/To do · 1/);assert.match(html,/Tasks I gave others · 1/);assert.doesNotMatch(nodes.get('#teamTaskFinished').innerHTML,/data-team-task="closed"/);
});
test('staff and department heads keep their personal query and never render the owner recovery group',async()=>{
 for(const role of ['staff','head']){
  const {ctx,nodes,queries}=recoveryWorkspace(role);await ctx.teamTasksWorkspace();
  assert.equal(queries[0].calls[0][1],'assignee_user_id.eq.owner,assigned_by.eq.owner');
  assert.doesNotMatch(nodes.get('#manualTasks').innerHTML,/Tasks for inactive staff|data-team-task="recovery"|data-team-task="unrelated-active"/);
  assert.match(nodes.get('#manualTasks').innerHTML,/To do · 1/);assert.match(nodes.get('#manualTasks').innerHTML,/Tasks I gave others · 1/);
 }
});
test('owner with no explicitly inactive staff keeps the existing personal query',async()=>{
 const {ctx,queries}=recoveryWorkspace('owner',[{user_id:'worker',active:true},{user_id:'unknown'}]);await ctx.loadTeamTasks();
 assert.equal(queries[0].calls[0][1],'assignee_user_id.eq.owner,assigned_by.eq.owner');
});
test('reassignment requires choosing an active employee and uses normal save with the unchanged exact due date',async()=>{
 let form;const calls=[],row=task({assignee_user_id:'gone',due_at:'2026-10-20T08:34:56.789Z'});
 const ctx=load({me:{user_id:'owner',role:'owner'},employeeDirectory:new Map([['gone',{user_id:'gone',active:false}],['worker',{user_id:'worker',active:true}]]),actionForm:(title,fields,submit)=>{form={title,fields,submit};},client:{rpc:async(name,args)=>{calls.push({name,args});return {data:{}};}},message:()=>{}});
 ctx.teamTasksWorkspace=async()=>{};ctx.openTeamTaskEditor(row);
 assert.equal(form.title,'Edit task');assert.match(form.fields,/<select name="assignee" required><option value="" selected>Choose an active employee<\/option>/);assert.doesNotMatch(form.fields,/<option value="gone"/);
 const values={title:row.title,details:row.details,urgency:row.urgency,due:ctx.teamTaskLocalInput(new Date(row.due_at)),assignee:'worker'};
 await form.submit(values);
 assert.deepEqual(JSON.parse(JSON.stringify(calls)),[{name:'save_team_task',args:{p_id:row.id,p_expected_version:row.version,p_title:row.title,p_details:row.details,p_urgency:row.urgency,p_due_at:row.due_at,p_assignee:'worker'}}]);
 await form.submit({...values,due:'2026-10-25T10:30'});assert.equal(calls[1].args.p_due_at,new Date('2026-10-25T10:30').toISOString(),'owner can still intentionally edit the deadline');
});
