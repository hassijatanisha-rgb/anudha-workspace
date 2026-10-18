// Ephemeral PostgreSQL only; website RPCs run as service_role, assignment RPCs as authenticated.
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const {PGlite}=await import(process.env.PGLITE_MODULE);
const db=new PGlite(),id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const OWNER=id(1),SALES=id(2),SERVICE=id(3),STORES=id(4),INACTIVE=id(5);
const mig=file=>readFileSync(new URL('../supabase/migrations/'+file,import.meta.url),'utf8');
const loadFunction=async(file,name)=>{const match=mig(file).match(new RegExp(String.raw`create(?: or replace)? function public\.${name}\([\s\S]*?\bas\s+(\$[a-z_]*\$)[\s\S]*?\1;`,'i'));assert.ok(match,name);await db.exec(match[0]);};
const as=(actor,aal='aal2')=>db.query("select set_config('test.actor',$1,false),set_config('test.aal',$2,false)",[actor??'',aal]);
const base={kind:'quote',name:'Fixture caller',phone:'+255712345678',email:'caller@example.invalid',organization:'Fixture clinic',product:'Analyzer',quantity:'2',message:'Please send a quote',channel:'whatsapp',client_key:'fixture-first'};
const submit=extra=>{const p={...base,...extra};return db.query('select * from submit_customer_request($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',Object.values(p)).then(r=>r.rows[0]);};
const eligible=request=>db.query('select * from customer_request_assignees($1)',[request]).then(r=>r.rows.map(s=>s.user_id).sort());
const assign=(request,version,person)=>db.query("select * from advance_customer_request($1,$2,'assign',$3,'Fixture assignment')",[request,version,person]).then(r=>r.rows[0]);
let checks=0;const check=async f=>{await f();checks++;};
try{
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;
 create table auth.users(id uuid primary key);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
 create function auth.jwt() returns jsonb language sql stable as $$select jsonb_build_object('aal',current_setting('test.aal',true))$$;
 create table auth.mfa_factors(id uuid primary key default gen_random_uuid(),user_id uuid,status text);
 create table staff(user_id uuid primary key,active boolean,role text,department text,access text[],display_name text);
 create table accounting_memberships(user_id uuid,active boolean);
 create table organizations(id uuid primary key,deleted_at timestamptz);
 create table contacts(id uuid primary key,organization_id uuid,deleted_at timestamptz);
 create table sales_proformas(id uuid primary key,organization_id uuid,deleted_at timestamptz);
 grant usage on schema auth to authenticated,service_role;
 insert into auth.users values('${OWNER}'),('${SALES}'),('${SERVICE}'),('${STORES}'),('${INACTIVE}');
 insert into staff values('${OWNER}',true,'owner','management','{}','Fixture owner'),('${SALES}',true,'staff','sales','{leads}','Fixture salesperson'),
 ('${SERVICE}',true,'staff','service','{service}','Fixture engineer'),('${STORES}',true,'staff','stores','{stock}','Fixture stores'),('${INACTIVE}',false,'staff','sales','{leads}','Inactive fixture');`);
 await db.exec(mig('202610140080_require_two_step.sql'));
 for(const name of ['inventory_active_staff','inventory_owner'])await loadFunction('202610010058_two_step_sign_in.sql',name);
 await loadFunction('202610050060_department_heads_and_access.sql','has_access');
 await db.exec(mig('202609300042_sales_leads.sql'));await db.exec(mig('202610060062_customer_requests.sql'));
 await db.exec(mig('202610160098_public_request_integrity.sql'));await db.exec(mig('202610160098_public_request_integrity.sql'));
 await db.exec('set role service_role');
 const first=await submit({name:' Fixture caller ',phone:'+255 712-345-678',email:' CALLER@EXAMPLE.INVALID ',organization:' Fixture clinic ',product:' Analyzer ',quantity:' 2 ',message:' Please send a quote ',channel:'invalid'});
 await check(async()=>{const retry=await submit({client_key:'different-connection'});assert.equal(retry.id,first.id);assert.equal(retry.duplicate,true);assert.equal(retry.kind,'quote');});
 for(const [field,value] of Object.entries({kind:'support',name:'Another caller',phone:'+255712345679',email:'different@example.invalid',organization:'Another clinic',product:'Reagent',quantity:'3',message:'Please send a revised quote',channel:'email'})){
  await check(async()=>{const changed=await submit({[field]:value,client_key:'change-'+field});assert.notEqual(changed.id,first.id,`${field} is material`);assert.equal(changed.duplicate,false);});
 }
 await check(async()=>{for(let n=0;n<5;n++)await submit({message:'Rate limit fixture '+n,client_key:'rate-limit'});await assert.rejects(submit({message:'Rate limit fixture 6',client_key:'rate-limit'}),/Too many requests/);assert.equal((await submit({message:'Rate limit fixture 0',client_key:'rate-limit'})).duplicate,true);});
 const complaint=await submit({kind:'complaint',client_key:'complaint'}),support=await submit({kind:'support',message:'Please inspect my equipment',client_key:'support'});
 await db.exec('reset role');
 await check(async()=>{assert.equal((await db.query('select count(*)::int n from customer_requests where id=$1',[first.id])).rows[0].n,1);assert.equal((await db.query('select count(*)::int n from customer_request_events where request_id=$1',[first.id])).rows[0].n,1);assert.ok((await db.query('select lead_id from customer_requests where id=$1',[first.id])).rows[0].lead_id);});
 await db.exec('set role authenticated');await as(SALES);
 await check(async()=>assert.deepEqual(await eligible(first.id),[OWNER,SALES]));
 await check(async()=>assert.deepEqual(await eligible(complaint.id),[OWNER,SALES,SERVICE]));
 await check(async()=>assert.deepEqual(await eligible(support.id),[OWNER,SALES,SERVICE]));
 for(const person of [STORES,INACTIVE,SERVICE,null])await check(()=>assert.rejects(assign(first.id,1,person),/active employee with access/));
 await check(async()=>{assert.equal((await db.query('select version from customer_requests where id=$1',[first.id])).rows[0].version,1);assert.equal((await db.query('select count(*)::int n from customer_request_events where request_id=$1',[first.id])).rows[0].n,1);});
 await check(async()=>assert.equal((await assign(first.id,1,SALES)).assigned_user_id,SALES));
 await check(()=>assert.rejects(assign(first.id,1,OWNER),/changed; refresh/));
 await check(async()=>assert.equal((await assign(first.id,2,OWNER)).assigned_user_id,OWNER));
 await check(async()=>assert.equal((await assign(complaint.id,1,SERVICE)).assigned_user_id,SERVICE));
 await as(SERVICE);await check(()=>assert.rejects(eligible(first.id),/do not have access/));
 await check(()=>assert.rejects(assign(first.id,3,SERVICE),/do not have access/));
 await check(async()=>assert.deepEqual(await eligible(complaint.id),[OWNER,SALES,SERVICE]));
 await check(async()=>assert.equal((await assign(complaint.id,2,SALES)).assigned_user_id,SALES,'Recipient eligibility uses their areas, not the caller\'s service-only grant'));
 // A grant revoked after opening the picker is rechecked before saving.
 await db.exec('reset role');await db.query("update staff set access='{}' where user_id=$1",[SALES]);await db.exec('set role authenticated');await as(SERVICE);
 await check(()=>assert.rejects(assign(complaint.id,3,SALES),/active employee with access/));
 for(const [actor,aal] of [[STORES,'aal2'],[INACTIVE,'aal2'],[OWNER,'aal1'],[null,'aal2']]){
  await as(actor,aal);await check(async()=>{await assert.rejects(eligible(complaint.id),/do not have access/);await assert.rejects(assign(complaint.id,3,SERVICE),/do not have access/);});
 }
 await check(async()=>{
  for(const fn of ['customer_request_assignees(uuid)','advance_customer_request(uuid,integer,text,uuid,text)'])assert.equal((await db.query("select has_function_privilege('anon',$1,'execute') allowed",[fn])).rows[0].allowed,false);
  assert.equal((await db.query("select has_function_privilege('authenticated','submit_customer_request(text,text,text,text,text,text,text,text,text,text)','execute') allowed")).rows[0].allowed,false);
 });
 console.log(`PASS: ${checks} public request checks; normalized full-content retries, distinct changed submissions, flood limit, eligible assignment/picker, revoked grants, MFA and RPC privileges. Cross-session advisory-lock contention requires PostgreSQL integration.`);
}finally{await db.close();}
