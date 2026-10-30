import {installDisclosureMotion} from './helpers/disclosure-motion.mjs';
import {workspacePageHeader} from './helpers/page-header.mjs';
import {statusTone} from './helpers/status-ui.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const read=file=>readFileSync(new URL('../'+file,import.meta.url),'utf8');
const deferred=()=>{let resolve,reject;const promise=new Promise((ok,bad)=>{resolve=ok;reject=bad});return {promise,resolve,reject};};
const task=(id='task',overrides={})=>({id,task_number:'TK-'+id,title:'Call <customer>',details:'Complete instructions',status:'open',urgency:'normal',assignee_user_id:'employee',assigned_by:'head',due_at:'2099-01-01T08:00:00.123456+00:00',version:4,reschedule_count:1,...overrides});
const request=(id='own',taskId='task',by='employee')=>({id,task_id:taskId,requested_by:by,status:'pending',old_due_at:'2099-01-01T08:00:00.123456+00:00',requested_due_at:'2099-01-02T08:00:00.654321+00:00',reason:'Customer <away> until tomorrow',created_at:'2026-10-29T08:00:00Z'});
const snapshot=(page=0,total=42,own=[])=>{page=Math.min(page,Math.max(0,Math.ceil(total/20)-1));const rows=[...Array.from({length:Math.min(20,total-page*20)},(_,n)=>request('decision-'+(page*20+n),'approval-'+(page*20+n),'other')),...own];return {rows,identities:rows.map(row=>({request_id:row.id,task_number:'TK-'+row.task_id,task_title:'Task <'+row.task_id+'>'})),total,page,pages:Math.max(1,Math.ceil(total/20))};};
function fixture(){
 const cards=new Map(),calls=[],reads=[],messages=[],forms=[],replaced=[],document={activeElement:null};let box=null;
 const dataset=html=>Object.fromEntries([...html.matchAll(/data-([\w-]+)="([^"]*)"/g)].map(match=>[match[1].replace(/-([a-z])/g,(_,letter)=>letter.toUpperCase()),match[2]]));
 const buttons=html=>[...html.matchAll(/<button\b([^>]*)>([^<]*)<\/button>/g)].map(match=>({dataset:dataset(match[1]),disabled:/\bdisabled\b/.test(match[1]),textContent:match[2],isConnected:true,hasAttribute(name){return Object.hasOwn(this.dataset,name.slice(5).replace(/-([a-z])/g,(_,letter)=>letter.toUpperCase()));},focus(){document.activeElement=this;}}));
 const matches=(element,selector)=>{const match=selector.match(/^\[data-([\w-]+)(?:="([^"]*)")?\]$/);if(!match)return false;const key=match[1].replace(/-([a-z])/g,(_,letter)=>letter.toUpperCase());return Object.hasOwn(element.dataset,key)&&(match[2]===undefined||element.dataset[key]===match[2]);};
 function cardFrom(html){
  const id=html.match(/data-team-task="([^"]+)"/)[1],card={closest:()=>null,dataset:{teamTask:id},html,isConnected:true,buttons:buttons(html),note:null,alerts:[],disclosure:{open:true},matches:selector=>selector==='[data-team-task]',querySelectorAll:selector=>selector==='button'?card.buttons:[]};
  const noteFrom=text=>{const node={dataset:dataset(text),html:text,remove(){card.note=null;}};Object.defineProperty(node,'outerHTML',{set:value=>{card.note=noteFrom(value);}});return node;};
  const add=text=>{if(text.includes('data-deadline-request-note'))card.note=noteFrom(text);else{for(const button of buttons(text)){button.remove=()=>{card.buttons=card.buttons.filter(item=>item!==button);};card.buttons.push(button);}}};
  card.actions={insertAdjacentHTML:(position,text)=>add(text)};card.insertAdjacentHTML=(position,text)=>add(text);card.append=node=>card.alerts.push(node);
  for(const button of card.buttons)button.remove=()=>{card.buttons=card.buttons.filter(item=>item!==button);};
  card.querySelector=selector=>selector==='.actions'?card.actions:selector==='[data-deadline-request-note]'?card.note:selector==='button'?card.buttons[0]:selector==='details'?card.disclosure:card.buttons.find(button=>matches(button,selector))||null;
  return card;
 }
 const target={isConnected:true,insertAdjacentHTML(position,html){
  assert.equal(position,'beforebegin');let body='';const panel={buttons:[],querySelectorAll:selector=>panel.buttons.filter(button=>matches(button,selector))};
  Object.defineProperty(panel,'innerHTML',{get:()=>body,set:value=>{body=value;panel.buttons=buttons(value);}});
  const next={html,open:/<details[^>]*\sopen(?:\s|>)/.test(html),isConnected:true,panel,retry:html.includes('data-deadline-retry')?{}:null,querySelector:selector=>selector==='[data-deadline-page]'?panel:null,remove(){this.isConnected=false;if(box===this)box=null;}};
  box=next;
 }};
 document.querySelectorAll=selector=>selector==='[data-team-task]'?[...cards.values()].filter(card=>card.isConnected):[];
 document.querySelector=selector=>{if(selector==='[data-deadline-requests]')return box;if(selector==='[data-deadline-retry]')return box?.retry;const id=selector.match(/^\[data-team-task="([^"]+)"\]/)?.[1];const card=cards.get(id);return selector.endsWith(' button')?card?.buttons[0]:card||null;};
 document.createElement=tag=>{assert.equal(tag,'p');return {setAttribute(){}};};
 const c=vm.createContext({workspacePageHeader,statusTone,document,$:selector=>selector==='#teamTaskRelated'?target:null,me:{user_id:'employee',role:'staff'},view:'personal',personalSection:'task',CSS:{escape:String},esc:value=>String(value??'').replace(/[&<>"']/g,char=>'&#'+char.charCodeAt(0)+';'),employeeName:id=>id,
  crypto:{randomUUID:()=> 'request-id'},actionForm:(title,fields,submit)=>forms.push({title,fields,submit}),message:(...args)=>messages.push(args),run:async fn=>{const pending=fn();c.pendingRun=pending;return pending;},
  client:{rpc:async(name,args)=>{calls.push({name,args});return c.response?c.response(name,args):{data:c.data};},from:table=>{let id;const q={select:()=>q,eq:(key,value)=>{assert.equal(key,'id');id=value;return q;},maybeSingle:async()=>{reads.push({table,id});return {data:c.freshTask};}};return q;}},
  all:async(table,columns,filter)=>{const query={in(key,ids){reads.push({table,ids:[...ids]});return query;},order(){return query;}};filter(query);return [];}
 });
 installDisclosureMotion(c);for(const file of ['team-tasks.js','deadline-requests.js'])vm.runInContext(read(file),c);
 c.seed=[task(),task('summary'),task('unrelated')];c.syncTeamTaskActor();vm.runInContext('teamTasks=seed;teamTaskSelectedId="task";teamTaskMore.set("forMe",{rows:seed,page:0,total:3,pages:1})',c);
 cards.set('task',cardFrom(c.teamTaskCard(c.seed[0])));cards.set('summary',cardFrom(c.teamTaskSummaryCard(c.seed[1])));cards.set('unrelated',cardFrom(c.teamTaskCard(c.seed[2])));
 c.data=snapshot();c.freshTask=task('task',{version:5,reschedule_count:2,due_at:'2099-01-02T08:00:00.654321+00:00'});
 // The existing Open path owns the full read/history. Observe its render boundary
 // using the actual task-card renderer, without duplicating that loading logic.
 c.renderTeamTaskGroups=()=>{const row=vm.runInContext('teamTasks.find(row=>row.id===teamTaskSelectedId)',c);if(row){cards.get(row.id).isConnected=false;cards.set(row.id,cardFrom(c.teamTaskCard(row)));replaced.push(row.id);c.decorateTaskDeadlineNotes(cards.get(row.id));}};
 c.teamTasksWorkspace=async()=>reads.push({workspace:true});
 return {c,cards,calls,reads,messages,forms,target,replaced,get:code=>vm.runInContext(code,c),box:()=>box,open:()=>{box.open=true;box.ontoggle();},step:async direction=>{box.panel.buttons.find(button=>button.dataset.deadlinePageStep===direction).onclick();await c.pendingRun;}};
}
test('deadline landing makes one bounded request, mounts only the count until expanded, and sends visible task IDs',async()=>{
 const f=fixture();await f.c.renderDeadlineRequests(f.target);assert.equal(f.calls.length,1);assert.equal(f.calls[0].name,'deadline_request_page');assert.deepEqual([...f.calls[0].args.p_task_ids],['task','summary','unrelated']);assert.equal(f.box().open,false);assert.equal(f.box().panel.innerHTML,'');assert.match(f.box().html,/waiting for you · 42/);assert.equal(f.reads.length,0);
 f.open();assert.equal((f.box().panel.innerHTML.match(/data-deadline-request=/g)||[]).length,20);assert.match(f.box().panel.innerHTML,/Task &#60;approval-0&#62;/);assert.match(f.box().panel.innerHTML,/Customer &#60;away&#62;/);assert.equal(f.calls.length,1);
});
test('approval paging renders only the new page and preserves expansion and unrelated task nodes',async()=>{
 const f=fixture(),original=[...f.cards.values()];f.c.response=(name,args)=>({data:snapshot(args.p_page)});await f.c.renderDeadlineRequests(f.target);f.open();const first=f.box();await f.step('next');
 assert.equal(f.calls.length,2);assert.equal(f.calls[1].args.p_page,1);assert.equal(first.isConnected,false);assert.equal(f.box().open,true);assert.match(f.box().panel.innerHTML,/decision-20/);assert.doesNotMatch(f.box().panel.innerHTML,/data-deadline-request="decision-0"/);assert.deepEqual([...f.cards.values()],original);
 await f.step('next');assert.equal((f.box().panel.innerHTML.match(/data-deadline-request=/g)||[]).length,2);assert.equal(f.box().panel.buttons.find(button=>button.dataset.deadlinePageStep==='next').disabled,true);await f.step('previous');assert.equal(f.get('deadlinePage'),1);
});
test('pending own requests mark both summaries and details without consuming approval count or duplicating notes',async()=>{
 const f=fixture();f.c.data=snapshot(0,0,[request(),request('own-summary','summary')]);const original=[...f.cards.values()];await f.c.renderDeadlineRequests(f.target);
 assert.equal(f.box(),null);assert.equal(f.cards.get('task').querySelector('[data-team-task-ask]'),null);assert.ok(f.cards.get('task').note);assert.ok(f.cards.get('summary').note);assert.ok(f.cards.get('summary').querySelector('[data-team-task-open]'));
 const note=f.cards.get('task').note;f.c.decorateTaskDeadlineNotes();assert.equal(f.cards.get('task').note,note);assert.deepEqual([...f.cards.values()],original);assert.equal(f.cards.get('unrelated').note,null);
 f.c.data=snapshot(0,0,[{...request('new-own'),reason:'Different reason'}]);await f.c.renderDeadlineRequests(f.target);assert.equal(f.cards.get('task').note.dataset.deadlineRequestId,'new-own');assert.match(f.cards.get('task').note.html,/Different reason/);
});
test('a disappeared own request removes the stale note and requires a fresh task read before another write',async()=>{
 const f=fixture(),card=f.cards.get('task'),other=f.cards.get('unrelated'),focused=other.buttons[0];focused.focus();f.c.data=snapshot(0,0,[request()]);await f.c.renderDeadlineRequests(f.target);
 f.c.data=snapshot(0,0);await f.c.renderDeadlineRequests(f.target);assert.equal(card.note,null);assert.equal(f.cards.get('task'),card);assert.equal(f.cards.get('unrelated'),other);assert.equal(other.disclosure.open,true);assert.equal(f.c.document.activeElement,focused);
 assert.equal(card.querySelector('[data-team-task-ask]'),null);assert.ok(card.buttons.filter(button=>!button.hasAttribute('data-team-task-open')&&!button.hasAttribute('data-team-task-collapse')).every(button=>button.disabled));
 const review=card.querySelector('[data-team-task-open]');assert.equal(review.textContent,'Review updated task');assert.equal(review.disabled,false);assert.equal(card.querySelector('[data-team-task-collapse]').disabled,false);assert.equal(f.get('teamTasks[0].version'),4);assert.equal(f.get('teamTaskRecordErrors.get("task").kind'),'deadline');assert.equal(f.reads.length,0);
 f.c.decorateTaskDeadlineNotes();assert.equal(card.buttons.filter(button=>button.hasAttribute('data-team-task-open')).length,1);assert.equal(card.alerts.length,1);
 await f.c.openTeamTask('task');assert.equal(f.get('teamTasks.find(row=>row.id==="task").version'),5);assert.equal(f.get('teamTaskRecordErrors.has("task")'),false);assert.equal(f.get('teamTaskHistoryLoaded.has("task")'),true);assert.ok(f.cards.get('task').querySelector('[data-team-task-ask]'));assert.equal(f.cards.get('task').querySelector('[data-team-task-open]'),null);assert.deepEqual(f.reads,[{table:'team_tasks',id:'task'},{table:'team_task_events',ids:['task']}]);
 f.c.refreshSavedDeadlineRequest=async()=>{};f.c.openDeadlineRequest(f.get('teamTasks.find(row=>row.id==="task")'));f.c.response=()=>({data:{}});await f.forms.at(-1).submit({due:'2099-01-03T08:00',reason:'Customer still needs more time'});assert.equal(f.calls.at(-1).name,'request_team_task_reschedule');assert.equal(f.calls.at(-1).args.p_expected_version,5);
});
test('disappeared summary notes keep only Open task, without inventing Ask controls or changing complete caches',async()=>{
 const f=fixture(),summary=f.cards.get('summary');f.c.data=snapshot(0,0,[request('own-summary','summary')]);await f.c.renderDeadlineRequests(f.target);f.c.data=snapshot(0,0);await f.c.renderDeadlineRequests(f.target);
 assert.equal(summary.note,null);assert.equal(f.cards.get('summary'),summary);assert.ok(summary.querySelector('[data-team-task-open]'));assert.equal(summary.querySelector('[data-team-task-ask]'),null);assert.equal(f.get('teamTaskRecordErrors.has("summary")'),false);assert.equal(f.reads.length,0);
});
test('focus on a newly disabled action moves to the usable review control',async()=>{
 const f=fixture();f.c.data=snapshot(0,0,[request()]);await f.c.renderDeadlineRequests(f.target);f.cards.get('task').querySelector('[data-team-task-comment]').focus();f.c.data=snapshot(0,0);await f.c.renderDeadlineRequests(f.target);assert.equal(f.c.document.activeElement,f.cards.get('task').querySelector('[data-team-task-open]'));
});
for(const change of [{status:'done',closed_at:'2099-01-02T00:00:00Z'}, {reschedule_count:3}, {assignee_user_id:'other'}])test(`fresh Open retains task eligibility after ${JSON.stringify(change)}`,async()=>{
 const f=fixture();f.c.data=snapshot(0,0,[request()]);await f.c.renderDeadlineRequests(f.target);f.c.data=snapshot(0,0);await f.c.renderDeadlineRequests(f.target);f.c.freshTask={...f.c.freshTask,...change};await f.c.openTeamTask('task');assert.equal(f.cards.get('task').querySelector('[data-team-task-ask]'),null);assert.equal(f.get('teamTasks.find(row=>row.id==="task").version'),5);
});
test('recovery persists across an affected detail redraw and clears only after its current record and history load',async()=>{
 const f=fixture();f.c.data=snapshot(0,0,[request()]);await f.c.renderDeadlineRequests(f.target);f.c.data=snapshot(0,0);await f.c.renderDeadlineRequests(f.target);f.c.renderTeamTaskGroups();
 const card=f.cards.get('task');assert.match(card.html,/Deadline request changed/);assert.equal(card.querySelector('[data-team-task-open]').disabled,false);assert.ok(card.buttons.filter(button=>!button.hasAttribute('data-team-task-open')&&!button.hasAttribute('data-team-task-collapse')).every(button=>button.disabled));
 f.c.all=async()=>{throw Error('History offline');};await f.c.openTeamTask('task');assert.equal(f.cards.get('task'),card);assert.equal(f.get('teamTaskRecordErrors.has("task")'),true);assert.match(f.messages.at(-1)[0],/History offline/);
});
test('a later deadline-page failure cannot remove the usable recovery action on a detail redraw',async()=>{
 const f=fixture();f.c.data=snapshot(0,0,[request()]);await f.c.renderDeadlineRequests(f.target);f.c.data=snapshot(0,0);await f.c.renderDeadlineRequests(f.target);f.c.response=()=>({error:{message:'Offline'}});await f.c.renderDeadlineRequests(f.target);f.c.renderTeamTaskGroups();assert.equal(f.cards.get('task').querySelector('[data-team-task-open]').disabled,false);assert.equal(f.get('teamTaskRecordErrors.get("task").kind'),'deadline');
});
test('a page failure shows Retry while keeping the last task notes; successful retry reconciles disappeared requests',async()=>{
 const f=fixture();f.c.data=snapshot(0,0,[request()]);await f.c.renderDeadlineRequests(f.target);const note=f.cards.get('task').note;
 f.c.response=()=>({error:{message:'Offline <failure>'}});await f.c.renderDeadlineRequests(f.target);assert.match(f.box().html,/role="alert"/);assert.match(f.box().html,/Offline &#60;failure&#62;/);assert.equal(f.cards.get('task').note,note);f.c.decorateTaskDeadlineNotes();assert.equal(f.cards.get('task').note,note,'unknown pending state cannot remove a note or restore Ask');
 f.c.response=()=>({data:snapshot(0,0)});const retry=f.box().retry;await retry.onclick();assert.equal(f.box(),null);assert.equal(f.cards.get('task').note,null);assert.equal(f.cards.get('task').querySelector('[data-team-task-open]').disabled,false);
});
for(const change of ['actor','same-user-session','clear','detached','route','section'])test(`${change} invalidation discards late deadline results and errors`,async()=>{
 for(const fail of [false,true]){const f=fixture(),wait=deferred();f.c.response=()=>wait.promise;const pending=f.c.renderDeadlineRequests(f.target);if(change==='actor')f.c.me={user_id:'other',role:'staff'};if(change==='same-user-session')f.c.me={user_id:'employee',role:'staff'};if(change==='clear')f.c.clearDeadlineRequests();if(change==='detached')f.target.isConnected=false;if(change==='route')f.c.view='reports';if(change==='section')f.c.personalSection='event';
  if(fail)wait.reject(Error('Late private error'));else wait.resolve({data:snapshot(0,0,[request()])});await pending;assert.equal(f.box(),null);assert.equal(f.get('deadlineRequests.length'),0);assert.equal(f.get('deadlinePageData'),null);assert.equal(f.cards.get('task').note,null);
 }
});
test('a newer page wins over old success and failure without corrupting notes or its count',async()=>{
 for(const fail of [false,true]){const f=fixture(),wait=deferred();f.c.response=()=>wait.promise;const old=f.c.renderDeadlineRequests(f.target);f.c.response=()=>({data:snapshot(1,42,[request()])});await f.c.renderDeadlineRequests(f.target);f.open();const latest=f.box(),note=f.cards.get('task').note;
  if(fail)wait.reject(Error('Old request error'));else wait.resolve({data:snapshot(0,0)});await old;assert.equal(f.box(),latest);assert.equal(f.cards.get('task').note,note);assert.equal(f.get('deadlinePageData.page'),1);assert.equal(f.get('deadlinePageData.total'),42);
 }
});
test('notes outside the requested visible-task scope are not assumed resolved',async()=>{
 const f=fixture();f.c.data=snapshot(0,0,[request()]);await f.c.renderDeadlineRequests(f.target);const note=f.cards.get('task').note;f.c.teamTaskPageIds=()=>['summary'];f.c.data=snapshot(0,0);await f.c.renderDeadlineRequests(f.target);assert.equal(f.cards.get('task').note,note);assert.equal(f.get('teamTaskRecordErrors.has("task")'),false);
});
test('a new actor cannot decorate from the prior actor pending cache',async()=>{
 const f=fixture();f.c.data=snapshot(0,0,[request()]);await f.c.renderDeadlineRequests(f.target);const old=f.cards.get('task').note;f.c.me={user_id:'employee',role:'staff'};f.c.decorateTaskDeadlineNotes();assert.equal(f.cards.get('task').note,old);assert.equal(f.get('teamTaskRecordErrors.size'),0);
});
test('invalid page payloads fail visibly and cannot decorate tasks or expose decisions',async()=>{
 for(const data of [{...snapshot(),rows:Array(101).fill(request())},{...snapshot(),page:-1},{...snapshot(),pages:0},{...snapshot(),identities:null}]){const f=fixture();f.c.data=data;await f.c.renderDeadlineRequests(f.target);assert.match(f.box().html,/could not be confirmed/);assert.equal(f.get('deadlinePageData'),null);assert.equal(f.cards.get('task').note,null);assert.equal(f.box().panel.innerHTML,'');}
});
test('missing original task identity disables decisions and cannot open a decision form',async()=>{
 const f=fixture();f.c.data={...snapshot(0,1),identities:[]};await f.c.renderDeadlineRequests(f.target);f.open();assert.ok(f.box().panel.buttons.filter(button=>button.hasAttribute('data-deadline-decide')).every(button=>button.disabled));f.c.openDeadlineDecision(f.get('deadlineRequests[0]'),'approved');assert.equal(f.forms.length,0);assert.match(f.messages.at(-1)[0],/identity is unavailable/);
});
