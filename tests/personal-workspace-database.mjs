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
 console.log('PASS: actual migration 012 + RLS fixture: private entry/audit isolation, company owner permissions, direct-write/anonymous/inactive denial, reload and stale revisions, immutable history and soft deletion. Fixture rollback verified.');
}finally{await db.close()}
