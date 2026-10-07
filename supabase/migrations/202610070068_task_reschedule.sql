-- Task reschedule (agreed by the department heads, 7 Oct 2026): the person doing a task cannot edit it, but may move
-- the due time later up to 3 times, giving a reason each time. After 3, the only ways forward are Mark done or asking
-- the person who gave it (who, like the owner, can still Edit or Cancel). The limit is kept here, not only in the page.
-- Every reschedule is a 'reschedule' row in team_task_events with the old due, the new due, the reason, who and when.
-- Rollback: revoke execute on public.reschedule_team_task in a forward migration; keep the column and the history rows.
begin;

alter table public.team_tasks add column reschedule_count integer not null default 0 check (reschedule_count between 0 and 3);
alter table public.team_task_events add column old_due_at timestamptz, add column new_due_at timestamptz;
alter table public.team_task_events drop constraint team_task_events_action_check;
alter table public.team_task_events add constraint team_task_events_action_check check (action in ('create','edit','done','cancel','reschedule'));
alter table public.team_task_events add constraint team_task_events_reschedule_dues check
 ((action = 'reschedule') = (old_due_at is not null and new_due_at is not null));

create function public.reschedule_team_task(p_id uuid, p_expected_version integer, p_new_due timestamptz, p_reason text)
returns public.team_tasks language plpgsql security definer set search_path=public,pg_temp as $$
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
 if (select auth.uid()) <> v_row.assignee_user_id and not public.inventory_owner() then raise exception 'Only the person doing the task or the owner can move it'; end if;
 -- Retried request: this person's last change already moved the task to this time for this reason.
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
end $$;

revoke all on function public.reschedule_team_task(uuid,integer,timestamptz,text) from public, anon;
grant execute on function public.reschedule_team_task(uuid,integer,timestamptz,text) to authenticated;
commit;
