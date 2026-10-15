-- Team tasks: one employee (or a head of department) gives a task to another, or to themselves. Every task has an
-- urgency and a due date and time. Only the person given the task, the person who gave it and the owner can see it.
-- Personal notes and reminders stay in workspace_entries. History is append-only in team_task_events.
-- Rollback: revoke the RPCs in a forward migration; keep the rows as history.
begin;

create sequence public.team_task_number_seq;
revoke all on sequence public.team_task_number_seq from public, anon, authenticated;

create table public.team_tasks (
 id uuid primary key,
 task_number text not null unique,
 title text not null check (length(trim(title)) between 2 and 200),
 details text not null default '' check (length(details) <= 4000),
 urgency text not null check (urgency in ('do_now','urgent','normal')),
 due_at timestamptz not null,
 assignee_user_id uuid not null references auth.users(id),
 assigned_by uuid not null references auth.users(id),
 status text not null default 'open' check (status in ('open','done','cancelled')),
 close_note text not null default '' check (length(close_note) <= 1000),
 closed_by uuid references auth.users(id),
 closed_at timestamptz,
 version integer not null default 1 check (version > 0),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 check ((status = 'open') = (closed_at is null and closed_by is null))
);
create index team_tasks_assignee on public.team_tasks(assignee_user_id, status, due_at);
create index team_tasks_assigned_by on public.team_tasks(assigned_by, status, due_at);
create index team_tasks_closed_by on public.team_tasks(closed_by);

create table public.team_task_events (
 id uuid primary key default gen_random_uuid(),
 task_id uuid not null references public.team_tasks(id),
 action text not null check (action in ('create','edit','done','cancel')),
 note text not null default '' check (length(note) <= 1000),
 actor_user_id uuid not null references auth.users(id),
 created_at timestamptz not null default now()
);
create index team_task_events_task on public.team_task_events(task_id, created_at);
create index team_task_events_actor on public.team_task_events(actor_user_id);

create function public.deny_team_task_mutation() returns trigger
language plpgsql set search_path=public,pg_temp as $$ begin raise exception 'Tasks are closed, never deleted; task history is never changed'; end $$;
create trigger team_tasks_no_delete before delete on public.team_tasks for each row execute function public.deny_team_task_mutation();
create trigger team_tasks_no_truncate before truncate on public.team_tasks for each statement execute function public.deny_team_task_mutation();
create trigger team_task_events_immutable before update or delete on public.team_task_events for each row execute function public.deny_team_task_mutation();
create trigger team_task_events_no_truncate before truncate on public.team_task_events for each statement execute function public.deny_team_task_mutation();

alter table public.team_tasks enable row level security;
alter table public.team_task_events enable row level security;
create policy team_tasks_read on public.team_tasks for select to authenticated using (
 (select public.inventory_active_staff()) and ((select auth.uid()) in (assignee_user_id, assigned_by) or (select public.inventory_owner())));
create policy team_task_events_read on public.team_task_events for select to authenticated using (
 exists(select 1 from public.team_tasks t where t.id = task_id));
revoke all on public.team_tasks, public.team_task_events from public, anon, authenticated;
grant select on public.team_tasks, public.team_task_events to authenticated;

create function public.save_team_task(p_id uuid, p_expected_version integer, p_title text, p_details text, p_urgency text,
 p_due_at timestamptz, p_assignee uuid)
