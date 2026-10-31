-- An eight-second inverse for a manual task close. Keep every historical event.
-- Rollback: revoke undo_team_task in a forward migration; retain its audit columns and rows.
begin;

alter table public.team_tasks add column undo_expires_at timestamptz,
 add constraint team_task_undo_deadline check (undo_expires_at is null or
  (status in ('done','cancelled') and closed_at is not null and undo_expires_at=closed_at+interval '8 seconds'));
alter table public.team_task_events add column task_version integer check (task_version>0),
 add column undoes_event_id uuid references public.team_task_events(id);
alter table public.team_task_events drop constraint team_task_events_action_check;
alter table public.team_task_events add constraint team_task_events_action_check
 check (action in ('create','edit','done','cancel','reschedule','progress','assignment','undo')),
 add constraint team_task_events_undo_proof check (
  (action='undo' and task_version is not null and undoes_event_id is not null)
  or (action<>'undo' and undoes_event_id is null and (task_version is null or action in ('done','cancel'))));
-- Legacy and automatic events have no version proof and cannot authorize Undo.
create unique index team_task_events_manual_version on public.team_task_events(task_id,task_version) where task_version is not null;

create or replace function public.close_team_task(p_id uuid,p_expected_version integer,p_action text,p_note text default '')
returns public.team_tasks language plpgsql security definer set search_path=public,pg_temp as $$
declare v_row public.team_tasks; v_actor uuid:=auth.uid(); v_role text; v_status text; v_now timestamptz;
begin
 if v_actor is null or public.inventory_active_staff() is not true then raise exception 'Active staff access is required' using errcode='42501'; end if;
 -- Hold current authorization through the write, including concurrent account deactivation/demotion.
 select role into v_role from public.staff where user_id=v_actor and active for share;
 if not found or public.inventory_active_staff() is not true then raise exception 'Active staff access is required' using errcode='42501'; end if;
 if p_id is null or p_expected_version is null or p_expected_version<1 then raise exception 'Task request and positive version are required'; end if;
 if coalesce(p_action,'') not in ('done','cancel') then raise exception 'Choose done or cancel'; end if;
 if length(coalesce(p_note,''))>1000 then raise exception 'Note is too long'; end if;
 v_status:=case when p_action='done' then 'done' else 'cancelled' end;
 select * into v_row from public.team_tasks where id=p_id for update;
 if not found then raise exception 'Task not found'; end if;
 if p_action='done' and v_actor<>v_row.assignee_user_id and v_role is distinct from 'owner' then raise exception 'Only the person doing the task or the owner can mark it done' using errcode='42501'; end if;
 if p_action='cancel' and v_actor<>v_row.assigned_by and v_role is distinct from 'owner' then raise exception 'Only the person who gave the task or the owner can cancel it' using errcode='42501'; end if;
 if v_row.status<>'open' then
  -- A retry must identify this exact close, never a later close or an automatic workflow result.
  if v_row.version::bigint=p_expected_version::bigint+1 and v_row.status=v_status and v_row.closed_by=v_actor
   and v_row.close_note=coalesce(p_note,'') and v_row.undo_expires_at=v_row.closed_at+interval '8 seconds'
   and exists(select 1 from public.team_task_events e where e.task_id=p_id and e.task_version=v_row.version
    and e.action=p_action and e.actor_user_id=v_actor and e.note=v_row.close_note and e.created_at=v_row.closed_at)
   then return v_row; end if;
  raise exception 'This task is already closed; refresh';
 end if;
 if v_row.version<>p_expected_version then raise exception 'Task changed; refresh'; end if;
 if v_row.version=2147483647 then raise exception 'Task version exhausted'; end if;
 if p_action='done' and not public.team_task_result_ok(p_note) then
  raise exception 'Write what you did and what the result was, in a few words (for example: Called Nisha, wants 2 ultrasound quotes).';
 end if;
 -- Wall-clock time after the row lock: a long-running transaction cannot extend the Undo window.
 v_now:=clock_timestamp();
 update public.team_tasks set status=v_status,close_note=coalesce(p_note,''),closed_by=v_actor,closed_at=v_now,
  undo_expires_at=v_now+interval '8 seconds',version=version+1,updated_at=v_now where id=p_id returning * into v_row;
 insert into public.team_task_events(task_id,action,note,actor_user_id,created_at,task_version)
 values(p_id,p_action,coalesce(p_note,''),v_actor,v_now,v_row.version);
 return v_row;
