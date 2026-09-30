-- Handoffs: each step of a Pro forma, delivery, service job, lead or pending order can be handed to a named
-- employee and appears on that person's task list. Additive only: no workflow status, stock or price changes.
-- Rollback: hide the UI and revoke the RPCs in a reviewed forward migration; keep rows and history.
begin;

create table public.work_assignments (
 id uuid primary key,
 record_type text not null check (record_type in ('proforma','delivery','service','lead','pending')),
 record_id uuid not null,
 record_label text not null check (length(trim(record_label)) between 1 and 200),
 task text not null check (length(trim(task)) between 2 and 300),
 note text not null default '' check (length(note) <= 2000),
 assignee_user_id uuid not null references auth.users(id),
 assigned_by uuid not null references auth.users(id),
 due_on date,
 status text not null check (status in ('open','done','handed_on','cancelled')),
 previous_assignment_id uuid references public.work_assignments(id),
 closed_by uuid references auth.users(id),
 closed_at timestamptz,
 close_note text not null default '' check (length(close_note) <= 1000),
 version integer not null default 1 check (version > 0),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 check ((status = 'open') = (closed_at is null and closed_by is null))
);
-- At most one open handoff per record: a new handoff closes the previous one in the same transaction.
create unique index work_assignments_one_open on public.work_assignments(record_type, record_id) where status='open';
create index work_assignments_assignee_open on public.work_assignments(assignee_user_id, due_on nulls last, id) where status='open';
create index work_assignments_record on public.work_assignments(record_type, record_id, created_at);
create index work_assignments_assigned_by on public.work_assignments(assigned_by);
create index work_assignments_previous on public.work_assignments(previous_assignment_id);
create index work_assignments_closed_by on public.work_assignments(closed_by);

-- Rows change only through the RPCs below; sender, assignee, record, task and creation time never change.
create function public.guard_work_assignment_update()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
 if tg_op = 'DELETE' then raise exception 'Handoffs are never deleted'; end if;
 if old.status <> 'open' then raise exception 'A closed handoff cannot change'; end if;
 if new.id is distinct from old.id or new.record_type is distinct from old.record_type or new.record_id is distinct from old.record_id
  or new.record_label is distinct from old.record_label or new.task is distinct from old.task or new.note is distinct from old.note
  or new.assignee_user_id is distinct from old.assignee_user_id or new.assigned_by is distinct from old.assigned_by
  or new.due_on is distinct from old.due_on or new.previous_assignment_id is distinct from old.previous_assignment_id
  or new.created_at is distinct from old.created_at then
  raise exception 'Handoff sender, assignee and task are permanent';
 end if;
 return new;
end $$;
create trigger work_assignments_guard before update or delete on public.work_assignments for each row execute function public.guard_work_assignment_update();
create function public.deny_work_assignment_truncate()
returns trigger language plpgsql set search_path=public,pg_temp as $$ begin raise exception 'Handoffs are never deleted'; end $$;
create trigger work_assignments_no_truncate before truncate on public.work_assignments for each statement execute function public.deny_work_assignment_truncate();

alter table public.work_assignments enable row level security;
create policy work_assignments_read on public.work_assignments for select to authenticated using ((select public.inventory_active_staff()));
revoke all on public.work_assignments from public, anon, authenticated;
grant select on public.work_assignments to authenticated;

create function public.work_record_exists(p_record_type text, p_record_id uuid)
returns boolean language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
 return case p_record_type
  when 'proforma' then exists(select 1 from public.sales_proformas where id=p_record_id and deleted_at is null)
  when 'delivery' then exists(select 1 from public.sales_delivery_notes where id=p_record_id)
  when 'service' then exists(select 1 from public.service_cases where id=p_record_id)
  when 'lead' then exists(select 1 from public.sales_leads where id=p_record_id)
  when 'pending' then exists(select 1 from public.pending_stock_requests where id=p_record_id)
  else false end;
end $$;
revoke all on function public.work_record_exists(text,uuid) from public, anon, authenticated;

-- Hand a record to the next person. p_expected_open_id is the currently open handoff the sender saw (null if none),
-- so two people handing on the same record at once cannot both succeed.
create function public.hand_off_work(p_id uuid, p_record_type text, p_record_id uuid, p_record_label text, p_task text,
 p_assignee_user_id uuid, p_due_on date default null, p_note text default '', p_expected_open_id uuid default null)
