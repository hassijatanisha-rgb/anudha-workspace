-- Move stock: a transfer that passes inspection arrives as available stock at the new godown (migration 073); a short
-- count goes to quarantine. Disposable database with the schema and migrations up to 073; fictional data only;
-- everything is rolled back.
--   psql -d <disposable> -v ON_ERROR_STOP=1 -f tests/sql/receive-transfer.sql   (prints passed/failed)
begin;
create temp table results(name text, ok boolean, detail text) on commit drop;
grant all on results to authenticated;
insert into auth.users(id,email) values('00000000-0000-4000-8000-0000000000f1','owner@t'),('00000000-0000-4000-8000-0000000000f2','stores@t');
insert into public.staff(user_id,role,active,department,access) values
 ('00000000-0000-4000-8000-0000000000f1','owner',true,'management','{}'),
 ('00000000-0000-4000-8000-0000000000f2','staff',true,'stores','{deliveries,stock}');
insert into public.products(id,name,sku) values('00000000-0000-4000-8000-0000000000f3','Fixture Transfer Analyzer','FXT-1');

create function pg_temp.as_user(n text) returns void language sql as $$
 select set_config('request.jwt.claims', json_build_object('sub','00000000-0000-4000-8000-0000000000'||n,'role','authenticated','aal','aal1')::text, true) $$;
create function pg_temp.equals(p_name text, p_sql text, p_expect text) returns void language plpgsql as $$
declare v text; begin execute p_sql into v; insert into results values(p_name, v is not distinct from p_expect, coalesce(v,'null'));
exception when others then insert into results values(p_name,false,sqlerrm); end $$;

set local role authenticated; select pg_temp.as_user('f1');
select public.save_inventory_location('00000000-0000-4000-8000-0000000000f4',0,'Fixture Godown','FXG','godown',true);
select public.save_inventory_location('00000000-0000-4000-8000-0000000000f5',0,'Fixture Second Godown','FXS','godown',true);
select public.save_pack_definition('00000000-0000-4000-8000-0000000000f6','00000000-0000-4000-8000-0000000000f3',0,'machine',2,'Fixture carton label checked');
select public.set_inventory_opening_balance('00000000-0000-4000-8000-0000000000f7',0,'00000000-0000-4000-8000-0000000000f3','00000000-0000-4000-8000-0000000000f4','00000000-0000-4000-8000-0000000000f6','',null,10,0,'Fixture count by stores');

select pg_temp.as_user('f2');
select public.request_inventory_transfer('00000000-0000-4000-8000-0000000000f8','00000000-0000-4000-8000-0000000000f7','00000000-0000-4000-8000-0000000000f5',3,current_date+1,'Fixture needed at the second godown');
select public.dispatch_inventory_transfer('00000000-0000-4000-8000-0000000000f8',1,(select version from public.inventory_lots where id='00000000-0000-4000-8000-0000000000f7'),'Truck fixture');
select pg_temp.equals('a counted, passed transfer is received','select status from public.receive_inventory_transfer(''00000000-0000-4000-8000-0000000000f8'',2,6,''pass'',''All fine'')','received');
select pg_temp.equals('it arrives as available sealed cartons at the second godown','select stock_status||'':''||sealed_cartons||'':''||loose_units from public.inventory_lots where location_id=''00000000-0000-4000-8000-0000000000f5''','available:3:0');
select pg_temp.equals('the first godown keeps the rest','select sealed_cartons::text from public.inventory_lots where id=''00000000-0000-4000-8000-0000000000f7''','7');
select pg_temp.equals('no units are lost overall','select sum(sealed_cartons*2+loose_units)::text from public.inventory_lots where product_id=''00000000-0000-4000-8000-0000000000f3''','20');
-- A second transfer to the same godown adds to the same available lot.
select public.request_inventory_transfer('00000000-0000-4000-8000-0000000000f9','00000000-0000-4000-8000-0000000000f7','00000000-0000-4000-8000-0000000000f5',1,current_date+1,'Fixture one more');
select public.dispatch_inventory_transfer('00000000-0000-4000-8000-0000000000f9',1,(select version from public.inventory_lots where id='00000000-0000-4000-8000-0000000000f7'),'Truck fixture');
select public.receive_inventory_transfer('00000000-0000-4000-8000-0000000000f9',2,2,'pass','All fine');
select pg_temp.equals('a second receipt adds to the same available lot','select count(*)||'':''||sum(sealed_cartons) from public.inventory_lots where location_id=''00000000-0000-4000-8000-0000000000f5''','1:4');
-- A short count goes to quarantine as loose units.
select public.request_inventory_transfer('00000000-0000-4000-8000-0000000000fa','00000000-0000-4000-8000-0000000000f7','00000000-0000-4000-8000-0000000000f5',1,current_date+1,'Fixture short one');
select public.dispatch_inventory_transfer('00000000-0000-4000-8000-0000000000fa',1,(select version from public.inventory_lots where id='00000000-0000-4000-8000-0000000000f7'),'Truck fixture');
select pg_temp.equals('a short count is quarantined','select status from public.receive_inventory_transfer(''00000000-0000-4000-8000-0000000000fa'',2,1,''pass'',''One missing'')','quarantine');
select pg_temp.equals('quarantined units are not available','select stock_status||'':''||loose_units from public.inventory_lots where location_id=''00000000-0000-4000-8000-0000000000f5'' and stock_status=''quarantine''','quarantine:1');
reset role;

select name, case when ok then 'ok' else 'FAIL' end, detail from results order by ok, name;
select count(*) filter (where ok) as passed, count(*) filter (where not ok) as failed from results;
rollback;
