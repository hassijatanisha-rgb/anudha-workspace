-- Deadline changes need the department head (owner decision, 13 October 2026), and overdue tasks alert the head.
-- The person doing a task asks for a new deadline with a reason; the head of their department (or the owner, when
-- they are a head themselves or their department has no head) approves or rejects it. Nobody decides their own
-- request. The owner may still move a deadline directly. The 3-move limit per task stays.
-- Overdue open tasks raise one task for the head (or owner) per deadline. There is no scheduler on this database, so
-- the alert is raised when anyone's notification bell refreshes, like the packing alert (migration 078).
begin;

-- Whoever approves for this person: heads of their department, or owners when they are a head or have no head.
create or replace function public.task_deadline_approvers(p_user_id uuid)
returns setof uuid language sql stable security definer set search_path to 'public','pg_temp' as $$
 with person as (select role, nullif(department,'') department from public.staff where user_id=p_user_id),
 heads as (select s.user_id from public.staff s, person p where s.active and s.role='head' and p.role<>'head' and p.role<>'owner'
  and p.department is not null and s.department=p.department and s.user_id<>p_user_id)
 select user_id from heads
 union all
 select s.user_id from public.staff s where s.active and s.role='owner' and s.user_id<>p_user_id and not exists(select 1 from heads)
$$;
revoke all on function public.task_deadline_approvers(uuid) from public, anon, authenticated;

-- Tasks this database raises itself; they are never overdue-alerted again (no alert about an alert).
create table if not exists public.team_task_generated(task_id uuid primary key references public.team_tasks(id), kind text not null check(kind in ('deadline_request','overdue_alert')));
alter table public.team_task_generated enable row level security;
revoke all on public.team_task_generated from public, anon, authenticated;

create table if not exists public.team_task_reschedule_requests(
 id uuid primary key,
 task_id uuid not null references public.team_tasks(id),
 task_version integer not null,
 requested_by uuid not null,
 old_due_at timestamptz not null,
 requested_due_at timestamptz not null check(requested_due_at>old_due_at),
 reason text not null check(length(trim(reason)) between 5 and 1000),
 status text not null default 'pending' check(status in ('pending','approved','rejected')),
 approval_task_ids uuid[] not null default '{}',
 decided_by uuid, decided_at timestamptz,
 decision_note text check(decision_note is null or length(trim(decision_note)) between 2 and 1000),
 created_at timestamptz not null default now(),
 check((status='pending')=(decided_by is null) and (decided_by is null)=(decided_at is null) and (decided_by is null)=(decision_note is null))
);
create unique index if not exists team_task_one_pending_request on public.team_task_reschedule_requests(task_id) where status='pending';
create or replace function public.guard_task_reschedule_request() returns trigger language plpgsql set search_path to 'public','pg_temp' as $$
begin
 if tg_op='DELETE' or old.status<>'pending'
  or (new.id,new.task_id,new.task_version,new.requested_by,new.old_due_at,new.requested_due_at,new.reason,new.approval_task_ids,new.created_at)
   is distinct from (old.id,old.task_id,old.task_version,old.requested_by,old.old_due_at,old.requested_due_at,old.reason,old.approval_task_ids,old.created_at) then
  raise exception 'Deadline requests are permanent history';
 end if;
 return new;
end $$;
drop trigger if exists team_task_reschedule_requests_history on public.team_task_reschedule_requests;
create trigger team_task_reschedule_requests_history before update or delete on public.team_task_reschedule_requests for each row execute function public.guard_task_reschedule_request();
-- Readers of a request: whoever its approval tasks were given to.
create or replace function public.approval_task_ids_owners(p_task_ids uuid[]) returns uuid[] language sql stable security definer set search_path to 'public','pg_temp' as $$
 select coalesce(array_agg(assignee_user_id),'{}') from public.team_tasks where id=any(p_task_ids)