returns public.work_assignments language plpgsql security definer set search_path=public,pg_temp as $$
declare v_row public.work_assignments; v_open public.work_assignments;
begin
 if not public.inventory_active_staff() then raise exception 'Active staff access is required'; end if;
 if p_id is null or p_record_type is null or p_record_id is null or p_assignee_user_id is null then raise exception 'Record and employee are required'; end if;
 if length(trim(coalesce(p_task,''))) not between 2 and 300 then raise exception 'Describe the task in 2 to 300 characters'; end if;
 if length(trim(coalesce(p_record_label,''))) not between 1 and 200 then raise exception 'Record label is required'; end if;
 if length(coalesce(p_note,'')) > 2000 then raise exception 'Note is too long'; end if;
 if p_due_on is not null and p_due_on < current_date - 1 then raise exception 'Due date cannot be in the past'; end if;
 perform pg_advisory_xact_lock(hashtextextended('work:'||p_record_type||':'||p_record_id::text,0));
 select * into v_row from public.work_assignments where id=p_id;
 if found then
  -- Lost response: an identical retry returns the saved handoff.
  if v_row.assigned_by=auth.uid() and v_row.record_type=p_record_type and v_row.record_id=p_record_id and v_row.assignee_user_id=p_assignee_user_id and v_row.task=trim(p_task) then return v_row; end if;
  raise exception 'Handoff request already used; refresh and compare';
 end if;
 if not public.work_record_exists(p_record_type,p_record_id) then raise exception 'That record no longer exists'; end if;
 if not exists(select 1 from public.staff where user_id=p_assignee_user_id and active) then raise exception 'Choose an active employee'; end if;
 select * into v_open from public.work_assignments where record_type=p_record_type and record_id=p_record_id and status='open' for update;
 if v_open.id is distinct from p_expected_open_id then raise exception 'Someone else changed who is responsible; refresh and compare'; end if;
 if found then
  update public.work_assignments set status='handed_on',closed_by=auth.uid(),closed_at=now(),close_note='Handed to next person',version=version+1,updated_at=now() where id=v_open.id;
 end if;
 insert into public.work_assignments(id,record_type,record_id,record_label,task,note,assignee_user_id,assigned_by,due_on,status,previous_assignment_id)
 values(p_id,p_record_type,p_record_id,trim(p_record_label),trim(p_task),coalesce(p_note,''),p_assignee_user_id,auth.uid(),p_due_on,'open',v_open.id)
 returning * into v_row;
 return v_row;
end $$;

-- Close an open handoff: the assignee or the owner marks it done; the sender, assignee or owner may cancel it.
create function public.close_work_assignment(p_id uuid, p_expected_version integer, p_action text, p_note text default '')
returns public.work_assignments language plpgsql security definer set search_path=public,pg_temp as $$
declare v_row public.work_assignments; v_owner boolean := public.inventory_owner(); v_note text := trim(coalesce(p_note,''));
begin
 if not public.inventory_active_staff() then raise exception 'Active staff access is required'; end if;
 if p_id is null or p_expected_version is null or p_action not in ('done','cancel') then raise exception 'Handoff, expected version and action are required'; end if;
 if length(v_note) > 1000 then raise exception 'Note is too long'; end if;
 select * into v_row from public.work_assignments where id=p_id for update;
 if not found then raise exception 'Handoff not found'; end if;
 if v_row.version <> p_expected_version then raise exception 'Handoff changed; refresh and compare'; end if;
 if v_row.status <> 'open' then raise exception 'This handoff is already closed'; end if;
 if p_action='done' and not v_owner and v_row.assignee_user_id <> auth.uid() then raise exception 'Only the assigned employee or the owner can mark this done'; end if;
 if p_action='cancel' and not v_owner and auth.uid() not in (v_row.assignee_user_id, v_row.assigned_by) then raise exception 'Only the sender, the assigned employee or the owner can cancel this'; end if;
 if p_action='cancel' and length(v_note) < 3 then raise exception 'Enter why the handoff is cancelled'; end if;
 update public.work_assignments set status=case when p_action='done' then 'done' else 'cancelled' end,closed_by=auth.uid(),closed_at=now(),close_note=v_note,version=version+1,updated_at=now()
 where id=p_id returning * into v_row;
 return v_row;
end $$;

revoke all on function public.hand_off_work(uuid,text,uuid,text,text,uuid,date,text,uuid), public.close_work_assignment(uuid,integer,text,text) from public, anon;
grant execute on function public.hand_off_work(uuid,text,uuid,text,text,uuid,date,text,uuid), public.close_work_assignment(uuid,integer,text,text) to authenticated;
commit;
