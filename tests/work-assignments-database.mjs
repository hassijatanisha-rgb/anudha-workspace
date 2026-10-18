// Disposable PGlite fixture only: run with PGLITE_MODULE pointing to @electric-sql/pglite dist/index.js.
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const {PGlite}=await import(process.env.PGLITE_MODULE);
const db=new PGlite(),id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const owner=id(1),mujtaba=id(2),jagroop=id(3),packer=id(4),inactive=id(5),salesOnly=id(6),serviceOnly=id(7),outsider=id(8),pf=id(10),dn=id(11),svc=id(12),lead=id(13),pend=id(14),archivedPf=id(15);
await db.exec(`create role anon;create role authenticated;create schema auth;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
create table public.staff(user_id uuid primary key,role text,active boolean,access text[] not null default '{proformas,deliveries,service,leads,purchasing}');
create function public.inventory_active_staff() returns boolean language sql stable security definer set search_path=public as $$select exists(select 1 from public.staff where user_id=auth.uid() and active)$$;
create function public.inventory_owner() returns boolean language sql stable security definer set search_path=public as $$select exists(select 1 from public.staff where user_id=auth.uid() and active and role='owner')$$;
create table public.sales_proformas(id uuid primary key,deleted_at timestamptz,document_number text not null,status text not null);
create table public.sales_delivery_notes(id uuid primary key,delivery_number text not null,status text not null);
create table public.service_cases(id uuid primary key,case_number text not null,status text not null);create table public.sales_leads(id uuid primary key);create table public.pending_stock_requests(id uuid primary key);
insert into auth.users values('${owner}'),('${mujtaba}'),('${jagroop}'),('${packer}'),('${inactive}'),('${salesOnly}'),('${serviceOnly}'),('${outsider}');
insert into public.staff(user_id,role,active) values('${owner}','owner',true),('${mujtaba}','staff',true),('${jagroop}','staff',true),('${packer}','staff',true),('${inactive}','staff',false);
insert into public.staff values('${salesOnly}','staff',true,'{proformas}'),('${serviceOnly}','staff',true,'{service}'),('${outsider}','staff',true,'{}');
insert into public.sales_proformas values('${pf}',null,'PF-CANONICAL','accepted'),('${archivedPf}',now(),'PF-ARCHIVED','draft');
insert into public.sales_delivery_notes values('${dn}','DN-CANONICAL','packing');insert into public.service_cases values('${svc}','INS-CANONICAL','assigned');
insert into public.sales_leads values('${lead}');insert into public.pending_stock_requests values('${pend}');`);
await db.exec(readFileSync(new URL('../supabase/migrations/202609300045_work_assignments.sql',import.meta.url),'utf8'));
const accessMigration=readFileSync(new URL('../supabase/migrations/202610180100_work_assignment_access.sql',import.meta.url),'utf8');
await db.exec(accessMigration);
await db.exec(accessMigration); // Reapplying preserves existing guards rather than duplicating their bodies.
const metadata=async()=>(await db.query("select oid,proacl,prosecdef,proconfig from pg_proc where oid='public.hand_off_work(uuid,text,uuid,text,text,uuid,date,text,uuid)'::regprocedure")).rows[0];
const beforeParentMigration=await metadata();
const parentMigration=readFileSync(new URL('../supabase/migrations/202610180105_work_handoff_parent_state.sql',import.meta.url),'utf8');
await db.exec(parentMigration);await db.exec(parentMigration);
assert.deepEqual(await metadata(),beforeParentMigration,'Repeated migration105 preserves handoff identity, grants, definer and search path');
const as=actor=>db.exec(`select set_config('test.actor','${actor||''}',false)`);
const hand=(reqId,type,record,assignee,expectedOpen=null,task='Approve and issue invoice',due=null,label='PF-1')=>db.query('select * from public.hand_off_work($1,$2,$3,$4,$5,$6,$7,$8,$9)',[reqId,type,record,label,task,assignee,due,'',expectedOpen]).then(r=>r.rows[0]);
const close=(reqId,version,action,note='')=>db.query('select * from public.close_work_assignment($1,$2,$3,$4)',[reqId,version,action,note]).then(r=>r.rows[0]);
let checks=0;const ok=()=>checks++;
ok();