$$;
revoke all on function public.approval_task_ids_owners(uuid[]) from public, anon;
grant execute on function public.approval_task_ids_owners(uuid[]) to authenticated;
alter table public.team_task_reschedule_requests enable row level security;
revoke all on public.team_task_reschedule_requests from public, anon, authenticated;
grant select on public.team_task_reschedule_requests to authenticated;
drop policy if exists team_task_reschedule_requests_read on public.team_task_reschedule_requests;
create policy team_task_reschedule_requests_read on public.team_task_reschedule_requests for select to authenticated using ((select public.inventory_active_staff())
 and (requested_by=(select auth.uid()) or (select auth.uid())=any(approval_task_ids_owners(approval_task_ids)) or (select public.inventory_owner())));


-- Raises one generated task for each approver; returns their ids.
create or replace function public.raise_task_for_approvers(p_for_user uuid, p_kind text, p_title text, p_details text, p_from_user uuid)
returns uuid[] language plpgsql security definer set search_path to 'public','pg_temp' as $$
declare v_ids uuid[]:='{}'; v_id uuid; v_approver uuid;
begin
 for v_approver in select * from public.task_deadline_approvers(p_for_user) order by 1 loop
  v_id:=gen_random_uuid();
  insert into public.team_tasks(id,task_number,title,details,urgency,due_at,assignee_user_id,assigned_by)
  values(v_id,'TK-'||lpad(nextval('public.team_task_number_seq')::text,6,'0'),left(p_title,200),left(p_details,4000),'urgent',now()+interval '1 day',v_approver,p_from_user);
  insert into public.team_task_events(task_id,action,note,actor_user_id) values(v_id,'create',left(p_title,1000),p_from_user);
  insert into public.team_task_generated(task_id,kind) values(v_id,p_kind);
  v_ids:=v_ids||v_id;
 end loop;
 return v_ids;
end $$;
revoke all on function public.raise_task_for_approvers(uuid,text,text,text,uuid) from public, anon, authenticated;

create or replace function public.request_team_task_reschedule(p_id uuid, p_task_id uuid, p_expected_version integer, p_new_due timestamptz, p_reason text)
returns public.team_task_reschedule_requests language plpgsql security definer set search_path to 'public','pg_temp' as $$
declare v_task public.team_tasks; v_result public.team_task_reschedule_requests; v_reason text:=trim(coalesce(p_reason,''));
begin
 if not public.inventory_active_staff() then raise exception 'Active staff access is required'; end if;
 if p_id is null or p_task_id is null or p_expected_version is null then raise exception 'Task request and version are required'; end if;
 select * into v_result from public.team_task_reschedule_requests where id=p_id;
 if found then
  if v_result.task_id=p_task_id and v_result.requested_by=auth.uid() and v_result.requested_due_at=p_new_due then return v_result; end if;
  raise exception 'This request was already recorded differently; refresh';
 end if;
 if length(v_reason) not between 5 and 1000 then raise exception 'Write why the task needs more time (at least 5 characters)'; end if;
 if p_new_due is null then raise exception 'Choose the new due date and time'; end if;
 if p_new_due > now()+interval '2 years' then raise exception 'Due date is too far ahead'; end if;
 select * into v_task from public.team_tasks where id=p_task_id for update;
 if not found then raise exception 'Task not found'; end if;
 if v_task.assignee_user_id<>auth.uid() then raise exception 'Only the person doing the task can ask for a new deadline'; end if;
 if v_task.status<>'open' then raise exception 'This task is already closed'; end if;
 if v_task.version<>p_expected_version then raise exception 'Task changed; refresh'; end if;
 if v_task.reschedule_count>=3 then raise exception 'This task was already moved 3 times. Mark it done or ask the person who gave it'; end if;
 if p_new_due<=now() or p_new_due<=v_task.due_at then raise exception 'Choose a new time later than now and later than the current due time'; end if;
 if exists(select 1 from public.team_task_reschedule_requests where task_id=v_task.id and status='pending') then raise exception 'A new deadline was already asked for and is waiting for a decision'; end if;
 if not exists(select 1 from public.task_deadline_approvers(auth.uid())) then raise exception 'Nobody can approve your deadline changes yet. Ask the owner.'; end if;
 insert into public.team_task_reschedule_requests(id,task_id,task_version,requested_by,old_due_at,requested_due_at,reason,approval_task_ids)
 values(p_id,v_task.id,v_task.version,auth.uid(),v_task.due_at,p_new_due,v_reason,
  public.raise_task_for_approvers(auth.uid(),'deadline_request','New deadline asked: '||v_task.task_number||' · '||v_task.title,
   'Asked to move '||v_task.task_number||' from '||to_char(v_task.due_at at time zone 'Africa/Dar_es_Salaam','DD Mon HH24:MI')||' to '||to_char(p_new_due at time zone 'Africa/Dar_es_Salaam','DD Mon HH24:MI')||'. Reason: '||v_reason||' Approve or reject it under My tasks → Deadline requests.',auth.uid()))
 returning * into v_result;
 return v_result;
