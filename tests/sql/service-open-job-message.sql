-- Recording a repair on a machine that already has an open service job (usually its planned maintenance) names that
-- job and its date (migration 075). Disposable database with the schema and migrations up to 075; fictional data only;
-- everything is rolled back.
--   psql -d <disposable> -v ON_ERROR_STOP=1 -f tests/sql/service-open-job-message.sql   (prints passed/failed)
begin;
create temp table results(name text, ok boolean, detail text) on commit drop;
grant all on results to authenticated;
insert into auth.users(id,email) values('00000000-0000-4000-8000-0000000000c1','servicehead@t');
insert into public.staff(user_id,role,active,department,access) values('00000000-0000-4000-8000-0000000000c1','head',true,'service','{service,deliveries,stock}');
insert into public.organizations(id,name) values('00000000-0000-4000-8000-0000000000c2','Fixture Service Clinic');
insert into public.products(id,name,sku) values('00000000-0000-4000-8000-0000000000c3','Fixture Service Analyzer','FXS-1');
insert into public.equipment_assets(id,organization_id,product_id,unit_number,status,installed_on,maintenance_interval_months) values('00000000-0000-4000-8000-0000000000c4','00000000-0000-4000-8000-0000000000c2','00000000-0000-4000-8000-0000000000c3',1,'active',current_date,3);
insert into public.service_cases(id,case_number,case_type,asset_id,organization_id,product_id,status,scheduled_for,assigned_user_id,created_by)
 values('00000000-0000-4000-8000-0000000000c5','SRV-FIXTURE-1','service','00000000-0000-4000-8000-0000000000c4','00000000-0000-4000-8000-0000000000c2','00000000-0000-4000-8000-0000000000c3','scheduled','2027-01-07','00000000-0000-4000-8000-0000000000c1','00000000-0000-4000-8000-0000000000c1');

create function pg_temp.as_user(n text) returns void language sql as $$
 select set_config('request.jwt.claims', json_build_object('sub','00000000-0000-4000-8000-0000000000'||n,'role','authenticated','aal','aal1')::text, true) $$;
create function pg_temp.fails(p_name text, p_sql text, p_expect text) returns void language plpgsql as $$
begin execute p_sql; insert into results values(p_name,false,'did not fail');
exception when others then insert into results values(p_name, sqlerrm ilike '%'||p_expect||'%', sqlerrm); end $$;
create function pg_temp.equals(p_name text, p_sql text, p_expect text) returns void language plpgsql as $$
declare v text; begin execute p_sql into v; insert into results values(p_name, v is not distinct from p_expect, coalesce(v,'null'));
exception when others then insert into results values(p_name,false,sqlerrm); end $$;

set local role authenticated; select pg_temp.as_user('c1');
select pg_temp.fails('a repair while maintenance is planned names the open job and date',
 'select public.create_service_case(gen_random_uuid(),''00000000-0000-4000-8000-0000000000c4'',null,''Error E4 after installation'')',
 'open service job SRV-FIXTURE-1 (scheduled, work date 07 Jan 2027)');
reset role;
update public.service_cases set status='cancelled' where id='00000000-0000-4000-8000-0000000000c5';
set local role authenticated; select pg_temp.as_user('c1');
select pg_temp.equals('once that job is closed the repair is recorded','select case_type||'':''||status from public.create_service_case(gen_random_uuid(),''00000000-0000-4000-8000-0000000000c4'',null,''Error E4 after installation'')','service:new');
reset role;

select name, case when ok then 'ok' else 'FAIL' end, detail from results order by ok, name;
select count(*) filter (where ok) as passed, count(*) filter (where not ok) as failed from results;
rollback;
