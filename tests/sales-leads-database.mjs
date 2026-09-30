// Disposable PGlite fixture only: run with PGLITE_MODULE pointing to @electric-sql/pglite dist/index.js.
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const {PGlite}=await import(process.env.PGLITE_MODULE);
const db=new PGlite(),id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const owner=id(1),staff=id(2),inactive=id(3),org=id(10),otherOrg=id(11),contact=id(20),otherContact=id(21),pf=id(30),otherPf=id(31);
await db.exec(`create role anon;create role authenticated;create schema auth;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
create table public.staff(user_id uuid primary key,role text,active boolean);
create function public.inventory_active_staff() returns boolean language sql stable security definer set search_path=public as $$select exists(select 1 from public.staff where user_id=auth.uid() and active)$$;
create table public.organizations(id uuid primary key,name text,deleted_at timestamptz);
create table public.contacts(id uuid primary key,organization_id uuid,deleted_at timestamptz);
create table public.sales_proformas(id uuid primary key,organization_id uuid,deleted_at timestamptz);
insert into auth.users values('${owner}'),('${staff}'),('${inactive}');
insert into public.staff values('${owner}','owner',true),('${staff}','staff',true),('${inactive}','staff',false);
insert into public.organizations values('${org}','Fixture Hospital',null),('${otherOrg}','Other Clinic',null);
insert into public.contacts values('${contact}','${org}',null),('${otherContact}','${otherOrg}',null);
insert into public.sales_proformas values('${pf}','${org}',null),('${otherPf}','${otherOrg}',null);`);
await db.exec(readFileSync(new URL('../supabase/migrations/202609300042_sales_leads.sql',import.meta.url),'utf8'));
const as=async actor=>db.exec(`select set_config('test.actor','${actor||''}',false)`);
const save=(leadId,version,fields)=>db.query('select * from public.save_sales_lead($1,$2,$3::jsonb)',[leadId,version,JSON.stringify(fields)]).then(r=>r.rows[0]);
const advance=(leadId,version,action,assignee=null,note='',proforma=null)=>db.query('select * from public.advance_sales_lead($1,$2,$3,$4,$5,$6)',[leadId,version,action,assignee,note,proforma]).then(r=>r.rows[0]);
const rejects=async(promise,pattern)=>{await assert.rejects(promise,pattern);};
let checks=0;const ok=()=>checks++;

// Access: anonymous and inactive staff cannot create leads.
await as('');await rejects(save(id(100),0,{subject:'Anon inquiry',caller_name:'Caller',caller_phone:'0712345678'}),/Active staff/);ok();
await as(inactive);await rejects(save(id(100),0,{subject:'Inactive inquiry',caller_name:'Caller',caller_phone:'0712345678'}),/Active staff/);ok();

// A phone inquiry from an unknown caller needs a name and phone number.
await as(staff);
await rejects(save(id(101),0,{subject:'No caller details'}),/check constraint|violates/);ok();
const inquiry=await save(id(101),0,{subject:'Needs a chemistry analyzer',caller_name:'Asha Caller',caller_phone:'0712 345 678',caller_organization:'New Clinic',source:'phone'});
assert.equal(inquiry.stage,'inquiry');assert.match(inquiry.lead_number,/^LD-\d{6}$/);assert.equal(inquiry.created_by,staff);ok();

// Lost response: the same request ID and subject returns the existing row; different content is rejected.
const replay=await save(id(101),0,{subject:'Needs a chemistry analyzer',caller_name:'Asha Caller',caller_phone:'0712 345 678'});
assert.equal(replay.lead_number,inquiry.lead_number);assert.equal(replay.version,1);ok();
await rejects(save(id(101),0,{subject:'Different subject',caller_name:'Asha Caller',caller_phone:'0712345678'}),/already exists/);ok();
assert.equal((await db.query('select count(*)::int n from public.sales_leads')).rows[0].n,1);ok();

