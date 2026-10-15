// Disposable PGlite fixture only: run with PGLITE_MODULE pointing to @electric-sql/pglite dist/index.js.
// Real migrations 056 (team tasks) and 067 (dashboard); the other tables are cut down to the columns the dashboard
// reads, with the same read rules as the live ones (has_access per area, migration 060/062).
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const {PGlite}=await import(process.env.PGLITE_MODULE);
const db=new PGlite(),id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,mig=f=>readFileSync(new URL('../supabase/migrations/'+f,import.meta.url),'utf8');
const owner=id(1),sales=id(2),engineer=id(3),gone=id(4);
// Dar es Salaam is UTC+3 all year. at(day,'01:30') is that local time; day(-1) is yesterday there.
const today=new Date(Date.now()+3*3600e3).toISOString().slice(0,10);
const day=n=>new Date(Date.parse(today+'T00:00:00Z')+n*864e5).toISOString().slice(0,10),at=(d,t)=>`${d}T${t}:00+03:00`;
await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
create table public.staff(user_id uuid primary key,role text,active boolean,access text[] not null default '{}');
create function public.inventory_active_staff() returns boolean language sql stable security definer set search_path=public as $$select exists(select 1 from public.staff where user_id=auth.uid() and active)$$;
create function public.is_active_staff() returns boolean language sql stable security definer set search_path=public as $$select public.inventory_active_staff()$$;
create function public.inventory_owner() returns boolean language sql stable security definer set search_path=public as $$select exists(select 1 from public.staff where user_id=auth.uid() and active and role='owner')$$;
create function public.has_access(p_area text) returns boolean language sql stable security definer set search_path=public as $$select exists(select 1 from public.staff where user_id=auth.uid() and active and (role='owner' or p_area=any(access)))$$;
insert into auth.users values('${owner}'),('${sales}'),('${engineer}'),('${gone}');
insert into public.staff values('${owner}','owner',true,'{}'),('${sales}','staff',true,'{leads,proformas}'),('${engineer}','staff',true,'{service}'),('${gone}','staff',false,'{leads,service,proformas}');
grant usage on schema public to authenticated, anon;grant usage on schema auth to authenticated;grant select on auth.users to authenticated;
create table public.organizations(id uuid primary key,name text,parent_id uuid,deleted_at timestamptz);
create table public.contacts(id uuid primary key,organization_id uuid,status text,deleted_at timestamptz);
create table public.sales_leads(id uuid primary key,stage text,next_action_on date,estimated_value_minor bigint,created_at timestamptz not null default now());
create table public.sales_lead_events(id uuid primary key default gen_random_uuid(),lead_id uuid,action text,created_at timestamptz not null default now());
create table public.service_cases(id uuid primary key,case_type text,source_case_id uuid,status text,scheduled_for date,completed_at timestamptz,created_at timestamptz not null default now());
create table public.service_case_events(id uuid primary key default gen_random_uuid(),case_id uuid,from_status text,to_status text,created_at timestamptz not null default now());
create table public.sales_proformas(id uuid primary key,status text,total_minor bigint,deleted_at timestamptz,created_at timestamptz not null default now());
create table public.sales_proforma_events(id uuid primary key default gen_random_uuid(),proforma_id uuid,from_status text,to_status text,created_at timestamptz not null default now());
create table public.customer_requests(id uuid primary key,kind text,status text,closed_at timestamptz,created_at timestamptz not null default now());
create table public.work_assignments(id uuid primary key,status text,due_on date,created_at timestamptz not null default now());
create table public.work_delays(id uuid primary key,assignment_id uuid,expected_on date,recorded_at timestamptz not null default now());
do $$declare t text;begin foreach t in array array['organizations','contacts','sales_leads','sales_lead_events','service_cases','service_case_events','sales_proformas','sales_proforma_events','customer_requests','work_assignments','work_delays'] loop
 execute format('alter table public.%I enable row level security',t);execute format('revoke all on public.%I from public,anon,authenticated',t);execute format('grant select on public.%I to authenticated',t);end loop;end$$;
