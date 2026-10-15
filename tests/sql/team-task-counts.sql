-- Team tasks per person on the Dashboard (migration 068): the owner sees everyone, a department head sees only their
-- own department, staff see nothing. Disposable database with the schema and migrations up to 068 (fictional users only):
--   psql -d <disposable> -v ON_ERROR_STOP=1 -f tests/sql/team-task-counts.sql   (prints passed/failed)
-- Everything runs in one transaction that is rolled back.
begin;
create temp table results(name text, ok boolean, detail text) on commit drop;
grant all on results to authenticated, anon;
insert into auth.users(id,email) values
 ('00000000-0000-4000-8000-0000000000c1','owner@test'),('00000000-0000-4000-8000-0000000000c2','saleshead@test'),
 ('00000000-0000-4000-8000-0000000000c3','sales1@test'),('00000000-0000-4000-8000-0000000000c4','stores1@test'),
 ('00000000-0000-4000-8000-0000000000c5','storeshead@test'),('00000000-0000-4000-8000-0000000000c6','salesgone@test'),
 ('00000000-0000-4000-8000-0000000000c7','sales2@test'),('00000000-0000-4000-8000-0000000000c8','nodepthead@test'),
 ('00000000-0000-4000-8000-0000000000c9','headgone@test');
insert into public.staff(user_id,role,active,department,access) values
 ('00000000-0000-4000-8000-0000000000c1','owner',true,'sales','{}'),
 ('00000000-0000-4000-8000-0000000000c2','head',true,'sales','{leads}'),
 ('00000000-0000-4000-8000-0000000000c3','staff',true,'sales','{leads}'),
 ('00000000-0000-4000-8000-0000000000c4','staff',true,'stores','{stock}'),
 ('00000000-0000-4000-8000-0000000000c5','head',true,'stores','{stock}'),
 ('00000000-0000-4000-8000-0000000000c6','staff',false,'sales','{leads}'),
 ('00000000-0000-4000-8000-0000000000c7','staff',true,'sales','{}'),
 ('00000000-0000-4000-8000-0000000000c8','head',true,'','{}'),
 ('00000000-0000-4000-8000-0000000000c9','head',false,'sales','{leads}');

-- The period is the last 7 Dar es Salaam days, ending today. Sales person c3:
--  open, due yesterday (open + late) · open, due in 30 days (not counted) · done 2 days ago, 1 day after its due time
--  (completed + late) · done 2 days ago, due tomorrow (completed) · done 40 days ago (outside) · cancelled (never counted)
-- Stores person c4: open, due yesterday (open + late).
create temp table fixture_tasks as
select * from (values
 ('00000000-0000-4000-8000-0000000001c1'::uuid,'TK-T00001','Call Aga Khan back','00000000-0000-4000-8000-0000000000c3'::uuid,'open',now()-interval '1 day',null::timestamptz,''),
 ('00000000-0000-4000-8000-0000000001c2','TK-T00002','Plan next month','00000000-0000-4000-8000-0000000000c3','open',now()+interval '30 days',null,''),
 ('00000000-0000-4000-8000-0000000001c3','TK-T00003','Send the quotation','00000000-0000-4000-8000-0000000000c3','done',now()-interval '3 days',now()-interval '2 days','Sent by email'),
 ('00000000-0000-4000-8000-0000000001c4','TK-T00004','Visit the clinic','00000000-0000-4000-8000-0000000000c3','done',now()+interval '1 day',now()-interval '2 days','Visited, order coming'),
 ('00000000-0000-4000-8000-0000000001c5','TK-T00005','Old task','00000000-0000-4000-8000-0000000000c3','done',now()-interval '41 days',now()-interval '40 days',''),
 ('00000000-0000-4000-8000-0000000001c6','TK-T00006','Not needed','00000000-0000-4000-8000-0000000000c3','cancelled',now()-interval '1 day',now()-interval '1 day','Customer cancelled'),
 ('00000000-0000-4000-8000-0000000001c7','TK-T00007','Count the godown','00000000-0000-4000-8000-0000000000c4','open',now()-interval '1 day',null,'')
) v(id,task_number,title,assignee,status,due_at,closed_at,close_note);
insert into public.team_tasks(id,task_number,title,urgency,due_at,assignee_user_id,assigned_by,status,close_note,closed_by,closed_at,created_at)
select id,task_number,title,'normal',due_at,assignee,'00000000-0000-4000-8000-0000000000c1',status,close_note,
 case when status<>'open' then assignee end,closed_at,now()-interval '45 days' from fixture_tasks;

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
-- The counts for one fixture person as 'open|completed|late', or null when that person is not listed.
create function pg_temp.counts_sql(n text) returns text language sql as $$
 select format('select open_count||''|''||completed_count||''|''||late_count from public.team_task_counts(%L,%L) where user_id=%L',
  (now() at time zone 'Africa/Dar_es_Salaam')::date-6,(now() at time zone 'Africa/Dar_es_Salaam')::date,'00000000-0000-4000-8000-0000000000'||n) $$;
