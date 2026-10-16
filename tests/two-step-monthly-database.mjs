// Ephemeral PostgreSQL fixture; never connects to a production database.
// Migration 088: a two-step code counts for 30 days; people without an authenticator who are not required are unaffected.
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const {PGlite}=await import(process.env.PGLITE_MODULE);
const db=new PGlite();
const id=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const OWNER=id(1),SALES=id(2),SALES_WITH_CODE=id(3);
let checks=0;
try{
 await db.exec(`create role anon;create role authenticated;create schema auth;
 create table auth.mfa_factors(user_id uuid,status text);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
 create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('test.jwt',true),''),'{}')::jsonb$$;
 create table staff(user_id uuid primary key,active boolean,role text,department text);
 create table accounting_memberships(user_id uuid,active boolean);
 insert into staff values('${OWNER}',true,'owner','management'),('${SALES}',true,'staff','sales'),('${SALES_WITH_CODE}',true,'staff','sales');
 insert into auth.mfa_factors values('${OWNER}','verified'),('${SALES_WITH_CODE}','verified');`);
 await db.exec(readFileSync(new URL('../supabase/migrations/202610140080_require_two_step.sql',import.meta.url),'utf8'));
 const migration=readFileSync(new URL('../supabase/migrations/202610160088_two_step_monthly.sql',import.meta.url),'utf8');
 await db.exec(migration);await db.exec(migration); // re-runnable
 const now=Math.floor(Date.now()/1000),day=86400;
 const satisfied=async(actor,jwt)=>{await db.exec(`set test.actor='${actor}';set test.jwt='${JSON.stringify(jwt)}'`);return (await db.query('select public.mfa_satisfied() ok')).rows[0].ok;};
 const amr=(...m)=>({aal:m.some(x=>x.method==='totp')?'aal2':'aal1',amr:m});
 assert.equal(await satisfied(OWNER,amr({method:'totp',timestamp:now-60},{method:'password',timestamp:now-120})),true,'fresh code');checks++;
 assert.equal(await satisfied(OWNER,amr({method:'totp',timestamp:now-29*day})),true,'29-day-old code');checks++;
 assert.equal(await satisfied(OWNER,amr({method:'totp',timestamp:now-31*day})),false,'31-day-old code must be entered again');checks++;
 assert.equal(await satisfied(OWNER,{aal:'aal2',amr:[{method:'password',timestamp:now}]}),false,'aal2 without a totp entry');checks++;
 assert.equal(await satisfied(OWNER,amr({method:'password',timestamp:now})),false,'owner with password only');checks++;
 assert.equal(await satisfied(OWNER,{aal:'aal2',amr:'not-an-array'}),false,'malformed claim fails closed');checks++;
 assert.equal(await satisfied(OWNER,{aal:'aal2',amr:[{method:'totp',timestamp:'soon'}]}),false,'non-numeric time fails closed');checks++;
 assert.equal(await satisfied(SALES,amr({method:'password',timestamp:now})),true,'staff without an authenticator unaffected');checks++;
 assert.equal(await satisfied(SALES_WITH_CODE,amr({method:'totp',timestamp:now-31*day})),false,'optional authenticator also renews monthly');checks++;
 console.log(`PASS: ${checks} two-step monthly checks; fresh and 29-day codes accepted, 31-day code refused, password-only and malformed claims refused, staff without an authenticator unaffected.`);
}finally{await db.close();}