end $$;

create or replace function public.undo_team_task(p_id uuid,p_expected_version integer)
returns public.team_tasks language plpgsql security definer set search_path=public,pg_temp as $$
declare v_row public.team_tasks; v_close public.team_task_events; v_actor uuid:=auth.uid(); v_role text; v_now timestamptz;
begin
 if v_actor is null or public.inventory_active_staff() is not true then raise exception 'Active staff access is required' using errcode='42501'; end if;
 select role into v_role from public.staff where user_id=v_actor and active for share;
 if not found or public.inventory_active_staff() is not true then raise exception 'Active staff access is required' using errcode='42501'; end if;
 if p_id is null or p_expected_version is null or p_expected_version<2 then raise exception 'Closed task and its version are required'; end if;
 select * into v_row from public.team_tasks where id=p_id for update;
 if not found then raise exception 'Task not found'; end if;
 select * into v_close from public.team_task_events where task_id=p_id and task_version=p_expected_version
  and action in ('done','cancel') and actor_user_id=v_actor;
 if not found then raise exception 'Only your manual task close can be undone' using errcode='42501'; end if;
 if (v_close.action='done' and v_actor<>v_row.assignee_user_id or v_close.action='cancel' and v_actor<>v_row.assigned_by)
  and v_role is distinct from 'owner' then raise exception 'Your current access does not allow undoing this task close' using errcode='42501'; end if;
 -- Lost successful response: the same audited inverse remains retryable after its deadline.
 if v_row.status='open' and v_row.version::bigint=p_expected_version::bigint+1
  and v_row.closed_by is null and v_row.closed_at is null and v_row.close_note='' and v_row.undo_expires_at is null
  and exists(select 1 from public.team_task_events e where e.task_id=p_id and e.task_version=v_row.version
   and e.action='undo' and e.undoes_event_id=v_close.id and e.actor_user_id=v_actor
   and e.created_at=v_row.updated_at and e.created_at>=v_close.created_at and e.created_at<v_close.created_at+interval '8 seconds')
  then return v_row; end if;
 if v_row.version<>p_expected_version then raise exception 'Task changed; refresh'; end if;
 if v_row.status<>(case when v_close.action='done' then 'done' else 'cancelled' end)
  or v_row.closed_by is distinct from v_actor or v_row.closed_at is distinct from v_close.created_at
  or v_row.close_note is distinct from v_close.note
  or v_row.undo_expires_at is distinct from v_close.created_at+interval '8 seconds' then raise exception 'This manual task close is no longer current'; end if;
 v_now:=clock_timestamp();
 if v_now>=v_row.undo_expires_at or v_now<v_row.closed_at then raise exception 'The eight-second Undo period has ended'; end if;
 if v_row.version=2147483647 then raise exception 'Task version exhausted'; end if;
 update public.team_tasks set status='open',close_note='',closed_by=null,closed_at=null,undo_expires_at=null,
  version=version+1,updated_at=v_now where id=p_id returning * into v_row;
 insert into public.team_task_events(task_id,action,note,actor_user_id,created_at,task_version,undoes_event_id)
 values(p_id,'undo',case when v_close.action='done' then 'Undid Mark done' else 'Undid cancellation' end,v_actor,v_now,v_row.version,v_close.id);
 return v_row;
end $$;
revoke all on function public.close_team_task(uuid,integer,text,text),public.undo_team_task(uuid,integer) from public,anon;
grant execute on function public.close_team_task(uuid,integer,text,text),public.undo_team_task(uuid,integer) to authenticated;
commit;
