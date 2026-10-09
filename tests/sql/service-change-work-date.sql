-- A scheduled service job (for example the planned maintenance after an installation) can be moved to another day
-- (migration 077). Disposable database with the schema and migrations up to 077; fictional data only; rolled back.
--   psql -d <disposable> -v ON_ERROR_STOP=1 -f tests/sql/service-change-work-date.sql   (prints passed/failed)
begin;
create temp table results(name text, ok boolean, detail text) on commit drop;
grant all on results to authenticated;
insert into auth.users(id,email) values('00000000-0000-4000-8000-0000000000c1','servicehead@t');
insert into public.staff(user_id,role,active,department,access) values('00000000-0000-4000-8000-0000000000c1','head',true,'service','{service,deliveries,stock}');
insert into public.organizations(id,name) values('00000000-0000-4000-8000-0000000000c2','Fixture Service Clinic');
insert into public.products(id,name,sku) values('00000000-0000-4000-8000-0000000000c3','Fixture Service Analyzer','FXS-1');
insert into public.equipment_assets(id,organization_id,product_id,unit_number,status,installed_on,maintenance_interval_months) values('00000000-0000-4000-8000-0000000000c4','00000000-0000-4000-8000-0000000000c2','00000000-0000-4000-8000-0000000000c3',1,'active',current_date,3);
insert into public.service_cases(id,case_number,case_type,asset_id,organization_id,product_id,status,scheduled_for,assigned_user_id,created_by)
 values('00000000-0000-4000-8000-0000000000c5','SRV-FIXTURE-1','service','00000000-0000-4000-8000-0000000000c4','00000000-0000-4000-8000-0000000000c2','00000000-0000-4000-8000-0000000000c3','scheduled',current_date+90,'00000000-0000-4000-8000-0000000000c1','00000000-0000-4000-8000-0000000000c1');

create function pg_temp.as_user(n text) returns void language sql as $$
 select set_config('request.jwt.claims', json_build_object('sub','00000000-0000-4000-8000-0000000000'||n,'role','authenticated','aal','aal1')::text, true) $$;
create function pg_temp.fails(p_name text, p_sql text, p_expect text) returns void language plpgsql as $$
begin execute p_sql; insert into results values(p_name,false,'did not fail');
exception when others then insert into results values(p_name, sqlerrm ilike '%'||p_expect||'%', sqlerrm); end $$;
create function pg_temp.equals(p_name text, p_sql text, p_expect text) returns void language plpgsql as $$
declare v text; begin execute p_sql into v; insert into results values(p_name, v is not distinct from p_expect, coalesce(v,'null'));
exception when others then insert into results values(p_name,false,sqlerrm); end $$;

set local role authenticated; select pg_temp.as_user('c1');
select pg_temp.equals('a scheduled job moves to an earlier day and stays scheduled',
 'select status||'':''||(scheduled_for=current_date+2) from public.advance_service_case(''00000000-0000-4000-8000-0000000000c5'',1,''schedule'',null,current_date+2,''Customer asked for Saturday'')','scheduled:true');
select pg_temp.equals('the change is in the job history','select count(*)::text from public.service_case_events where case_id=''00000000-0000-4000-8000-0000000000c5'' and note=''Customer asked for Saturday''','1');
select pg_temp.fails('a past date is refused','select public.advance_service_case(''00000000-0000-4000-8000-0000000000c5'',2,''schedule'',null,current_date-1,''Wrong date'')','today or a future');
select pg_temp.equals('starting work still follows','select status from public.advance_service_case(''00000000-0000-4000-8000-0000000000c5'',2,''start'',null,null,''On site now'')','on_site');
select pg_temp.fails('an on-site job cannot be rescheduled','select public.advance_service_case(''00000000-0000-4000-8000-0000000000c5'',3,''schedule'',null,current_date+5,''Later'')','not the next allowed');
reset role;

select name, case when ok then 'ok' else 'FAIL' end, detail from results order by ok, name;
select count(*) filter (where ok) as passed, count(*) filter (where not ok) as failed from results;
rollback;
