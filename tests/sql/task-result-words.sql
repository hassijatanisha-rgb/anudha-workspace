-- Marking a task done needs a real result in the database too, not only on the screen (migration 076). Disposable
-- database with the schema and migrations up to 076; fictional users only; everything is rolled back.
--   psql -d <disposable> -v ON_ERROR_STOP=1 -f tests/sql/task-result-words.sql   (prints passed/failed)
begin;
create temp table results(name text, ok boolean, detail text) on commit drop;
grant all on results to authenticated;
insert into auth.users(id,email) values('00000000-0000-4000-8000-0000000000b1','giver@t'),('00000000-0000-4000-8000-0000000000b2','doer@t');
insert into public.staff(user_id,role,active,department,access) values
 ('00000000-0000-4000-8000-0000000000b1','head',true,'sales','{leads,proformas}'),('00000000-0000-4000-8000-0000000000b2','staff',true,'sales','{leads}');
create function pg_temp.as_user(n text) returns void language sql as $$
 select set_config('request.jwt.claims', json_build_object('sub','00000000-0000-4000-8000-0000000000'||n,'role','authenticated','aal','aal1')::text, true) $$;
create function pg_temp.fails(p_name text, p_sql text, p_expect text) returns void language plpgsql as $$
begin execute p_sql; insert into results values(p_name,false,'did not fail');
exception when others then insert into results values(p_name, sqlerrm ilike '%'||p_expect||'%', sqlerrm); end $$;
create function pg_temp.equals(p_name text, p_sql text, p_expect text) returns void language plpgsql as $$
declare v text; begin execute p_sql into v; insert into results values(p_name, v is not distinct from p_expect, coalesce(v,'null'));
exception when others then insert into results values(p_name,false,sqlerrm); end $$;

set local role authenticated; select pg_temp.as_user('b1');
select public.save_team_task('00000000-0000-4000-8000-0000000000b3',0,'Fixture call the clinic','','normal',now()+interval '1 day','00000000-0000-4000-8000-0000000000b2');
select public.save_team_task('00000000-0000-4000-8000-0000000000b4',0,'Fixture second task','','normal',now()+interval '1 day','00000000-0000-4000-8000-0000000000b2');
select pg_temp.as_user('b2');
select pg_temp.fails('"xxx" is refused','select public.close_team_task(''00000000-0000-4000-8000-0000000000b3'',1,''done'',''xxx'')','what you did');
select pg_temp.fails('"ok done" is refused','select public.close_team_task(''00000000-0000-4000-8000-0000000000b3'',1,''done'',''ok done'')','what you did');
select pg_temp.fails('"test test test" is refused','select public.close_team_task(''00000000-0000-4000-8000-0000000000b3'',1,''done'',''test test test'')','what you did');
select pg_temp.fails('an empty result is refused','select public.close_team_task(''00000000-0000-4000-8000-0000000000b3'',1,''done'','''')','what you did');
select pg_temp.equals('a real result closes the task','select status||'':''||close_note from public.close_team_task(''00000000-0000-4000-8000-0000000000b3'',1,''done'',''Called the clinic, wants 2 quotes'')','done:Called the clinic, wants 2 quotes');
select pg_temp.equals('a Swahili result counts as words','select public.team_task_result_ok(''Mteja amelipa leo'')::text','true');
select pg_temp.as_user('b1');
select pg_temp.equals('cancelling still needs only a short reason','select status from public.close_team_task(''00000000-0000-4000-8000-0000000000b4'',1,''cancel'',''Not needed'')','cancelled');
reset role;

select name, case when ok then 'ok' else 'FAIL' end, detail from results order by ok, name;
select count(*) filter (where ok) as passed, count(*) filter (where not ok) as failed from results;
rollback;
