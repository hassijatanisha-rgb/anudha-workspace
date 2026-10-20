-- Keep progress and assignment instructions as permanent task history.
-- Older tasks get a current-instructions baseline; earlier overwritten details cannot be reconstructed.
-- Rollback: revoke append_team_task_progress in a forward migration; preserve all history.
begin;

alter table public.team_task_events add column if not exists old_assignment jsonb, add column if not exists new_assignment jsonb;
alter table public.team_task_events drop constraint team_task_events_action_check;
alter table public.team_task_events add constraint team_task_events_action_check
 check (action in ('create','edit','done','cancel','reschedule','progress','assignment'));

-- Capture at the task write boundary, including assignments created by existing automatic workflows.
-- The original save, deadline and close functions retain their authorization, locks and version checks.
create or replace function public.capture_team_task_assignment()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_old jsonb; v_new jsonb;
begin
 v_new := jsonb_build_object('title',new.title,'details',new.details,'urgency',new.urgency,'due_at',new.due_at,
  'assignee_user_id',new.assignee_user_id,'assigned_by',new.assigned_by);
 if tg_op='UPDATE' then
  if (new.title,new.details,new.urgency,new.due_at,new.assignee_user_id,new.assigned_by)
    is not distinct from (old.title,old.details,old.urgency,old.due_at,old.assignee_user_id,old.assigned_by) then return new; end if;
  v_old := jsonb_build_object('title',old.title,'details',old.details,'urgency',old.urgency,'due_at',old.due_at,
   'assignee_user_id',old.assignee_user_id,'assigned_by',old.assigned_by);
 end if;
 insert into public.team_task_events(task_id,action,note,actor_user_id,old_assignment,new_assignment)
 values(new.id,'assignment',case when tg_op='INSERT' then 'Original assignment' else 'Assignment changed' end,
  coalesce(auth.uid(),new.assigned_by),v_old,v_new);
 return new;
end $$;
revoke all on function public.capture_team_task_assignment() from public,anon,authenticated;
drop trigger if exists team_task_assignment_history on public.team_tasks;
create trigger team_task_assignment_history after insert or update on public.team_tasks
 for each row execute function public.capture_team_task_assignment();

insert into public.team_task_events(task_id,action,note,actor_user_id,new_assignment)
select t.id,'assignment','Saved instructions when history began',t.assigned_by,
 jsonb_build_object('title',t.title,'details',t.details,'urgency',t.urgency,'due_at',t.due_at,
  'assignee_user_id',t.assignee_user_id,'assigned_by',t.assigned_by)
from public.team_tasks t
where not exists(select 1 from public.team_task_events e where e.task_id=t.id and e.action='assignment');

create or replace function public.append_team_task_progress(p_id uuid,p_task_id uuid,p_note text)
returns public.team_task_events language plpgsql security definer set search_path=public,pg_temp as $$
declare v_task public.team_tasks; v_event public.team_task_events; v_note text := trim(coalesce(p_note,''));
begin
 if auth.uid() is null or public.inventory_active_staff() is not true then raise exception 'Active staff access is required' using errcode='42501'; end if;
 if p_id is null or p_task_id is null then raise exception 'Comment request and task are required'; end if;
 if length(v_note) not between 1 and 1000 then raise exception 'Write a progress comment (1 to 1000 characters)'; end if;
 select * into v_task from public.team_tasks where id=p_task_id for update;
 if not found then raise exception 'Task unavailable' using errcode='42501'; end if;
 if auth.uid() not in (v_task.assignee_user_id,v_task.assigned_by) and public.inventory_owner() is not true then
  raise exception 'Only the person doing the task, its giver or the owner can comment' using errcode='42501';
 end if;
 select * into v_event from public.team_task_events where id=p_id;
 if found then
  if v_event.task_id=p_task_id and v_event.action='progress' and v_event.actor_user_id=auth.uid() and v_event.note=v_note then return v_event; end if;
  raise exception 'Comment request identifier already used';
 end if;
 if v_task.status<>'open' then raise exception 'This task is already closed'; end if;
 insert into public.team_task_events(id,task_id,action,note,actor_user_id)
 values(p_id,p_task_id,'progress',v_note,auth.uid()) returning * into v_event;
 return v_event;
end $$;
revoke all on function public.append_team_task_progress(uuid,uuid,text) from public,anon;
grant execute on function public.append_team_task_progress(uuid,uuid,text) to authenticated;
commit;
