import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import vm from 'node:vm';
const read=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8');
function load(extra={}){
 const ctx=vm.createContext({esc:s=>String(s??'').replace(/[&<>"']/g,c=>'&#'+c.charCodeAt(0)+';'),...extra});
 vm.runInContext(read('dashboard.js')+';Object.assign(globalThis,{dashboardCards,dashboardPeriodic,dashboardResult});',ctx);return ctx;
}
const plain=value=>JSON.parse(JSON.stringify(value));
const sample={today:'2026-10-06',
 open:{overdue:5,overdue_parts:{leads:3,tasks:0,steps:2,service:null},due_today:1,due_today_parts:{leads:0,tasks:1,steps:0,service:null},
  opportunities:774,cases:null,accounts:9353,scheduled_service:null,quotes:3659,webqueries:60,contacts:20116,tasks:4740},
 periodic:{opportunities:2,cases:null,scheduled_service:null,quotes:11,webqueries:0,tasks:54},
 result:{cases_cancelled:null,cases_resolved:null,opportunities_won:1,opportunities_lost:2,quotes_closed:0,tasks_completed:0,webqueries_closed:0}};

test('today and yesterday are Dar es Salaam days (UTC+3), not UTC days',()=>{
 const {dashboardDay}=load();
 assert.equal(dashboardDay(Date.parse('2026-10-05T21:00:00Z')),'2026-10-06','midnight in Dar is 21:00 UTC');
 assert.equal(dashboardDay(Date.parse('2026-10-05T20:59:59Z')),'2026-10-05');
 assert.equal(dashboardDay(Date.parse('2026-12-31T22:30:00Z')),'2027-01-01');
});
test('preset periods give inclusive first and last days; weeks start on Monday',()=>{
 const {dashboardRange}=load(),r=(preset,today)=>plain(dashboardRange({preset},today));
 assert.deepEqual(r('today','2026-10-06'),{from:'2026-10-06',to:'2026-10-06'});
 assert.deepEqual(r('yesterday','2026-10-06'),{from:'2026-10-05',to:'2026-10-05'});
 assert.deepEqual(r('yesterday','2026-01-01'),{from:'2025-12-31',to:'2025-12-31'});
 assert.deepEqual(r('week','2026-10-06'),{from:'2026-10-05',to:'2026-10-06'},'Tuesday');
 assert.deepEqual(r('week','2026-10-05'),{from:'2026-10-05',to:'2026-10-05'},'Monday');
 assert.deepEqual(r('week','2026-10-11'),{from:'2026-10-05',to:'2026-10-11'},'Sunday');
 assert.deepEqual(r('month','2026-10-06'),{from:'2026-10-01',to:'2026-10-06'});
 assert.throws(()=>dashboardRange({preset:'forever'},'2026-10-06'),/Choose a period/);
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
 assert.equal(dashboardRangeLabel({preset:'yesterday'},{from:'2026-10-05',to:'2026-10-05'}),'Yesterday (05/10/2026)');
 assert.equal(dashboardRangeLabel({preset:'week'},{from:'2026-10-05',to:'2026-10-06'}),'This week (05/10/2026 – 06/10/2026)');
 assert.equal(dashboardRangeLabel({preset:'custom'},{from:'2026-09-01',to:'2026-09-30'}),'01/09/2026 – 30/09/2026');
});
test('defaults: Periodic is yesterday, Result is today',()=>{
 const ctx=load();
 assert.equal(ctx.dashboardPeriodic.preset,'yesterday');assert.equal(ctx.dashboardResult.preset,'today');
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
