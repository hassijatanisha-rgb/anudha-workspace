-- Lead "spoke to" role, handover with a note, and the new owner's work list (migration 068). Disposable database with
-- the schema and migrations up to 068; fictional users only; everything is rolled back.
--   psql -d <disposable> -v ON_ERROR_STOP=1 -f tests/sql/lead-handover.sql   (prints passed/failed)
begin;
create temp table results(name text, ok boolean, detail text) on commit drop;
create temp table ids(k text primary key, v uuid) on commit drop;
grant all on results, ids to authenticated, anon;
insert into auth.users(id,email) values
 ('00000000-0000-4000-8000-0000000000d1','owner@t'),('00000000-0000-4000-8000-0000000000d2','saleshead@t'),
 ('00000000-0000-4000-8000-0000000000d3','ultrasound@t'),('00000000-0000-4000-8000-0000000000d4','stores@t'),
 ('00000000-0000-4000-8000-0000000000d5','left@t');
insert into public.staff(user_id,role,active,department,access) values
 ('00000000-0000-4000-8000-0000000000d1','owner',true,'management','{}'),
 ('00000000-0000-4000-8000-0000000000d2','head',true,'sales','{leads,proformas}'),
 ('00000000-0000-4000-8000-0000000000d3','staff',true,'sales','{leads}'),
 ('00000000-0000-4000-8000-0000000000d4','staff',true,'stores','{stock}'),
 ('00000000-0000-4000-8000-0000000000d5','staff',false,'sales','{leads}');
insert into ids values ('lead',gen_random_uuid()),('closed',gen_random_uuid()),('client',gen_random_uuid());
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
create function pg_temp.id(p text) returns uuid language sql as $$ select v from ids where k=p $$;
create function pg_temp.handover(p_lead text, p_version int, p_to text, p_note text, p_next text default null, p_due date default null)
returns public.sales_leads language sql as $$
 select * from public.hand_over_sales_lead(pg_temp.id(p_lead),p_version,('00000000-0000-4000-8000-0000000000'||p_to)::uuid,p_note,p_next,p_due) $$;
create function pg_temp.lead(p text) returns public.sales_leads language sql as $$ select * from public.sales_leads where id=pg_temp.id(p) $$;
-- An existing client for the "known client, person not a named contact" case.
insert into public.organizations(id,name) select v,'Fixture Aga Khan Test' from ids where k='client';

set local role authenticated; select pg_temp.as_user('d2');

-- 1. Person we spoke to and their role
select pg_temp.check('head records a procurement call and keeps it','select public.save_sales_lead(pg_temp.id(''lead''),0,jsonb_build_object(''subject'',''Price for a general ultrasound'',''caller_name'',''Stella Fixture'',''caller_phone'',''0712 000 111'',''caller_organization'',''Fixture Hospital'',''caller_role'',''procurement'',''owner_user_id'',''00000000-0000-4000-8000-0000000000d2''))');
select pg_temp.equals('role is saved on the lead','select caller_role||'':''||caller_name||'':''||stage from pg_temp.lead(''lead'')','procurement:Stella Fixture:lead');
select pg_temp.fails('unknown role refused','select public.save_sales_lead(gen_random_uuid(),0,''{"subject":"Role test","caller_name":"Ab Cd","caller_phone":"0712000222","caller_role":"janitor"}''::jsonb)','role of the person');
select pg_temp.equals('known client with a caller who is not a contact','select caller_name||'':''||caller_role from public.save_sales_lead(gen_random_uuid(),0,jsonb_build_object(''subject'',''Ultrasound probe'',''organization_id'',pg_temp.id(''client''),''caller_name'',''Dr Fixture'',''caller_phone'',''0755000333'',''caller_role'',''doctor''))','Dr Fixture:doctor');
select pg_temp.equals('edit keeps the role editable','select caller_role from public.save_sales_lead(pg_temp.id(''lead''),1,jsonb_build_object(''subject'',''Price for a general ultrasound'',''caller_name'',''Stella Fixture'',''caller_phone'',''0712 000 111'',''caller_role'',''head_of_department''))','head_of_department');
select pg_temp.equals('new lead is on the head''s work list','select count(*)::text from public.work_assignments where record_type=''lead'' and record_id=pg_temp.id(''lead'') and status=''open'' and assignee_user_id=''00000000-0000-4000-8000-0000000000d2''','1');

