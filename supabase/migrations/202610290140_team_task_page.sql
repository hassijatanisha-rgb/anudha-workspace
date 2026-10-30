-- Bounded personal task groups. Details and append-only history are read only when a task is opened.
-- Match the client's millisecond comparisons and elapsed-day windows without rounding stored deadlines.
begin;
create or replace function public.team_task_page(p_for_me_page integer default 0,p_gave_page integer default 0,p_results_page integer default 0,p_finished_page integer default 0)
returns jsonb language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare v_now timestamptz:=date_trunc('milliseconds',now()); v_actor uuid:=auth.uid(); v_result jsonb;
begin
 if not public.inventory_active_staff() then raise exception 'Active staff access is required'; end if;
 if p_for_me_page is null or p_gave_page is null or p_results_page is null or p_finished_page is null
  or least(p_for_me_page,p_gave_page,p_results_page,p_finished_page)<0
  or greatest(p_for_me_page,p_gave_page,p_results_page,p_finished_page)>1000000 then raise exception 'Invalid task page'; end if;
 with requested(group_key,requested_page) as (values ('forMe',p_for_me_page),('gave',p_gave_page),('results',p_results_page),('finished',p_finished_page)),
 visible as materialized (
  select id,task_number,title,urgency,due_at,assignee_user_id,assigned_by,status,closed_at,
   case when status='open' and assignee_user_id=v_actor then 'forMe'
    when status='open' then 'gave'
    when assigned_by=v_actor and assignee_user_id<>v_actor and date_trunc('milliseconds',closed_at)>v_now-interval '168 hours' then 'results'
    else 'finished' end as group_key
  from public.team_tasks
  where (assignee_user_id=v_actor or assigned_by=v_actor) and (status='open' or closed_at>=v_now-interval '720 hours')
 ), totals as (
  select r.group_key,count(v.id)::integer as total,greatest(1,ceil(count(v.id)/20.0)::integer) as pages,
   least(r.requested_page,greatest(0,ceil(count(v.id)/20.0)::integer-1)) as page
  from requested r left join visible v using(group_key) group by r.group_key,r.requested_page
 ), ranked as (
  select v.*,row_number() over(partition by group_key order by
   case when group_key='results' then date_trunc('milliseconds',closed_at) end desc,
   case urgency when 'do_now' then 0 when 'urgent' then 1 when 'normal' then 2 else 3 end,
   date_trunc('milliseconds',due_at),id) as position
  from visible v
 )
 select jsonb_build_object('as_of',v_now,'groups',jsonb_object_agg(t.group_key,jsonb_build_object('total',t.total,'page',t.page,'pages',t.pages,
  'rows',coalesce((select jsonb_agg(to_jsonb(r)-'group_key'-'position' order by r.position) from ranked r
   where r.group_key=t.group_key and r.position>t.page*20 and r.position<=(t.page+1)*20),'[]'::jsonb)))) into v_result from totals t;
 return v_result;
end $$;
revoke all on function public.team_task_page(integer,integer,integer,integer) from public,anon;
grant execute on function public.team_task_page(integer,integer,integer,integer) to authenticated;
commit;