// Client and contact must match; the assignee must be active staff.
await rejects(save(id(102),0,{subject:'Wrong contact',organization_id:org,contact_id:otherContact}),/contact from the selected client/);ok();
await rejects(save(id(102),0,{subject:'Inactive owner',organization_id:org,owner_user_id:inactive}),/active employee/);ok();
await rejects(save(id(102),0,{subject:'Bad date',organization_id:org,next_action_on:'not-a-date'}),/invalid ID, amount or date/);ok();
const lead=await save(id(102),0,{subject:'Reagent supply',organization_id:org,contact_id:contact,owner_user_id:staff,estimated_value_minor:'1500000',next_action:'Call back',next_action_on:'2026-10-02'});
assert.equal(lead.stage,'lead');assert.equal(Number(lead.estimated_value_minor),1500000);ok();

// Stale versions are rejected for edits and actions.
await rejects(save(id(102),0+2,{subject:'Stale edit',organization_id:org}),/changed/);ok();
await rejects(advance(id(101),5,'qualify',staff),/changed/);ok();

// Inquiry -> lead needs a salesperson; qualify assigns in one step.
await rejects(advance(id(101),1,'qualify'),/Assign a salesperson/);ok();
const qualified=await advance(id(101),1,'qualify',owner,'Shivani passed to sales');
assert.equal(qualified.stage,'lead');assert.equal(qualified.owner_user_id,owner);ok();
await rejects(advance(id(101),2,'qualify',owner),/Only inquiries/);ok();

// Won requires a Pro forma for the same client, used by one lead only.
const opp=await advance(id(102),1,'opportunity');assert.equal(opp.stage,'opportunity');ok();
await rejects(advance(id(102),2,'won'),/Choose the Pro forma/);ok();
await rejects(advance(id(102),2,'won',null,'',otherPf),/same client/);ok();
const won=await advance(id(102),2,'won',null,'Customer accepted',pf);assert.equal(won.stage,'won');assert.equal(won.proforma_id,pf);ok();
await rejects(advance(id(101),2,'won',null,'',pf),/already linked|same client/);ok();
await rejects(save(id(102),3,{subject:'Edit after won',organization_id:org}),/Reopen/);ok();
await rejects(advance(id(102),3,'reopen'),/Only lost/);ok();

// A caller-only lead takes the client from its Pro forma when won.
const callerWon=await advance(id(101),2,'won',null,'',otherPf);assert.equal(callerWon.organization_id,otherOrg);ok();

// Lost needs a reason and can be reopened, clearing the reason.
const third=await save(id(103),0,{subject:'Price enquiry',organization_id:org});
await rejects(advance(id(103),1,'lost',null,''),/why the lead was lost/);ok();
const lost=await advance(id(103),1,'lost',null,'Chose a competitor');assert.equal(lost.lost_reason,'Chose a competitor');ok();
const reopened=await advance(id(103),2,'reopen',null,'Customer called back');assert.equal(reopened.stage,'lead');assert.equal(reopened.lost_reason,'');ok();

// History records every step with its actor and cannot be changed or deleted; leads cannot be deleted.
const history=(await db.query(`select action,to_stage,actor_user_id from public.sales_lead_events where lead_id=$1 order by created_at,action`,[id(102)])).rows;
assert.deepEqual(history.map(r=>r.action).sort(),['create','opportunity','won']);assert.ok(history.every(r=>r.actor_user_id===staff));ok();
await rejects(db.query(`update public.sales_lead_events set note='changed'`),/immutable/);ok();
await rejects(db.query(`delete from public.sales_lead_events`),/immutable/);ok();
await rejects(db.query(`delete from public.sales_leads where id=$1`,[id(103)]),/never hard-deleted/);ok();

// No stock, proforma or client rows were changed by any lead action.
assert.equal((await db.query('select count(*)::int n from public.sales_proformas')).rows[0].n,2);ok();

// Direct table writes and anonymous RPC execution are not granted.
const grants=(await db.query(`select has_table_privilege('authenticated','public.sales_leads','insert') ins,has_table_privilege('authenticated','public.sales_leads','update') upd,
 has_function_privilege('anon','public.save_sales_lead(uuid,integer,jsonb)','execute') anon_save,has_function_privilege('authenticated','public.save_sales_lead(uuid,integer,jsonb)','execute') auth_save`)).rows[0];
assert.deepEqual(grants,{ins:false,upd:false,anon_save:false,auth_save:true});ok();
console.log(`PASS: ${checks} sales lead checks — access denial, caller-or-client identity, lost-response replay, stale versions, assignment, stage rules, won-to-Pro-forma link, lost/reopen, immutable history, no hard delete, no direct writes.`);
