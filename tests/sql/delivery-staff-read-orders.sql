-- Stores and delivery staff (Deliveries access, no Pro formas access) can read the Pro forma and items behind a
-- delivery note (migration 072). Disposable database with the schema and migrations up to 072; fictional users only;
-- everything is rolled back.
--   psql -d <disposable> -v ON_ERROR_STOP=1 -f tests/sql/delivery-staff-read-orders.sql   (prints passed/failed)
begin;
create temp table results(name text, ok boolean, detail text) on commit drop;
grant all on results to authenticated;
insert into auth.users(id,email) values
 ('00000000-0000-4000-8000-0000000000e1','owner@t'),('00000000-0000-4000-8000-0000000000e2','storeshead@t'),
 ('00000000-0000-4000-8000-0000000000e3','driver@t'),('00000000-0000-4000-8000-0000000000e4','travelonly@t');
insert into public.staff(user_id,role,active,department,access) values
 ('00000000-0000-4000-8000-0000000000e1','owner',true,'management','{}'),
 ('00000000-0000-4000-8000-0000000000e2','head',true,'stores','{deliveries,purchasing,stock,stock_count,travel}'),
 ('00000000-0000-4000-8000-0000000000e3','staff',true,'stores','{deliveries,stock}'),
 ('00000000-0000-4000-8000-0000000000e4','staff',true,'stores','{travel}');
insert into public.organizations(id,name) values('00000000-0000-4000-8000-0000000000e5','Fixture Delivery Clinic');
insert into public.contacts(id,organization_id,title,first_name,last_name,position,phone_country,country_code,phone,status)
 values('00000000-0000-4000-8000-0000000000e6','00000000-0000-4000-8000-0000000000e5','Doctor','Neema','Fixture','Buyer','TZ','+255','712345111','review');
insert into public.products(id,name,sku) values('00000000-0000-4000-8000-0000000000e7','Fixture Delivery Probe','FXD-1');

create function pg_temp.as_user(n text) returns void language sql as $$
 select set_config('request.jwt.claims', json_build_object('sub','00000000-0000-4000-8000-0000000000'||n,'role','authenticated','aal','aal1')::text, true) $$;
create function pg_temp.equals(p_name text, p_sql text, p_expect text) returns void language plpgsql as $$
declare v text; begin execute p_sql into v; insert into results values(p_name, v is not distinct from p_expect, coalesce(v,'null'));
exception when others then insert into results values(p_name,false,sqlerrm); end $$;
create function pg_temp.fails(p_name text, p_sql text, p_expect text) returns void language plpgsql as $$
begin execute p_sql; insert into results values(p_name,false,'did not fail');
exception when others then insert into results values(p_name, sqlerrm ilike '%'||p_expect||'%', sqlerrm); end $$;

set local role authenticated; select pg_temp.as_user('e1');
select public.save_sales_proforma('00000000-0000-4000-8000-0000000000e8',0,'00000000-0000-4000-8000-0000000000e5','00000000-0000-4000-8000-0000000000e6','TZS',current_date+30,'2 weeks','Cash','',
 '[{"productId":"00000000-0000-4000-8000-0000000000e7","description":"Fixture Delivery Probe","quantity":2,"uom":"pc","unitPriceMinor":1000,"discountBasisPoints":0,"taxBasisPoints":0}]'::jsonb);

select pg_temp.as_user('e2');
select pg_temp.equals('stores head with Deliveries reads the Pro forma','select count(*)::text from public.sales_proformas where id=''00000000-0000-4000-8000-0000000000e8''','1');
select pg_temp.equals('stores head reads its items for packing','select count(*)::text from public.sales_proforma_lines where proforma_id=''00000000-0000-4000-8000-0000000000e8''','1');
select pg_temp.fails('stores head still cannot change a Pro forma','select public.advance_sales_proforma(''00000000-0000-4000-8000-0000000000e8'',1,''send'','''')','access');
select pg_temp.as_user('e3');
select pg_temp.equals('driver with Deliveries reads the Pro forma','select count(*)::text from public.sales_proformas where id=''00000000-0000-4000-8000-0000000000e8''','1');
select pg_temp.as_user('e4');
select pg_temp.equals('staff without Deliveries or Pro formas still cannot read it','select count(*)::text from public.sales_proformas where id=''00000000-0000-4000-8000-0000000000e8''','0');
select pg_temp.equals('nor its items','select count(*)::text from public.sales_proforma_lines where proforma_id=''00000000-0000-4000-8000-0000000000e8''','0');
reset role;

select name, case when ok then 'ok' else 'FAIL' end, detail from results order by ok, name;
select count(*) filter (where ok) as passed, count(*) filter (where not ok) as failed from results;
rollback;
