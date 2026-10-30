begin;
set local lock_timeout='2s';

-- Each visible job needs only its latest audit entry, not its complete history.
create index service_case_events_latest_idx on public.service_case_events(case_id,created_at desc,id desc);

create function public.service_case_page(p_case_type text default 'installation',p_page integer default 0,p_case_id uuid default null)
returns jsonb language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare v_result jsonb;
begin
 if not public.inventory_active_staff() or not public.has_access('service') then
  raise exception 'Service access is required' using errcode='42501';
 end if;
 if p_case_type is null or p_case_type not in ('installation','service') then raise exception 'Choose a valid Service case type'; end if;
 if p_page is null or p_page<0 or p_page>1000000 then raise exception 'Choose a valid Service page'; end if;
 with scope as materialized (
  select c.*,c.status not in ('completed','cancelled') and c.reused_case_id is null and (c.assigned_user_id is null or c.scheduled_for is null) as needs_planning,
   c.status in ('completed','cancelled') as closed from public.service_cases c where c.case_type=p_case_type
 ), matches as materialized (
  select * from scope where p_case_id is null or id=p_case_id
 ), totals as (
  select count(*) as total,greatest(1,(count(*)+49)/50) as pages,least(p_page,greatest(0,(count(*)-1)/50)) as page from matches
 ), page_rows as materialized (
  select * from matches order by needs_planning desc,closed,created_at,id limit 50 offset (select page*50 from totals)
 ), dates as (select (now() at time zone 'Africa/Dar_es_Salaam')::date as today)
 select jsonb_build_object(
  'rows',coalesce((select jsonb_agg((to_jsonb(c)-'needs_planning'-'closed')||jsonb_build_object('page_summary',true,
   'display',jsonb_build_object('product_name',coalesce(case when review.id is not null then review.name else p.name end,'Product unavailable'),
    'organization_name',coalesce(site.name,'Client unavailable'),'organization_location',coalesce(site.location,''),'customer_name',coalesce(customer.name,'Client unavailable'),
    'serial_number',coalesce(a.serial_number,''),'installation_location',coalesce(a.installation_location,'')),
   'report_summary',report.summary,'latest_event',event.summary,'coordinator',handoff.summary,'coordinator_delay',delay.summary)
   order by c.needs_planning desc,c.closed,c.created_at,c.id)
   from page_rows c
   left join public.equipment_assets a on a.id=c.asset_id
   left join public.organizations site on site.id=coalesce(c.site_organization_id,c.organization_id) and site.deleted_at is null
   left join public.organizations customer on customer.id=c.organization_id and customer.deleted_at is null
   left join public.products p on p.id=c.product_id and p.deleted_at is null
   left join lateral (select r.id,r.name from public.product_detail_reviews r where r.product_id=p.id order by r.version desc limit 1) review on true
   left join lateral (select jsonb_build_object('id',r.id,'actual_work_date',r.actual_work_date,'next_maintenance_date',r.next_maintenance_date,'service_charge_minor',r.service_charge_minor,'currency',r.currency) as summary from public.service_reports r where r.case_id=c.id limit 1) report on true
   left join lateral (select jsonb_build_object('id',e.id,'to_status',e.to_status,'actor_user_id',e.actor_user_id,'created_at',e.created_at) as summary from public.service_case_events e where e.case_id=c.id order by e.created_at desc,e.id desc limit 1) event on true
   left join lateral (select w.id,jsonb_build_object('id',w.id,'status',w.status,'assignee_user_id',w.assignee_user_id,'assigned_by',w.assigned_by,'task',w.task,'created_at',w.created_at,'due_on',w.due_on) as summary from public.work_assignments w where w.record_type='service' and w.record_id=c.id and w.status='open' order by w.created_at desc,w.id desc limit 1) handoff on true
   left join lateral (select jsonb_build_object('reason',d.reason,'expected_on',d.expected_on) as summary from public.work_delays d where d.assignment_id=handoff.id order by d.recorded_at desc,d.id desc limit 1) delay on true),'[]'::jsonb),
  'total',totals.total,'page',totals.page,'pages',totals.pages,
  'metrics',(select jsonb_build_object(
   'awaiting_engineer',count(*) filter(where needs_planning and assigned_user_id is null),
   'awaiting_date',count(*) filter(where needs_planning and scheduled_for is null),
   'oldest_engineer_days',max(greatest(0,today-(created_at at time zone 'Africa/Dar_es_Salaam')::date)) filter(where needs_planning and assigned_user_id is null),
   'oldest_date_days',max(greatest(0,today-(created_at at time zone 'Africa/Dar_es_Salaam')::date)) filter(where needs_planning and scheduled_for is null),
   'due_30',count(*) filter(where status='scheduled' and scheduled_for between today and today+30),
   'overdue',count(*) filter(where status='scheduled' and scheduled_for<today)) from scope cross join dates)
 ) into v_result from totals;
 return v_result;
end $$;
revoke all on function public.service_case_page(text,integer,uuid) from public,anon;
grant execute on function public.service_case_page(text,integer,uuid) to authenticated;
commit;
