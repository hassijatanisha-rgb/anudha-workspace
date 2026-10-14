// Ephemeral PostgreSQL fixture; never connects to a production database.
// Migration 080: owners and accounts must use two-step sign-in; everyone else keeps it optional.
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const {PGlite}=await import(process.env.PGLITE_MODULE);
const db=new PGlite();
const id=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const OWNER=id(1),ACCOUNTS_HEAD=id(2),ACCOUNTING_MEMBER=id(3),FORMER_MEMBER=id(4),SALES_HEAD=id(5),SALES_HEAD_ON=id(6),INACTIVE_OWNER=id(7);
let checks=0;const ok=async f=>{await f();checks++;};
try{
 await db.exec(`create role anon;create role authenticated;create schema auth;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
 create function auth.jwt() returns jsonb language sql stable as $$select jsonb_build_object('aal',coalesce(nullif(current_setting('test.aal',true),''),'aal1'))$$;
 create table auth.mfa_factors(id uuid primary key default gen_random_uuid(),user_id uuid,status text);
 create table public.staff(user_id uuid primary key,active boolean,role text,department text,access text[]);
 create table public.accounting_memberships(user_id uuid primary key,active boolean);
 insert into public.staff values('${OWNER}',true,'owner','',null),('${ACCOUNTS_HEAD}',true,'head','accounts','{}'),('${ACCOUNTING_MEMBER}',true,'staff','sales','{proformas}'),
  ('${FORMER_MEMBER}',true,'staff','sales','{proformas}'),('${SALES_HEAD}',true,'head','sales','{proformas}'),('${SALES_HEAD_ON}',true,'head','sales','{proformas}'),('${INACTIVE_OWNER}',false,'owner','',null);
 insert into public.accounting_memberships values('${ACCOUNTING_MEMBER}',true),('${FORMER_MEMBER}',false);
 insert into auth.mfa_factors(user_id,status) values('${SALES_HEAD_ON}','verified'),('${SALES_HEAD}','unverified');
 -- Live mfa_satisfied before this migration (058) and live has_access (060), so the effect on real data access is checked.
 create function public.mfa_satisfied() returns boolean language sql stable security definer set search_path to 'public','pg_temp' as $$select coalesce((select auth.jwt()->>'aal'),'aal1') = 'aal2' or not exists(select 1 from auth.mfa_factors f where f.user_id = (select auth.uid()) and f.status = 'verified')$$;
 create function public.has_access(p_area text) returns boolean language sql stable security definer set search_path to 'public','pg_temp' as $$select exists(select 1 from public.staff s where s.user_id=(select auth.uid()) and s.active and (s.role='owner' or p_area=any(s.access))) and public.mfa_satisfied()$$;`);
 const migration=readFileSync(new URL('../supabase/migrations/202610140080_require_two_step.sql',import.meta.url),'utf8');
 await db.exec(migration);await db.exec(migration); // re-runnable
 const as=async(actor,aal='aal1')=>db.exec(`set test.actor='${actor}';set test.aal='${aal}'`);
 const state=async()=>(await db.query("select two_step_required() r, two_step_setup_required() s, mfa_satisfied() m, has_access('proformas') a")).rows[0];
 const expect=async(actor,aal,want,label)=>{await as(actor,aal);const got=await state();assert.deepEqual([got.r,got.s,got.m,got.a],want,label);};

 // Required, nothing set up: refused everything, sent to setup.
 await ok(()=>expect(OWNER,'aal1',[true,true,false,false],'owner without two-step'));
 await ok(()=>expect(ACCOUNTS_HEAD,'aal1',[true,true,false,false],'accounts department head without two-step'));
 await ok(()=>expect(ACCOUNTING_MEMBER,'aal1',[true,true,false,false],'active accounting member without two-step'));
 // Not required: a former accounting member and ordinary heads keep the old optional behaviour.
 await ok(()=>expect(FORMER_MEMBER,'aal1',[false,false,true,true],'inactive accounting membership'));
 await ok(()=>expect(SALES_HEAD,'aal1',[false,false,true,true],'sales head with only an unfinished setup'));
 await ok(()=>expect(SALES_HEAD_ON,'aal1',[false,false,false,false],'optional two-step on still needs the code, as before'));
 await ok(()=>expect(SALES_HEAD_ON,'aal2',[false,false,true,true],'optional two-step with the code'));
 // Required and set up: the code is still needed each sign-in, then full access.
 await db.exec(`insert into auth.mfa_factors(user_id,status) values('${OWNER}','verified')`);
 await ok(()=>expect(OWNER,'aal1',[true,false,false,false],'owner set up, code not entered yet'));
 await ok(()=>expect(OWNER,'aal2',[true,false,true,true],'owner with the code'));
 // Lost phone: the owner reset removes the factor and the person is sent back to setup.
 await db.exec(`delete from auth.mfa_factors where user_id='${OWNER}'`);
 await ok(()=>expect(OWNER,'aal1',[true,true,false,false],'after a reset'));
 // An inactive owner record does not make the login a required one (it has no access anyway).
 await ok(()=>expect(INACTIVE_OWNER,'aal1',[false,false,true,false],'inactive owner'));
 // Nobody signed in: nothing is required and nothing is granted.
 await ok(async()=>{await db.exec("reset test.actor");const got=await state();assert.deepEqual([got.r,got.s,got.a],[false,false,false]);});
 await ok(async()=>{const acl=(await db.query("select has_function_privilege('anon','public.two_step_setup_required()','execute') a, has_function_privilege('authenticated','public.two_step_setup_required()','execute') b")).rows[0];assert.deepEqual([acl.a,acl.b],[false,true]);});
 console.log(`PASS: ${checks} two-step checks; owners, accounts department and active accounting members refused all access until set up and until the code is entered; others unchanged; reset sends back to setup; no anonymous access.`);
}finally{await db.close();}
