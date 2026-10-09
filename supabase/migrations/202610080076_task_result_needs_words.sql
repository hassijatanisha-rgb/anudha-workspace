-- My tasks: "Mark done" needs a short result so the person who gave the task sees what happened. The screen refused
-- junk such as "xxx" or "ok done", but the database accepted any note, so a retried or scripted save could close a task
-- with "xxx". The same rule is now checked here: at least 3 real words (2+ letters or digits, not one repeated letter,
-- not ok/done/yes/test…). Cancelling is unchanged. Otherwise unchanged from migration 056.
begin;
create or replace function public.team_task_result_ok(p_note text) returns boolean
language sql immutable set search_path to 'pg_catalog' as $$
 select count(*)>=3 from regexp_matches(lower(coalesce(p_note,'')),'[a-z0-9À-ɏ]{2,}','g') as m(w)
 where m.w[1] !~ '^(.)\1+$'
   and m.w[1] <> all(array['ok','okay','done','na','nil','none','yes','no','test','finished','complete','completed'])
$$;

create or replace function public.close_team_task(p_id uuid, p_expected_version integer, p_action text, p_note text default ''::text)
 returns public.team_tasks language plpgsql security definer set search_path to 'public','pg_temp' as $function$
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
 if p_action = 'done' and not public.team_task_result_ok(p_note) then
  raise exception 'Write what you did and what the result was, in a few words (for example: Called Nisha, wants 2 ultrasound quotes).';
 end if;
 update public.team_tasks set status=v_status,close_note=coalesce(p_note,''),
  closed_by=auth.uid(),closed_at=now(),version=version+1,updated_at=now() where id = p_id returning * into v_row;
 insert into public.team_task_events(task_id,action,note,actor_user_id) values(v_row.id,p_action,coalesce(p_note,''),auth.uid());
 return v_row;
end $function$;
revoke all on function public.team_task_result_ok(text) from public,anon;
grant execute on function public.team_task_result_ok(text) to authenticated;
commit;