returns public.team_tasks language plpgsql security definer set search_path=public,pg_temp as $$
declare v_row public.team_tasks;
begin
 if not public.inventory_active_staff() then raise exception 'Active staff access is required'; end if;
 if p_id is null or p_expected_version is null then raise exception 'Task request and version are required'; end if;
 if length(trim(coalesce(p_title,''))) not between 2 and 200 then raise exception 'Write what needs doing (2 to 200 characters)'; end if;
 if length(coalesce(p_details,'')) > 4000 then raise exception 'Details are too long'; end if;
 if coalesce(p_urgency,'') not in ('do_now','urgent','normal') then raise exception 'Choose how urgent it is'; end if;
 if p_due_at is null then raise exception 'Choose the due date and time'; end if;
 if p_due_at > now() + interval '2 years' then raise exception 'Due date is too far ahead'; end if;
 if not exists(select 1 from public.staff where user_id = p_assignee and active) then raise exception 'Choose an active employee'; end if;
 select * into v_row from public.team_tasks where id = p_id for update;
 if not found then
  if p_expected_version <> 0 then raise exception 'Task not found; refresh'; end if;
  if p_due_at < now() - interval '1 day' then raise exception 'Choose a due date and time from today on'; end if;
  insert into public.team_tasks(id,task_number,title,details,urgency,due_at,assignee_user_id,assigned_by)
  values(p_id,'TK-'||lpad(nextval('public.team_task_number_seq')::text,6,'0'),trim(p_title),coalesce(p_details,''),p_urgency,p_due_at,p_assignee,auth.uid())
  returning * into v_row;
  insert into public.team_task_events(task_id,action,note,actor_user_id) values(v_row.id,'create',v_row.title,auth.uid());
  return v_row;
 end if;
 -- A lost response retried with the same request returns the task this person already created.
 if p_expected_version = 0 and v_row.assigned_by = auth.uid() and v_row.version = 1 and v_row.title = trim(p_title) then return v_row; end if;
 if auth.uid() <> v_row.assigned_by and not public.inventory_owner() then raise exception 'Only the person who gave the task or the owner can change it'; end if;
 if v_row.status <> 'open' then raise exception 'This task is already closed'; end if;
 if v_row.version <> p_expected_version then raise exception 'Task changed; refresh'; end if;
 update public.team_tasks set title=trim(p_title),details=coalesce(p_details,''),urgency=p_urgency,due_at=p_due_at,assignee_user_id=p_assignee,
  version=version+1,updated_at=now() where id = p_id returning * into v_row;
 insert into public.team_task_events(task_id,action,note,actor_user_id) values(v_row.id,'edit','',auth.uid());
 return v_row;
end $$;

create function public.close_team_task(p_id uuid, p_expected_version integer, p_action text, p_note text default '')
returns public.team_tasks language plpgsql security definer set search_path=public,pg_temp as $$
declare v_row public.team_tasks; v_status text;
begin
 if not public.inventory_active_staff() then raise exception 'Active staff access is required'; end if;
 if coalesce(p_action,'') not in ('done','cancel') then raise exception 'Choose done or cancel'; end if;
 v_status := case when p_action = 'done' then 'done' else 'cancelled' end;
 if length(coalesce(p_note,'')) > 1000 then raise exception 'Note is too long'; end if;
 select * into v_row from public.team_tasks where id = p_id for update;
 if not found then raise exception 'Task not found'; end if;
 if v_row.status <> 'open' then
  -- Retried request: already closed this way by this person.
  if v_row.status = v_status and v_row.closed_by = auth.uid() then return v_row; end if;
  raise exception 'This task is already closed';
 end if;
 if v_row.version <> p_expected_version then raise exception 'Task changed; refresh'; end if;
 if p_action = 'done' and auth.uid() <> v_row.assignee_user_id and not public.inventory_owner() then raise exception 'Only the person doing the task or the owner can mark it done'; end if;
 if p_action = 'cancel' and auth.uid() <> v_row.assigned_by and not public.inventory_owner() then raise exception 'Only the person who gave the task or the owner can cancel it'; end if;
 update public.team_tasks set status=v_status,close_note=coalesce(p_note,''),
  closed_by=auth.uid(),closed_at=now(),version=version+1,updated_at=now() where id = p_id returning * into v_row;
 insert into public.team_task_events(task_id,action,note,actor_user_id) values(v_row.id,p_action,coalesce(p_note,''),auth.uid());
 return v_row;
end $$;

revoke all on function public.save_team_task(uuid,integer,text,text,text,timestamptz,uuid), public.close_team_task(uuid,integer,text,text) from public, anon;
grant execute on function public.save_team_task(uuid,integer,text,text,text,timestamptz,uuid), public.close_team_task(uuid,integer,text,text) to authenticated;
revoke all on function public.deny_team_task_mutation() from public, anon, authenticated;
commit;
