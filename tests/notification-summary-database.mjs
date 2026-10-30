// Disposable PostgreSQL fixture: real task/alert functions; minimal staff/auth, work and order read boundaries.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const {PGlite}=await import(process.env.PGLITE_MODULE);
const db=new PGlite(),id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const migration=name=>readFileSync(new URL('../supabase/migrations/'+name,import.meta.url),'utf8');
const OWNER=id(1),HEAD=id(2),STAFF=id(3),OTHER=id(4),INACTIVE=id(5);
let checks=0;const check=async fn=>{await fn();checks++;};
try{
 await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
 create table public.staff(user_id uuid primary key,role text,active boolean,department text,display_name text);
 create function public.inventory_active_staff() returns boolean language sql stable security definer set search_path=public,pg_temp as $$select exists(select 1 from staff where user_id=auth.uid() and active) and current_setting('test.mfa',true)='yes'$$;
 create function public.inventory_owner() returns boolean language sql stable security definer set search_path=public,pg_temp as $$select inventory_active_staff() and exists(select 1 from staff where user_id=auth.uid() and role='owner')$$;
 insert into auth.users values('${OWNER}'),('${HEAD}'),('${STAFF}'),('${OTHER}'),('${INACTIVE}');
 insert into staff values('${OWNER}','owner',true,'management','Owner'),('${HEAD}','head',true,'stores','Head'),('${STAFF}','staff',true,'stores','Worker'),('${OTHER}','staff',true,'sales','Other'),('${INACTIVE}','staff',false,'stores','Inactive');
 alter table staff enable row level security;
 create policy staff_read on staff for select to authenticated using(user_id=auth.uid() or inventory_owner());
 grant usage on schema public,auth to authenticated;grant select on staff to authenticated;
 create table organizations(id uuid primary key,name text);
 insert into organizations values('${id(90)}','Fixture clinic');
 create table sales_delivery_notes(id uuid primary key,organization_id uuid,delivery_number text,status text,packer_user_id uuid,packing_alerted_at timestamptz,packing_taken_at timestamptz,customer_waiting boolean default false,packing_alert_task_ids uuid[] not null default '{}');
 create table work_assignments(id uuid primary key,assignee_user_id uuid,assigned_by uuid,status text,created_at timestamptz);
 create table work_notices(id uuid primary key,user_id uuid,created_at timestamptz,read_at timestamptz);
 alter table work_assignments enable row level security;alter table work_notices enable row level security;
 create policy work_assignments_read on work_assignments for select to authenticated using((select inventory_active_staff()));
 create policy work_notices_read on work_notices for select to authenticated using(user_id=(select auth.uid()) or (select inventory_owner()));
 grant select on work_assignments,work_notices to authenticated;
 set test.mfa='yes';`);
 for(const file of ['202610010056_team_tasks.sql','202610070068_task_reschedule.sql','202610150083_deadline_approval.sql'])await db.exec(migration(file));
 const packing=migration('202610090078_packing_queue.sql');
 for(const name of ['packing_overdue_minutes','packing_staff_name','packing_raise_overdue_alerts']){
  const start=packing.indexOf(`create function public.${name}(`),end=packing.indexOf('$$;',start);
  assert.ok(start>=0&&end>start);await db.exec(packing.slice(start,end+3));
 }
 await db.exec('revoke all on function packing_raise_overdue_alerts() from public,anon;grant execute on function packing_raise_overdue_alerts() to authenticated;');
 await db.exec(migration('202610290129_notification_summary.sql'));
 const now=Date.now(),at=hours=>new Date(now+hours*3600000).toISOString(),seen=at(-1),future=at(24);
 const task=async(n,assignee,by,{status='open',closedBy=null,closedAt=null,createdAt=at(-2),dueAt=future}={})=>db.query(`insert into team_tasks(id,task_number,title,urgency,due_at,assignee_user_id,assigned_by,status,closed_by,closed_at,created_at) values($1,$2,'Fixture task','normal',$3,$4,$5,$6,$7,$8,$9)`,[id(n),'FIX-'+n,dueAt,assignee,by,status,closedBy,closedAt,createdAt]);
 await task(101,STAFF,OWNER);await task(102,STAFF,OWNER,{createdAt:at(-0.5)});await task(103,STAFF,STAFF);await task(104,OTHER,OWNER);
 await task(105,STAFF,OWNER,{status:'done',closedBy:STAFF,closedAt:at(-0.5)});
 await task(106,OTHER,STAFF,{status:'done',closedBy:OTHER,closedAt:at(-0.5)});
 await task(107,OTHER,STAFF,{status:'cancelled',closedBy:OTHER,closedAt:at(-0.5)});
 await task(108,OTHER,STAFF,{status:'done',closedBy:STAFF,closedAt:at(-0.5)});
 await task(109,STAFF,STAFF,{status:'done',closedBy:STAFF,closedAt:at(-0.5)});
 await task(110,OTHER,STAFF,{status:'done',closedBy:OTHER,closedAt:at(-192)});
 await task(111,OTHER,STAFF,{status:'done',closedBy:OTHER,closedAt:at(-2)});
 await task(112,STAFF,OWNER,{dueAt:at(-2)});
 for(const [n,assignee,by,status,createdAt] of [[201,STAFF,OWNER,'open',at(-2)],[202,STAFF,OWNER,'open',at(-0.5)],[203,STAFF,STAFF,'open',at(-0.5)],[204,OTHER,OWNER,'open',at(-0.5)],[205,STAFF,OWNER,'done',at(-0.5)]])await db.query('insert into work_assignments values($1,$2,$3,$4,$5)',[id(n),assignee,by,status,createdAt]);
 for(const [n,user,read] of [[301,STAFF,null],[302,STAFF,at(-0.5)],[303,OTHER,null]])await db.query('insert into work_notices values($1,$2,$3,$4)',[id(n),user,at(-2),read]);
 const addPacking=n=>db.query("insert into sales_delivery_notes(id,organization_id,delivery_number,status,packer_user_id,packing_taken_at) values($1,$2,$3,'packing',$4,$5)",[id(n),id(90),'DN-'+n,STAFF,at(-1)]);
 await addPacking(401);
 const as=async actor=>{await db.exec('reset role');await db.query("select set_config('test.actor',$1,false)",[actor||'']);await db.exec('set role authenticated');};
 const summary=async(tasks=null,work=null,results=null)=>(await db.query('select notification_summary($1,$2,$3) as result',[tasks,work,results])).rows[0].result;
 const admin=async(sql,args=[])=>{await db.exec('reset role');try{return await db.query(sql,args);}finally{await db.exec('set role authenticated');}};
 await as(STAFF);
 await check(async()=>assert.deepEqual(await summary(),{tasks:3,work:2,results:3,notices:1}));
 await check(async()=>assert.deepEqual(await summary(seen,seen,seen),{tasks:1,work:1,results:2,notices:1}));
 await check(async()=>{
  assert.equal((await admin('select count(*)::int n from team_task_generated where kind=\'overdue_alert\'')).rows[0].n,1,'staff refresh runs the actual overdue alert function once');
  assert.equal((await admin('select packing_alerted_at from sales_delivery_notes where id=$1',[id(401)])).rows[0].packing_alerted_at,null,'staff refresh skips packing alerts');
 });
 await as(HEAD);
 await check(async()=>{
  assert.deepEqual(await summary(),{tasks:2,work:0,results:0,notices:0},'head sees the packing and overdue tasks created before counting');
  assert.equal((await admin('select cardinality(packing_alert_task_ids) n from sales_delivery_notes where id=$1',[id(401)])).rows[0].n,2,'actual packing function alerts both owner and stores head');
  assert.deepEqual(await summary(),{tasks:2,work:0,results:0,notices:0},'repeated summary never duplicates alerts');
 });
 await admin("insert into sales_delivery_notes(id,organization_id,delivery_number,status,packer_user_id,packing_taken_at) values($1,$2,'DN-402','packing',$3,$4)",[id(402),id(90),STAFF,at(-1)]);
 await as(OWNER);
 await check(async()=>assert.deepEqual(await summary(),{tasks:2,work:0,results:1,notices:0},'owner role from staff triggers the second packing alert and only counts own results'));
 await as(STAFF);
 await check(async()=>{
  await admin(`create policy scoped_work on work_assignments as restrictive for select to authenticated using (id<>'${id(202)}')`);
  assert.deepEqual(await summary(),{tasks:3,work:1,results:3,notices:1},'invoker preserves additional caller RLS restrictions');
 });
 await check(async()=>{
  await admin('revoke select on work_assignments from authenticated');
  assert.deepEqual(await summary(),{tasks:3,work:null,results:3,notices:1},'one failed count does not block other counts');
  await admin('grant select on work_assignments to authenticated');await admin('revoke select on team_tasks from authenticated');
  assert.deepEqual(await summary(),{tasks:null,work:1,results:null,notices:1},'both task count failures remain unknown');
  await admin('grant select on team_tasks to authenticated');
 });
 await check(async()=>{
  await admin('revoke execute on function raise_team_task_overdue_alerts() from authenticated');
  assert.deepEqual(await summary(),{tasks:3,work:1,results:3,notices:1},'alert errors preserve the existing independent count behavior');
  await admin('grant execute on function raise_team_task_overdue_alerts() to authenticated');
 });
 await check(async()=>{
  await as(OWNER);await admin('revoke execute on function packing_raise_overdue_alerts() from authenticated');
  assert.deepEqual(await summary(),{tasks:2,work:0,results:1,notices:0},'packing alert error does not prevent task alerts or counts');
  await admin('grant execute on function packing_raise_overdue_alerts() to authenticated');
 });
 await check(async()=>{
  await db.exec("set test.mfa='no'");await assert.rejects(summary(),/Active staff/);await db.exec("set test.mfa='yes'");
  await as(INACTIVE);await assert.rejects(summary(),/Active staff/);
  await as(null);await assert.rejects(summary(),/Active staff/);
  await db.exec('reset role;set role anon');await assert.rejects(summary(),/permission denied/);
 });
 await db.exec('reset role');
 await check(async()=>{
  const row=(await db.query("select prosecdef,provolatile,has_function_privilege('anon',oid,'execute') anon,has_function_privilege('authenticated',oid,'execute') authenticated from pg_proc where proname='notification_summary'")).rows[0];
  assert.deepEqual(row,{prosecdef:false,provolatile:'v',anon:false,authenticated:true});
 });
 console.log(`PASS: ${checks} notification summary database checks; actual packing/task alert side effects, idempotence, server role, seen/unread filters, partial failures, caller RLS and active/MFA/anonymous gates.`);
}finally{await db.close();}
