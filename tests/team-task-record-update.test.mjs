import {installDisclosureMotion} from './helpers/disclosure-motion.mjs';
import {workspacePageHeader} from './helpers/page-header.mjs';
import {statusTone} from './helpers/status-ui.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../team-tasks.js',import.meta.url),'utf8');
const task={id:'task',status:'open',title:'Call the clinic',assignee_user_id:'worker',assigned_by:'head'};
const event={id:'request',task_id:'task',action:'progress',note:'Confirmed <delivery>',actor_user_id:'worker',created_at:'2026-10-29T08:00:00Z'};
function fixture(){
 let submit,progress=null;const messages=[],calls=[],actions={identity:'unchanged'},other={identity:'other card'},details={open:true};
 const card={querySelectorAll:()=>[],querySelector:selector=>selector==='.team-task-progress'?progress:actions,insertBefore(node,before){assert.equal(before,actions);progress=node;}};
 const document={querySelector:selector=>selector==='[data-team-task="task"]'?card:null,createElement(tag){assert.equal(tag,'template');const template={content:{}};Object.defineProperty(template,'innerHTML',{set(html){template.content.firstElementChild={html,querySelector:()=>details,replaceWith(next){progress=next;}};}});return template;}};
 const ctx=vm.createContext({workspacePageHeader,statusTone,me:{user_id:'worker',role:'staff'},view:'personal',personalSection:'task',document,CSS:{escape:String},crypto:{randomUUID:()=> 'request'},
  employeeName:()=> 'Employee',esc:value=>String(value??'').replaceAll('<','&lt;').replaceAll('>','&gt;'),
  actionForm:(_,__,callback)=>{submit=callback;},message:(text,error)=>messages.push({text,error}),client:{rpc:async(name,args)=>{calls.push({name,args});return ctx.result;}}
 });
 installDisclosureMotion(ctx);vm.runInContext(source,ctx);ctx.teamTasksWorkspace=()=>assert.fail('No page reload after adding progress');ctx.result={data:event};
 return {ctx,messages,calls,actions,other,details,progress:()=>progress,submit:values=>submit(values)};
}
test('confirmed progress patches only the history with escaped server text and no extra read',async()=>{
 const f=fixture();f.ctx.openTeamTaskComment(task);await f.submit({note:'Confirmed <delivery>'});
 assert.equal(f.calls.length,1);assert.equal(f.calls[0].name,'append_team_task_progress');
 assert.match(f.progress().html,/Confirmed &lt;delivery&gt;/);assert.equal(f.other.identity,'other card');assert.equal(f.actions.identity,'unchanged');
 assert.equal(f.messages[0].text,'Progress added. The task stays open.');
 f.ctx.savedTask=task;f.ctx.savedEvent=event;vm.runInContext('updateTeamTaskProgress(savedTask,savedEvent)',f.ctx);
 assert.equal(vm.runInContext('teamTaskEvents.get("task").length',f.ctx),1,'an idempotent retry must not duplicate a comment');
 assert.equal(f.details.open,true);
});
test('unconfirmed successful response gives a saved-but-unavailable message without fabricating history',async()=>{
 for(const data of [null,{}, {...event,task_id:'another-task'}, {...event,id:'unexpected'}]){
  const f=fixture();f.ctx.result={data};f.ctx.openTeamTaskComment(task);await f.submit({note:'A valid comment'});
  assert.equal(f.progress(),null);assert.equal(vm.runInContext('teamTaskEvents.size',f.ctx),0);
  assert.equal(f.messages[0].error,true);assert.match(f.messages[0].text,/Progress was saved.*Refresh the task before retrying/);
 }
});
test('failed progress leaves the task history untouched and preserves the retry request ID',async()=>{
 const f=fixture();f.ctx.result={error:{message:'Connection unavailable'}};f.ctx.openTeamTaskComment(task);
 for(let i=0;i<2;i++)await assert.rejects(f.submit({note:'A valid comment'}),/Connection unavailable/);
 assert.equal(f.progress(),null);assert.equal(f.calls[0].args.p_id,f.calls[1].args.p_id);assert.deepEqual(f.messages,[]);
});

