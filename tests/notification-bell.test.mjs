import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const read=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8');
const plain=value=>JSON.parse(JSON.stringify(value));
// A query builder that records every call, and answers with the given count / rows.
function fakeClient(answer=()=>({count:0,data:[],error:null})){
 const queries=[];
 return {queries,from(table){
  const q={table,calls:[]};queries.push(q);
  const builder=new Proxy({},{get(_,name){
   if(name==='then')return (ok,bad)=>Promise.resolve(answer(q)).then(ok,bad);
   return (...args)=>{q.calls.push([name,...args]);return builder;};
  }});
  return builder;
 }};
}
function load(extra={}){
 const ctx=vm.createContext({workspaceLoading(){},workspaceRefreshRetaining:()=>false,esc:s=>String(s??'').replace(/[&<>"']/g,c=>'&#'+c.charCodeAt(0)+';'),employeeName:id=>({a:'Amina',j:'Jagroop'})[id]||'?',
  document:{addEventListener(){},getElementById:()=>null,querySelector:()=>null,hidden:false},setInterval:()=>0,Date,...extra});
 vm.runInContext(read('notification-bell.js')+';Object.assign(globalThis,{bellKinds});',ctx);return ctx;
}

test('the badge counts tasks, handoffs, results and unread order updates for the signed-in person',async()=>{
 const client=fakeClient(q=>({count:q.table==='work_assignments'?2:1,error:null}));
 const box={querySelector:()=>({setAttribute(){},textContent:'',hidden:false})};
 const ctx=load({client,me:{user_id:'me1'},document:{addEventListener(){},getElementById:id=>id==='identity'||id==='bell'?box:null,querySelector:()=>null}});
 await ctx.refreshNotificationBell(true);
 assert.equal(client.queries.length,4);
 for(const q of client.queries)assert.deepEqual(plain(q.calls[0]),['select','id',{count:'exact',head:true}],'count only, no rows');
 const [tasks,work,results]=client.queries.map(q=>q.calls.slice(1));
 assert.equal(client.queries[0].table,'team_tasks');
 assert.deepEqual(plain(tasks),[['eq','assignee_user_id','me1'],['neq','assigned_by','me1'],['eq','status','open']],'given to me by someone else, still open; nothing seen yet');
 assert.equal(client.queries[1].table,'work_assignments');
 assert.deepEqual(plain(work),[['eq','assignee_user_id','me1'],['neq','assigned_by','me1'],['eq','status','open']]);
 assert.equal(client.queries[2].table,'team_tasks');
 assert.deepEqual(plain(results.slice(0,4)),[['eq','assigned_by','me1'],['neq','assignee_user_id','me1'],['neq','closed_by','me1'],['in','status',['done','cancelled']]]);
 assert.equal(results[4][0],'gt');assert.equal(results[4][1],'closed_at');
 assert.ok(Math.abs(Date.parse(results[4][2])-(Date.now()-7*864e5))<60000,'results look back 7 days');
 assert.equal(client.queries[3].table,'work_notices');
 assert.deepEqual(plain(client.queries[3].calls.slice(1)),[['eq','user_id','me1'],['is','read_at',null]]);
 assert.equal(ctx.bellTotal({tasks:1,work:2,results:1,notices:3}),7);
});

test('order updates use server unread state even after local task updates have been marked seen',()=>{
 const client=fakeClient(),data=new Map(),storage={getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,value)},ctx=load({client});
 ctx.bellMarkSeen('u1',['tasks','work','results','notices'],new Date('2026-10-20T10:00:00Z'),storage);
 assert.equal(Object.hasOwn(ctx.bellSeen('u1',storage),'notices'),false);
 ctx.bellQuery('notices','u1','2026-10-20T10:00:00Z',false);
 assert.deepEqual(plain(client.queries[0].calls.slice(1)),[['eq','user_id','u1'],['is','read_at',null],['order','created_at',{ascending:false}],['limit',5]]);
 assert.equal(ctx.bellItemText('notices',{record_label:'PF-1',message:'Invoice is ready'}),'PF-1 · Invoice is ready');
});

test('opening an order update routes to its record without acknowledging the server notice',()=>{
 const opened=[],calls=[],ctx=load({me:{user_id:'u1'},run:fn=>fn(),workOpenRecord:row=>opened.push(row.record_id),client:{rpc:(...args)=>calls.push(args)}});
 ctx.bellChoose('notices',{id:'notice-1',record_type:'proforma',record_id:'pf-1'});
 assert.deepEqual(opened,['pf-1']);assert.deepEqual(calls,[]);
});

test('Got it acknowledges only a loaded notice and refreshes after server confirmation',async()=>{
 const calls=[],ctx=load({me:{user_id:'u1'},client:{rpc:async(name,args)=>{calls.push({name,args});return {data:{id:args.p_id}};}}});
 vm.runInContext("bellItems={notices:[{id:'notice-1'}]};bellCounts={notices:1};",ctx);
 let refreshes=0;ctx.refreshNotificationBell=async()=>{refreshes++;};
 await ctx.bellDismissNotice('unknown');assert.equal(calls.length,0);
 await ctx.bellDismissNotice('notice-1');
 assert.deepEqual(plain(calls),[{name:'dismiss_work_notice',args:{p_id:'notice-1'}}]);assert.equal(refreshes,1);
 ctx.client.rpc=async()=>({error:{message:'Access denied'}});
 await assert.rejects(ctx.bellDismissNotice('notice-1'),/Access denied/);assert.equal(refreshes,1);
});

test('an old notice acknowledgement cannot refresh the replacement session',async()=>{
 let finish;const ctx=load({me:{user_id:'u1'},client:{rpc:()=>new Promise(resolve=>{finish=resolve;})}});
 vm.runInContext("bellItems={notices:[{id:'notice-1'}]};",ctx);
 let refreshes=0;ctx.refreshNotificationBell=async()=>{refreshes++;};
 const pending=ctx.bellDismissNotice('notice-1');ctx.me={user_id:'u2'};ctx.clearNotificationBell();finish({data:{id:'notice-1'}});await pending;
 assert.equal(refreshes,0);
});

test('notice labels are escaped and each unread update has its own acknowledgement',()=>{
 const ctx=load();
 vm.runInContext("bellCounts={notices:1};bellItems={notices:[{id:'notice-1',record_label:'<PF>',message:'<script>bad</script>'}]};",ctx);
 const html=ctx.bellPanel();
 assert.doesNotMatch(html,/<script>|<PF>|data-bell-clear/);assert.match(html,/data-bell-dismiss="notice-1">Got it/);
});
test('seen times are kept per person and kind; later reads only count what came after',()=>{
 const data=new Map(),storage={getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,String(v))};
 const ctx=load();
 assert.deepEqual(plain(ctx.bellSeen('u1',storage)),{tasks:'',work:'',results:''});
 ctx.bellMarkSeen('u1',['tasks'],new Date('2026-10-07T08:00:00Z'),storage);
 assert.deepEqual(plain(ctx.bellSeen('u1',storage)),{tasks:'2026-10-07T08:00:00.000Z',work:'',results:''});
 assert.deepEqual(plain(ctx.bellSeen('u2',storage)),{tasks:'',work:'',results:''},'another person on the same device starts fresh');
 const now=Date.parse('2026-10-07T09:00:00Z');
 assert.equal(ctx.bellSince('tasks',ctx.bellSeen('u1',storage),now),'2026-10-07T08:00:00.000Z');
 assert.equal(ctx.bellSince('results',{results:''},now),'2026-09-30T09:00:00.000Z','results: last 7 days');
 assert.equal(ctx.bellSince('results',{results:'2026-10-06T00:00:00.000Z'},now),'2026-10-06T00:00:00.000Z','or since last seen, if later');
 const client=fakeClient();const c2=load({client});
 c2.bellQuery('tasks','u1','2026-10-07T08:00:00.000Z',true);
 assert.deepEqual(plain(client.queries[0].calls.at(-1)),['gt','created_at','2026-10-07T08:00:00.000Z']);
});
test('blocked or broken storage never breaks the bell',()=>{
 const ctx=load(),blocked={getItem(){throw Error('SecurityError')},setItem(){throw Error('QuotaExceededError')}};
 assert.deepEqual(plain(ctx.bellSeen('u1',blocked)),{tasks:'',work:'',results:''});
 assert.doesNotThrow(()=>ctx.bellMarkSeen('u1',['work'],new Date(),blocked));
 assert.deepEqual(plain(ctx.bellSeen('u1',{getItem:()=>'{"tasks":"yesterday","work":5}'})),{tasks:'',work:'',results:''},'nonsense values are ignored');
 assert.doesNotThrow(()=>ctx.bellSeen('u1',null));
});
test('the list loads only when opened: five newest of each kind, in plain words',async()=>{
 const client=fakeClient();const ctx=load({client});
 ctx.bellQuery('work','u1','',false);
 assert.match(client.queries[0].calls[0][1],/record_type,record_id,record_label,task,assigned_by/);
 assert.deepEqual(plain(client.queries[0].calls.slice(-2)),[['order','created_at',{ascending:false}],['limit',5]]);
 assert.equal(ctx.bellItemText('tasks',{title:'Send the report',assigned_by:'j'}),'Send the report · from Jagroop');
 assert.equal(ctx.bellItemText('work',{record_label:'PF-000123',task:'Pack the order',assigned_by:'a'}),'PF-000123 · Pack the order · from Amina');
 assert.equal(ctx.bellItemText('results',{assignee_user_id:'j',status:'done',title:'Call Aga Khan',close_note:'Order confirmed'}),'Jagroop finished: Call Aga Khan — Order confirmed');
 assert.equal(ctx.bellItemText('results',{assignee_user_id:'a',status:'cancelled',title:'Visit',close_note:''}),'Amina cancelled: Visit');
 assert.equal(ctx.bellBadge(4),'4');assert.equal(ctx.bellBadge(12),'9+');
});
test('pressing an item opens the right page and marks that kind seen',()=>{
 const opened=[],ctx=load({me:{user_id:'u1'},message:()=>{},run:fn=>fn(),render:()=>opened.push('render'),workOpenRecord:row=>opened.push('record:'+row.record_label),view:'dashboard',personalSection:'event',personalPage:3,client:fakeClient()});
 const marks=[];ctx.bellMarkSeen=(user,kinds)=>marks.push(kinds.join());
 ctx.bellChoose('work',{record_type:'proforma',record_id:'r',record_label:'PF-000123'});
 ctx.bellChoose('tasks',{id:'t'});
 assert.deepEqual(opened,['record:PF-000123','render']);
 assert.equal(ctx.view,'personal');assert.equal(ctx.personalSection,'task');assert.equal(ctx.personalPage,0);
 assert.deepEqual(marks,['work','tasks']);
});
test('wired in: header bell refreshes on navigation and every 2 minutes, and clears on sign-out',()=>{
 const bell=read('notification-bell.js'),nav=read('workspace-navigation.js'),app=read('app.js'),html=read('index.src.html');
 assert.match(bell,/setInterval\(\(\)=>\{if\(me&&!document\.hidden\)refreshNotificationBell\(true\)\.catch\(\(\)=>\{\}\);\},120000\);/);
 assert.match(nav,/function syncWorkspaceNavigation\(\)\{[\s\S]*?refreshNotificationBell\(\)\.catch/);
 assert.match(app.split('\n').find(line=>line.startsWith('function clear()')),/clearNotificationBell\(\)/);
 assert.ok(html.indexOf('notification-bell.js')>0&&html.indexOf('notification-bell.js')<html.indexOf('workspace-navigation.js'));
 assert.match(bell,/getElementById\('identity'\)/,'sits in the top header');
 assert.doesNotMatch(bell,/localStorage\.(get|set)Item/,'storage is only reached through the guarded helpers');
});

test('My tasks marks each notification kind only after its corresponding pane loads',async()=>{
 for(const handoffVisible of [true,false]){
  const nodes=new Map(),seen=[],node=()=>({innerHTML:'',isConnected:true,querySelector:()=>({})});
  for(const key of ['#content','#manualTasks','#teamTaskFinished','#orderSteps','#teamTaskRelated','#teamTaskRefresh','#teamTaskNew'])nodes.set(key,node());
  const ctx=load({me:{user_id:'worker',role:'staff'},view:'personal',personalSection:'task',$:selector=>nodes.get(selector),all:async()=>[],run:fn=>fn(),renderMyHandoffs:async()=>handoffVisible});
  vm.runInContext(read('team-tasks.js'),ctx);ctx.bellMarkSeen=(actor,kinds)=>seen.push({actor,kinds:[...kinds]});ctx.refreshNotificationBell=async()=>{};
  await ctx.teamTasksWorkspace();
  assert.equal(seen.length,handoffVisible?2:1);assert.ok(seen.every(item=>item.actor==='worker'));
  assert.deepEqual(seen.flatMap(item=>item.kinds).sort(),handoffVisible?['results','tasks','work']:['results','tasks']);
  assert.match(nodes.get('#manualTasks').innerHTML,/Nothing given to you right now/);
 }
});
