-- Run against a disposable database that has the schema plus migration 060 (fictional users only):
--   psql -d <disposable> -v ON_ERROR_STOP=1 -f tests/sql/department-heads-access.sql
-- Everything runs in one transaction that is rolled back.
begin;
create temp table results(name text, ok boolean, detail text) on commit drop;
grant all on results to authenticated;
insert into auth.users(id,email) values
 ('00000000-0000-4000-8000-0000000000a1','owner@test'),('00000000-0000-4000-8000-0000000000a2','saleshead@test'),
 ('00000000-0000-4000-8000-0000000000a3','sales1@test'),('00000000-0000-4000-8000-0000000000a4','stores1@test'),
 ('00000000-0000-4000-8000-0000000000a5','servicehead@test'),('00000000-0000-4000-8000-0000000000a6','new@test'),
 ('00000000-0000-4000-8000-0000000000a7','sales2@test');
insert into public.staff(user_id,role,active,department,access) values
 ('00000000-0000-4000-8000-0000000000a1','owner',true,'management','{}'),
 ('00000000-0000-4000-8000-0000000000a2','head',true,'sales','{leads,proformas,travel}'),
 ('00000000-0000-4000-8000-0000000000a3','staff',true,'sales','{leads}'),
 ('00000000-0000-4000-8000-0000000000a4','staff',true,'stores','{stock,purchasing}'),
 ('00000000-0000-4000-8000-0000000000a5','head',true,'service','{service,travel}'),
 ('00000000-0000-4000-8000-0000000000a7','staff',true,'sales','{}');
insert into public.staff_account_events(user_id,action,note,actor_user_id) values('00000000-0000-4000-8000-0000000000a4','created','','00000000-0000-4000-8000-0000000000a1');
insert into public.suppliers(id,supplier_number,name,created_by) values (gen_random_uuid(),'SUP-T1','Fixture Supplier','00000000-0000-4000-8000-0000000000a1');

create function pg_temp.as_user(n text) returns void language sql as $$
 select set_config('request.jwt.claims', json_build_object('sub','00000000-0000-4000-8000-0000000000'||n,'role','authenticated','aal','aal1')::text, true) $$;
-- check(name, sql that must succeed) / fails(name, sql, expected message fragment)
create function pg_temp.check(p_name text, p_sql text) returns void language plpgsql as $$
begin execute p_sql; insert into results values(p_name,true,''); exception when others then insert into results values(p_name,false,sqlerrm); end $$;
create function pg_temp.fails(p_name text, p_sql text, p_expect text) returns void language plpgsql as $$
begin execute p_sql; insert into results values(p_name,false,'did not fail');
exception when others then insert into results values(p_name, sqlerrm ilike '%'||p_expect||'%', sqlerrm); end $$;
create function pg_temp.equals(p_name text, p_sql text, p_expect text) returns void language plpgsql as $$
declare v text; begin execute p_sql into v; insert into results values(p_name, v is not distinct from p_expect, coalesce(v,'null'));
exception when others then insert into results values(p_name,false,sqlerrm); end $$;

set local role authenticated;

-- Salesperson with Leads only
select pg_temp.as_user('a3');
select pg_temp.equals('staff has listed area','select public.has_access(''leads'')::text','true');
select pg_temp.equals('staff lacks unlisted area','select public.has_access(''proformas'')::text','false');
select pg_temp.fails('save without area is refused','select public.save_sales_proforma(gen_random_uuid(),0,null,null,''TZS'',null,'''','''','''',''[]''::jsonb)','do not have access to proformas');
select pg_temp.fails('purchase request without area is refused','select public.save_purchase_request(gen_random_uuid(),0,(select id from public.suppliers limit 1),''TZS'',null,'''',''[]''::jsonb)','do not have access to purchasing');
select pg_temp.equals('suppliers hidden without purchasing','select count(*)::text from public.suppliers','0');
select pg_temp.equals('staff sees only own staff row','select count(*)::text from public.staff','1');
select pg_temp.fails('staff cannot change access','select public.set_staff_access(''00000000-0000-4000-8000-0000000000a7'',''{leads}'')','own department');
select pg_temp.fails('staff cannot call the internal check','select public.require_access(''leads'')','permission denied');