-- 2. Handover with a note
select pg_temp.fails('changing salesperson without a note is refused','select public.advance_sales_lead(pg_temp.id(''lead''),2,''assign'',''00000000-0000-4000-8000-0000000000d3'')','Hand over');
select pg_temp.fails('note of fewer than 5 words refused','select pg_temp.handover(''lead'',2,''d3'',''please call them back'')','at least 5 words');
select pg_temp.fails('blank note refused','select pg_temp.handover(''lead'',2,''d3'',''   '')','at least 5 words');
select pg_temp.fails('someone without Leads cannot receive it','select pg_temp.handover(''lead'',2,''d4'',''Head of radiology wants a general ultrasound'')','can open Leads');
select pg_temp.fails('inactive employee cannot receive it','select pg_temp.handover(''lead'',2,''d5'',''Head of radiology wants a general ultrasound'')','can open Leads');
select pg_temp.fails('cannot hand to the current owner','select pg_temp.handover(''lead'',2,''d2'',''Head of radiology wants a general ultrasound'')','already has');
select pg_temp.fails('stale version refused','select pg_temp.handover(''lead'',1,''d3'',''Head of radiology wants a general ultrasound'')','changed');
select pg_temp.fails('next step date in the past refused','select pg_temp.handover(''lead'',2,''d3'',''Head of radiology wants a general ultrasound'',''Call Mr Bob'',current_date-10)','past');
select pg_temp.equals('handover moves the lead and sets the next step','select owner_user_id||'':''||next_action||'':''||(next_action_on=current_date+3)||'':''||version from pg_temp.handover(''lead'',2,''d3'',''Head of radiology at X, wants a general ultrasound, compare quotes, call Mr Bob 0556'',''Call Mr Bob'',current_date+3)','00000000-0000-4000-8000-0000000000d3:Call Mr Bob:true:3');
select pg_temp.equals('a retried handover returns the saved lead once','select version||'':''||(select count(*) from public.sales_lead_events where lead_id=pg_temp.id(''lead'') and action=''handover'') from pg_temp.handover(''lead'',2,''d3'',''Head of radiology at X,  wants a general ultrasound, compare quotes, call Mr Bob 0556'',''Call Mr Bob'',current_date+3)','3:1');
select pg_temp.equals('history shows who handed to whom with the note','select from_user_id||''>''||assigned_user_id||''|''||actor_user_id||''|''||note from public.sales_lead_events where lead_id=pg_temp.id(''lead'') and action=''handover''',
 '00000000-0000-4000-8000-0000000000d2>00000000-0000-4000-8000-0000000000d3|00000000-0000-4000-8000-0000000000d2|Head of radiology at X, wants a general ultrasound, compare quotes, call Mr Bob 0556');

-- The new owner sees it in their work list, with the note, the next step and its date
select pg_temp.as_user('d3');
select pg_temp.equals('new owner has one open work item with the note','select task||''|''||note||''|''||(due_on=current_date+3)||''|''||assigned_by from public.work_assignments where record_type=''lead'' and record_id=pg_temp.id(''lead'') and status=''open'' and assignee_user_id=''00000000-0000-4000-8000-0000000000d3''',
 'Call Mr Bob|Handover: Head of radiology at X, wants a general ultrasound, compare quotes, call Mr Bob 0556|true|00000000-0000-4000-8000-0000000000d2');
select pg_temp.equals('the head''s item is closed as handed on','select status||'':''||close_note from public.work_assignments where record_type=''lead'' and record_id=pg_temp.id(''lead'') and assignee_user_id=''00000000-0000-4000-8000-0000000000d2''','handed_on:Handed over to '||coalesce((select display_name from public.staff where user_id='00000000-0000-4000-8000-0000000000d2'),'the next salesperson'));
select pg_temp.equals('only one open item on the lead','select count(*)::text from public.work_assignments where record_type=''lead'' and record_id=pg_temp.id(''lead'') and status=''open''','1');
select pg_temp.check('the specialist can hand it back','select pg_temp.handover(''lead'',3,''d2'',''Customer wants the head to call them back'')');
select pg_temp.equals('next step is kept when none is given','select next_action from pg_temp.lead(''lead'')','Call Mr Bob');

-- Closed leads and people without Leads
select pg_temp.as_user('d2');
select pg_temp.check('a lead to close','select public.save_sales_lead(pg_temp.id(''closed''),0,''{"subject":"Closed one","caller_name":"Ab Cd","caller_phone":"0712000444","owner_user_id":"00000000-0000-4000-8000-0000000000d2"}''::jsonb)');
select pg_temp.check('close it','select public.advance_sales_lead(pg_temp.id(''closed''),1,''lost'',null,''Chose a competitor'')');
select pg_temp.fails('a closed lead cannot be handed over','select pg_temp.handover(''closed'',2,''d3'',''Head of radiology wants a general ultrasound'')','closed');
select pg_temp.as_user('d4');
select pg_temp.fails('stores staff cannot hand over leads','select pg_temp.handover(''lead'',4,''d3'',''Head of radiology wants a general ultrasound'')','do not have access');
reset role;

select pg_temp.equals('anonymous cannot run handover','select has_function_privilege(''anon'',''public.hand_over_sales_lead(uuid,integer,uuid,text,text,date)'',''execute'')::text','false');
select pg_temp.equals('staff can run handover','select has_function_privilege(''authenticated'',''public.hand_over_sales_lead(uuid,integer,uuid,text,text,date)'',''execute'')::text','true');

select name, case when ok then 'ok' else 'FAIL' end, detail from results order by ok, name;
select count(*) filter (where ok) as passed, count(*) filter (where not ok) as failed from results;
rollback;
