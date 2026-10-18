// Disposable PGlite only: migration 097 with real task/approval policies and MFA helpers.
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const {PGlite}=await import(process.env.PGLITE_MODULE);
const db=new PGlite(),id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const OWNER=id(1),HEAD=id(2),OTHER_HEAD=id(3),WORKER=id(4),OTHER_WORKER=id(5),OUTSIDER=id(6),INACTIVE=id(7),TASK=id(10),OTHER_TASK=id(11),REQUEST=id(20),OTHER_REQUEST=id(21);
const mig=file=>readFileSync(new URL('../supabase/migrations/'+file,import.meta.url),'utf8');
const loadFunction=async(file,name)=>{const match=mig(file).match(new RegExp(String.raw`create(?: or replace)? function public\.${name}\([\s\S]*?\bas\s+(\$[a-z_]*\$)[\s\S]*?\1;`,'i'));assert.ok(match,name);await db.exec(match[0]);};
const as=(actor,aal='aal2')=>db.query("select set_config('test.actor',$1,false),set_config('test.aal',$2,false)",[actor??'',aal]);
const identities=ids=>db.query('select * from deadline_request_task_identities($1)',[ids]).then(r=>r.rows);
let checks=0;const check=async f=>{await f();checks++;};
try{
 await db.exec(`create role anon;create role authenticated;create schema auth;grant usage on schema auth to authenticated;
 create table auth.users(id uuid primary key);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
 create function auth.jwt() returns jsonb language sql stable as $$select jsonb_build_object('aal',current_setting('test.aal',true))$$;
 create table auth.mfa_factors(id uuid primary key default gen_random_uuid(),user_id uuid,status text);
 create table staff(user_id uuid primary key,active boolean,role text,department text);
 create table accounting_memberships(user_id uuid,active boolean);
 create table sales_delivery_notes(id uuid primary key,packing_alert_task_ids uuid[] not null default '{}');
 insert into auth.users values('${OWNER}'),('${HEAD}'),('${OTHER_HEAD}'),('${WORKER}'),('${OTHER_WORKER}'),('${OUTSIDER}'),('${INACTIVE}');
 insert into staff values('${OWNER}',true,'owner','management'),('${HEAD}',true,'head','sales'),('${OTHER_HEAD}',true,'head','service'),('${WORKER}',true,'staff','sales'),('${OTHER_WORKER}',true,'staff','service'),('${OUTSIDER}',true,'staff','stores'),('${INACTIVE}',false,'head','sales');`);
 await db.exec(mig('202610140080_require_two_step.sql'));
 for(const name of ['inventory_active_staff','inventory_owner'])await loadFunction('202610010058_two_step_sign_in.sql',name);
 for(const file of ['202610010056_team_tasks.sql','202610070068_task_reschedule.sql','202610150083_deadline_approval.sql','202610160097_deadline_identity.sql'])await db.exec(mig(file));
 await db.exec('set role authenticated');await as(OWNER);
 for(const [task,assignee,title] of [[TASK,WORKER,'Sales customer follow-up'],[OTHER_TASK,OTHER_WORKER,'Service confidential follow-up']])await db.query("select save_team_task($1,0,$2,'Private task details','normal',now()+interval '1 day',$3)",[task,title,assignee]);
 const requests=[];
 for(const [task,person,request] of [[TASK,WORKER,REQUEST],[OTHER_TASK,OTHER_WORKER,OTHER_REQUEST]]){await as(person);requests.push((await db.query("select * from request_team_task_reschedule($1,$2,1,now()+interval '3 days','Waiting for customer confirmation')",[request,task])).rows[0]);}
 await as(HEAD);const expected=(await identities([REQUEST]))[0];
 await check(async()=>{assert.deepEqual(Object.keys(expected).sort(),['request_id','task_number','task_title']);assert.equal(expected.request_id,REQUEST);assert.equal(expected.task_title,'Sales customer follow-up');assert.match(expected.task_number,/^TK-/);});
 await check(async()=>{assert.equal((await db.query('select count(*)::int n from team_tasks where id=$1',[TASK])).rows[0].n,0,'approver cannot read the original private task');assert.equal((await db.query('select count(*)::int n from team_task_reschedule_requests where id=$1',[REQUEST])).rows[0].n,1,'approver can read the request');});
 await check(async()=>assert.deepEqual(await identities([REQUEST,OTHER_REQUEST,id(999)]),[expected],'unauthorized and nonexistent requests are both omitted'));
 await check(async()=>assert.deepEqual(await identities([REQUEST,REQUEST]),[expected],'duplicate input does not amplify output'));
 await check(async()=>assert.deepEqual(await identities(Array(100).fill(REQUEST)),[expected]));
 for(const ids of [null,[],Array(101).fill(REQUEST)])await check(()=>assert.rejects(identities(ids),/between 1 and 100/));
 await check(async()=>assert.deepEqual(await identities([null,id(999)]),[]));
 await as(WORKER);await check(async()=>assert.deepEqual(await identities([REQUEST,OTHER_REQUEST]),[expected],'requester sees own identity only'));
 await as(OTHER_HEAD);await check(async()=>{const rows=await identities([REQUEST,OTHER_REQUEST]);assert.equal(rows.length,1);assert.equal(rows[0].request_id,OTHER_REQUEST);assert.equal(rows[0].task_title,'Service confidential follow-up');});
 await as(OUTSIDER);await check(async()=>{assert.deepEqual(await identities([REQUEST,OTHER_REQUEST]),[]);await assert.rejects(db.query('update team_task_reschedule_requests set requested_by=$1 where id=$2',[OUTSIDER,REQUEST]),/permission denied/);await assert.rejects(db.query('update team_tasks set assignee_user_id=$1 where id=$2',[OUTSIDER,requests[0].approval_task_ids[0]]),/permission denied/);});
 await as(OWNER);await check(async()=>assert.equal((await identities([REQUEST,OTHER_REQUEST])).length,2));
 await check(async()=>{for(const role of ['anon','authenticated'])assert.equal((await db.query("select has_function_privilege($1,'deadline_request_task_identities(uuid[])','execute') allowed",[role])).rows[0].allowed,role==='authenticated');const meta=(await db.query("select prosecdef,proconfig from pg_proc where oid='deadline_request_task_identities(uuid[])'::regprocedure")).rows[0];assert.equal(meta.prosecdef,true);assert.deepEqual(meta.proconfig,['search_path=public, pg_temp']);});
 for(const [actor,aal] of [[INACTIVE,'aal2'],[OWNER,'aal1'],[null,'aal2']]){await as(actor,aal);await check(()=>assert.rejects(identities([REQUEST]),/Active staff access is required/));}
 await db.exec('reset role');await db.query("insert into auth.mfa_factors(user_id,status) values($1,'verified')",[HEAD]);await db.exec('set role authenticated');await as(HEAD,'aal1');
 await check(()=>assert.rejects(identities([REQUEST]),/Active staff access is required/));
 await as(HEAD);await check(async()=>assert.deepEqual(await identities([REQUEST]),[expected]));
 await db.exec('reset role');await db.query('update staff set active=false where user_id=$1',[HEAD]);await db.exec('set role authenticated');
 await check(()=>assert.rejects(identities([REQUEST]),/Active staff access is required/));
 await db.exec('reset role');await db.query('update staff set active=true where user_id=$1',[HEAD]);await db.exec('set role authenticated');await as(HEAD);
 await db.query("select decide_team_task_reschedule($1,'approved','Customer timing confirmed')",[REQUEST]);
 await check(async()=>assert.deepEqual(await identities([REQUEST]),[expected],'closed requests retain readable history'));
 // The identity boundary follows the same current approval-task ownership as request RLS.
 await db.exec('reset role');await db.query('update team_tasks set assignee_user_id=$1 where id=$2',[OUTSIDER,requests[0].approval_task_ids[0]]);await db.exec('set role authenticated');
 await as(HEAD);await check(async()=>{assert.deepEqual(await identities([REQUEST]),[]);assert.equal((await db.query('select count(*)::int n from team_task_reschedule_requests where id=$1',[REQUEST])).rows[0].n,0);});
 await as(OUTSIDER);await check(async()=>{assert.deepEqual(await identities([REQUEST]),[expected]);assert.equal((await db.query('select count(*)::int n from team_task_reschedule_requests where id=$1',[REQUEST])).rows[0].n,1);});
 await db.exec('reset role;set role anon');await check(()=>assert.rejects(identities([REQUEST]),/permission denied/));
 console.log(`PASS: ${checks} deadline identity checks; real generated approvals, minimal identity without original task access, unrelated-request isolation, bounded input, no direct mutation, matching request RLS, closed history, active staff/MFA and execute privileges.`);
}finally{await db.close();}