-- Stores staff with Purchasing
select pg_temp.as_user('a4');
select pg_temp.equals('suppliers visible with purchasing','select count(*)::text from public.suppliers','1');

-- Sales head
select pg_temp.as_user('a2');
select pg_temp.equals('head sees whole staff list','select count(*)::text from public.staff','6');
select pg_temp.check('head gives own-department staff an area they have','select public.set_staff_access(''00000000-0000-4000-8000-0000000000a3'',''{leads,proformas}'')');
select pg_temp.fails('head cannot give an area they lack','select public.set_staff_access(''00000000-0000-4000-8000-0000000000a3'',''{leads,stock}'')','access you have yourself: stock');
select pg_temp.fails('head cannot change another department','select public.set_staff_access(''00000000-0000-4000-8000-0000000000a4'',''{stock}'')','own department');
select pg_temp.fails('head cannot change another head','select public.set_staff_access(''00000000-0000-4000-8000-0000000000a5'',''{travel}'')','own department');
select pg_temp.fails('head cannot change themself','select public.set_staff_access(''00000000-0000-4000-8000-0000000000a2'',''{leads}'')','own department');
select pg_temp.fails('head cannot change the owner','select public.set_staff_active(''00000000-0000-4000-8000-0000000000a1'',false)','own department');
select pg_temp.fails('unknown area is refused','select public.set_staff_access(''00000000-0000-4000-8000-0000000000a3'',''{everything}'')','areas from the list');
select pg_temp.check('head adds a new login to own department','select public.add_department_staff(''00000000-0000-4000-8000-0000000000a6'',''{leads}'')');
select pg_temp.fails('head cannot add the same person twice','select public.add_department_staff(''00000000-0000-4000-8000-0000000000a6'',''{leads}'')','already on the staff list');
select pg_temp.check('head switches off own-department staff','select public.set_staff_active(''00000000-0000-4000-8000-0000000000a7'',false)');
select pg_temp.check('head sets own-department phone','select public.set_staff_phone(''00000000-0000-4000-8000-0000000000a3'',''+255712345678'')');
select pg_temp.check('head names own-department staff','select public.set_staff_display_name(''00000000-0000-4000-8000-0000000000a3'',0,''Sara Sales'')');
select pg_temp.fails('head cannot rename another department','select public.set_staff_display_name(''00000000-0000-4000-8000-0000000000a4'',0,''Someone'')','department head access');
select pg_temp.fails('head cannot set another department phone','select public.set_staff_phone(''00000000-0000-4000-8000-0000000000a4'',''+255712345678'')','department head access');
select pg_temp.equals('head two-step list covers only own department','select count(*)::text from public.staff_two_step_status()','3');
select pg_temp.equals('head sees own-department history only','select count(distinct user_id)::text from public.staff_account_events','2');
select pg_temp.fails('head cannot make owners or heads','select public.manage_staff(''00000000-0000-4000-8000-0000000000a3'',''head'',true)','Owner access required');

-- Owner
select pg_temp.as_user('a1');
select pg_temp.equals('owner has every area','select public.has_access(''stock_count'')::text','true');
select pg_temp.check('owner makes someone a head','select public.manage_staff(''00000000-0000-4000-8000-0000000000a4'',''head'',true)');
select pg_temp.check('owner sets any access','select public.set_staff_access(''00000000-0000-4000-8000-0000000000a4'',''{stock,stock_count,purchasing}'')');
select pg_temp.fails('owner cannot give an owner a list','select public.set_staff_access(''00000000-0000-4000-8000-0000000000a1'',''{leads}'')','full access');
select pg_temp.equals('changes are logged','select string_agg(action,'','' order by action) from public.staff_account_events where user_id=''00000000-0000-4000-8000-0000000000a4''','access_changed,created,role_changed');

-- Switched-off person loses everything
select pg_temp.as_user('a7');
select pg_temp.equals('switched-off staff has no area','select public.has_access(''leads'')::text','false');

reset role;
select name, case when ok then 'ok' else 'FAIL' end, detail from results order by ok, name;
select count(*) filter (where ok) as passed, count(*) filter (where not ok) as failed from results;
rollback;