create policy r on public.organizations for select to authenticated using ((select public.is_active_staff()));
create policy r on public.contacts for select to authenticated using ((select public.is_active_staff()));
create policy r on public.sales_leads for select to authenticated using ((select public.has_access('leads')));
create policy r on public.sales_lead_events for select to authenticated using ((select public.has_access('leads')));
create policy r on public.service_cases for select to authenticated using ((select public.has_access('service')));
create policy r on public.service_case_events for select to authenticated using ((select public.has_access('service')));
create policy r on public.sales_proformas for select to authenticated using ((select public.has_access('proformas')));
create policy r on public.sales_proforma_events for select to authenticated using ((select public.has_access('proformas')));
create policy r on public.customer_requests for select to authenticated using (case when kind in ('inquiry','quote') then (select public.has_access('leads')) else (select public.has_access('leads')) or (select public.has_access('service')) end);
create policy r on public.work_assignments for select to authenticated using ((select public.inventory_active_staff()));
create policy r on public.work_delays for select to authenticated using ((select public.inventory_active_staff()));`);
await db.exec(mig('202610010056_team_tasks.sql'));
await db.exec(mig('202610060067_activity_dashboard.sql'));

// Fixture rows. Comments give the card each row should (or should not) reach.
await db.exec(`
insert into public.organizations values('${id(100)}','Aga Khan',null,null),('${id(101)}','Aga Khan Mwanza','${id(100)}',null),('${id(102)}','Closed Lab',null,now());
insert into public.contacts values('${id(110)}','${id(100)}','kept',null),('${id(111)}','${id(100)}','review',null),('${id(112)}','${id(100)}','incorrect',null),('${id(113)}','${id(100)}','kept',now());
insert into public.sales_leads values
 ('${id(200)}','opportunity','${day(-2)}',5000000,'${at(day(-1),'00:30')}'), -- open, overdue, created yesterday (21:30 UTC the day before)
 ('${id(201)}','inquiry','${today}',null,'${at(today,'02:00')}'),          -- open, due today, created today though UTC says yesterday
 ('${id(202)}','won',null,900000000,'${at(day(-9),'10:00')}'),            -- won today
 ('${id(203)}','lead',null,null,'${at(day(-9),'10:00')}'),               -- lost yesterday then reopened: not lost
 ('${id(204)}','lost','${day(-5)}',null,'${at(day(-9),'10:00')}');        -- lost today; closed so never overdue
insert into public.sales_lead_events(lead_id,action,created_at) values('${id(202)}','won','${at(today,'00:10')}'),('${id(203)}','lost','${at(day(-1),'09:00')}'),('${id(203)}','reopen','${at(day(-1),'10:00')}'),('${id(204)}','lost','${at(today,'08:00')}');
insert into public.service_cases values
 ('${id(300)}','service',null,'new',null,null,'${at(day(-1),'12:00')}'),                         -- open case, created yesterday
 ('${id(301)}','service','${id(399)}','scheduled','${day(-1)}',null,'${at(day(-30),'12:00')}'),  -- planned maintenance: scheduled + overdue, not a case
 ('${id(302)}','installation',null,'scheduled','${today}',null,'${at(day(-30),'12:00')}'),       -- installation visit today: due today only
 ('${id(303)}','service',null,'completed',null,'${at(today,'09:00')}','${at(day(-3),'12:00')}'), -- resolved today
 ('${id(304)}','service',null,'cancelled',null,null,'${at(day(-3),'12:00')}'),                   -- cancelled today
 ('${id(305)}','service',null,'scheduled','${day(3)}',null,'${at(day(-3),'12:00')}');            -- open case, scheduled yesterday, then engineer changed
insert into public.service_case_events(case_id,from_status,to_status,created_at) values('${id(304)}','new','cancelled','${at(today,'07:00')}'),
 ('${id(305)}','assigned','scheduled','${at(day(-1),'08:00')}'),('${id(305)}','scheduled','scheduled','${at(day(-1),'09:00')}'),('${id(301)}',null,'scheduled','${at(day(-30),'12:00')}');
insert into public.sales_proformas values('${id(400)}','draft',100,null,'${at(day(-1),'23:59')}'),('${id(401)}','sent',100,null,'${at(day(-4),'10:00')}'),
 ('${id(402)}','accepted',100,null,'${at(day(-4),'10:00')}'),('${id(403)}','draft',100,now(),'${at(day(-1),'11:00')}'),('${id(404)}','rejected',100,null,'${at(day(-4),'10:00')}');
insert into public.sales_proforma_events(proforma_id,from_status,to_status,created_at) values('${id(402)}','sent','accepted','${at(today,'10:00')}'),('${id(404)}','sent','rejected','${at(day(-2),'10:00')}');
insert into public.customer_requests values('${id(500)}','inquiry','received',null,'${at(day(-1),'08:00')}'),('${id(501)}','quote','resolved','${at(today,'08:00')}','${at(day(-3),'08:00')}'),
 ('${id(502)}','complaint','received',null,'${at(day(-1),'08:00')}');
