-- Why a step is late and when it is now expected. Recorded against the open handoff by the person holding it, the
-- person who sent it, or the owner. Append-only: a new report supersedes the last one for that handoff, and the
-- history shows every change of expected date. Does not change any workflow, stock or money.
-- Rollback: revoke the RPC in a forward migration; keep the rows as history.
begin;

create table public.work_delays (
 id uuid primary key,
 assignment_id uuid not null references public.work_assignments(id),
 reason text not null check (length(trim(reason)) between 3 and 500),
 expected_on date not null,
 recorded_by uuid not null references auth.users(id),
 recorded_at timestamptz not null default now()
);
create index work_delays_assignment on public.work_delays(assignment_id, recorded_at desc);
create index work_delays_recorded_by on public.work_delays(recorded_by);
create function public.deny_work_delay_mutation() returns trigger
language plpgsql set search_path=public,pg_temp as $$ begin raise exception 'Delay reports are never changed; add a new one'; end $$;
create trigger work_delays_immutable before update or delete on public.work_delays for each row execute function public.deny_work_delay_mutation();
create trigger work_delays_no_truncate before truncate on public.work_delays for each statement execute function public.deny_work_delay_mutation();
alter table public.work_delays enable row level security;
create policy work_delays_read on public.work_delays for select to authenticated using ((select public.inventory_active_staff()));
revoke all on public.work_delays from public, anon, authenticated;
grant select on public.work_delays to authenticated;

create function public.record_work_delay(p_id uuid, p_assignment_id uuid, p_reason text, p_expected_on date)
returns public.work_delays language plpgsql security definer set search_path=public,pg_temp as $$
declare v_row public.work_delays; v_work public.work_assignments;
begin
 if not public.inventory_active_staff() then raise exception 'Active staff access is required'; end if;
 select * into v_row from public.work_delays where id=p_id;
 if found then
  if v_row.assignment_id=p_assignment_id and v_row.recorded_by=auth.uid() and v_row.expected_on=p_expected_on then return v_row; end if;
  raise exception 'Delay report already saved; refresh';
 end if;
 select * into v_work from public.work_assignments where id=p_assignment_id;
 if not found then raise exception 'Step not found'; end if;
 if v_work.status <> 'open' then raise exception 'This step is already finished'; end if;
 if auth.uid() not in (v_work.assignee_user_id, v_work.assigned_by) and not public.inventory_owner() then raise exception 'Only the person doing the step, the sender or the owner can report a delay'; end if;
 if length(trim(coalesce(p_reason,''))) not between 3 and 500 then raise exception 'Enter the reason for the delay'; end if;
 if p_expected_on is null or p_expected_on < current_date then raise exception 'Choose the new expected date (today or later)'; end if;
 if p_expected_on > current_date + 366 then raise exception 'Expected date is too far ahead'; end if;
 insert into public.work_delays(id,assignment_id,reason,expected_on,recorded_by) values(p_id,p_assignment_id,trim(p_reason),p_expected_on,auth.uid()) returning * into v_row;
 return v_row;
end $$;

revoke all on function public.record_work_delay(uuid,uuid,text,date) from public, anon;
grant execute on function public.record_work_delay(uuid,uuid,text,date) to authenticated;
revoke all on function public.deny_work_delay_mutation() from public, anon, authenticated;
commit;
