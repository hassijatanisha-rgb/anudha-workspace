-- Run against a disposable database that has the schema plus migration 071 (fictional users and records only):
--   psql -d <disposable> -v ON_ERROR_STOP=1 -f tests/sql/clients-items-records-access.sql
-- Everything runs in one transaction that is rolled back.
begin;
create temp table results(name text, ok boolean, detail text) on commit drop;
grant all on results to authenticated;
insert into auth.users(id,email) values
 ('00000000-0000-4000-8000-0000000000a1','owner@test'),('00000000-0000-4000-8000-0000000000a2','saleshead@test'),
 ('00000000-0000-4000-8000-0000000000a3','sales1@test'),('00000000-0000-4000-8000-0000000000a4','records1@test'),
 ('00000000-0000-4000-8000-0000000000a5','sales2@test'),('00000000-0000-4000-8000-0000000000a6','new@test'),
 ('00000000-0000-4000-8000-0000000000a7','storeshead@test'),('00000000-0000-4000-8000-0000000000a8','stores1@test'),
 ('00000000-0000-4000-8000-0000000000a9','sales3@test');
insert into public.staff(user_id,role,active,department,access) values
 ('00000000-0000-4000-8000-0000000000a1','owner',true,'management','{}'),
 ('00000000-0000-4000-8000-0000000000a2','head',true,'sales','{leads,proformas,stock,travel}'),
 ('00000000-0000-4000-8000-0000000000a3','staff',true,'sales','{leads,proformas,stock}'),
 ('00000000-0000-4000-8000-0000000000a4','staff',true,'stores','{stock,records}'),
 ('00000000-0000-4000-8000-0000000000a5','staff',true,'sales','{leads,records}'),
 ('00000000-0000-4000-8000-0000000000a7','head',true,'stores','{stock,records}'),
 ('00000000-0000-4000-8000-0000000000a8','staff',true,'stores','{stock}'),
 ('00000000-0000-4000-8000-0000000000a9','staff',true,'sales','{proformas,records}');
-- An existing client branch, one of its contacts and two existing items.
insert into public.organizations(id,name,location,type) values('00000000-0000-4000-8000-0000000000b1','Fixture Records Hospital','Dar Es Salaam','Hospital');
insert into public.contacts(id,organization_id,title,first_name,last_name,position,phone_country,country_code,phone,status)
 values('00000000-0000-4000-8000-0000000000b2','00000000-0000-4000-8000-0000000000b1','Doctor','Asha','Fixture','Radiologist','TZ','+255','712345678','review');
insert into public.contacts(id,organization_id,title,first_name,last_name,position,phone_country,country_code,phone,status,reason)
 values('00000000-0000-4000-8000-0000000000b5','00000000-0000-4000-8000-0000000000b1','Mr.','Juma','Fixture','Buyer','TZ','+255','712345679','incorrect','Left the hospital');
insert into public.products(id,name,sku) values('00000000-0000-4000-8000-0000000000b3','Fixture Records Probe','FX-1'),('00000000-0000-4000-8000-0000000000b4','Fixture Records Probe','FX-2'),
 ('00000000-0000-4000-8000-0000000000b6','Fixture Records Reagent','FX-3');
-- A second branch to group under the fixture client.
insert into public.organizations(id,name,location,type) values('00000000-0000-4000-8000-0000000000b7','Fixture Records Hospital Annex','Dodoma','Hospital');

create function pg_temp.as_user(n text) returns void language sql as $$
 select set_config('request.jwt.claims', json_build_object('sub','00000000-0000-4000-8000-0000000000'||n,'role','authenticated','aal','aal1')::text, true) $$;
create function pg_temp.check(p_name text, p_sql text) returns void language plpgsql as $$
begin execute p_sql; insert into results values(p_name,true,''); exception when others then insert into results values(p_name,false,sqlerrm); end $$;
create function pg_temp.fails(p_name text, p_sql text, p_expect text) returns void language plpgsql as $$
begin execute p_sql; insert into results values(p_name,false,'did not fail');
exception when others then insert into results values(p_name, sqlerrm ilike '%'||p_expect||'%', sqlerrm); end $$;
create function pg_temp.equals(p_name text, p_sql text, p_expect text) returns void language plpgsql as $$
declare v text; begin execute p_sql into v; insert into results values(p_name, v is not distinct from p_expect, coalesce(v,'null'));
exception when others then insert into results values(p_name,false,sqlerrm); end $$;
-- A complete new contact for the fixture branch (same rules as the contact form).
create function pg_temp.contact(p_first text) returns jsonb language sql as $$
 select jsonb_build_object('organization_id','00000000-0000-4000-8000-0000000000b1','title','Mrs.','first_name',p_first,'last_name','Fixture',
  'position','Nurse','phone_country','TZ','country_code','+255','phone','713456789','email','','status','review','reason','') $$;
