-- Aggregate report history under the caller's existing read policies. One result per person;
-- no event histories, staff-table access, workflow writes or permission changes.
begin;

create function public.report_work_summary(p_since timestamptz,p_until timestamptz,p_now timestamptz,p_today date)
returns jsonb language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare v_result jsonb;
begin
 if public.inventory_active_staff() is not true then raise exception 'Active staff access is required' using errcode='42501'; end if;
 if p_since is null or p_until is null or not isfinite(p_since) or not isfinite(p_until) or p_since>=p_until
  or p_now is null or not isfinite(p_now) or p_today is null or not isfinite(p_today) then
  raise exception 'Choose a valid report period' using errcode='22023';
 end if;
 with parts as (
  select w.assignee_user_id actor,count(*) finished,
   sum(greatest(0,floor(extract(epoch from w.closed_at)*1000)-floor(extract(epoch from w.created_at)*1000))) step_ms,
   0::bigint open_now,0::bigint overdue_now,null::numeric longest_ms,0::bigint delays
  from public.work_assignments w
  where w.closed_at>=p_since and w.closed_at<p_until and w.status in('done','handed_on') and w.assignee_user_id is not null
  group by w.assignee_user_id
  union all
  select w.assignee_user_id,0,0,count(*),count(*) filter(where case
    when d.expected_on is not null then d.expected_on<p_today
    when w.due_on is not null then w.due_on<p_today
    else floor(extract(epoch from p_now)*1000)-floor(extract(epoch from w.created_at)*1000)>172800000 end),
   max(floor(extract(epoch from p_now)*1000)-floor(extract(epoch from w.created_at)*1000)),0
  from public.work_assignments w
  -- Equal timestamps used the first id in the old id-ordered history request.
  left join lateral (select d.expected_on from public.work_delays d where d.assignment_id=w.id order by d.recorded_at desc,d.id asc limit 1) d on true
  where w.status='open' group by w.assignee_user_id
  union all
  select w.assignee_user_id,0,0,0,0,null,count(*)
  from public.work_delays d join public.work_assignments w on w.id=d.assignment_id
  where d.recorded_at>=p_since and d.recorded_at<p_until and w.assignee_user_id is not null
  group by w.assignee_user_id
 ), people as (
  select actor,sum(finished) finished,sum(step_ms) step_ms,sum(open_now) open_now,
   sum(overdue_now) overdue_now,max(longest_ms) longest_ms,sum(delays) delays
  from parts group by actor
 )
 select coalesce(jsonb_agg(jsonb_build_object('actor',p.actor,'department',coalesce(d.department,''),
  'finished',p.finished,'stepMs',p.step_ms,'open_now',p.open_now,'overdue_now',p.overdue_now,'longestMs',p.longest_ms,'delays',p.delays) order by p.actor),'[]'::jsonb)
 into v_result from people p left join public.staff_departments() d on d.user_id=p.actor;
 return v_result;
end $$;

create function public.report_activity_summary(p_since timestamptz,p_until timestamptz)
returns jsonb language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare v_result jsonb;
begin
 if public.inventory_active_staff() is not true then raise exception 'Active staff access is required' using errcode='42501'; end if;
 if p_since is null or p_until is null or not isfinite(p_since) or not isfinite(p_until) or p_since>=p_until then
  raise exception 'Choose a valid report period' using errcode='22023';
 end if;
 with events as (
  select e.actor_user_id actor,case when e.action='create' then 'inquiries'
   when e.action='qualify' or (e.action='assign' and e.from_stage='inquiry') then 'qualified'
   when e.action='won' then 'won' when e.action='lost' then 'lost' end kind
  from public.sales_lead_events e where e.created_at>=p_since and e.created_at<p_until
  union all
  select e.actor_user_id,case when coalesce(e.from_status,'')='' and e.to_status='draft' then 'proformas'
   when e.to_status='sent' and e.from_status is distinct from 'sent' then 'sent'
   when e.to_status='accepted' and e.from_status is distinct from 'accepted' then 'accepted' end
  from public.sales_proforma_events e where e.created_at>=p_since and e.created_at<p_until
  union all
  select e.actor_user_id,'delivered' from public.sales_delivery_events e
  where e.created_at>=p_since and e.created_at<p_until and e.to_status='delivered' and e.from_status is distinct from 'delivered'
  union all
  select e.actor_user_id,'serviceReports' from public.service_case_events e
  where e.created_at>=p_since and e.created_at<p_until and e.to_status='completed' and e.from_status is distinct from 'completed'
  union all
  select e.actor_user_id,case when e.action='create' then 'pendingCreated' when e.action='fulfil' then 'pendingFulfilled' end
  from public.pending_stock_events e where e.created_at>=p_since and e.created_at<p_until
  union all
  select w.closed_by,'stepsDone' from public.work_assignments w
  where w.closed_at>=p_since and w.closed_at<p_until and w.status='done'
 ), people as (
  select actor,count(*) filter(where kind='inquiries') inquiries,count(*) filter(where kind='qualified') qualified,
   count(*) filter(where kind='won') won,count(*) filter(where kind='lost') lost,count(*) filter(where kind='proformas') proformas,
   count(*) filter(where kind='sent') sent,count(*) filter(where kind='accepted') accepted,count(*) filter(where kind='delivered') delivered,
   count(*) filter(where kind='serviceReports') "serviceReports",count(*) filter(where kind='pendingCreated') "pendingCreated",
   count(*) filter(where kind='pendingFulfilled') "pendingFulfilled",count(*) filter(where kind='stepsDone') "stepsDone"
  from events where actor is not null and kind is not null group by actor
 )
 select coalesce(jsonb_agg(to_jsonb(p) order by p.actor),'[]'::jsonb) into v_result from people p;
 return v_result;
end $$;

revoke all on function public.report_work_summary(timestamptz,timestamptz,timestamptz,date),public.report_activity_summary(timestamptz,timestamptz) from public,anon;
grant execute on function public.report_work_summary(timestamptz,timestamptz,timestamptz,date),public.report_activity_summary(timestamptz,timestamptz) to authenticated;
commit;
