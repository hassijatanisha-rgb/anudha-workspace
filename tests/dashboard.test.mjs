import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import vm from 'node:vm';
const read=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8');
function load(extra={}){
 const ctx=vm.createContext({esc:s=>String(s??'').replace(/[&<>"']/g,c=>'&#'+c.charCodeAt(0)+';'),...extra});
 vm.runInContext(read('dashboard.js')+';Object.assign(globalThis,{dashboardCards,dashboardPresets,dashboardDefaultPeriod});',ctx);return ctx;
}
const plain=value=>JSON.parse(JSON.stringify(value));
const sample={today:'2026-10-06',
 open:{overdue:5,overdue_parts:{leads:3,tasks:0,steps:2,service:null},due_today:1,due_today_parts:{leads:0,tasks:1,steps:0,service:null},
  opportunities:774,cases:null,accounts:9353,scheduled_service:null,quotes:3659,webqueries:60,contacts:20116,tasks:4740},
 periodic:{opportunities:2,cases:null,scheduled_service:null,quotes:11,webqueries:0,tasks:54},
 result:{cases_cancelled:null,cases_resolved:null,opportunities_won:1,opportunities_lost:2,quotes_closed:0,tasks_completed:0,webqueries_closed:0}};

test('today is a Dar es Salaam day (UTC+3), not a UTC day',()=>{
 const {dashboardDay}=load();
 assert.equal(dashboardDay(Date.parse('2026-10-05T21:00:00Z')),'2026-10-06','midnight in Dar is 21:00 UTC');
 assert.equal(dashboardDay(Date.parse('2026-10-05T20:59:59Z')),'2026-10-05');
 assert.equal(dashboardDay(Date.parse('2026-12-31T22:30:00Z')),'2027-01-01');
});
test('preset periods give inclusive first and last days; weeks start on Monday',()=>{
 const {dashboardRange}=load(),r=(preset,today)=>plain(dashboardRange({preset},today));
 assert.deepEqual(r('today','2026-10-06'),{from:'2026-10-06',to:'2026-10-06'});
 assert.deepEqual(r('week','2026-10-06'),{from:'2026-10-05',to:'2026-10-06'},'Tuesday');
 assert.deepEqual(r('week','2026-10-05'),{from:'2026-10-05',to:'2026-10-05'},'Monday');
 assert.deepEqual(r('week','2026-10-11'),{from:'2026-10-05',to:'2026-10-11'},'Sunday');
 assert.deepEqual(r('week','2026-10-04'),{from:'2026-09-28',to:'2026-10-04'},'Sunday belongs to the week that started the Monday before');
 assert.deepEqual(r('week','2027-01-03'),{from:'2026-12-28',to:'2027-01-03'},'a week can start in the previous year');
 assert.deepEqual(r('week','2028-03-01'),{from:'2028-02-28',to:'2028-03-01'},'leap year: Wednesday 1 March');
 assert.deepEqual(r('month','2026-10-06'),{from:'2026-10-01',to:'2026-10-06'});
 assert.deepEqual(r('year','2026-10-06'),{from:'2026-01-01',to:'2026-10-06'});
 assert.deepEqual(r('year','2028-12-31'),{from:'2028-01-01',to:'2028-12-31'},'a whole leap year is 366 days, within the limit');
 for(const preset of ['yesterday','forever'])assert.throws(()=>dashboardRange({preset},'2026-10-06'),/Choose a period/);
});
test('quarters start on 1 January, 1 April, 1 July and 1 October',()=>{
 const {dashboardRange}=load(),q=today=>dashboardRange({preset:'quarter'},today).from;
 for(const [today,from] of [['2026-01-01','2026-01-01'],['2026-02-14','2026-01-01'],['2026-03-31','2026-01-01'],['2026-04-01','2026-04-01'],
  ['2026-06-30','2026-04-01'],['2026-07-01','2026-07-01'],['2026-09-30','2026-07-01'],['2026-10-01','2026-10-01'],['2026-10-06','2026-10-01'],['2026-12-31','2026-10-01']])
  assert.equal(q(today),from,today);
 assert.equal(dashboardRange({preset:'quarter'},'2026-10-06').to,'2026-10-06','a period ends today');
});
test('the period buttons are the six the heads asked for, in order',()=>{
 const {dashboardPresets}=load();
 assert.deepEqual(plain(dashboardPresets.map(([,label])=>label)),['Today','This week','This month','This quarter','This year','Custom']);
});
test('the chosen period is remembered per person on this device, and blocked storage never breaks the page',()=>{
 const {dashboardLoadPeriod,dashboardSavePeriod}=load(),data=new Map();
 const storage={getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,String(v))};
 assert.deepEqual(plain(dashboardLoadPeriod('u1',storage)),{preset:'today',from:'',to:''},'nothing saved: Today');
 dashboardSavePeriod('u1',{preset:'quarter',from:'',to:''},storage);
 dashboardSavePeriod('u2',{preset:'custom',from:'2026-09-01',to:'2026-09-30'},storage);
 assert.equal(plain(dashboardLoadPeriod('u1',storage)).preset,'quarter');
 assert.deepEqual(plain(dashboardLoadPeriod('u2',storage)),{preset:'custom',from:'2026-09-01',to:'2026-09-30'},'each person has their own');
 data.set('anudha.dashboard.period.u3','{"preset":"custom","from":"2026-09-30","to":"2026-09-01"}');
 data.set('anudha.dashboard.period.u4','not json');data.set('anudha.dashboard.period.u5','{"preset":"yesterday"}');
 for(const user of ['u3','u4','u5'])assert.equal(dashboardLoadPeriod(user,storage).preset,'today',`${user}: a broken or old value falls back to Today`);
 const blocked={getItem(){throw Error('SecurityError')},setItem(){throw Error('QuotaExceededError')}};
 assert.equal(dashboardLoadPeriod('u1',blocked).preset,'today');
 assert.doesNotThrow(()=>dashboardSavePeriod('u1',{preset:'week'},blocked));
 assert.doesNotThrow(()=>dashboardSavePeriod('u1',{preset:'week'},null));
});
test('team tasks: one line per person, most late first; only the owner and heads see the section',()=>{
 const names={a:'Jagroop',b:'Amina',c:'Baraka'};
 const ctx=load({employeeName:id=>names[id]||'?',me:{user_id:'h',role:'head'}});
 assert.equal(ctx.dashboardTeamLine({user_id:'a',open_count:4,completed_count:11,late_count:1}),'Jagroop: 4 open · 11 completed · 1 late');
 const rows=[{user_id:'a',open_count:4,completed_count:11,late_count:0},{user_id:'b',open_count:1,completed_count:0,late_count:1},{user_id:'c',open_count:4,completed_count:2,late_count:0}];
 assert.deepEqual(plain(ctx.dashboardTeamOrder(rows).map(r=>r.user_id)),['b','c','a'],'late first, then most open, then by name');
 assert.equal(ctx.dashboardTeamVisible(),true);
 ctx.me={user_id:'s',role:'staff'};assert.equal(ctx.dashboardTeamVisible(),false);assert.equal(ctx.dashboardTeamSection(),'');
 ctx.me={user_id:'o',role:'owner'};assert.equal(ctx.dashboardTeamVisible(),true);
});
test('a person\'s task shows whether it was late and the result written when it was done',()=>{
 const ctx=load({employeeName:()=>'Owner'}),now=Date.parse('2026-10-07T09:00:00Z');
 const done=ctx.dashboardPersonTask({title:'Send <quote>',task_number:'TK-000001',status:'done',due_at:'2026-10-05T14:00:00Z',closed_at:'2026-10-06T08:00:00Z',close_note:'Sent by email',assigned_by:'o'},now);
 assert.match(done,/class="late"/);assert.match(done,/Done .* · late/);assert.match(done,/Result: Sent by email/);assert.match(done,/Send &#60;quote&#62;/);
 const open=ctx.dashboardPersonTask({title:'Call',task_number:'TK-000002',status:'open',due_at:'2026-10-08T14:00:00Z',closed_at:null,close_note:'',assigned_by:'o'},now);
 assert.match(open,/Not done yet/);assert.doesNotMatch(open,/late|Result/);
});
test('one period feeds Periodic, Result and Team tasks',async()=>{
 const calls=[],html={};
 const ctx=load({me:{user_id:'h',role:'head'},view:'dashboard',employeeName:()=>'X',syncWorkspaceNavigation:()=>{},run:fn=>fn(),
  $:()=>({set innerHTML(v){html.content=v},get innerHTML(){return html.content},value:''}),document:{querySelectorAll:()=>[]},
  client:{rpc:async(name,args)=>{calls.push([name,args]);return {data:name==='team_task_counts'?[]:{open:{},periodic:{},result:{}},error:null};}},
  localStorage:{getItem:()=>JSON.stringify({preset:'quarter'}),setItem:()=>{}}});
 ctx.dashboardDay=()=>'2026-10-06';
 await ctx.dashboardWorkspace();
 assert.deepEqual(plain(calls),[['dashboard_counts',{p_periodic_from:'2026-10-01',p_periodic_to:'2026-10-06',p_result_from:'2026-10-01',p_result_to:'2026-10-06'}],['team_task_counts',{p_from:'2026-10-01',p_to:'2026-10-06'}]]);
 assert.match(html.content,/aria-pressed="true" class="active">This quarter</);assert.match(html.content,/Team tasks/);
});
test('a custom range must be two real dates in order, one year or less apart',()=>{
 const {dashboardRange}=load(),c=(from,to)=>dashboardRange({preset:'custom',from,to},'2026-10-06');
 assert.deepEqual(plain(c('2026-09-01','2026-09-30')),{from:'2026-09-01',to:'2026-09-30'});
 assert.deepEqual(plain(c('2025-10-06','2026-10-07')),{from:'2025-10-06',to:'2026-10-07'},'366 days is allowed, like the server');
 assert.throws(()=>c('2026-10-06','2026-10-05'),/on or before/);
 assert.throws(()=>c('2026-02-30','2026-03-01'),/start and an end date/);
 assert.throws(()=>c('','2026-03-01'),/start and an end date/);
 assert.throws(()=>c('2025-10-05','2026-10-07'),/one year or less/);
});
test('period labels show the dates as day/month/year',()=>{
 const {dashboardRangeLabel}=load();
 assert.equal(dashboardRangeLabel({preset:'today'},{from:'2026-10-05',to:'2026-10-05'}),'Today (05/10/2026)');
 assert.equal(dashboardRangeLabel({preset:'quarter'},{from:'2026-10-01',to:'2026-10-06'}),'This quarter (01/10/2026 – 06/10/2026)');
 assert.equal(dashboardRangeLabel({preset:'week'},{from:'2026-10-05',to:'2026-10-06'}),'This week (05/10/2026 – 06/10/2026)');
 assert.equal(dashboardRangeLabel({preset:'custom'},{from:'2026-09-01',to:'2026-09-30'}),'01/09/2026 – 30/09/2026');
});
test('default period is Today',()=>{
 assert.equal(load().dashboardDefaultPeriod.preset,'today');
});
test('cards follow the screenshot order; a card the person cannot see is left out, not shown as 0',()=>{
 const {dashboardTiles}=load();
 assert.deepEqual(plain(dashboardTiles('open',sample).map(t=>t.label)),['Overdues','Due Today','Opportunities','Accounts','Quotes','Webqueries','Contacts','Tasks']);
 assert.deepEqual(plain(dashboardTiles('periodic',sample).map(t=>`${t.label}=${t.value}`)),['Opportunities=2','Quotes=11','Webqueries=0','Tasks=54'],'a real 0 is still shown');
 const result=dashboardTiles('result',sample);
 assert.deepEqual(plain(result.map(t=>t.label)),['Opportunities','Close Quotes','Completed Tasks','Close Webqueries'],'Cases group hidden when both parts are hidden');
 assert.equal(result[0].value,3);assert.deepEqual(plain(result[0].items.map(i=>i.label)),['Closed Won','Closed Lost']);
 assert.equal(dashboardTiles('open',null).length,0);
});
test('Overdues and Due Today say what they are made of',()=>{
 const {dashboardTiles,dashboardBreakdown}=load(),open=dashboardTiles('open',sample);
 assert.equal(open[0].breakdown,'Lead follow-ups 3 · Order steps 2');assert.equal(open[1].breakdown,'Tasks 1');
 assert.equal(dashboardBreakdown(null),'');assert.equal(dashboardBreakdown({leads:0,tasks:0}),'');
});
test('Calls, WhatsApps and new accounts or contacts per period have no data in the ERP and are not cards',()=>{
 const {dashboardCards}=load(),keys=JSON.stringify(dashboardCards);
 assert.doesNotMatch(keys,/call|whatsapp/i);
 assert.ok(!dashboardCards.periodic.some(([key])=>key==='accounts'||key==='contacts'));
 assert.doesNotMatch(read('dashboard.js'),/_minor|total_minor|estimated_value|money/i,'counts only, never amounts');
});
test('clickable cards open existing lists with filters those lists already have; others are not buttons',()=>{
 const {dashboardCards,dashboardTarget,dashboardTile}=load(),nav=read('workspace-navigation.js');
 const leadFilters=[...read('sales-leads.js').match(/leadFilters=\[(.*?)\];/)[1].matchAll(/\['(\w+)'/g)].map(m=>m[1]);
 const requestFilters=[...read('customer-requests.js').match(/requestFilters=\[(.*?)\];/)[1].matchAll(/\['(\w+)'/g)].map(m=>m[1]);
 const targets=Object.values(dashboardCards).flat().flatMap(card=>[card[3],...(card[4]||[]).map(part=>part[3])]).filter(Boolean);
 assert.ok(targets.length>=8);
 for(const t of targets){
  assert.ok(nav.includes(t.section?`'${t.view}','${t.section}'`:`'${t.view}'`),`menu has ${t.view}:${t.section||''}`);
  if(t.view==='leads')assert.ok(leadFilters.includes(t.filter),t.filter);
  if(t.view==='requests')assert.ok(requestFilters.includes(t.filter),t.filter);
 }
 assert.deepEqual(plain(dashboardTarget('result','opportunities_lost')),{view:'leads',filter:'lost'});
 assert.equal(dashboardTarget('periodic','opportunities'),null,'no list can be filtered by creation date');
 assert.equal(dashboardTarget('open','overdue'),null);
 assert.match(dashboardTile('open',{key:'tasks',label:'Tasks',tone:'tasks',value:4740,target:{view:'personal'}}),/^<button type="button" class="dashboard-tile dashboard-tasks" data-dashboard-open="open:tasks"[^>]*>.*4,740/);
 assert.match(dashboardTile('open',{key:'contacts',label:'Contacts <b>',tone:'contacts',value:1,target:null}),/^<div class="dashboard-tile dashboard-contacts"><span>Contacts &#60;b&#62;<\/span>/);
});
test('opening a card sets the same screen state as its menu entry',async()=>{
 const calls=[];
 const ctx=load({message:()=>{},search:'x',page:3,view:'dashboard',leadFilter:'mine',leadSearch:'old',serviceSection:'installations',salesSection:'',salesEditing:'new',salesFocusedProforma:'p',salesProformaFilter:'draft',salesProformaSearch:'q',
  requestFilter:'all',personalSection:'event',personalPage:2,openLeadSection:s=>calls.push('lead:'+s),openRequestSection:s=>calls.push('request:'+s),clearSalesPrefill:()=>calls.push('prefill'),
  goProfile:k=>calls.push('profile:'+k),run:fn=>fn(),render:()=>calls.push('render')});
 await ctx.dashboardOpen(ctx.dashboardTarget('result','opportunities_won'));
 assert.equal(ctx.view,'leads');assert.equal(ctx.leadFilter,'won');assert.equal(ctx.leadSearch,'');assert.equal(ctx.search,'');assert.equal(ctx.page,0);
 await ctx.dashboardOpen(ctx.dashboardTarget('open','webqueries'));
 assert.equal(ctx.view,'requests');assert.equal(ctx.requestFilter,'open');
 await ctx.dashboardOpen(ctx.dashboardTarget('open','quotes'));
 assert.equal(ctx.view,'sales');assert.equal(ctx.salesSection,'proformas');assert.equal(ctx.salesEditing,'');assert.equal(ctx.salesProformaFilter,'all');assert.equal(ctx.salesFocusedProforma,'');
 await ctx.dashboardOpen(ctx.dashboardTarget('open','cases'));assert.equal(ctx.serviceSection,'schedule');
 await ctx.dashboardOpen(ctx.dashboardTarget('open','tasks'));assert.equal(ctx.view,'personal');assert.equal(ctx.personalSection,'task');assert.equal(ctx.personalPage,0);
 await ctx.dashboardOpen(ctx.dashboardTarget('open','accounts'));
 assert.deepEqual(calls,['lead:leads','render','request:inquiries','render','prefill','render','render','render','profile:clients']);
});
test('Dashboard is wired in: first menu entry, its own screen, cleared on sign-out, loaded before app.js',()=>{
 const nav=read('workspace-navigation.js'),app=read('app.js'),html=read('index.html');
 assert.match(nav,/\{name:'Main',tone:'main',items:\[\n\s+\['Dashboard','dashboard'\],/);
 assert.match(app,/view==='dashboard'\)return dashboardWorkspace\(\)/);
 assert.match(app.split('\n').find(line=>line.startsWith('function clear()')),/typeof clearDashboard==='function'\)clearDashboard\(\)/);
 assert.match(app,/view=\/\^#\\\/\(clients\|client\|branch\)\\b\/\.test\(location\.hash\)\?'contacts':'dashboard'/,'Dashboard is the landing view unless a client link was opened');
 assert.ok(html.indexOf('dashboard.js')>0&&html.indexOf('dashboard.js')<html.indexOf('workspace-navigation.js')&&html.indexOf('dashboard.js')<html.indexOf('app.js'));
});
test('the landing view follows the address: client links still open the client page',()=>{
 const line=read('app.js').split('\n').find(l=>l.startsWith('let client,me,'));
 const viewFor=hash=>vm.runInNewContext(line.replace(/^let /,'var ')+';view',{location:{hash}});
 assert.equal(viewFor(''),'dashboard');assert.equal(viewFor('#/'),'dashboard');
 assert.equal(viewFor('#/clients'),'contacts');assert.equal(viewFor('#/branch/abc'),'contacts');assert.equal(viewFor('#/client/abc'),'contacts');
});
test('migration 067: one security invoker read, fixed search path, signed-in staff only, next number in sequence',()=>{
 const files=readdirSync(new URL('../supabase/migrations/',import.meta.url)).filter(f=>f.endsWith('.sql')).sort();
 const at=files.indexOf('202610060067_activity_dashboard.sql');assert.ok(at>0);assert.match(files[at-1],/^\d{8}0066_/);
 const sql=read('supabase/migrations/202610060067_activity_dashboard.sql');
 assert.match(sql,/^begin;$/m);assert.match(sql,/^commit;$/m);
 assert.match(sql,/returns jsonb language plpgsql stable security invoker set search_path=public,pg_temp/);
 assert.doesNotMatch(sql,/security definer|insert into|update public|delete from|_minor/i,'read-only counts, never amounts');
 assert.match(sql,/revoke all on function public\.dashboard_counts\(date,date,date,date\) from public, anon;/);
 assert.match(sql,/grant execute on function public\.dashboard_counts\(date,date,date,date\) to authenticated;/);
 assert.match(sql,/inventory_active_staff\(\) then raise exception 'Active staff access is required'/);
 assert.ok((sql.match(/Africa\/Dar_es_Salaam/g)||[]).length>=5,'every day boundary uses Dar es Salaam time');
});
test('migration 068: team counts check who is asking, heads see their own department, next number in sequence',()=>{
 const files=readdirSync(new URL('../supabase/migrations/',import.meta.url)).filter(f=>f.endsWith('.sql')).sort();
 assert.equal(files.at(-1),'202610070068_team_task_counts.sql');assert.match(files.at(-2),/^\d{8}0067_/);
 const sql=read('supabase/migrations/202610070068_team_task_counts.sql');
 assert.match(sql,/^begin;$/m);assert.match(sql,/^commit;$/m);assert.match(sql,/^-- Rollback:/m);
 assert.match(sql,/me\.user_id=\(select auth\.uid\(\)\)/);
 assert.match(sql,/me\.role='owner' or \(me\.role='head' and me\.department<>'' and exists\(\s*select 1 from public\.staff t where t\.user_id=p_user_id and t\.role<>'owner' and t\.department=me\.department/);
 assert.match(sql,/where s\.active and public\.can_see_team_member\(s\.user_id\)/,'every listed person passes the department check');
 assert.match(sql,/if p_user_id is null or not public\.can_see_team_member\(p_user_id\) then/);
 assert.match(sql,/if not \(public\.is_owner\(\) or public\.is_department_head\(\)\) then/);
 assert.doesNotMatch(sql,/insert into|update public|delete from|alter policy|create policy/i,'read-only; team_tasks read rules unchanged');
 assert.match(sql,/revoke all on function public\.can_see_team_member\(uuid\), public\.team_task_period\(date,date\) from public, anon, authenticated;/);
 assert.match(sql,/revoke all on function public\.team_task_counts\(date,date\), public\.team_member_tasks\(uuid,date,date\) from public, anon;/);
 assert.match(sql,/grant execute on function public\.team_task_counts\(date,date\), public\.team_member_tasks\(uuid,date,date\) to authenticated;/);
 assert.ok((sql.match(/Africa\/Dar_es_Salaam/g)||[]).length>=2);
 assert.ok(readdirSync(new URL('./sql/',import.meta.url)).includes('team-task-counts.sql'),'database test for head visibility');
});