await as('');await assert.rejects(hand(id(100),'proforma',pf,mujtaba),/Active staff/);ok();
await as(inactive);await assert.rejects(hand(id(100),'proforma',pf,mujtaba),/Active staff/);ok();
await as(owner);
for(const [args,pattern] of [[['proforma',id(99),mujtaba],/no longer exists/],[['proforma',archivedPf,mujtaba],/no longer exists/],[['unknown',pf,mujtaba],/access to assign/],[['proforma',pf,inactive],/active employee/]]){
 await assert.rejects(hand(id(100),...args),pattern);ok();
}
await assert.rejects(hand(id(100),'proforma',pf,mujtaba,null,'x'),/2 to 300/);ok();
await assert.rejects(hand(id(100),'proforma',pf,mujtaba,null,'Late task','2000-01-01'),/past/);ok();

// Sales creator hands the accepted Pro forma to accounts (Mujtaba).
const first=await hand(id(100),'proforma',pf,mujtaba,null,'Approve and issue invoice',null,'Forged order number');assert.equal(first.status,'open');assert.equal(first.assigned_by,owner);ok();
assert.equal(first.record_label,'PF-CANONICAL','The saved Pro forma number replaces a caller-supplied label');ok();
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
assert.deepEqual((await db.query('select record_label from work_assignments where id in ($1,$2) order by id',[id(102),id(103)])).rows,[{record_label:'DN-CANONICAL'},{record_label:'INS-CANONICAL'}]);ok();
assert.equal((await db.query('select record_label from work_assignments where id=$1',[id(104)])).rows[0].record_label,'PF-1','Unrelated handoff types retain their existing label contract');ok();

// Sender, assignee and task are permanent; closed rows cannot change; nothing can be deleted.
await assert.rejects(db.query(`update public.work_assignments set assigned_by=$1 where id=$2`,[packer,id(102)]),/permanent/);ok();
await assert.rejects(db.query(`update public.work_assignments set close_note='edited' where id=$1`,[id(101)]),/closed handoff/);ok();
await assert.rejects(db.query(`delete from public.work_assignments where id=$1`,[id(102)]),/never deleted/);ok();
await assert.rejects(db.query(`insert into public.work_assignments(id,record_type,record_id,record_label,task,assignee_user_id,assigned_by,status) values($1,'delivery',$2,'x','Second open',$3,$3,'open')`,[id(106),dn,owner]),/duplicate key|unique/);ok();
const grants=(await db.query(`select has_table_privilege('authenticated','public.work_assignments','insert') ins,has_table_privilege('authenticated','public.work_assignments','update') upd,has_function_privilege('anon','public.hand_off_work(uuid,text,uuid,text,text,uuid,date,text,uuid)','execute') anon_hand,has_function_privilege('authenticated','public.work_record_exists(text,uuid)','execute') helper`)).rows[0];
assert.deepEqual(grants,{ins:false,upd:false,anon_hand:false,helper:false});ok();

// Explicit self-assignment uses the same checked handoff and does not grant access to other workflows.
await db.exec('set role authenticated');
await as(salesOnly);
const own=await hand(id(110),'proforma',pf,salesOnly,null,'Follow up the customer');
assert.equal(own.assignee_user_id,salesOnly);assert.equal(own.assigned_by,salesOnly);ok();
await assert.rejects(hand(id(111),'delivery',dn,salesOnly,id(102),'Take delivery'),/access to assign/);ok();
await assert.rejects(hand(id(111),'service',svc,salesOnly,id(103),'Take installation'),/access to assign/);ok();
await assert.rejects(hand(id(111),'proforma',pf,serviceOnly,own.id,'Follow up the customer'),/employee with access/);ok();
await as(outsider);
await assert.rejects(hand(id(111),'proforma',pf,outsider,own.id,'Take the order'),/access to assign/);ok();
await assert.rejects(close(own.id,1,'done','Not allowed'),/access to close/);ok();
await assert.rejects(db.query('select public.work_assignment_access($1,$2)',['proforma',salesOnly]),/permission denied/);ok();
await as(salesOnly);
assert.equal((await hand(own.id,'proforma',pf,salesOnly,null,'Follow up the customer')).id,own.id,'authorized identical replay stays idempotent');ok();
await assert.rejects(hand(id(111),'proforma',pf,salesOnly,null,'Follow up the customer'),/Someone else changed/);ok();
const successor=await hand(id(111),'proforma',pf,salesOnly,own.id,'Record customer acceptance');
assert.equal(successor.previous_assignment_id,own.id);ok();
const selfHistory=(await db.query('select status,closed_by from work_assignments where id=$1',[own.id])).rows[0];
assert.deepEqual(selfHistory,{status:'handed_on',closed_by:salesOnly});ok();

