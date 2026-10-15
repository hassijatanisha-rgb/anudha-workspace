-- Dashboard "Team tasks": for each person the signed-in owner or head may see, how many tasks are open, completed and
-- late in a chosen period, and that person's tasks with their results. The owner sees everyone; a department head sees
-- the people in their own department (themself included, never the owner) and nobody else. team_tasks stay readable
-- only by the giver, the person given the task and the owner (migration 056), so these reads are security definer and
-- check who is asking before reading anything. Counts and task rows only. Days are Dar es Salaam days (UTC+3).
--  open      = still open and due by the end of the period (older overdue tasks included)
--  completed = marked done during the period
--  late      = still open after its due time, or marked done during the period after its due time
-- Rollback: drop function public.team_member_tasks(uuid,date,date), public.team_task_counts(date,date) and
-- public.can_see_team_member(uuid) in a forward migration; nothing else changes.
begin;

-- Owner: anyone. Head: someone in the head's own (named) department who is not an owner.
create function public.can_see_team_member(p_user_id uuid) returns boolean
language sql stable security definer set search_path=public,pg_temp as $$
 select public.mfa_satisfied() and exists(
  select 1 from public.staff me where me.user_id=(select auth.uid()) and me.active and (
   me.role='owner' or (me.role='head' and me.department<>'' and exists(
    select 1 from public.staff t where t.user_id=p_user_id and t.role<>'owner' and t.department=me.department))))
$$;

create function public.team_task_period(p_from date, p_to date, out v_start timestamptz, out v_end timestamptz)
language plpgsql immutable set search_path=public,pg_temp as $$
begin
 if p_from is null or p_to is null then raise exception 'Choose a start and an end date'; end if;
 if p_from > p_to then raise exception 'The start date must be on or before the end date'; end if;
 if p_to - p_from > 366 then raise exception 'Choose a period of one year or less'; end if;
 v_start := p_from::timestamp at time zone 'Africa/Dar_es_Salaam';
 v_end := (p_to + 1)::timestamp at time zone 'Africa/Dar_es_Salaam';
end $$;

create function public.team_task_counts(p_from date, p_to date)
returns table(user_id uuid, department text, open_count bigint, completed_count bigint, late_count bigint)
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_start timestamptz; v_end timestamptz;
begin
 if not (public.is_owner() or public.is_department_head()) then
  raise exception 'Only the owner or a department head can see team tasks' using errcode='42501';
 end if;
 select p.v_start, p.v_end into v_start, v_end from public.team_task_period(p_from, p_to) p;
 return query
 select s.user_id, s.department,
  count(t.id) filter (where t.status='open' and t.due_at < v_end),
  count(t.id) filter (where t.status='done'),
  count(t.id) filter (where (t.status='open' and t.due_at < least(now(), v_end)) or (t.status='done' and t.closed_at > t.due_at))
 from public.staff s
 left join public.team_tasks t on t.assignee_user_id=s.user_id
  and (t.status='open' or (t.status='done' and t.closed_at >= v_start and t.closed_at < v_end))
 where s.active and public.can_see_team_member(s.user_id)
 group by s.user_id, s.department
 order by s.user_id;
end $$;

-- One person's tasks behind the counts: open ones due by the end of the period and ones done in it, with the note
-- left when each was done.
create function public.team_member_tasks(p_user_id uuid, p_from date, p_to date)
returns table(id uuid, task_number text, title text, urgency text, due_at timestamptz, status text, assigned_by uuid,
 closed_at timestamptz, close_note text)
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_start timestamptz; v_end timestamptz;
begin
 if p_user_id is null or not public.can_see_team_member(p_user_id) then
  raise exception 'You can only see tasks of people in your own department' using errcode='42501';
 end if;
 select p.v_start, p.v_end into v_start, v_end from public.team_task_period(p_from, p_to) p;
 return query
 select t.id, t.task_number, t.title, t.urgency, t.due_at, t.status, t.assigned_by, t.closed_at, t.close_note
 from public.team_tasks t
 where t.assignee_user_id=p_user_id
  and ((t.status='open' and t.due_at < v_end) or (t.status='done' and t.closed_at >= v_start and t.closed_at < v_end))
 order by t.status<>'open', t.due_at, t.id
 limit 500;
end $$;

revoke all on function public.can_see_team_member(uuid), public.team_task_period(date,date) from public, anon, authenticated;
revoke all on function public.team_task_counts(date,date), public.team_member_tasks(uuid,date,date) from public, anon;
grant execute on function public.team_task_counts(date,date), public.team_member_tasks(uuid,date,date) to authenticated;
commit;