end $$;

create or replace function public.decide_team_task_reschedule(p_request_id uuid, p_decision text, p_note text)
returns public.team_task_reschedule_requests language plpgsql security definer set search_path to 'public','pg_temp' as $$
declare v_req public.team_task_reschedule_requests; v_task public.team_tasks; v_note text:=trim(coalesce(p_note,'')); v_alert uuid;
begin
 if not public.inventory_active_staff() then raise exception 'Active staff access is required'; end if;
 if p_decision not in ('approved','rejected') then raise exception 'Choose approve or reject'; end if;
 if length(v_note) not between 2 and 1000 then raise exception 'Write a short note for the person'; end if;
 select * into v_req from public.team_task_reschedule_requests where id=p_request_id for update;
 if not found then raise exception 'Request not found'; end if;
 if v_req.status<>'pending' then raise exception 'This request was already decided'; end if;
 if v_req.requested_by=auth.uid() then raise exception 'You cannot decide your own deadline request'; end if;
 if not public.inventory_owner() and not exists(select 1 from public.task_deadline_approvers(v_req.requested_by) a where a=auth.uid()) then
  raise exception 'Only the department head of this person or the owner can decide this';
 end if;
 select * into v_task from public.team_tasks where id=v_req.task_id for update;
 if p_decision='approved' then
  if v_task.status<>'open' or v_task.version<>v_req.task_version or v_task.due_at<>v_req.old_due_at then raise exception 'The task changed after this request. Reject it and ask for a new one.'; end if;
  if v_req.requested_due_at<=now() then raise exception 'The asked-for time has already passed. Reject it and ask for a new one.'; end if;
  if v_task.reschedule_count>=3 then raise exception 'This task was already moved 3 times'; end if;
  insert into public.team_task_events(task_id,action,note,actor_user_id,old_due_at,new_due_at)
  values(v_task.id,'reschedule',left('Approved by head: '||v_note||' · Asked: '||v_req.reason,1000),auth.uid(),v_task.due_at,v_req.requested_due_at);
  update public.team_tasks set due_at=v_req.requested_due_at,reschedule_count=reschedule_count+1,version=version+1,updated_at=now() where id=v_task.id;
 end if;
 update public.team_task_reschedule_requests set status=p_decision,decided_by=auth.uid(),decided_at=now(),decision_note=v_note where id=v_req.id returning * into v_req;
 -- The approval tasks are finished by the decision.
 foreach v_alert in array v_req.approval_task_ids loop
  update public.team_tasks set status='done',close_note=left('Deadline request '||p_decision||': '||v_note,1000),closed_by=auth.uid(),closed_at=now(),version=version+1,updated_at=now()
  where id=v_alert and status='open';
  if found then insert into public.team_task_events(task_id,action,note,actor_user_id) values(v_alert,'done','Deadline request '||p_decision,auth.uid()); end if;
 end loop;
 return v_req;
end $$;

-- The person doing a task no longer moves it directly; the owner still can.
create or replace function public.reschedule_team_task(p_id uuid, p_expected_version integer, p_new_due timestamp with time zone, p_reason text)
 RETURNS team_tasks LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_row public.team_tasks; v_reason text := trim(coalesce(p_reason,''));
