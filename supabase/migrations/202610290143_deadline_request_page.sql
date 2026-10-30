begin;

create function public.deadline_request_page(p_page integer default 0,p_task_ids uuid[] default '{}'::uuid[])
returns jsonb language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare v_result jsonb;v_ids uuid[];v_identities jsonb:='[]'::jsonb;
begin
 if public.inventory_active_staff() is not true then raise exception 'Active staff access is required' using errcode='42501'; end if;
 if p_page is null or p_page<0 or p_page>1000000 then raise exception 'Choose a valid deadline-request page'; end if;
 if p_task_ids is null or cardinality(p_task_ids)>80 or array_position(p_task_ids,null) is not null then raise exception 'Choose at most 80 visible tasks'; end if;
 with visible as materialized (
  select r.id,r.task_id,r.requested_by,r.old_due_at,r.requested_due_at,r.reason,r.status,r.created_at
  from public.team_task_reschedule_requests r where r.status='pending'
 ), decisions as materialized (
  select * from visible where requested_by<>auth.uid()
 ), totals as (
  select count(*) as total,greatest(1,(count(*)+19)/20) as pages,least(p_page,greatest(0,(count(*)-1)/20)) as page from decisions
 ), page_rows as (
  select * from decisions order by created_at,id limit 20 offset (select page*20 from totals)
 ), combined as (
  select * from page_rows union all select * from visible where requested_by=auth.uid() and task_id=any(p_task_ids)
 )
 select jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(r) order by created_at,id) from combined r),'[]'::jsonb),
  'total',total,'page',page,'pages',pages),(select array_agg(id) from combined)
 into v_result,v_ids from totals;
 -- Reuse the existing request-specific identity boundary for approvers who
 -- cannot read the task itself. No broader task columns are exposed.
 if coalesce(cardinality(v_ids),0)>0 then
  select coalesce(jsonb_agg(to_jsonb(i)),'[]'::jsonb) into v_identities from public.deadline_request_task_identities(v_ids) i;
 end if;
 return v_result||jsonb_build_object('identities',v_identities);
end $$;
revoke all on function public.deadline_request_page(integer,uuid[]) from public,anon;
grant execute on function public.deadline_request_page(integer,uuid[]) to authenticated;
commit;