create function pg_temp.rev(p_table text, p_id text) returns integer language plpgsql as $$
declare v integer; begin execute format('select revision from public.%I where id=%L',p_table,'00000000-0000-4000-8000-0000000000'||p_id) into v; return v; end $$;

set local role authenticated;

-- The area exists, is in no template and nobody has it by default.
select pg_temp.as_user('a1');
select pg_temp.equals('records is a valid area','select (''records''=any(public.staff_access_areas()))::text','true');
select pg_temp.equals('owner always has records','select public.has_access(''records'')::text','true');

-- Sales staff without records: still reads and uses existing clients and items, but cannot change them.
select pg_temp.as_user('a3');
select pg_temp.equals('without records: no records area','select public.has_access(''records'')::text','false');
select pg_temp.equals('without records: still reads clients','select count(*)::text from public.organizations where id=''00000000-0000-4000-8000-0000000000b1''','1');
select pg_temp.equals('without records: still reads items','select count(*)::text from public.products where id=''00000000-0000-4000-8000-0000000000b3''','1');
select pg_temp.fails('without records: add contact refused','select public.save_contact(gen_random_uuid(),0,pg_temp.contact(''Neema''))','Clients & items data');
select pg_temp.fails('without records: edit contact refused','select public.save_contact(''00000000-0000-4000-8000-0000000000b2'',pg_temp.rev(''contacts'',''b2''),pg_temp.contact(''Asha''))','Clients & items data');
select pg_temp.fails('without records: restore flagged contact refused','select public.restore_contact(''00000000-0000-4000-8000-0000000000b5'',pg_temp.rev(''contacts'',''b5''))','Clients & items data');
select pg_temp.fails('without records: add organization refused','select public.save_organization(gen_random_uuid(),''Fixture New Clinic'',''Arusha'',''Clinic'')','Clients & items data');
select pg_temp.fails('without records: group branches refused','select public.set_organization_parent(''00000000-0000-4000-8000-0000000000b1'',null)','Clients & items data');
select pg_temp.fails('without records: delete contact refused','select public.archive_record(''contact'',''00000000-0000-4000-8000-0000000000b2'')','Clients & items data');
select pg_temp.fails('without records: import refused','select public.import_records(''[]'',''[]'',''[{"id":"00000000-0000-4000-8000-0000000000c1","name":"Fixture Import"}]'')','Clients & items data');
select pg_temp.fails('without records: edit product refused','select public.save_product(''00000000-0000-4000-8000-0000000000b3'',pg_temp.rev(''products'',''b3''),''Fixture Renamed'',''FX-1'')','Clients & items data');
select pg_temp.fails('without records: product match refused','select public.set_product_match(''00000000-0000-4000-8000-0000000000b3'',pg_temp.rev(''products'',''b3''),''00000000-0000-4000-8000-0000000000b4'',''confirmed'')','Clients & items data');
select pg_temp.fails('without records: product category refused even with stock','select public.save_product_inventory_classification(gen_random_uuid(),''00000000-0000-4000-8000-0000000000b3'',0,''spares'',''Checked the catalogue'')','Clients & items data');
select pg_temp.fails('without records: pack definition refused','select public.save_pack_definition(gen_random_uuid(),''00000000-0000-4000-8000-0000000000b3'',0,''piece'',10,''Checked the box'')','Clients & items data');
select pg_temp.fails('without records: product detail review refused','select public.save_product_detail_review(gen_random_uuid(),''00000000-0000-4000-8000-0000000000b3'',0,''Fixture Probe'','''','''',''unknown'',null,null,''Checked the box'')','Clients & items data');
select pg_temp.fails('without records: approve client refused','select public.approve_organization(''00000000-0000-4000-8000-0000000000b1'')','Clients & items data');
select pg_temp.fails('without records: restore deleted client refused','select public.restore_record(''organization'',''00000000-0000-4000-8000-0000000000b1'')','Clients & items data');
select pg_temp.fails('without records: machine links refused','select public.save_product_machine_link_review(gen_random_uuid(),''00000000-0000-4000-8000-0000000000b6'',0,''{}'',''Checked the manual'')','Clients & items data');
select pg_temp.fails('without records: source mapping refused','select public.save_product_source_mapping_review(gen_random_uuid(),''fixture-key'',0,null,''unresolved'',''{}''::jsonb,''Checked the file'')','Clients & items data');
select pg_temp.fails('without records: product list refused','select public.apply_product_list(''[{"code":"AN-99991","product":"Fixture Listed","category":"Spare"}]'')','Clients & items data');
select pg_temp.fails('without records: add one product refused','select public.add_product(gen_random_uuid(),''Fixture Single Product'',''FX-9'',''{"origin":"manual"}'')','Clients & items data');
select pg_temp.fails('without records: product delete refused','select public.set_product_archived(''00000000-0000-4000-8000-0000000000b3'',true)','Clients & items data');
-- ... and keeps working with them exactly as before.
select pg_temp.equals('without records: lead for an existing client with a typed-in caller','select caller_name from public.save_sales_lead(gen_random_uuid(),0,jsonb_build_object(''subject'',''Probe price'',''organization_id'',''00000000-0000-4000-8000-0000000000b1'',''caller_name'',''Dr Fixture Caller'',''caller_phone'',''0755000333''))','Dr Fixture Caller');
select pg_temp.equals('without records: Pro forma for an existing client and item','select organization_id::text from public.save_sales_proforma(gen_random_uuid(),0,''00000000-0000-4000-8000-0000000000b1'',''00000000-0000-4000-8000-0000000000b2'',''TZS'',current_date+30,''7 days'',''On delivery'','''',''[{"productId":"00000000-0000-4000-8000-0000000000b3","quantity":2,"unitPriceMinor":100,"discountBasisPoints":0,"taxBasisPoints":0,"uom":"piece","description":"Fixture probe"}]''::jsonb)','00000000-0000-4000-8000-0000000000b1');
select pg_temp.equals('without records: client and item unchanged','select (select name from public.organizations where id=''00000000-0000-4000-8000-0000000000b1'')||''|''||(select name from public.products where id=''00000000-0000-4000-8000-0000000000b3'')','Fixture Records Hospital|Fixture Records Probe');

-- Staff member the owner gave records to.
select pg_temp.as_user('a4');
select pg_temp.check('with records: add contact','select public.save_contact(gen_random_uuid(),0,pg_temp.contact(''Neema''))');
select pg_temp.check('with records: edit contact','select public.save_contact(''00000000-0000-4000-8000-0000000000b2'',pg_temp.rev(''contacts'',''b2''),pg_temp.contact(''Asha''))');
select pg_temp.check('with records: restore flagged contact','select public.restore_contact(''00000000-0000-4000-8000-0000000000b5'',pg_temp.rev(''contacts'',''b5''))');
select pg_temp.equals('with records: edit product','select name from public.save_product(''00000000-0000-4000-8000-0000000000b3'',pg_temp.rev(''products'',''b3''),''Fixture Records Probe'',''FX-1A'')','Fixture Records Probe');
select pg_temp.check('with records: product match','select public.set_product_match(''00000000-0000-4000-8000-0000000000b3'',pg_temp.rev(''products'',''b3''),''00000000-0000-4000-8000-0000000000b4'',''confirmed'')');
select pg_temp.check('with records and stock: product category','select public.save_product_inventory_classification(gen_random_uuid(),''00000000-0000-4000-8000-0000000000b3'',0,''spares'',''Checked the catalogue'')');
-- The client and item steps that used to be owner-only.
select pg_temp.check('with records: add organization','select public.save_organization(''00000000-0000-4000-8000-0000000000c3'',''Fixture Records Clinic'',''Arusha'',''Clinic'')');
select pg_temp.check('with records: edit organization','select public.save_organization(''00000000-0000-4000-8000-0000000000b1'',''Fixture Records Hospital'',''Dar Es Salaam'',''Referral Hospital'')');
select pg_temp.check('with records: group a branch','select public.set_organization_parent(''00000000-0000-4000-8000-0000000000b7'',''00000000-0000-4000-8000-0000000000b1'')');
select pg_temp.fails('with records: approval reaches the profile checks','select public.approve_organization(''00000000-0000-4000-8000-0000000000b1'')','contact');
select pg_temp.check('with records: delete a contact','select public.archive_record(''contact'',''00000000-0000-4000-8000-0000000000b5'')');
select pg_temp.check('with records: restore the contact','select public.restore_record(''contact'',''00000000-0000-4000-8000-0000000000b5'')');
select pg_temp.check('with records: delete a client','select public.archive_record(''organization'',''00000000-0000-4000-8000-0000000000c3'')');
select pg_temp.check('with records: restore the client','select public.restore_record(''organization'',''00000000-0000-4000-8000-0000000000c3'')');
select pg_temp.check('with records: pack size','select public.save_pack_definition(gen_random_uuid(),''00000000-0000-4000-8000-0000000000b4'',0,''piece'',12,''Checked the box'')');
select pg_temp.check('with records: product detail review','select public.save_product_detail_review(gen_random_uuid(),''00000000-0000-4000-8000-0000000000b4'',0,''Fixture Records Probe'',''Maker'',''FX-2'',''unknown'',null,null,''Checked the box'')');
select pg_temp.check('with records: reagent category','select public.save_product_inventory_classification(gen_random_uuid(),''00000000-0000-4000-8000-0000000000b6'',0,''reagents'',''Checked the box'')');
select pg_temp.check('with records: machine links','select public.save_product_machine_link_review(gen_random_uuid(),''00000000-0000-4000-8000-0000000000b6'',0,''{}'',''No machine listed yet'')');
select pg_temp.fails('with records: source mapping reaches its own checks','select public.save_product_source_mapping_review(gen_random_uuid(),''fixture-key'',0,null,''unresolved'',''{}''::jsonb,''Checked the file'')','Invalid mapping snapshot');
select pg_temp.equals('with records: product list','select (public.apply_product_list(''[{"code":"AN-99991","product":"Fixture Listed","category":"Spare"}]'')->>''rows'')','1');
select pg_temp.check('with records: delete a product','select public.set_product_archived(''00000000-0000-4000-8000-0000000000b4'',true)');
select pg_temp.check('with records: restore the product','select public.set_product_archived(''00000000-0000-4000-8000-0000000000b4'',false)');
-- One product at a time, with the same rules as one product through import_records.
select pg_temp.equals('with records: add one product','select name||''|''||sku||''|''||(source->>''origin'')||''|''||match_status||''|''||revision from public.add_product(''00000000-0000-4000-8000-0000000000c4'',''Fixture Single Product'',''FX-9'',''{"origin":"manual"}'')','Fixture Single Product|FX-9|manual|unreviewed|1');
select pg_temp.equals('with records: a retry returns the saved product','select (select id::text from public.add_product(''00000000-0000-4000-8000-0000000000c4'',''Fixture Single Product'',''FX-9'',''{"origin":"manual"}''))||''|''||(select count(*) from public.products where id=''00000000-0000-4000-8000-0000000000c4'')','00000000-0000-4000-8000-0000000000c4|1');
select pg_temp.fails('with records: the same id with another name is refused','select public.add_product(''00000000-0000-4000-8000-0000000000c4'',''Fixture Other Product'')','already used');
select pg_temp.equals('with records: defaults match import_records','select sku||''|''||source::text from public.add_product(''00000000-0000-4000-8000-0000000000c5'',''Fixture Default Product'',null,null)','|{}');
select pg_temp.check('with records: an exact-name duplicate is allowed, as in import_records','select public.add_product(gen_random_uuid(),''Fixture Single Product'')');
select pg_temp.fails('with records: a blank name is refused, as in import_records','select public.add_product(gen_random_uuid(),''   '')','products_name_check');
-- Still owner-only: bulk import, and deleting or restoring Pro formas.
select pg_temp.fails('with records: bulk import stays owner-only','select public.import_records(''[]'',''[]'',''[{"id":"00000000-0000-4000-8000-0000000000c1","name":"Fixture Import"}]'')','Owner access required');
select pg_temp.as_user('a9');
select pg_temp.fails('with records and proformas: Pro forma delete stays owner-only','select public.set_draft_proforma_archived((select id from public.sales_proformas where organization_id=''00000000-0000-4000-8000-0000000000b1'' limit 1),1,true)','Owner access is required to archive or restore Pro formas');

-- Owner can do everything.
select pg_temp.as_user('a1');
select pg_temp.check('owner: add organization','select public.save_organization(''00000000-0000-4000-8000-0000000000c2'',''Fixture New Clinic'',''Arusha'',''Clinic'')');
select pg_temp.check('owner: add contact','select public.save_contact(gen_random_uuid(),0,pg_temp.contact(''Rehema''))');
select pg_temp.check('owner: edit product','select public.save_product(''00000000-0000-4000-8000-0000000000b4'',pg_temp.rev(''products'',''b4''),''Fixture Records Probe'',''FX-2A'')');
select pg_temp.check('owner: pack definition','select public.save_pack_definition(gen_random_uuid(),''00000000-0000-4000-8000-0000000000b3'',0,''piece'',10,''Checked the box'')');
select pg_temp.check('owner: product detail review','select public.save_product_detail_review(gen_random_uuid(),''00000000-0000-4000-8000-0000000000b3'',0,''Fixture Records Probe'','''','''',''unknown'',null,null,''Checked the box'')');
select pg_temp.check('owner: import an exact-name duplicate (no duplicate check there either)','select public.import_records(''[]'',''[]'',''[{"id":"00000000-0000-4000-8000-0000000000c6","name":"Fixture Single Product"}]'')');
select pg_temp.fails('owner: import refuses a blank name the same way','select public.import_records(''[]'',''[]'',''[{"id":"00000000-0000-4000-8000-0000000000c7","name":"   "}]'')','products_name_check');
select pg_temp.check('owner: add one product','select public.add_product(gen_random_uuid(),''Fixture Owner Product'')');
select pg_temp.check('owner: import a product','select public.import_records(''[]'',''[]'',''[{"id":"00000000-0000-4000-8000-0000000000c1","name":"Fixture Import"}]'')');
select pg_temp.check('owner: delete product','select public.set_product_archived(''00000000-0000-4000-8000-0000000000c1'',true)');
select pg_temp.check('owner: delete organization','select public.archive_record(''organization'',''00000000-0000-4000-8000-0000000000c2'')');
select pg_temp.check('owner: Pro forma delete unchanged','select public.set_draft_proforma_archived((select id from public.sales_proformas where organization_id=''00000000-0000-4000-8000-0000000000b1'' limit 1),(select version from public.sales_proformas where organization_id=''00000000-0000-4000-8000-0000000000b1'' limit 1),true)');
select pg_temp.check('owner gives records to a person','select public.set_staff_access(''00000000-0000-4000-8000-0000000000a3'',''{leads,proformas,stock,records}'')');
select pg_temp.check('owner takes records away again','select public.set_staff_access(''00000000-0000-4000-8000-0000000000a3'',''{leads,proformas,stock}'')');

-- Heads cannot give or take away records, whether or not they have it.
select pg_temp.as_user('a2');
select pg_temp.fails('head without records cannot give it','select public.set_staff_access(''00000000-0000-4000-8000-0000000000a3'',''{leads,records}'')','Only the owner');
select pg_temp.fails('head cannot take records away','select public.set_staff_access(''00000000-0000-4000-8000-0000000000a5'',''{leads}'')','Only the owner');
select pg_temp.equals('head changes other areas and records stays','select array_to_string(access,'','') from public.set_staff_access(''00000000-0000-4000-8000-0000000000a5'',''{leads,proformas,records}'')','leads,proformas,records');
select pg_temp.fails('head cannot add a login with records','select public.add_department_staff(''00000000-0000-4000-8000-0000000000a6'',''{leads,records}'')','Only the owner');
select pg_temp.fails('head still cannot give areas they lack','select public.set_staff_access(''00000000-0000-4000-8000-0000000000a3'',''{leads,service}'')','access you have yourself: service');
select pg_temp.as_user('a7');
select pg_temp.fails('head with records cannot give it either','select public.set_staff_access(''00000000-0000-4000-8000-0000000000a8'',''{stock,records}'')','Only the owner');
select pg_temp.fails('head with records cannot add a login with it','select public.add_department_staff(''00000000-0000-4000-8000-0000000000a6'',''{records}'')','Only the owner');

reset role;
select pg_temp.equals('no one else was given records','select string_agg(right(user_id::text,2),'','' order by user_id) from public.staff where ''records''=any(access) and user_id::text like ''00000000-0000-4000-8000-0000000000a%''','a4,a5,a7,a9');
select name, case when ok then 'ok' else 'FAIL' end, detail from results order by ok, name;
select count(*) filter (where ok) as passed, count(*) filter (where not ok) as failed from results;
rollback;
