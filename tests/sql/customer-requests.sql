-- Website customer requests (migration 062). Disposable database with the schema and migrations 060-062; rolled back.
--   psql -d <disposable> -v ON_ERROR_STOP=1 -f tests/sql/customer-requests.sql   (prints passed/failed)
begin;
create temp table results(name text, ok boolean, detail text) on commit drop;
grant all on results to authenticated, service_role, anon;
insert into auth.users(id,email) values
 ('00000000-0000-4000-8000-0000000000c1','owner@t'),('00000000-0000-4000-8000-0000000000c2','sales@t'),
 ('00000000-0000-4000-8000-0000000000c3','service@t'),('00000000-0000-4000-8000-0000000000c4','stores@t');
insert into public.staff(user_id,role,active,department,access) values
 ('00000000-0000-4000-8000-0000000000c1','owner',true,'management','{}'),
 ('00000000-0000-4000-8000-0000000000c2','staff',true,'sales','{leads}'),
 ('00000000-0000-4000-8000-0000000000c3','staff',true,'service','{service}'),
 ('00000000-0000-4000-8000-0000000000c4','staff',true,'stores','{stock}');
create function pg_temp.as_user(n text) returns void language sql as $$
 select set_config('request.jwt.claims', json_build_object('sub','00000000-0000-4000-8000-0000000000'||n,'role','authenticated')::text, true) $$;
create function pg_temp.check(p_name text, p_sql text) returns void language plpgsql as $$
begin execute p_sql; insert into results values(p_name,true,''); exception when others then insert into results values(p_name,false,sqlerrm); end $$;
create function pg_temp.fails(p_name text, p_sql text, p_expect text) returns void language plpgsql as $$
begin execute p_sql; insert into results values(p_name,false,'did not fail');
exception when others then insert into results values(p_name, sqlerrm ilike '%'||p_expect||'%', sqlerrm); end $$;
create function pg_temp.equals(p_name text, p_sql text, p_expect text) returns void language plpgsql as $$
declare v text; begin execute p_sql into v; insert into results values(p_name, v is not distinct from p_expect, coalesce(v,'null'));
exception when others then insert into results values(p_name,false,sqlerrm); end $$;

-- Website (service role)
set local role service_role;
create temp table sub as select * from public.submit_customer_request('quote','Asha Fixture','+255 712 000 111','asha@example.com','Fixture Clinic','Baby incubator','2','Please send a price for two incubators','whatsapp','client-a');
select pg_temp.equals('request number format','select (request_number ~ ''^REQ-[0-9]{4}-[0-9]{6}$'')::text from sub','true');
select pg_temp.equals('same message twice returns the first number','select (s.request_number=(select request_number from sub) and s.duplicate)::text from public.submit_customer_request(''quote'',''Asha Fixture'',''+255712000111'','''','''','''','''',''Please send a price for two incubators'',''whatsapp'',''client-a'') s','true');
select pg_temp.check('complaint accepted','select public.submit_customer_request(''complaint'',''Baraka Fixture'',''0755123456'','''','''',''Autoclave'','''',''The autoclave door leaks steam'',''phone'',''client-b'')');
select pg_temp.fails('phone is required','select public.submit_customer_request(''inquiry'',''No Phone'',''abc'','''','''','''','''',''Hello there'',''email'',''client-c'')','phone number');
select pg_temp.fails('unknown kind refused','select public.submit_customer_request(''spam'',''X Y'',''0755000000'','''','''','''','''',''Hello'',''phone'',''client-c'')','Choose what');
select pg_temp.check('four more from one connection allowed','select public.submit_customer_request(''inquiry'',''Flood Test'',''0711000001'','''','''','''','''',''msg ''||g,''phone'',''client-d'') from generate_series(1,5) g');
select pg_temp.fails('sixth within the hour refused','select public.submit_customer_request(''inquiry'',''Flood Test'',''0711000001'','''','''','''','''',''msg 6'',''phone'',''client-d'')','Too many requests');
select pg_temp.check('confirmation result recorded','select public.record_customer_request_confirmation((select id from sub),''not_set_up'',''WhatsApp not connected yet'')');
select pg_temp.equals('tracking with the right phone ending','select status from public.track_customer_request(lower((select request_number from sub)),''000111'')','received');
select pg_temp.equals('tracking with a wrong phone shows nothing','select count(*)::text from public.track_customer_request((select request_number from sub),''999999'')','0');
reset role;
-- Checked as the database owner (the website function only calls the functions above)
select pg_temp.equals('quote opens a lead waiting for a salesperson','select l.stage||'':''||l.source||'':''||l.caller_phone from public.customer_requests r join public.sales_leads l on l.id=r.lead_id where r.id=(select id from sub)','inquiry:website:+255712000111');
select pg_temp.equals('lead is followed up by the owner until assigned','select count(*)::text from public.work_assignments w join public.customer_requests r on r.lead_id=w.record_id where r.id=(select id from sub) and w.status=''open'' and w.assignee_user_id=''00000000-0000-4000-8000-0000000000c1''','1');
select pg_temp.equals('complaint opens no lead','select count(*)::text from public.customer_requests where kind=''complaint'' and lead_id is not null','0');
grant select on sub to authenticated;

-- The public and staff cannot submit or track directly (only through the website function)
set local role authenticated; select pg_temp.as_user('c2');
select pg_temp.fails('staff cannot call the website submission','select public.submit_customer_request(''inquiry'',''X Y'',''0755000000'','''','''','''','''',''Hi there'',''phone'','''')','permission denied');
select pg_temp.equals('sales sees quotes and complaints','select count(*)::text from public.customer_requests where kind in (''quote'',''complaint'')','2');
reset role; set local role anon;
select pg_temp.fails('anonymous visitors cannot read requests','select count(*) from public.customer_requests','permission denied');
reset role;

-- Service staff: complaints only
set local role authenticated; select pg_temp.as_user('c3');
select pg_temp.equals('service sees complaints but not quotes','select string_agg(distinct kind,'','') from public.customer_requests','complaint');
create temp table c as select id, version from public.customer_requests where kind='complaint';
select pg_temp.check('service takes the complaint','select public.advance_customer_request((select id from c),(select version from c),''take'')');
select pg_temp.fails('resolve needs what was done','select public.advance_customer_request((select id from c),(select version from c)+1,''resolve'',null,'''')','what was done');
select pg_temp.fails('stale version refused','select public.advance_customer_request((select id from c),(select version from c),''resolve'',null,''Replaced the door seal'')','changed');
select pg_temp.check('service resolves with a note','select public.advance_customer_request((select id from c),(select version from c)+1,''resolve'',null,''Replaced the door seal on site'')');
select pg_temp.equals('history kept','select string_agg(action,'','' order by created_at) from public.customer_request_events where request_id=(select id from c)','received,take,resolve');
select pg_temp.fails('service cannot work on a quote','select public.advance_customer_request((select id from sub),1,''take'')','do not have access');
reset role;

-- Stores staff (no Leads or Service): sees nothing
set local role authenticated; select pg_temp.as_user('c4');
select pg_temp.equals('stores sees no requests','select count(*)::text from public.customer_requests','0');
reset role;

select name, case when ok then 'ok' else 'FAIL' end, detail from results order by ok, name;
select count(*) filter (where ok) as passed, count(*) filter (where not ok) as failed from results;
rollback;
