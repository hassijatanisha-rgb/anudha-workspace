begin;

-- Keep the existing alert side effects and caller-scoped counts in one bell refresh.
create function public.notification_summary(
 p_tasks_since timestamptz default null, p_work_since timestamptz default null,
 p_results_since timestamptz default null
) returns jsonb language plpgsql volatile security invoker set search_path=public,pg_temp as $$
declare
 v_actor uuid:=auth.uid(); v_role text;
 v_tasks bigint; v_work bigint; v_results bigint; v_notices bigint;
begin
 if v_actor is null or not public.inventory_active_staff() then
  raise exception 'Active staff access is required' using errcode='42501';
 end if;
 select role into v_role from public.staff where user_id=v_actor and active;
 if not found then raise exception 'Active staff access is required' using errcode='42501'; end if;
 -- Alert failures have never blocked the bell's independent count reads.
 if v_role in ('owner','head') then
  begin perform public.packing_raise_overdue_alerts(); exception when others then null; end;
 end if;
 begin perform public.raise_team_task_overdue_alerts(); exception when others then null; end;
 -- A failed kind stays unknown (null); the other kinds still return their counts.
 begin
  select count(*) into v_tasks from public.team_tasks
   where assignee_user_id=v_actor and assigned_by<>v_actor and status='open'
    and (p_tasks_since is null or created_at>p_tasks_since);
 exception when others then v_tasks:=null; end;
 begin
  select count(*) into v_work from public.work_assignments
   where assignee_user_id=v_actor and assigned_by<>v_actor and status='open'
    and (p_work_since is null or created_at>p_work_since);
 exception when others then v_work:=null; end;
 begin
  select count(*) into v_results from public.team_tasks
   where assigned_by=v_actor and assignee_user_id<>v_actor and closed_by<>v_actor
    and status in ('done','cancelled') and closed_at>coalesce(p_results_since,now()-interval '7 days');
 exception when others then v_results:=null; end;
 begin
  select count(*) into v_notices from public.work_notices where user_id=v_actor and read_at is null;
 exception when others then v_notices:=null; end;
 return jsonb_build_object('tasks',v_tasks,'work',v_work,'results',v_results,'notices',v_notices);
end $$;
revoke all on function public.notification_summary(timestamptz,timestamptz,timestamptz) from public,anon;
grant execute on function public.notification_summary(timestamptz,timestamptz,timestamptz) to authenticated;
commit;