// Revoking an area prevents a previously assigned employee from closing or taking further steps.
await db.exec('reset role');await db.query("update staff set access='{}' where user_id=$1",[salesOnly]);
await db.exec('set role authenticated');await as(salesOnly);
await assert.rejects(close(successor.id,1,'done','Finished'),/access to close/);ok();
await assert.rejects(hand(id(112),'proforma',pf,salesOnly,successor.id,'More work'),/access to assign/);ok();
await as(owner);
assert.equal((await close(successor.id,1,'done','Reviewed and completed')).status,'done');ok();
// Pending stock has no per-area gate in the existing workflow and remains available to active staff.
await as(outsider);
assert.equal((await hand(id(113),'pending',pend,outsider,id(105),'Follow up stock')).assignee_user_id,outsider);ok();
await db.exec('reset role');
assert.equal((await db.query('select access from staff where user_id=$1',[outsider])).rows[0].access.length,0,'taking work never changes staff access');ok();
assert.equal((await db.query("select count(*)::int n from work_assignments where record_id=$1 and status='open'",[pf])).rows[0].n,0,'failed handoffs did not reopen or add tasks');ok();

// Finished parents cannot receive new work, but a response lost before completion can still be replayed.
let terminalNumber=200;
for(const [type,table,numberColumn,initialStatus,terminalStatus] of [
 ['proforma','sales_proformas','document_number','accepted','rejected'],['proforma','sales_proformas','document_number','accepted','cancelled'],
 ['delivery','sales_delivery_notes','delivery_number','ready','delivered'],['delivery','sales_delivery_notes','delivery_number','ready','cancelled'],
 ['service','service_cases','case_number','assigned','completed'],['service','service_cases','case_number','assigned','cancelled']
]){
 const parentId=id(terminalNumber++),requestId=id(terminalNumber++),newRequestId=id(terminalNumber++),canonical=`FIX-${type}-${terminalStatus}`;
 await db.exec('reset role');await as(owner);
 await db.query(`insert into public.${table}(id,${numberColumn},status) values($1,$2,$3)`,[parentId,canonical,initialStatus]);
 await db.exec('set role authenticated');
 const saved=await hand(requestId,type,parentId,owner,null,'Finish the workflow',null,'x'.repeat(250));
 assert.equal(saved.record_label,canonical,'Canonical identity is used even when the supplied label exceeds the display limit');ok();
 await close(requestId,1,'done','Finished the planned work');
 await db.exec('reset role');await db.query(`update public.${table} set status=$1 where id=$2`,[terminalStatus,parentId]);await db.exec('set role authenticated');
 await assert.rejects(hand(newRequestId,type,parentId,owner,null,'Take another step'),/no longer open for new handoffs/);ok();
 const retried=await hand(requestId,type,parentId,owner,null,'Finish the workflow',null,'Another misleading number');
 assert.equal(retried.id,requestId);assert.equal(retried.status,'done');assert.equal(retried.record_label,canonical);ok();
 await assert.rejects(hand(requestId,type,parentId,owner,null,'Different request'),/already used/);ok();
 assert.equal((await db.query('select count(*)::int n from work_assignments where record_id=$1',[parentId])).rows[0].n,1,'Terminal attempts neither reopen work nor add history');ok();
}
await db.exec('reset role');
const definition=(await db.query("select pg_get_functiondef('public.hand_off_work(uuid,text,uuid,text,text,uuid,date,text,uuid)'::regprocedure) body")).rows[0].body;
assert.ok(definition.indexOf('from public.service_cases where id=p_record_id for share')<definition.indexOf("pg_advisory_xact_lock(hashtextextended('work:'"),'All scoped parent locks precede the work lock');ok();
assert.ok(definition.indexOf('then return v_row; end if;')<definition.indexOf('This record is no longer open for new handoffs'),'Saved-request replay precedes terminal-state rejection');ok();
console.log(`PASS: ${checks} handoff checks — canonical identities, terminal parents, preserved retries, parent-before-work lock order, repeat migration, actor/recipient areas, self-assignment, immutable history and no direct writes. PGlite does not simulate concurrent sessions.`);
await db.close();
