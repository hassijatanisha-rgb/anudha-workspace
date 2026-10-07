-- Task reschedule (migration 068). Disposable database with the schema applied; rolled back.
--   psql -d <disposable> -At -v ON_ERROR_STOP=1 -f tests/sql/task-reschedule.sql   (every line must end in |t)
begin;
insert into auth.users(id,email) values ('00000000-0000-4000-8000-0000000000d1','o@t'),('00000000-0000-4000-8000-0000000000d2','h@t'),('00000000-0000-4000-8000-0000000000d3','w@t'),('00000000-0000-4000-8000-0000000000d4','x@t');
insert into public.staff(user_id,role,active,department,access) values ('00000000-0000-4000-8000-0000000000d1','owner',true,'management','{}'),('00000000-0000-4000-8000-0000000000d2','staff',true,'sales','{}'),('00000000-0000-4000-8000-0000000000d3','staff',true,'sales','{}'),('00000000-0000-4000-8000-0000000000d4','staff',true,'stores','{}');
create function pg_temp.as_user(n text) returns void language sql as $$
 select set_config('request.jwt.claims', json_build_object('sub','00000000-0000-4000-8000-0000000000'||n,'role','authenticated')::text, true) $$;
create function pg_temp.fails(p_sql text, p_expect text) returns boolean language plpgsql as $$
begin execute p_sql; return false; exception when others then return sqlerrm ilike '%'||p_expect||'%'; end $$;
create function pg_temp.move(p_version integer, p_due interval, p_reason text) returns integer language sql as $$
 select reschedule_count from public.reschedule_team_task('00000000-0000-4000-8000-0000000000e1',p_version,now()+p_due,p_reason) $$;
set local role authenticated;
select pg_temp.as_user('d2');
select 'head gives a task', (public.save_team_task('00000000-0000-4000-8000-0000000000e1',0,'Call the regional official','','urgent',now()+interval '1 hour','00000000-0000-4000-8000-0000000000d3')).version=1;
select 'the person who gave it cannot reschedule (they edit instead)', pg_temp.fails($q$select pg_temp.move(1,'1 day','Moving it myself')$q$,'Only the person doing');
select pg_temp.as_user('d4');
select 'a stranger is refused', pg_temp.fails($q$select pg_temp.move(1,'1 day','Not my task at all')$q$,'Only the person doing');
select pg_temp.as_user('d3');
select 'a reason is required', pg_temp.fails($q$select pg_temp.move(1,'1 day','  no ')$q$,'at least 5');
select 'a past date is refused', pg_temp.fails($q$select pg_temp.move(1,'-1 hour','Called, no answer')$q$,'later than now');
select 'earlier than the current due is refused', pg_temp.fails($q$select pg_temp.move(1,'30 minutes','Called, no answer')$q$,'current due time');
select 'assignee reschedules: 1 of 3', pg_temp.move(1,'1 day','Called, no answer; officials can''t be called twice a day; trying again Thursday')=1;
select 'history keeps old due, new due, reason and who', (select count(*)=1 from public.team_task_events where task_id='00000000-0000-4000-8000-0000000000e1' and action='reschedule'
 and old_due_at=now()+interval '1 hour' and new_due_at=now()+interval '1 day' and note like 'Called, no answer;%' and actor_user_id='00000000-0000-4000-8000-0000000000d3');
select 'a retried request returns the same task', pg_temp.move(1,'1 day','Called, no answer; officials can''t be called twice a day; trying again Thursday')=1;
select 'a stale version is refused', pg_temp.fails($q$select pg_temp.move(1,'3 days','Still no answer today')$q$,'changed; refresh');
select 'second reschedule', pg_temp.move(2,'2 days','Still no answer today')=2;
select 'third reschedule', pg_temp.move(3,'3 days','Office closed for the holiday')=3;
select 'fourth reschedule is refused', pg_temp.fails($q$select pg_temp.move(4,'4 days','One more try please')$q$,'already moved 3 times');
select 'the person doing it still cannot edit', pg_temp.fails($q$select public.save_team_task('00000000-0000-4000-8000-0000000000e1',4,'Call later','','normal',now()+interval '9 days','00000000-0000-4000-8000-0000000000d3')$q$,'Only the person who gave');
select 'no direct writes', pg_temp.fails($q$update public.team_tasks set reschedule_count=0$q$,'permission denied');
select pg_temp.as_user('d1');
select 'owner cannot pass the limit by rescheduling', pg_temp.fails($q$select pg_temp.move(4,'4 days','Owner moving it')$q$,'already moved 3 times');
select 'owner can still edit after 3', (select version from public.save_team_task('00000000-0000-4000-8000-0000000000e1',4,'Call the regional official','','urgent',now()+interval '9 days','00000000-0000-4000-8000-0000000000d3'))=5;
select pg_temp.as_user('d3');
select 'assignee can still mark it done', (select status from public.close_team_task('00000000-0000-4000-8000-0000000000e1',5,'done','Spoke to the official, letter sent'))='done';
select pg_temp.as_user('d2');
select 'second task for the closed check', (public.save_team_task('00000000-0000-4000-8000-0000000000e2',0,'Send the quote','','normal',now()+interval '1 hour','00000000-0000-4000-8000-0000000000d3')).version=1;
select 'cancelled', (select status from public.close_team_task('00000000-0000-4000-8000-0000000000e2',1,'cancel','Customer bought elsewhere'))='cancelled';
select pg_temp.as_user('d3');
select 'a closed task is refused', pg_temp.fails($q$select public.reschedule_team_task('00000000-0000-4000-8000-0000000000e2',2,now()+interval '1 day','Customer called back')$q$,'already closed');
reset role;
select 'anon cannot call it', not has_function_privilege('anon','public.reschedule_team_task(uuid,integer,timestamptz,text)','execute');
select 'events stay unchangeable', pg_temp.fails($q$update public.team_task_events set note='x' where action='reschedule'$q$,'never changed');
rollback;
