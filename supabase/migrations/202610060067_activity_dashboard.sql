-- Dashboard: one read that counts what is open now, what was created in a chosen period and what was finished in a
-- chosen period, so the Dashboard page makes a single request. Counts only, never amounts. The function runs as the
-- signed-in person (security invoker), so every count goes through the same read rules as the lists: a count from an
-- area the person has no access to comes back as null and the page leaves that card out instead of showing 0.
-- Days are Dar es Salaam days (UTC+3). Card-by-card mapping: docs/DASHBOARD-CARDS.md.
-- Rollback: drop function public.dashboard_counts(date,date,date,date) in a forward migration; nothing else changes.
begin;

create function public.dashboard_counts(p_periodic_from date, p_periodic_to date, p_result_from date, p_result_to date)
returns jsonb language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare
 v_today date := (now() at time zone 'Africa/Dar_es_Salaam')::date;
 v_leads boolean := public.has_access('leads');
 v_service boolean := public.has_access('service');
 v_quotes boolean := public.has_access('proformas');
 v_clients boolean := public.is_active_staff();
 v_p_start timestamptz; v_p_end timestamptz; v_r_start timestamptz; v_r_end timestamptz;
 v_late jsonb; v_due jsonb;
begin
 if not public.inventory_active_staff() then raise exception 'Active staff access is required' using errcode='42501'; end if;
 if p_periodic_from is null or p_periodic_to is null or p_result_from is null or p_result_to is null then
  raise exception 'Choose a start and an end date';
 end if;
 if p_periodic_from > p_periodic_to or p_result_from > p_result_to then raise exception 'The start date must be on or before the end date'; end if;
 if p_periodic_to - p_periodic_from > 366 or p_result_to - p_result_from > 366 then raise exception 'Choose a period of one year or less'; end if;
 -- Midnight to midnight in Dar es Salaam; the end is the next day's midnight (exclusive).
 v_p_start := p_periodic_from::timestamp at time zone 'Africa/Dar_es_Salaam';
 v_p_end := (p_periodic_to + 1)::timestamp at time zone 'Africa/Dar_es_Salaam';
 v_r_start := p_result_from::timestamp at time zone 'Africa/Dar_es_Salaam';
 v_r_end := (p_result_to + 1)::timestamp at time zone 'Africa/Dar_es_Salaam';

 -- Overdue and due today, per kind of work. An order step's date is its latest reported delay, else its due date.
 select jsonb_build_object(
  'leads', case when v_leads then (select count(*) from public.sales_leads where stage not in ('won','lost') and next_action_on < v_today) end,
  'tasks', (select count(*) from public.team_tasks where status='open' and (due_at at time zone 'Africa/Dar_es_Salaam')::date < v_today),
  'steps', (select count(*) from public.work_assignments w where w.status='open' and coalesce((select d.expected_on from public.work_delays d
            where d.assignment_id=w.id order by d.recorded_at desc, d.id desc limit 1), w.due_on) < v_today),
  'service', case when v_service then (select count(*) from public.service_cases where status='scheduled' and scheduled_for < v_today) end)
 into v_late;
 select jsonb_build_object(
  'leads', case when v_leads then (select count(*) from public.sales_leads where stage not in ('won','lost') and next_action_on = v_today) end,
  'tasks', (select count(*) from public.team_tasks where status='open' and (due_at at time zone 'Africa/Dar_es_Salaam')::date = v_today),
  'steps', (select count(*) from public.work_assignments w where w.status='open' and coalesce((select d.expected_on from public.work_delays d
            where d.assignment_id=w.id order by d.recorded_at desc, d.id desc limit 1), w.due_on) = v_today),
  'service', case when v_service then (select count(*) from public.service_cases where status='scheduled' and scheduled_for = v_today) end)
 into v_due;

 return jsonb_build_object(
  'today', v_today,
  'open', jsonb_build_object(
   'overdue', (select sum(value::bigint) from jsonb_each_text(v_late) where value is not null),
   'overdue_parts', v_late,
   'due_today', (select sum(value::bigint) from jsonb_each_text(v_due) where value is not null),
   'due_today_parts', v_due,
   'opportunities', case when v_leads then (select count(*) from public.sales_leads where stage not in ('won','lost')) end,
   'cases', case when v_service then (select count(*) from public.service_cases where case_type='service' and source_case_id is null and status not in ('completed','cancelled')) end,
   'accounts', case when v_clients then (select count(*) from public.organizations where deleted_at is null and parent_id is null) end,
   'scheduled_service', case when v_service then (select count(*) from public.service_cases where case_type='service' and status='scheduled') end,
   'quotes', case when v_quotes then (select count(*) from public.sales_proformas where deleted_at is null and status in ('draft','sent')) end,
   'webqueries', case when v_leads then (select count(*) from public.customer_requests where kind in ('inquiry','quote') and status in ('received','in_progress')) end,
   'contacts', case when v_clients then (select count(*) from public.contacts where deleted_at is null and status<>'incorrect') end,
   'tasks', (select count(*) from public.team_tasks where status='open')),
  'periodic', jsonb_build_object(
   'opportunities', case when v_leads then (select count(*) from public.sales_leads where created_at >= v_p_start and created_at < v_p_end) end,
   'cases', case when v_service then (select count(*) from public.service_cases where case_type='service' and source_case_id is null and created_at >= v_p_start and created_at < v_p_end) end,
   'scheduled_service', case when v_service then (select count(distinct e.case_id) from public.service_case_events e join public.service_cases c on c.id=e.case_id
     where c.case_type='service' and e.to_status='scheduled' and e.from_status is distinct from 'scheduled' and e.created_at >= v_p_start and e.created_at < v_p_end) end,
   'quotes', case when v_quotes then (select count(*) from public.sales_proformas where deleted_at is null and created_at >= v_p_start and created_at < v_p_end) end,
   'webqueries', case when v_leads then (select count(*) from public.customer_requests where kind in ('inquiry','quote') and created_at >= v_p_start and created_at < v_p_end) end,
   'tasks', (select count(*) from public.team_tasks where created_at >= v_p_start and created_at < v_p_end)),
  'result', jsonb_build_object(
   'cases_cancelled', case when v_service then (select count(distinct e.case_id) from public.service_case_events e join public.service_cases c on c.id=e.case_id
     where c.case_type='service' and c.source_case_id is null and c.status='cancelled' and e.to_status='cancelled' and e.created_at >= v_r_start and e.created_at < v_r_end) end,
   'cases_resolved', case when v_service then (select count(*) from public.service_cases where case_type='service' and source_case_id is null and status='completed' and completed_at >= v_r_start and completed_at < v_r_end) end,
   -- A lead counts once, and only while it is still won (or lost): a lost lead that was reopened is not lost.
   'opportunities_won', case when v_leads then (select count(distinct e.lead_id) from public.sales_lead_events e join public.sales_leads l on l.id=e.lead_id
     where e.action='won' and l.stage='won' and e.created_at >= v_r_start and e.created_at < v_r_end) end,
   'opportunities_lost', case when v_leads then (select count(distinct e.lead_id) from public.sales_lead_events e join public.sales_leads l on l.id=e.lead_id
     where e.action='lost' and l.stage='lost' and e.created_at >= v_r_start and e.created_at < v_r_end) end,
   'quotes_closed', case when v_quotes then (select count(distinct e.proforma_id) from public.sales_proforma_events e join public.sales_proformas p on p.id=e.proforma_id
     where p.deleted_at is null and p.status in ('accepted','rejected','cancelled') and e.to_status in ('accepted','rejected','cancelled') and e.created_at >= v_r_start and e.created_at < v_r_end) end,
   'tasks_completed', (select count(*) from public.team_tasks where status='done' and closed_at >= v_r_start and closed_at < v_r_end),
   'webqueries_closed', case when v_leads then (select count(*) from public.customer_requests where kind in ('inquiry','quote') and status in ('resolved','closed') and closed_at >= v_r_start and closed_at < v_r_end) end));
end $$;

revoke all on function public.dashboard_counts(date,date,date,date) from public, anon;
grant execute on function public.dashboard_counts(date,date,date,date) to authenticated;
commit;
