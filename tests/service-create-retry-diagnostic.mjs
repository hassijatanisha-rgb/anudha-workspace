// Selected-function diagnostic only. No connection to Supabase or live records.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const {PGlite}=await import(process.env.PGLITE_MODULE);
const db=new PGlite();
const source=readFileSync(new URL('../supabase/migrations/202609210008_service_workflow.sql',import.meta.url),'utf8');
const start=source.indexOf('create or replace function public.create_service_case(');
const end=source.indexOf('create or replace function public.advance_service_case(',start);
assert.ok(start>=0&&end>start);
try{
 await db.exec(`
 create schema auth;
 create function auth.uid() returns uuid language sql as $$select '00000000-0000-4000-8000-000000000001'::uuid$$;
 create function public.inventory_active_staff() returns boolean language sql as $$select true$$;
 create table equipment_assets(id uuid primary key,status text,organization_id uuid,product_id uuid);
 create table contacts(id uuid primary key,organization_id uuid,deleted_at timestamptz,status text);
 create sequence service_case_number_seq;
 create table service_cases(id uuid primary key,case_number text,case_type text,asset_id uuid,organization_id uuid,contact_id uuid,product_id uuid,problem_summary text,created_by uuid,status text default 'new');
 create table service_case_events(id uuid primary key,case_id uuid,to_status text,note text,actor_user_id uuid);
 insert into equipment_assets values('00000000-0000-4000-8000-000000000002','active','00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000004');
 `);
 await db.exec(source.slice(start,end));
 const asset='00000000-0000-4000-8000-000000000002',id='00000000-0000-4000-8000-000000000005';
 const create=key=>db.query('select * from create_service_case($1::uuid,$2::uuid,null,$3)',[key,asset,'Fictional repair']);
 const first=await create(id);assert.equal(first.rows[0].id,id);
 await assert.rejects(create(id),/already has open service work/);
 await assert.rejects(create('00000000-0000-4000-8000-000000000006'),/already has open service work/);
 const counts=await db.query('select (select count(*) from service_cases)::int as cases,(select count(*) from service_case_events)::int as events');
 assert.deepEqual(counts.rows,[{cases:1,events:1}]);
 console.log('CONFIRMED: first save persists one case/event; same-ID and fresh-ID retries both reject while the case is open, without duplication. Retry success recovery is missing.');
}finally{await db.close();}
