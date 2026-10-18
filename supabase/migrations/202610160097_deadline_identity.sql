begin;

-- Approvers can read a deadline request without general access to its original
-- task. Expose only that task's identity through the request's existing boundary.
create function public.deadline_request_task_identities(p_request_ids uuid[])
returns table(request_id uuid,task_number text,task_title text)
language plpgsql stable security definer
set search_path=public,pg_temp
as $$
begin
 if not public.inventory_active_staff() then raise exception 'Active staff access is required' using errcode='42501'; end if;
 if p_request_ids is null or cardinality(p_request_ids) not between 1 and 100 then
  raise exception 'Choose between 1 and 100 deadline requests';
 end if;
 return query
 select r.id,t.task_number,t.title
 from public.team_task_reschedule_requests r
 join public.team_tasks t on t.id=r.task_id
 where r.id=any(p_request_ids)
 and (r.requested_by=auth.uid() or public.inventory_owner()
  or exists(select 1 from public.team_tasks approval where approval.id=any(r.approval_task_ids) and approval.assignee_user_id=auth.uid()));
end;
$$;
revoke all on function public.deadline_request_task_identities(uuid[]) from public,anon;
grant execute on function public.deadline_request_task_identities(uuid[]) to authenticated;

commit;