function recordFixture(){
 const original={...task,assigned_by:'worker',version:1,urgency:'normal',task_number:'TK-1',due_at:'2098-01-01T09:00:00Z',details:'Old instructions',reschedule_count:0},saved={...original,version:2,title:'Changed <title>',due_at:'2098-01-02T09:00:00Z',reschedule_count:1};
 const cards=new Map(),calls=[],messages=[];let submit;
 const parse=html=>{
  const id=html.match(/data-team-task="([^"]+)"/)[1],details=new Map(['.team-task-assignments','.team-task-moves','.team-task-progress details'].map(key=>[key,{open:false}])),buttons=[...html.matchAll(/<button\b([^>]*)>/g)].map(match=>({disabled:/\bdisabled\b/.test(match[1]),collapse:match[1].includes('data-team-task-collapse')}));
  return {html,buttons,details,closest:()=>null,isConnected:true,focus(){},alerts:[...html.matchAll(/<p class="notice error" role="alert">([^<]*)<\/p>/g)].map(match=>({textContent:match[1]})),querySelector:selector=>details.get(selector)||null,querySelectorAll:selector=>selector==='button'?buttons:[],append(node){this.alerts.push(node);},replaceWith(next){cards.set(id,next);}};
 };
 const document={querySelector:selector=>cards.get(selector.match(/"([^"]+)"/)?.[1])||null,createElement:tag=>{if(tag==='p')return {setAttribute(){}};assert.equal(tag,'template');const t={content:{}};Object.defineProperty(t,'innerHTML',{set:html=>t.content.firstElementChild=parse(html)});return t;}};
 const ctx=vm.createContext({workspacePageHeader,statusTone,me:{user_id:'worker',role:'owner'},view:'personal',personalSection:'task',document,CSS:{escape:String},crypto:{randomUUID:()=> 'request'},employeeDirectory:new Map([['worker',{user_id:'worker',active:true}]]),
  employeeName:()=> 'Employee',esc:value=>String(value??'').replaceAll('<','&lt;').replaceAll('>','&gt;'),actionForm:(_,__,callback)=>{submit=callback;},message:(text,error)=>messages.push({text,error}),
  client:{rpc:async(name,args)=>{calls.push({name,args});return {data:saved};}},all:async(table,columns,filter)=>{const call={table};const query={in(key,ids){call.ids=[...ids];return query;},order(){return query;}};filter(query);calls.push(call);return [{id:'move',task_id:'task',action:'reschedule',old_due_at:original.due_at,new_due_at:saved.due_at,note:'Confirmed new visit date',created_at:'2026-10-29T09:00:00Z'}];}
 });
 installDisclosureMotion(ctx);vm.runInContext(source,ctx);ctx.syncTeamTaskActor();ctx.seed=[original,{...original,id:'other'}];vm.runInContext('teamTasks=seed;teamTaskMore.set("1",{rows:seed,page:0,total:2,pages:1});teamTaskSelectedId="task"',ctx);ctx.teamTasksWorkspace=()=>assert.fail('No full workspace refresh');
 cards.set('task',parse(ctx.teamTaskCard(original)));cards.set('other',parse(ctx.teamTaskCard(ctx.seed[1])));cards.get('task').details.get('.team-task-moves').open=true;
 return {ctx,original,saved,cards,calls,messages,submit:values=>submit(values),get:code=>vm.runInContext(code,ctx)};
}
test('rescheduling uses the confirmed row and only that task history, retaining every other card',async()=>{
 const f=recordFixture(),other=f.cards.get('other');f.ctx.openTeamTaskReschedule(f.original);await f.submit({due:'2098-01-02T09:00',reason:'Confirmed new visit date'});
 assert.equal(f.calls.length,2);assert.equal(f.calls[0].name,'reschedule_team_task');assert.deepEqual(f.calls[1].ids,['task']);
 assert.equal(f.get('teamTasks[0].version'),2);assert.equal(f.get('teamTaskMore.get("1").rows[0].version'),2);
 assert.equal(f.cards.get('other'),other);assert.match(f.cards.get('task').html,/Changed &lt;title&gt;/);assert.match(f.cards.get('task').html,/Confirmed new visit date/);assert.equal(f.cards.get('task').details.get('.team-task-moves').open,true);
 assert.match(f.messages.at(-1).text,/Task moved/);
});
test('editing instructions for the same employee does not reload tasks or other panes',async()=>{
 const f=recordFixture();f.ctx.openTeamTaskEditor(f.original);await f.submit({title:'Changed title',details:'Updated instructions',urgency:'normal',due:'2098-01-02T09:00',assignee:'worker'});
 assert.equal(f.calls[0].name,'save_team_task');assert.equal(f.calls.length,2);assert.equal(f.get('teamTasks[0].version'),2);assert.equal(f.messages.at(-1).text,'Task updated.');
});
test('a successful task edit with failed history shows the saved state and disables stale controls',async()=>{
 const f=recordFixture();f.ctx.all=async()=>{throw Error('Offline');};f.ctx.openTeamTaskReschedule(f.original);await f.submit({due:'2098-01-02T09:00',reason:'Confirmed new visit date'});
 assert.equal(f.get('teamTasks[0].version'),2);assert.ok(f.cards.get('task').buttons.filter(button=>!button.collapse).every(button=>button.disabled));assert.match(f.cards.get('task').alerts[0].textContent,/Task saved.*History could not refresh/);assert.equal(f.messages.at(-1).error,true);
});
test('unconfirmed task response cannot render fabricated details or read history',async()=>{
 for(const change of [row=>({...row,id:'other'}),row=>({...row,version:1}),row=>({...row,assignee_user_id:'somebody'}),row=>({...row,version:10}),()=>({id:'task',status:'open',version:2,assigned_by:'worker',assignee_user_id:'worker'}),row=>[row,row],row=>({...row,task_number:''}),row=>({...row,due_at:'not a date'}),row=>({...row,reschedule_count:undefined}),()=>null]){
  const f=recordFixture();f.ctx.client.rpc=async()=>({data:change(f.saved)});f.ctx.openTeamTaskReschedule(f.original);await f.submit({due:'2098-01-02T09:00',reason:'Confirmed new visit date'});
  assert.equal(f.calls.length,0);assert.equal(f.get('teamTasks[0].version'),1);assert.ok(f.cards.get('task').buttons.every(button=>button.disabled));assert.equal(f.messages[0].error,true);assert.match(f.cards.get('task').alerts[0].textContent,/current details could not be verified/);
  f.ctx.currentTask=f.original;assert.match(f.ctx.teamTaskCard(f.original),/current details could not be verified/);assert.match(f.ctx.teamTaskCard(f.original),/<button disabled/);
 }
});
test('task edits discard history results after navigation or a same-ID replacement session',async()=>{
 for(const change of [f=>f.ctx.me={user_id:'worker',role:'owner'},f=>f.ctx.personalSection='notes',f=>f.ctx.clearTeamTasks()]){
  const f=recordFixture(),before=f.cards.get('task');let resolve;f.ctx.all=()=>new Promise(done=>{resolve=done;});f.ctx.openTeamTaskReschedule(f.original);
  const pending=f.submit({due:'2098-01-02T09:00',reason:'Confirmed new visit date'});await new Promise(setImmediate);change(f);resolve([]);await pending;
  assert.equal(f.cards.get('task'),before);assert.equal(f.messages.length,0);assert.notEqual(f.get('teamTasks[0]?.version'),2);
 }
});
test('failed task write retains existing DOM and cache without a history read',async()=>{
 const f=recordFixture(),before=f.cards.get('task');f.ctx.client.rpc=async()=>({error:{message:'Task changed; refresh'}});f.ctx.openTeamTaskReschedule(f.original);
 await assert.rejects(f.submit({due:'2098-01-02T09:00',reason:'Confirmed new visit date'}),/Task changed/);assert.equal(f.cards.get('task'),before);assert.equal(f.get('teamTasks[0].version'),1);assert.equal(f.calls.length,0);
});
test('failed task-history state survives rendering until a successful scoped history reload',async()=>{
 const f=recordFixture();f.get("teamTaskHistoryLoaded.add('task')");f.ctx.all=async()=>{throw Error('Offline');};f.ctx.openTeamTaskReschedule(f.original);await f.submit({due:'2098-01-02T09:00',reason:'Confirmed new visit date'});
 assert.equal(f.get("teamTaskHistoryLoaded.has('task')"),false);assert.match(f.get("teamTaskPage('1')"),/History could not refresh/);assert.match(f.get("teamTaskPage('1')"),/<button disabled/);
 f.ctx.all=async()=>[];f.ctx.client.from=()=>{const q={select:()=>q,eq:()=>q,maybeSingle:async()=>({data:f.saved})};return q;};f.ctx.renderTeamTaskGroups=()=>{};await f.ctx.openTeamTask('task');
 assert.equal(f.get("teamTaskHistoryLoaded.has('task')"),true);assert.equal(f.get("teamTaskRecordErrors.has('task')"),false);assert.doesNotMatch(f.get("teamTaskPage('1')"),/History could not refresh/);
});
test('rereading history alone cannot clear an unverified task row warning',async()=>{
 const f=recordFixture();f.ctx.client.rpc=async()=>({data:null});f.ctx.openTeamTaskReschedule(f.original);await f.submit({due:'2098-01-02T09:00',reason:'Confirmed new visit date'});
 await f.ctx.loadTeamTaskHistory(['task'],f.ctx.me,f.get('teamTaskEpoch'));
 assert.equal(f.get("teamTaskRecordErrors.get('task').kind"),'record');assert.match(f.get("teamTaskPage('1')"),/current details could not be verified/);assert.match(f.get("teamTaskPage('1')"),/<button disabled/);
});
