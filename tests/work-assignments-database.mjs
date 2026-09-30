// Disposable PGlite fixture only: run with PGLITE_MODULE pointing to @electric-sql/pglite dist/index.js.
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const {PGlite}=await import(process.env.PGLITE_MODULE);
const db=new PGlite(),id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const owner=id(1),mujtaba=id(2),jagroop=id(3),packer=id(4),inactive=id(5),pf=id(10),dn=id(11),svc=id(12),lead=id(13),pend=id(14),archivedPf=id(15);
await db.exec(`create role anon;create role authenticated;create schema auth;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
create table public.staff(user_id uuid primary key,role text,active boolean);
create function public.inventory_active_staff() returns boolean language sql stable security definer set search_path=public as $$select exists(select 1 from public.staff where user_id=auth.uid() and active)$$;
create function public.inventory_owner() returns boolean language sql stable security definer set search_path=public as $$select exists(select 1 from public.staff where user_id=auth.uid() and active and role='owner')$$;
create table public.sales_proformas(id uuid primary key,deleted_at timestamptz);create table public.sales_delivery_notes(id uuid primary key);
create table public.service_cases(id uuid primary key);create table public.sales_leads(id uuid primary key);create table public.pending_stock_requests(id uuid primary key);
insert into auth.users values('${owner}'),('${mujtaba}'),('${jagroop}'),('${packer}'),('${inactive}');
insert into public.staff values('${owner}','owner',true),('${mujtaba}','staff',true),('${jagroop}','staff',true),('${packer}','staff',true),('${inactive}','staff',false);
insert into public.sales_proformas values('${pf}',null),('${archivedPf}',now());insert into public.sales_delivery_notes values('${dn}');insert into public.service_cases values('${svc}');
insert into public.sales_leads values('${lead}');insert into public.pending_stock_requests values('${pend}');`);
await db.exec(readFileSync(new URL('../supabase/migrations/202609300045_work_assignments.sql',import.meta.url),'utf8'));
const as=actor=>db.exec(`select set_config('test.actor','${actor||''}',false)`);
const hand=(reqId,type,record,assignee,expectedOpen=null,task='Approve and issue invoice',due=null)=>db.query('select * from public.hand_off_work($1,$2,$3,$4,$5,$6,$7,$8,$9)',[reqId,type,record,'PF-1',task,assignee,due,'',expectedOpen]).then(r=>r.rows[0]);
const close=(reqId,version,action,note='')=>db.query('select * from public.close_work_assignment($1,$2,$3,$4)',[reqId,version,action,note]).then(r=>r.rows[0]);
let checks=0;const ok=()=>checks++;

await as('');await assert.rejects(hand(id(100),'proforma',pf,mujtaba),/Active staff/);ok();
await as(inactive);await assert.rejects(hand(id(100),'proforma',pf,mujtaba),/Active staff/);ok();
await as(owner);
for(const [args,pattern] of [[['proforma',id(99),mujtaba],/no longer exists/],[['proforma',archivedPf,mujtaba],/no longer exists/],[['unknown',pf,mujtaba],/no longer exists/],[['proforma',pf,inactive],/active employee/]]){
 await assert.rejects(hand(id(100),...args),pattern);ok();
}
await assert.rejects(hand(id(100),'proforma',pf,mujtaba,null,'x'),/2 to 300/);ok();
await assert.rejects(hand(id(100),'proforma',pf,mujtaba,null,'Late task','2000-01-01'),/past/);ok();

// Sales creator hands the accepted Pro forma to accounts (Mujtaba).
const first=await hand(id(100),'proforma',pf,mujtaba);assert.equal(first.status,'open');assert.equal(first.assigned_by,owner);ok();
assert.equal((await hand(id(100),'proforma',pf,mujtaba)).id,first.id,'identical retry returns the same handoff');ok();
await assert.rejects(hand(id(100),'proforma',pf,jagroop),/already used/);ok();

// A second handoff must name the open one it replaces; a stale view is refused.
await as(mujtaba);
await assert.rejects(hand(id(101),'proforma',pf,jagroop,null,'Assign packing'),/Someone else changed/);ok();
const second=await hand(id(101),'proforma',pf,jagroop,id(100),'Assign packing');
assert.equal(second.previous_assignment_id,id(100));assert.equal(second.assigned_by,mujtaba);ok();
const prior=(await db.query('select status,closed_by from public.work_assignments where id=$1',[id(100)])).rows[0];
assert.deepEqual(prior,{status:'handed_on',closed_by:mujtaba});ok();
assert.equal((await db.query(`select count(*)::int n from public.work_assignments where record_id=$1 and status='open'`,[pf])).rows[0].n,1);ok();

// Only the assignee or owner can mark done; cancel needs a reason from sender, assignee or owner.
await as(packer);await assert.rejects(close(id(101),1,'done'),/assigned employee or the owner/);ok();
await assert.rejects(close(id(101),1,'cancel','no reason'),/sender, the assigned employee or the owner/);ok();
await as(mujtaba);await assert.rejects(close(id(101),1,'cancel',''),/why/);ok();
await as(jagroop);await assert.rejects(close(id(101),9,'done'),/changed/);ok();
const done=await close(id(101),1,'done','Packer assigned');assert.equal(done.status,'done');assert.equal(done.closed_by,jagroop);ok();
await assert.rejects(close(id(101),2,'done'),/already closed/);ok();

// Every record type can be handed off independently.
await as(owner);
for(const [n,type,record] of [[102,'delivery',dn],[103,'service',svc],[104,'lead',lead],[105,'pending',pend]]){assert.equal((await hand(id(n),type,record,packer)).record_type,type);ok();}

// Sender, assignee and task are permanent; closed rows cannot change; nothing can be deleted.
await assert.rejects(db.query(`update public.work_assignments set assigned_by=$1 where id=$2`,[packer,id(102)]),/permanent/);ok();
await assert.rejects(db.query(`update public.work_assignments set close_note='edited' where id=$1`,[id(101)]),/closed handoff/);ok();
await assert.rejects(db.query(`delete from public.work_assignments where id=$1`,[id(102)]),/never deleted/);ok();
await assert.rejects(db.query(`insert into public.work_assignments(id,record_type,record_id,record_label,task,assignee_user_id,assigned_by,status) values($1,'delivery',$2,'x','Second open',$3,$3,'open')`,[id(106),dn,owner]),/duplicate key|unique/);ok();
const grants=(await db.query(`select has_table_privilege('authenticated','public.work_assignments','insert') ins,has_table_privilege('authenticated','public.work_assignments','update') upd,has_function_privilege('anon','public.hand_off_work(uuid,text,uuid,text,text,uuid,date,text,uuid)','execute') anon_hand,has_function_privilege('authenticated','public.work_record_exists(text,uuid)','execute') helper`)).rows[0];
assert.deepEqual(grants,{ins:false,upd:false,anon_hand:false,helper:false});ok();
console.log(`PASS: ${checks} handoff checks — access, record/assignee validation, identical-retry replay, stale-handoff refusal, one open handoff per record, handed-on chain, done/cancel permissions, permanent sender and task, no deletes, no direct writes.`);