insert into public.work_assignments values('${id(600)}','open','${day(-1)}',now()),('${id(601)}','open','${day(-1)}',now()),('${id(602)}','open','${today}',now()),('${id(603)}','done','${day(-3)}',now());
insert into public.work_delays values('${id(610)}','${id(601)}','${day(-2)}','${at(day(-2),'09:00')}'),('${id(611)}','${id(601)}','${day(4)}','${at(day(-1),'09:00')}');
insert into public.team_tasks(id,task_number,title,urgency,due_at,assignee_user_id,assigned_by,status,closed_by,closed_at,created_at) values
 ('${id(700)}','TK-000001','Call Polymed','urgent','${at(day(-1),'17:00')}','${sales}','${owner}','open',null,null,'${at(day(-1),'08:00')}'),
 ('${id(701)}','TK-000002','Send report','normal','${at(today,'01:30')}','${engineer}','${engineer}','open',null,null,'${at(day(-3),'08:00')}'),
 ('${id(702)}','TK-000003','Visit Muhimbili','do_now','${at(day(-2),'17:00')}','${sales}','${sales}','done','${sales}','${at(today,'11:00')}','${at(day(-3),'08:00')}');`);

const call=async(who,pf=day(-1),pt=day(-1),rf=today,rt=today)=>{
 await db.exec(`select set_config('test.actor','${who||''}',false);set role ${who?'authenticated':'anon'}`);
 try{return (await db.query('select public.dashboard_counts($1,$2,$3,$4) d',[pf,pt,rf,rt])).rows[0].d;}finally{await db.exec('reset role');}
};
let checks=0;const ok=()=>checks++;

// Owner: everything the business has, with Dar es Salaam day edges.
const o=await call(owner);
assert.equal(o.today,today,'today is the Dar es Salaam date');ok();
assert.deepEqual(o.open.overdue_parts,{leads:1,tasks:1,steps:1,service:1},'delayed step with a future date is not late; closed lead is not');ok();
assert.equal(o.open.overdue,4);ok();
assert.deepEqual(o.open.due_today_parts,{leads:1,tasks:1,steps:1,service:1},'a task due 01:30 Dar time is due today, not overdue');ok();
assert.equal(o.open.due_today,4);ok();
assert.deepEqual({...o.open,overdue:0,overdue_parts:0,due_today:0,due_today_parts:0},
 {overdue:0,overdue_parts:0,due_today:0,due_today_parts:0,opportunities:3,cases:2,accounts:1,scheduled_service:2,quotes:2,webqueries:1,contacts:2,tasks:2});ok();
assert.deepEqual(o.periodic,{opportunities:1,cases:1,scheduled_service:1,quotes:1,webqueries:1,tasks:1},'yesterday = Dar midnight to midnight; a reassignment is not a new schedule');ok();
assert.deepEqual(o.result,{cases_cancelled:1,cases_resolved:1,opportunities_won:1,opportunities_lost:1,quotes_closed:1,tasks_completed:1,webqueries_closed:1});ok();
assert.doesNotMatch(JSON.stringify(o),/900000000|5000000|minor|total/,'counts only, never amounts');ok();

// Ranges: this week style range reaches older rows; reopened lead still not lost.
const wide=await call(owner,day(-9),today,day(-2),today);
assert.equal(wide.periodic.opportunities,5);assert.equal(wide.result.quotes_closed,2);assert.equal(wide.result.opportunities_lost,1);ok();

// Sales (leads + Pro formas, no service): service counts are hidden, not zero; tasks are only their own.
const s=await call(sales);
assert.equal(s.open.cases,null);assert.equal(s.open.scheduled_service,null);assert.equal(s.result.cases_resolved,null);assert.equal(s.periodic.cases,null);ok();
assert.equal(s.open.overdue_parts.service,null);assert.equal(s.open.overdue,3,'hidden parts are left out of the total');ok();
assert.equal(s.open.opportunities,3);assert.equal(s.open.quotes,2);assert.equal(s.open.webqueries,1);ok();
assert.equal(s.open.tasks,1,'only tasks given to or by them');assert.equal(s.result.tasks_completed,1);ok();

// Engineer (service only): no leads, quotes or website inquiries.
const e=await call(engineer);
assert.equal(e.open.opportunities,null);assert.equal(e.open.quotes,null);assert.equal(e.open.webqueries,null);assert.equal(e.result.opportunities_won,null);assert.equal(e.result.quotes_closed,null);ok();
assert.equal(e.open.cases,2);assert.equal(e.open.accounts,1);assert.equal(e.open.tasks,1);assert.equal(e.open.due_today_parts.tasks,1);ok();

// Refusals.
await assert.rejects(call(gone),/Active staff access/,'switched-off login');ok();
await assert.rejects(call(null),/permission denied for function/,'signed-out (anon) callers cannot run it');ok();
await assert.rejects(call(owner,today,day(-1)),/on or before/);ok();
await assert.rejects(call(owner,day(-1),day(-1),day(-400),today),/one year or less/);ok();
await assert.rejects(call(owner,null,today),/start and an end date/);ok();

// Function shape: runs as the caller, fixed search path, no public or anon execute.
const f=(await db.query(`select p.prosecdef,p.provolatile,p.proconfig,has_function_privilege('anon',p.oid,'execute') anon,has_function_privilege('authenticated',p.oid,'execute') auth
 from pg_proc p where p.proname='dashboard_counts'`)).rows;
assert.equal(f.length,1);assert.equal(f[0].prosecdef,false,'security invoker');assert.equal(f[0].provolatile,'s');ok();
assert.deepEqual(f[0].proconfig,['search_path=public, pg_temp']);assert.equal(f[0].anon,false);assert.equal(f[0].auth,true);ok();
console.log(`dashboard database: ${checks} checks passed`);
