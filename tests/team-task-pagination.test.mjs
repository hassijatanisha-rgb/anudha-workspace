import {installDisclosureMotion} from './helpers/disclosure-motion.mjs';
import {workspacePageHeader} from './helpers/page-header.mjs';
import {statusTone} from './helpers/status-ui.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../team-tasks.js',import.meta.url),'utf8'),keys=['forMe','gave','results','finished'];
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const task=(key,n)=>({id:`${key}-${n}`,title:`Task <${n}>`,task_number:`TK-${n}`,assignee_user_id:key==='gave'||key==='results'?'other':'employee',assigned_by:key==='gave'||key==='results'?'employee':'manager',status:key==='results'||key==='finished'?'done':'open',due_at:'2099-01-01T09:00:00.123456+00:00',closed_at:key==='results'||key==='finished'?'2026-10-29T09:00:00Z':null,urgency:'normal'});
function snapshot(offsets={}){return {groups:Object.fromEntries(keys.map((key,i)=>{const total=81+i,page=Math.min(offsets[key]||0,Math.ceil(total/20)-1);return [key,{total,page,pages:Math.ceil(total/20),rows:Array.from({length:Math.min(20,total-page*20)},(_,n)=>task(key,page*20+n))}]}))};}
function fixture(){
 const nodes=new Map(),groups=new Map(),calls=[],reads=[],messages=[],focused=[],seen=[];
 const parseCards=html=>new Map([...html.matchAll(/<article[^>]*data-team-task="([^"]+)"[\s\S]*?<\/article>/g)].map(m=>[m[1],{html:m[0],isConnected:true,closest:()=>[...groups.values()].find(group=>group.target.cards.has(m[1]))||null,querySelector:()=>null,focus(){focused.push(m[1])}}]));
 const node=()=>{let html='';const n={isConnected:true,querySelectorAll:()=>[],querySelector:()=>({})};Object.defineProperty(n,'innerHTML',{get:()=>html,set:value=>{html=value;for(const match of value.matchAll(/<details class="team-task-group" data-team-task-group="([^"]+)"\s*([^>]*)><summary>(.*?)<\/summary><div data-team-task-page="[^"]+">([\s\S]*?)(?=<\/div><\/details>)/g)){
  const key=match[1],old=groups.get(key);if(old){old.isConnected=false;old.target.isConnected=false;for(const card of old.target.cards.values())card.isConnected=false;}
  let body=match[4];const target={isConnected:true,querySelectorAll:()=>[],closest:()=>groups.get(key),cards:parseCards(body),querySelector:()=>({focus:()=>focused.push(key)}),scrollIntoView(){}};Object.defineProperty(target,'innerHTML',{get:()=>body,set:v=>{for(const card of target.cards.values())card.isConnected=false;body=v;target.cards=parseCards(v);}});
  const summary={setAttribute(){},addEventListener(){}},details={addEventListener(){},dataset:{teamTaskGroup:key},open:/\bopen\b/.test(match[2]),isConnected:true,target,querySelector:selector=>selector==='summary'?summary:target};groups.set(key,details);
 }}});return n;};
 for(const key of ['#content','#manualTasks','#teamTaskFinished','#orderSteps','#teamTaskRelated','#teamTaskRefresh','#teamTaskNew','#teamTaskRetry'])nodes.set(key,node());
 const document={querySelectorAll:selector=>selector==='[data-team-task-group]'?[...groups.values()]:[],querySelector:selector=>{if(nodes.has(selector))return nodes.get(selector);const key=selector.match(/data-team-task-page="([^"]+)"/)?.[1];if(key)return groups.get(key)?.target;const id=selector.match(/data-team-task="([^"]+)"/)?.[1];return [...groups.values()].map(group=>group.target.cards.get(id)).find(Boolean)||null;}};
 const c=vm.createContext({workspacePageHeader,statusTone,me:{user_id:'employee',role:'staff'},view:'personal',personalSection:'task',document,CSS:{escape:String},$:selector=>nodes.get(selector),employeeName:id=>id,esc:v=>String(v??'').replace(/[&<>"']/g,ch=>'&#'+ch.charCodeAt(0)+';'),workspaceRefreshRetaining:()=>false,run:fn=>fn(),message:(text,error)=>messages.push({text,error}),bellMarkSeen:(_,kinds)=>seen.push(...kinds),
  client:{rpc:async(name,args)=>{calls.push({name,args});return {data:snapshot({forMe:args.p_for_me_page,gave:args.p_gave_page,results:args.p_results_page,finished:args.p_finished_page})};},from:table=>{const q={select(){return q},eq(key,id){q.id=id;return q},async maybeSingle(){reads.push({table,id:q.id});if(c.detailError)throw Error(c.detailError);const [key,n]=q.id.split('-');return {data:{...task(key,Number(n)),version:1,reschedule_count:0,details:'Full <instructions>',close_note:''}};}};return q;}},
  all:async(table,cols,filter)=>{const q={in(key,ids){q.ids=[...ids];return q},order(){return q}};filter(q);reads.push({table,ids:q.ids});if(c.historyError)throw Error(c.historyError);return q.ids.flatMap(id=>Array.from({length:25},(_,i)=>({id:id+'-'+i,task_id:id,action:'progress',note:'Private <progress> '+i,actor_user_id:'employee',created_at:'2026-10-29T09:00:00Z'})));}
 });vm.runInContext('function workspaceSkeleton(kind,label)'+readFileSync(new URL('../workspace-refresh.js',import.meta.url),'utf8').split('function workspaceSkeleton(kind,label)')[1].split('function workspaceLoading')[0],c);installDisclosureMotion(c);vm.runInContext(source,c);return {c,nodes,groups,calls,reads,messages,focused,seen,get:code=>vm.runInContext(code,c),html:()=>[...groups.values()].map(group=>group.target.innerHTML).join(''),button:(key,direction='next')=>({dataset:{teamTaskMore:key,direction},closest:()=>groups.get(key).target})};
}
test('cold tasks use one bounded RPC, exact four counts and only To do summaries with no full records/history',async()=>{
 const f=fixture();await f.c.teamTasksWorkspace();assert.deepEqual(f.calls.map(call=>call.name),['team_task_page']);assert.deepEqual(f.reads,[]);assert.equal(f.get('teamTasks.length'),0);assert.equal(f.get('teamTaskEvents.size'),0);
 assert.equal(f.get('[...teamTaskMore.values()].reduce((n,g)=>n+g.rows.length,0)'),80);assert.equal((f.html().match(/data-team-task="/g)||[]).length,20);assert.ok(f.html().replace(/<[^>]*>/g,' ').split(/\s+/).length<3000);assert.ok((f.html().match(/<[a-z]/g)||[]).length<2000);
 assert.equal(f.groups.get('forMe').open,true);for(const key of keys.slice(1)){assert.equal(f.groups.get(key).open,false);assert.equal(f.groups.get(key).target.innerHTML,'');assert.equal(f.get(`teamTaskMore.get('${key}').total`),snapshot().groups[key].total);}
 assert.match(f.html(),/Task &#60;0&#62;/);assert.doesNotMatch(f.html(),/data-team-task-edit|data-team-task-comment|Full progress|Full &#60;instructions/);assert.deepEqual(f.seen,['tasks','results']);
});
test('expanding a group uses cached summaries; independent server paging does not load histories',async()=>{
 const f=fixture();await f.c.teamTasksWorkspace();const gave=f.groups.get('gave');gave.open=true;gave.ontoggle();assert.equal(f.calls.length,1);assert.equal((gave.target.innerHTML.match(/data-team-task="/g)||[]).length,20);
 await f.c.changeTeamTaskPage(f.button('gave'));assert.equal(f.calls[1].args.p_gave_page,1);assert.equal(f.calls[1].args.p_for_me_page,0);assert.match(f.groups.get('gave').target.innerHTML,/21–40 of 82/);assert.equal(f.groups.get('gave').open,true);assert.equal(f.get('teamTaskMore.get("forMe").page'),0);assert.equal(f.reads.length,0);assert.equal(f.focused.at(-1),'gave');
 await f.c.changeTeamTaskPage(f.button('forMe'));assert.equal(f.calls[2].args.p_gave_page,1);assert.equal(f.calls[2].args.p_for_me_page,1);
});
test('Open task reads only its complete record and full history, retaining exact due timestamp and one detail',async()=>{
 const f=fixture();await f.c.teamTasksWorkspace();await f.c.openTeamTask('forMe-0');assert.deepEqual(f.reads,[{table:'team_tasks',id:'forMe-0'},{table:'team_task_events',ids:['forMe-0']}]);assert.equal(f.get('teamTasks[0].due_at'),'2099-01-01T09:00:00.123456+00:00');assert.equal(f.get('teamTaskEvents.get("forMe-0").length'),25);assert.match(f.html(),/Full &#60;instructions&#62;/);assert.match(f.html(),/Full progress history · 25/);assert.match(f.html(),/data-team-task-comment="forMe-0"/);
 await f.c.openTeamTask('forMe-1');assert.equal((f.html().match(/Full progress history/g)||[]).length,1);assert.equal(f.get('teamTaskSelectedId'),'forMe-1');assert.equal(f.calls.length,1);
});
test('detail and history failures expose no partial editing state or erase recovery warnings',async()=>{
 for(const key of ['detailError','historyError']){const f=fixture();await f.c.teamTasksWorkspace();f.get('teamTaskRecordErrors.set("forMe-0",{kind:"record",text:"Unverified"})');f.c[key]='Offline <details>';await f.c.openTeamTask('forMe-0');assert.equal(f.get('teamTaskSelectedId'),'');assert.equal(f.get('teamTasks.length'),0);assert.equal(f.get('teamTaskHistoryLoaded.size'),0);assert.equal(f.get('teamTaskRecordErrors.get("forMe-0").kind'),'record');assert.doesNotMatch(f.html(),/data-team-task-edit/);assert.match(f.messages[0].text,/Offline/);
  delete f.c[key];await f.c.openTeamTask('forMe-0');assert.equal(f.get('teamTaskRecordErrors.has("forMe-0")'),false);}
});
test('same-id actor replacement clears every complete cache and stale page success or error cannot overwrite the new page',async()=>{
 for(const failure of [false,true]){const f=fixture();await f.c.teamTasksWorkspace();await f.c.openTeamTask('forMe-0');f.get('teamTaskRecordErrors.set("forMe-0",{kind:"record"})');const pending=deferred();f.c.client.rpc=()=>pending.promise;const old=f.c.teamTasksWorkspace();f.c.me={user_id:'employee',role:'head'};f.c.client.rpc=async()=>({data:snapshot({forMe:2})});await f.c.teamTasksWorkspace();const html=f.html();if(failure)pending.reject(Error('Old request'));else pending.resolve({data:snapshot()});await old;assert.equal(f.html(),html);assert.equal(f.get('teamTasks.length'),0);assert.equal(f.get('teamTaskEvents.size'),0);assert.equal(f.get('teamTaskRecordErrors.size'),0);assert.equal(f.get('teamTaskMore.get("forMe").page'),2);}
});
test('stale selected records or history cannot appear after another open, navigation or clear',async()=>{
 for(const mode of ['actor','section','clear','newer']){const f=fixture();await f.c.teamTasksWorkspace();const wait=deferred();f.c.all=()=>wait.promise;const pending=f.c.openTeamTask('forMe-0');await new Promise(setImmediate);
  if(mode==='actor')f.c.me={user_id:'employee',role:'head'};if(mode==='section')f.c.personalSection='notes';if(mode==='clear')f.c.clearTeamTasks();if(mode==='newer'){f.c.all=async()=>[];await f.c.openTeamTask('forMe-1');}
  const html=f.html();wait.resolve([{id:'old',task_id:'forMe-0',action:'progress',note:'Old private history'}]);await pending;assert.equal(f.html(),html);assert.equal(f.get('teamTaskEvents.has("forMe-0")'),false);assert.equal(f.messages.length,0);
 }
});
test('newer independent page requests retain both requested offsets and ignore late responses',async()=>{
 const f=fixture();await f.c.teamTasksWorkspace();const wait=deferred();f.c.client.rpc=()=>wait.promise;const old=f.c.changeTeamTaskPage(f.button('forMe'));let args;f.c.client.rpc=async(name,a)=>{args=a;return {data:snapshot({forMe:a.p_for_me_page,gave:a.p_gave_page})};};await f.c.changeTeamTaskPage(f.button('gave'));wait.resolve({data:snapshot({forMe:1})});await old;assert.equal(args.p_for_me_page,1);assert.equal(args.p_gave_page,1);assert.equal(f.get('teamTaskMore.get("gave").page'),1);assert.equal(f.get('teamTaskMore.get("forMe").page'),1);
});
test('malformed pages fail closed and navigation discards pending snapshots',async()=>{
 const f=fixture(),bad=snapshot();bad.groups.forMe.rows.push(task('forMe',20));f.c.client.rpc=async()=>({data:bad});await f.c.teamTasksWorkspace();assert.match(f.nodes.get('#manualTasks').innerHTML,/could not be confirmed/);assert.equal(f.get('teamTaskMore.size'),0);
 const wait=deferred();f.c.client.rpc=()=>wait.promise;const old=f.c.teamTasksWorkspace();f.c.personalSection='notes';f.nodes.get('#manualTasks').innerHTML='Notes';wait.resolve({data:snapshot()});await old;assert.equal(f.nodes.get('#manualTasks').innerHTML,'Notes');assert.equal(f.get('teamTaskMore.size'),0);
});
test('old summary clicks and close dialogs cannot act for a replacement actor',async()=>{
 const f=fixture();await f.c.teamTasksWorkspace();const button=f.button('forMe');f.c.me={user_id:'employee',role:'head'};assert.equal(f.c.teamTaskPageIds().length,0);await f.c.openTeamTask('forMe-0');await f.c.changeTeamTaskPage(button);assert.equal(f.calls.length,1);assert.equal(f.reads.length,0);
 for(const stage of ['before','after']){const g=fixture();await g.c.teamTasksWorkspace();let submit;g.c.actionForm=(_,__,fn)=>{submit=fn};g.c.openTeamTaskClose(task('forMe',0),'cancel');const wait=deferred();g.c.client.rpc=()=>wait.promise;
  if(stage==='before'){g.c.me={user_id:'employee',role:'head'};await assert.rejects(submit({note:'No longer required'}),/Login or task view changed/);}
  else{const pending=submit({note:'No longer required'});g.c.me={user_id:'employee',role:'head'};g.c.teamTasksWorkspace=()=>assert.fail('Stale close must not refresh');wait.resolve({data:{}});await pending;assert.equal(g.messages.length,0);}
 }
});
test('deadline requests start after bounded IDs commit, refresh only when IDs change and decorate opened details without extra reads',async()=>{
 const f=fixture(),wait=deferred(),scopes=[],decorated=[];f.c.client.rpc=()=>wait.promise;f.c.renderDeadlineRequests=async()=>{scopes.push([...f.c.teamTaskPageIds()]);};f.c.decorateTaskDeadlineNotes=root=>decorated.push(root||'document');
 const loading=f.c.teamTasksWorkspace();assert.equal(scopes.length,0);wait.resolve({data:snapshot()});await loading;assert.equal(scopes.length,1);assert.equal(scopes[0].length,80);assert.equal(new Set(scopes[0]).size,80);
 await f.c.openTeamTask('forMe-0');assert.equal(scopes.length,1);assert.equal(decorated.length,2);f.c.client.rpc=async(name,args)=>({data:snapshot({forMe:args.p_for_me_page})});
 await f.c.changeTeamTaskPage(f.button('forMe','previous'));assert.equal(scopes.length,1);await f.c.changeTeamTaskPage(f.button('forMe'));assert.equal(scopes.length,2);assert.ok(scopes[1].includes('forMe-20'));assert.ok(!scopes[1].includes('forMe-0'));
});