begin
 if not public.inventory_active_staff() then raise exception 'Active staff access is required'; end if;
 if p_id is null or p_expected_version is null then raise exception 'Task request and version are required'; end if;
 if length(v_reason) < 5 then raise exception 'Write why the task is moved (at least 5 characters)'; end if;
 if length(v_reason) > 1000 then raise exception 'Reason is too long'; end if;
 if p_new_due is null then raise exception 'Choose the new due date and time'; end if;
 if p_new_due > now() + interval '2 years' then raise exception 'Due date is too far ahead'; end if;
 select * into v_row from public.team_tasks where id = p_id for update;
 if not found then raise exception 'Task not found'; end if;
 -- deadline_approval_083
 if not public.inventory_owner() then raise exception 'A new deadline needs your department head''s approval. Use "Ask for more time".'; end if;
 if v_row.version = p_expected_version + 1 and v_row.due_at = p_new_due and exists(select 1 from public.team_task_events e
  where e.task_id = p_id and e.action = 'reschedule' and e.new_due_at = p_new_due and e.note = v_reason and e.actor_user_id = (select auth.uid())
  and e.created_at = v_row.updated_at) then return v_row; end if;
 if v_row.status <> 'open' then raise exception 'This task is already closed'; end if;
 if v_row.version <> p_expected_version then raise exception 'Task changed; refresh'; end if;
 if v_row.reschedule_count >= 3 then raise exception 'This task was already moved 3 times. Mark it done or ask the person who gave it'; end if;
 if p_new_due <= now() then raise exception 'Choose a new time later than now'; end if;
 if p_new_due <= v_row.due_at then raise exception 'Choose a new time later than the current due time'; end if;
 insert into public.team_task_events(task_id,action,note,actor_user_id,old_due_at,new_due_at) values(v_row.id,'reschedule',v_reason,(select auth.uid()),v_row.due_at,p_new_due);
 update public.team_tasks set due_at=p_new_due,reschedule_count=reschedule_count+1,version=version+1,updated_at=now()
  where id = p_id returning * into v_row;
 return v_row;
end $function$;

-- One overdue alert per task and deadline.
create table if not exists public.team_task_overdue_alerts(
 task_id uuid not null references public.team_tasks(id), due_at timestamptz not null, alert_task_ids uuid[] not null default '{}',
 created_at timestamptz not null default now(), primary key(task_id,due_at));
alter table public.team_task_overdue_alerts enable row level security;
revoke all on public.team_task_overdue_alerts from public, anon, authenticated;

create or replace function public.raise_team_task_overdue_alerts()
returns integer language plpgsql security definer set search_path to 'public','pg_temp' as $$
declare v_task record; v_count integer:=0; v_ids uuid[];
begin
 if not public.inventory_active_staff() then return 0; end if;
 for v_task in select t.* from public.team_tasks t
  where t.status='open' and t.due_at<now()
   and not exists(select 1 from public.team_task_generated g where g.task_id=t.id)
   and not exists(select 1 from public.sales_delivery_notes n where t.id=any(n.packing_alert_task_ids))
   and not exists(select 1 from public.team_task_overdue_alerts a where a.task_id=t.id and a.due_at=t.due_at)
  order by t.due_at limit 50 for update of t skip locked
 loop
  v_ids:=public.raise_task_for_approvers(v_task.assignee_user_id,'overdue_alert','Overdue: '||v_task.task_number||' · '||v_task.title,
   v_task.task_number||' was due '||to_char(v_task.due_at at time zone 'Africa/Dar_es_Salaam','DD Mon HH24:MI')||' and is still open. Check with the person doing it. This alert closes itself when you mark it done.',v_task.assignee_user_id);
  insert into public.team_task_overdue_alerts(task_id,due_at,alert_task_ids) values(v_task.id,v_task.due_at,v_ids) on conflict do nothing;
  v_count:=v_count+1;
 end loop;
 return v_count;
end $$;

revoke all on function public.request_team_task_reschedule(uuid,uuid,integer,timestamptz,text), public.decide_team_task_reschedule(uuid,text,text),
 public.raise_team_task_overdue_alerts(), public.guard_task_reschedule_request() from public, anon;
grant execute on function public.request_team_task_reschedule(uuid,uuid,integer,timestamptz,text), public.decide_team_task_reschedule(uuid,text,text),
 public.raise_team_task_overdue_alerts() to authenticated;

commit;