create function pg_temp.listed_sql(p_where text) returns text language sql as $$
 select format('select count(*)::text from public.team_task_counts(%L,%L) c where %s',
  (now() at time zone 'Africa/Dar_es_Salaam')::date-6,(now() at time zone 'Africa/Dar_es_Salaam')::date,p_where) $$;
create function pg_temp.tasks_sql(n text, p_cols text default 'count(*)::text') returns text language sql as $$
 select format('select %s from public.team_member_tasks(%L,%L,%L)',p_cols,'00000000-0000-4000-8000-0000000000'||n,
  (now() at time zone 'Africa/Dar_es_Salaam')::date-6,(now() at time zone 'Africa/Dar_es_Salaam')::date) $$;
grant execute on function pg_temp.counts_sql(text), pg_temp.listed_sql(text), pg_temp.tasks_sql(text,text) to authenticated, anon;

set local role authenticated;

-- Sales head: own department only
select pg_temp.as_user('c2');
select pg_temp.equals('head: sales person counts are open 1, completed 2, late 2', pg_temp.counts_sql('c3'), '1|2|2');
select pg_temp.equals('head: a sales person with no tasks shows zeros', pg_temp.counts_sql('c7'), '0|0|0');
select pg_temp.equals('head: sees themself', pg_temp.listed_sql('user_id=''00000000-0000-4000-8000-0000000000c2'''), '1');
select pg_temp.equals('head: nobody from another department is listed', pg_temp.listed_sql('department<>''sales'''), '0');
select pg_temp.equals('head: stores person is not listed', pg_temp.counts_sql('c4'), null);
select pg_temp.equals('head: stores head is not listed', pg_temp.counts_sql('c5'), null);
select pg_temp.equals('head: the owner is not listed, even in the same department', pg_temp.counts_sql('c1'), null);
select pg_temp.equals('head: switched-off staff are not listed', pg_temp.counts_sql('c6'), null);
select pg_temp.equals('head: opens a sales person''s tasks (open due in the period, done in the period)', pg_temp.tasks_sql('c3'), '3');
select pg_temp.equals('head: sees the results written when tasks were done', pg_temp.tasks_sql('c3','string_agg(close_note,'','' order by task_number)'), ',Sent by email,Visited, order coming');
select pg_temp.fails('head: cannot open a stores person''s tasks', pg_temp.tasks_sql('c4'), 'own department');
select pg_temp.fails('head: cannot open the owner''s tasks', pg_temp.tasks_sql('c1'), 'own department');
select pg_temp.equals('head: task table read rules are unchanged (cannot list the team''s tasks directly)', 'select count(*)::text from public.team_tasks where assignee_user_id=''00000000-0000-4000-8000-0000000000c3''', '0');
select pg_temp.fails('head: start after end is refused', 'select * from public.team_task_counts(''2026-10-07'',''2026-10-01'')', 'on or before');
select pg_temp.fails('head: more than a year is refused', 'select * from public.team_task_counts(''2025-01-01'',''2026-10-01'')', 'one year or less');
select pg_temp.fails('head: cannot call the internal visibility check', 'select public.can_see_team_member(''00000000-0000-4000-8000-0000000000c4'')', 'permission denied');

-- Stores head: the mirror image
select pg_temp.as_user('c5');
select pg_temp.equals('stores head: stores person counts are open 1, completed 0, late 1', pg_temp.counts_sql('c4'), '1|0|1');
select pg_temp.equals('stores head: nobody from sales is listed', pg_temp.listed_sql('department<>''stores'''), '0');
select pg_temp.fails('stores head: cannot open a sales person''s tasks', pg_temp.tasks_sql('c3'), 'own department');

-- A head with no department sees nobody
select pg_temp.as_user('c8');
select pg_temp.equals('head without a department: nobody listed', pg_temp.listed_sql('true'), '0');

-- Staff and switched-off heads see nothing
select pg_temp.as_user('c3');
select pg_temp.fails('staff: no team counts', pg_temp.listed_sql('true'), 'owner or a department head');
select pg_temp.fails('staff: cannot open a colleague''s tasks', pg_temp.tasks_sql('c7'), 'own department');
select pg_temp.as_user('c9');
select pg_temp.fails('switched-off head: no team counts', pg_temp.listed_sql('true'), 'owner or a department head');

-- Owner: everyone
select pg_temp.as_user('c1');
select pg_temp.equals('owner: sales person counts', pg_temp.counts_sql('c3'), '1|2|2');
select pg_temp.equals('owner: stores person counts', pg_temp.counts_sql('c4'), '1|0|1');
select pg_temp.equals('owner: every active staff member is listed', pg_temp.listed_sql('true'), (select count(*)::text from public.staff where active));
select pg_temp.equals('owner: opens anyone''s tasks', pg_temp.tasks_sql('c4'), '1');

reset role;
set local role anon;
select pg_temp.fails('signed out: refused', 'select * from public.team_task_counts(current_date,current_date)', 'permission denied');

reset role;
select name, case when ok then 'ok' else 'FAIL' end, detail from results order by ok, name;
select count(*) filter (where ok) as passed, count(*) filter (where not ok) as failed from results;
rollback;
