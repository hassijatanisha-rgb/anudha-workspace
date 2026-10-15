// Ephemeral PostgreSQL fixture; never connects to a production database.
// Migration 079: discounts need a head (within the owner-set limit) or owner decision before a Pro forma is sent.
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const {PGlite}=await import(process.env.PGLITE_MODULE);
const db=new PGlite();
const id=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const SALES=id(1),HEAD=id(2),OWNER=id(3),OTHER_HEAD=id(11);
const mig=name=>readFileSync(new URL('../supabase/migrations/'+name,import.meta.url),'utf8');
let checks=0;const ok=async(f)=>{await f();checks++;};
try{
 await db.exec(`create role anon;create role authenticated;create schema auth;
 create table auth.users(id uuid primary key,email text);
 create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
 create table staff(user_id uuid primary key,active boolean,role text,department text,access text[]);
 create table products(id uuid primary key,name text);
 create table organizations(id uuid primary key,deleted_at timestamptz);
 create table contacts(id uuid primary key,organization_id uuid,deleted_at timestamptz,status text);
 insert into auth.users values('${SALES}','s@example.invalid'),('${HEAD}','h@example.invalid'),('${OWNER}','o@example.invalid'),('${OTHER_HEAD}','h2@example.invalid');
 insert into staff values('${SALES}',true,'staff','sales','{proformas}'),('${HEAD}',true,'head','sales','{proformas}'),
  ('${OWNER}',true,'owner','management','{}'),('${OTHER_HEAD}',true,'head','service','{proformas}');
 insert into products values('${id(3)}','Fixture product');
 insert into organizations values('${id(4)}',null);
 insert into contacts values('${id(5)}','${id(4)}',null,'valid');
 set test.actor='${SALES}';`);
 for(const name of ['202609210001_inventory_foundation.sql','202609210004_proforma_delivery_workflow.sql','202609250024_proforma_save_validation.sql'])await db.exec(mig(name));
 // Live helper definitions (migrations 058/060), without the two-step factor check this fixture has no auth schema for.
 await db.exec(`create or replace function public.mfa_satisfied() returns boolean language sql stable as $$select true$$;
 create or replace function public.inventory_active_staff() returns boolean language sql stable security definer set search_path to 'public','pg_temp' as $$select exists(select 1 from public.staff where user_id=auth.uid() and active=true) and public.mfa_satisfied()$$;
 create or replace function public.inventory_owner() returns boolean language sql stable security definer set search_path to 'public','pg_temp' as $$select exists(select 1 from public.staff where user_id=auth.uid() and active=true and role='owner') and public.mfa_satisfied()$$;
 create or replace function public.is_department_head() returns boolean language sql stable security definer set search_path to 'public','pg_temp' as $$select exists(select 1 from public.staff where user_id=(select auth.uid()) and active and role='head') and public.mfa_satisfied()$$;
 create or replace function public.has_access(p_area text) returns boolean language sql stable security definer set search_path to 'public','pg_temp' as $$select exists(select 1 from public.staff s where s.user_id=(select auth.uid()) and s.active and (s.role='owner' or p_area=any(s.access))) and public.mfa_satisfied()$$;
 create or replace function public.require_access(p_area text) returns void language plpgsql stable security definer set search_path to 'public','pg_temp' as $$begin if not public.has_access(p_area) then raise exception 'You do not have access to %. Ask your department head.', replace(p_area,'_',' ') using errcode='42501'; end if; end $$;`);
 const migration=mig('202610130079_discount_approval.sql');
 await db.exec(migration);
 await db.exec(migration); // re-runnable
 const as=actor=>db.exec(`set test.actor='${actor}'`);
 const line=bp=>[{productId:id(3),quantity:2,unitPriceMinor:50000,discountBasisPoints:bp,taxBasisPoints:1800,uom:'piece',description:'Fixture item'}];
 const save=(pf,version,bp)=>db.query('select save_sales_proforma($1,$2,$3,$4,$5,current_date+30,$6,$7,$8,$9)',[pf,version,id(4),id(5),'TZS','7 days','On delivery','Fixture',JSON.stringify(line(bp))]);
 const row=async pf=>(await db.query('select * from sales_proformas where id=$1',[pf])).rows[0];
 const send=async pf=>db.query('select advance_sales_proforma($1,$2,$3,$4)',[pf,(await row(pf)).version,'send','']);
 let n=100;const decide=async(pf,decision='approved',reason='Customer volume order',decisionId=id(n++))=>db.query('select * from decide_proforma_discount($1,$2,$3,$4,$5)',[decisionId,pf,(await row(pf)).version,decision,reason]);
 const policy=async()=>(await db.query('select * from discount_policy')).rows[0];
 const setLimit=async bp=>db.query('select set_discount_policy($1,$2)',[(await policy()).version,bp]);

 // No limit set: every discount needs the owner.
 const PF1=id(20);await as(SALES);await save(PF1,0,1250);
 await ok(()=>assert.rejects(send(PF1),/has a discount\. Ask your department head or the owner/));
 await as(HEAD);await ok(()=>assert.rejects(decide(PF1),/Only the owner \(MD\)/));
 // Only the owner sets the limit, with a current version.
 await ok(()=>assert.rejects(setLimit(1500),/Only the owner/));
 await as(OWNER);await ok(()=>assert.rejects(db.query('select set_discount_policy($1,$2)',[99,1500]),/changed; refresh/));
 await ok(()=>assert.rejects(setLimit(0),/between 0\.01% and 100%/));
 await setLimit(1500);await ok(async()=>assert.equal((await policy()).head_limit_basis_points,1500));
 // Within the limit: staff cannot decide, a head can; the Pro forma then sends.
 await as(SALES);await ok(()=>assert.rejects(decide(PF1),/your own Pro forma/));
 await as(OTHER_HEAD);await ok(()=>assert.rejects(decide(PF1,'approved','x'),/reason/));
 await as(HEAD);const decisionId=id(900);await decide(PF1,'approved','Customer volume order',decisionId);
 await ok(async()=>{const replay=await decide(PF1,'approved','Customer volume order',decisionId);assert.equal(replay.rows[0].id,decisionId);});
 await ok(()=>assert.rejects(decide(PF1,'rejected','Different answer',decisionId),/already recorded differently/));
 await as(SALES);await send(PF1);await ok(async()=>assert.equal((await row(PF1)).status,'sent'));
 await as(HEAD);await ok(()=>assert.rejects(decide(PF1),/Only a draft/));

 // A saved change is a new revision and needs a new decision.
 const PF2=id(21);await as(SALES);await save(PF2,0,1000);await as(HEAD);await decide(PF2);
 await as(SALES);await save(PF2,(await row(PF2)).version,1000);
 await ok(()=>assert.rejects(send(PF2),/has a discount/));
 // Stale version cannot be decided.
 await as(HEAD);await ok(()=>assert.rejects(db.query('select * from decide_proforma_discount($1,$2,$3,$4,$5)',[id(901),PF2,0,'approved','Old screen']),/changed; refresh/));
 // Rejected, then approved later: the latest decision counts.
 await decide(PF2,'rejected','Too low margin');
 await as(SALES);await ok(()=>assert.rejects(send(PF2),/was rejected/));
 await as(OTHER_HEAD);await decide(PF2,'approved','Margin confirmed with sales head');
 await as(SALES);await send(PF2);await ok(async()=>assert.equal((await row(PF2)).status,'sent'));

 // Above the limit: a head cannot decide; the owner can.
 const PF3=id(22);await as(SALES);await save(PF3,0,2000);
 await as(HEAD);await ok(()=>assert.rejects(decide(PF3),/above the department head limit/));
 await as(OWNER);await decide(PF3,'approved','Strategic hospital account');
 await as(SALES);await send(PF3);await ok(async()=>assert.equal((await row(PF3)).status,'sent'));

 // Owner lowers the limit after a head approval: the head approval no longer covers it.
 const PF4=id(23);await as(SALES);await save(PF4,0,1200);await as(HEAD);await decide(PF4);
 await as(OWNER);await setLimit(1000);
 await as(SALES);await ok(()=>assert.rejects(send(PF4),/limit changed; this discount now needs the owner/));

 // Nobody decides their own Pro forma, including heads.
 const PF5=id(24);await as(HEAD);await save(PF5,0,500);await ok(()=>assert.rejects(decide(PF5),/your own Pro forma/));

 // No discount: no approval needed, and nothing to decide.
 const PF6=id(25);await as(SALES);await save(PF6,0,0);
 await as(HEAD);await ok(()=>assert.rejects(decide(PF6),/no discount to approve/));
 await as(SALES);await send(PF6);await ok(async()=>assert.equal((await row(PF6)).status,'sent'));

 // Decisions are permanent, bound to revision and readable only with Pro forma access.
 await ok(()=>assert.rejects(db.query('update sales_proforma_discount_decisions set reason=$1',['Edited']),/permanent history/));
 await ok(()=>assert.rejects(db.query('delete from sales_proforma_discount_decisions'),/permanent history/));
 await ok(async()=>{const r=(await db.query('select revision,required_level,max_discount_basis_points from sales_proforma_discount_decisions where id=$1',[decisionId])).rows[0];assert.deepEqual([r.revision,r.required_level,r.max_discount_basis_points],[1,'head',1250]);});
 await ok(async()=>{const acl=(await db.query("select has_table_privilege('anon','public.sales_proforma_discount_decisions','select') a, has_function_privilege('anon','public.decide_proforma_discount(uuid,uuid,integer,text,text)','execute') f, has_function_privilege('authenticated','public.proforma_discount_requirement(uuid)','execute') r")).rows[0];assert.deepEqual([acl.a,acl.f,acl.r],[false,false,false]);});
 await ok(async()=>{const rls=(await db.query("select relrowsecurity from pg_class where relname in ('discount_policy','sales_proforma_discount_decisions')")).rows;assert.ok(rls.length===2&&rls.every(r=>r.relrowsecurity));});
 console.log(`PASS: ${checks} discount approval checks; owner-only limit, head within limit, owner above it or while unset, no self-approval, new revision needs new decision, latest decision counts, lowered limit voids head approval, no-discount Pro formas unaffected, append-only history, no anonymous access.`);
}finally{await db.close();}
