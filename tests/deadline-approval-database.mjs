// Disposable PGlite fixture only: run with PGLITE_MODULE pointing to @electric-sql/pglite dist/index.js.
// Migration 083 on top of the real team task migrations (056, 068): deadline requests decided by the department head
// (or owner), and one overdue alert per task and deadline.
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const {PGlite}=await import(process.env.PGLITE_MODULE);
const db=new PGlite(),id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,mig=f=>readFileSync(new URL('../supabase/migrations/'+f,import.meta.url),'utf8');
const OWNER=id(1),OWNER2=id(2),SALES_HEAD=id(3),SERVICE_HEAD=id(4),WORKER=id(5),LONER=id(6),GONE=id(7);
let checks=0;const ok=async f=>{await f();checks++;};
try{
 await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);
 create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
 create table public.staff(user_id uuid primary key,role text,active boolean,department text);
 create function public.inventory_active_staff() returns boolean language sql stable security definer set search_path=public as $$select exists(select 1 from public.staff where user_id=auth.uid() and active)$$;
 create function public.inventory_owner() returns boolean language sql stable security definer set search_path=public as $$select exists(select 1 from public.staff where user_id=auth.uid() and active and role='owner')$$;
 insert into auth.users values('${OWNER}'),('${OWNER2}'),('${SALES_HEAD}'),('${SERVICE_HEAD}'),('${WORKER}'),('${LONER}'),('${GONE}');
 insert into public.staff values('${OWNER}','owner',true,'management'),('${OWNER2}','owner',true,''),('${SALES_HEAD}','head',true,'sales'),('${SERVICE_HEAD}','head',true,'service'),
  ('${WORKER}','staff',true,'sales'),('${LONER}','staff',true,''),('${GONE}','staff',false,'sales');
 create table public.sales_delivery_notes(id uuid primary key,packing_alert_task_ids uuid[] not null default '{}');
 grant usage on schema public to authenticated;grant usage on schema auth to authenticated;grant select on auth.users to authenticated;`);
 await db.exec(mig('202610010056_team_tasks.sql'));await db.exec(mig('202610070068_task_reschedule.sql'));
 await db.exec(mig('202610150083_deadline_approval.sql'));await db.exec(mig('202610150083_deadline_approval.sql')); // re-runnable
 const as=a=>db.exec(`select set_config('test.actor','${a||''}',false)`);
 const inDays=d=>new Date(Date.now()+d*86400000).toISOString();
 const task=async(tid,who,days=1)=>{await as(OWNER);return (await db.query('select * from public.save_team_task($1,0,$2,$3,$4,$5,$6)',[tid,'Call Fixture Hospital','Details','normal',inDays(days),who])).rows[0];};
 const row=async tid=>(await db.query('select * from team_tasks where id=$1',[tid])).rows[0];
 let rn=500;const ask=async(tid,days,reason='Customer asked to call next week',rid=id(rn++))=>{const t=await row(tid),due=typeof days==='number'?inDays(days):days;return (await db.query('select * from request_team_task_reschedule($1,$2,$3,$4,$5)',[rid,tid,t.version,due,reason])).rows[0];};
 const decide=(rid,decision,note='Agreed with the customer')=>db.query('select * from decide_team_task_reschedule($1,$2,$3)',[rid,decision,note]).then(r=>r.rows[0]);
 const tasksFor=async who=>(await db.query("select t.* from team_tasks t join team_task_generated g on g.task_id=t.id where t.assignee_user_id=$1 order by t.created_at",[who])).rows;
 const readable=async(who,rid)=>{await db.exec(`select set_config('test.actor','${who}',false);set role authenticated`);const n=(await db.query('select count(*)::int n from team_task_reschedule_requests where id=$1',[rid])).rows[0].n;await db.exec('reset role');return n;};

 // The person doing the task can no longer move it directly; the owner still can.
 const T1=id(10);await task(T1,WORKER,1);
 await as(WORKER);await ok(async()=>assert.rejects(db.query('select * from reschedule_team_task($1,$2,$3,$4)',[T1,(await row(T1)).version,inDays(3),'Customer away']),/department head's approval/));
 // A request goes to the head of the person's department only.
 const R1=await ask(T1,3);
 await ok(async()=>{assert.equal(R1.status,'pending');assert.equal((await tasksFor(SALES_HEAD)).length,1);assert.equal((await tasksFor(OWNER)).length,0);assert.equal((await tasksFor(SERVICE_HEAD)).length,0);});
 await ok(async()=>assert.match((await tasksFor(SALES_HEAD))[0].details,/Customer asked to call next week/));
 await ok(()=>assert.rejects(ask(T1,4),/already asked for and is waiting/));
 await ok(async()=>assert.equal((await ask(T1,R1.requested_due_at.toISOString(),'Customer asked to call next week',R1.id)).id,R1.id,'replay returns the saved request'));
 // Only the right head (or an owner) decides, never the requester.
 await ok(()=>decide(R1.id,'approved').then(()=>assert.fail('requester decided'),e=>assert.match(e.message,/your own deadline request/)));
 await as(SERVICE_HEAD);await ok(()=>assert.rejects(decide(R1.id,'approved'),/department head of this person or the owner/));
 await ok(async()=>{assert.equal(await readable(WORKER,R1.id),1);assert.equal(await readable(SALES_HEAD,R1.id),1);assert.equal(await readable(SERVICE_HEAD,R1.id),0);});
 await as(SALES_HEAD);const before=await row(T1);await decide(R1.id,'approved','Fine, next week');
 await ok(async()=>{const t=await row(T1);assert.equal(t.reschedule_count,1);assert.equal(t.version,before.version+1);assert.equal(new Date(t.due_at).toISOString(),R1.requested_due_at.toISOString());});
 await ok(async()=>{const e=(await db.query("select * from team_task_events where task_id=$1 and action='reschedule'",[T1])).rows[0];assert.match(e.note,/Approved by head: Fine, next week/);assert.equal(e.actor_user_id,SALES_HEAD);});
 await ok(async()=>assert.equal((await tasksFor(SALES_HEAD))[0].status,'done','approval task closed by the decision'));
 await ok(()=>assert.rejects(decide(R1.id,'rejected'),/already decided/));
 // Rejected: nothing moves.
 const R2=await (async()=>{await as(WORKER);return ask(T1,6,'Still waiting for LPO');})();
 await as(OWNER);await decide(R2.id,'rejected','Call them today please');
 await ok(async()=>{const t=await row(T1);assert.equal(t.reschedule_count,1);assert.equal(new Date(t.due_at).toISOString(),R1.requested_due_at.toISOString());});
 // A task changed after the request cannot be approved from the stale request.
 await as(WORKER);const R3=await ask(T1,8,'Machine part delayed');
 await as(OWNER);await db.query('select * from reschedule_team_task($1,$2,$3,$4)',[T1,(await row(T1)).version,inDays(9),'Owner moved it directly']);
 await as(SALES_HEAD);await ok(()=>assert.rejects(decide(R3.id,'approved'),/task changed after this request/));
 await decide(R3.id,'rejected','Superseded by the owner');
 // Heads and people without a head ask the owners.
 const T2=id(11);await task(T2,SALES_HEAD,1);await as(SALES_HEAD);await ask(T2,2,'Board meeting moved');
 await ok(async()=>{assert.equal((await tasksFor(OWNER)).length,1);assert.equal((await tasksFor(OWNER2)).length,1);});
 const T3=id(12);await task(T3,LONER,1);await as(LONER);await ask(T3,2,'Waiting on supplier quote');
 await ok(async()=>{assert.equal((await tasksFor(OWNER)).length,2);assert.equal((await tasksFor(OWNER2)).length,2);});
 // The 3-move limit still holds for approved requests.
 await db.query("update team_tasks set reschedule_count=3 where id=$1",[T1]);
 await as(WORKER);await ok(()=>assert.rejects(ask(T1,12),/already moved 3 times/));

 // Overdue alerts: one per task and deadline, to the head; never about generated tasks or packing alerts.
 const T4=id(13),T5=id(14);await task(T4,WORKER,1);await task(T5,WORKER,1);
 await db.query("update team_tasks set due_at=now()-interval '2 hours' where id in ($1,$2)",[T4,T5]);
 await db.query("insert into sales_delivery_notes(id,packing_alert_task_ids) values($1,array[$2::uuid])",[id(90),T5]);
 await db.query("update team_tasks set due_at=now()-interval '1 hour' where id in (select task_id from team_task_generated)");
 const headBefore=(await tasksFor(SALES_HEAD)).length;
 await as(WORKER);await ok(async()=>assert.equal((await db.query('select raise_team_task_overdue_alerts() n')).rows[0].n,1,'only T4: T5 is a packing alert, generated tasks are skipped'));
 await ok(async()=>{const alerts=(await tasksFor(SALES_HEAD)).slice(headBefore);assert.equal(alerts.length,1);assert.match(alerts[0].title,/^Overdue: TK-\d+ · Call Fixture Hospital/);assert.equal(alerts[0].urgency,'urgent');});
 await ok(async()=>assert.equal((await db.query('select raise_team_task_overdue_alerts() n')).rows[0].n,0,'repeat runs add nothing'));
 await db.query("update team_tasks set due_at=now()-interval '10 minutes' where id=$1",[T4]);
 await ok(async()=>assert.equal((await db.query('select raise_team_task_overdue_alerts() n')).rows[0].n,1,'a new missed deadline alerts again'));
 await as(GONE);await ok(async()=>assert.equal((await db.query('select raise_team_task_overdue_alerts() n')).rows[0].n,0,'inactive staff raise nothing'));
 // History is permanent; nothing for anonymous callers.
 await ok(()=>assert.rejects(db.query("update team_task_reschedule_requests set reason='Edited reason' where id=$1",[R1.id]),/permanent history/));
 await ok(()=>assert.rejects(db.query('delete from team_task_reschedule_requests where id=$1',[R1.id]),/permanent history/));
 await ok(async()=>{const r=(await db.query("select has_function_privilege('anon','public.request_team_task_reschedule(uuid,uuid,integer,timestamptz,text)','execute') a, has_function_privilege('authenticated','public.task_deadline_approvers(uuid)','execute') b, has_table_privilege('anon','public.team_task_reschedule_requests','select') c")).rows[0];assert.deepEqual([r.a,r.b,r.c],[false,false,false]);});
 console.log(`PASS: ${checks} deadline checks; direct moves only by the owner, requests go to the person's department head (owners for heads and people without a head), no self-decisions, approval moves the deadline once with history and closes the approval task, rejection and stale requests move nothing, 3-move limit kept, one overdue alert per task and deadline to the head (no alerts about alerts or packing alerts), permanent history, no anonymous access.`);
}finally{await db.close();}
