// Disposable, in-memory PostgreSQL only. No connection string or production calls.
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const {PGlite}=await import(process.env.PGLITE_MODULE);
const db=new PGlite();
try{
 await db.exec(`
  create role anon; create role authenticated; create schema auth;
  create table auth.users(id uuid primary key);
  create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
  grant usage on schema auth to authenticated,anon;
  create table public.staff(user_id uuid primary key references auth.users(id),active boolean,role text);
  insert into auth.users values('00000000-0000-0000-0000-000000000001'),('00000000-0000-0000-0000-000000000002');
  insert into public.staff values('00000000-0000-0000-0000-000000000001',true,'owner'),('00000000-0000-0000-0000-000000000002',true,'staff');
 `);
 // Use the actual authorization helpers from the foundation migration.
 const foundation=readFileSync(new URL('../supabase/migrations/202609210001_inventory_foundation.sql',import.meta.url),'utf8');
 for(const name of ['inventory_active_staff','inventory_owner']){
  const declaration=foundation.match(new RegExp(`create or replace function public\\.${name}\\(\\)[\\s\\S]*?\\$\\$;`));
  assert.ok(declaration,`Missing foundation helper ${name}`);await db.exec(declaration[0]);
 }
 await db.exec(readFileSync(new URL('../supabase/migrations/202609220012_personal_workspace.sql',import.meta.url),'utf8'));
 // GRANT does not resolve the pg_temp alias. Resolve the actual temporary schema
 // in this disposable harness; the application's migration remains unchanged.
 await db.exec('create temporary table fixture_temp_schema_marker(id integer)');
 const tempSchema=(await db.query('select nspname from pg_namespace where oid=pg_my_temp_schema()')).rows[0].nspname;
 const fixture=readFileSync(new URL('./personal-workspace-rls.sql',import.meta.url),'utf8').replace('grant usage on schema pg_temp to authenticated, anon;',`grant usage on schema "${tempSchema}" to authenticated, anon;`);
 await db.exec(fixture);
 assert.equal((await db.query('select count(*)::int n from public.workspace_entries')).rows[0].n,0,'fixture rollback leaves no entries');
 assert.equal((await db.query('select count(*)::int n from public.workspace_entry_audit')).rows[0].n,0,'fixture rollback leaves no audit snapshots');
 if(process.env.TWENTY_EMPLOYEES==='1'){
  const ids=Array.from({length:20},(_,i)=>`10000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`);
  const asActor=(id,fn)=>db.transaction(async tx=>{
   await tx.exec('set local role authenticated');
   await tx.query("select set_config('request.jwt.claim.sub',$1,true)",[id]);return fn(tx);
  });
  const save=(tx,id,version,kind,visibility='personal',done=false)=>tx.query(
   "select * from save_workspace_entry($1,$2,$3,$4,$5,'Fictional only',$6,null,null,'urgent',$7,false)",
   [id,version,kind,visibility,`Test ${kind}`,kind==='event'?'2026-10-08T08:00:00Z':null,done]);
  for(const [i,id] of ids.entries()){
   await db.query('insert into auth.users values($1)',[id]);
   await db.query('insert into staff values($1,true,$2)',[id,i===0?'owner':'staff']);
   for(const kind of ['note','task','event'])await asActor(id,tx=>save(tx,id.replace('10000000',kind==='note'?'20000000':kind==='task'?'30000000':'40000000'),0,kind));
  }
  const company='50000000-0000-4000-8000-000000000001';
  await asActor(ids[0],tx=>save(tx,company,0,'event','company'));
  for(const [i,id] of ids.entries()){
   await asActor(id,async tx=>{
    const rows=(await tx.query('select * from workspace_entries')).rows;
    assert.equal(rows.length,4);assert.ok(rows.every(r=>r.owner_id===id||r.id===company));
    const history=(await tx.query('select * from workspace_entry_audit')).rows;
    assert.equal(history.length,4);assert.ok(history.every(r=>r.actor_id===id||r.entry_id===company));
   });
   const other=ids[(i+1)%20].replace('10000000','20000000');
   await assert.rejects(asActor(id,tx=>save(tx,other,1,'note')),/Entry unavailable/);
   const task=id.replace('10000000','30000000');
   await asActor(id,tx=>save(tx,task,1,'task','personal',true));
   await assert.rejects(asActor(id,tx=>save(tx,task,1,'task')),/Entry changed/);
   await asActor(id,async tx=>{
    const row=(await tx.query('select * from workspace_entries where id=$1',[task])).rows[0];
    assert.equal(row.completed,true);assert.equal(row.version,2);assert.equal(row.owner_id,id);
    const audit=(await tx.query('select * from workspace_entry_audit where entry_id=$1',[task])).rows;
    assert.equal(audit.length,2);assert.ok(audit.every(r=>r.actor_id===id));
   });
   if(i>0)await assert.rejects(asActor(id,tx=>save(tx,company,1,'event','company')),/Owner access is required/);
   const note=id.replace('10000000','20000000');
   await assert.rejects(asActor(id,tx=>save(tx,note,1,'note','company')),/visibility cannot change/);
  }
  assert.equal((await db.query('select count(*)::int n from workspace_entries')).rows[0].n,61);
  assert.equal((await db.query('select count(*)::int n from workspace_entry_audit')).rows[0].n,81);
  console.log('PASS 20 sequential fictional actors: private notes/tasks/events, shared company event, denied company edits and visibility changes, verified completion/audit and stale saves. Not real login or concurrent sessions.');
 }
 console.log('PASS: actual migration 012 + RLS fixture: private entry/audit isolation, company owner permissions, direct-write/anonymous/inactive denial, reload and stale revisions, immutable history and soft deletion. Fixture rollback verified.');
}finally{await db.close()}
