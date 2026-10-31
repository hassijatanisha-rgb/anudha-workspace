-- Dashboard's large expression triggered LLVM compilation on the live dataset:
-- EXPLAIN ANALYZE: 5958ms with JIT, 145ms with transaction-local JIT off.
-- Limit that setting to these read-only functions. All reads still use caller RLS;
-- there is no shared/user-independent cache and no change to permissions.
-- Split counts into small RLS plans to bound first-call planning overhead.
-- The browser retains only period totals for 60 seconds and refreshes open work.
-- Rollback: restore migration067 dashboard_counts; drop dashboard_open_counts and contacts_dashboard_active_idx.
begin;

-- The live contact count scanned 9,568 buffers (388ms). This partial covering
-- index used 548 buffers (18ms) without changing caller RLS or count semantics.
set local lock_timeout='2s';
create index contacts_dashboard_active_idx on public.contacts(id)
 where deleted_at is null and status<>'incorrect';

create function public.dashboard_open_counts()
returns jsonb language plpgsql stable security invoker set search_path=public,pg_temp set jit=off as $$
declare
 v_today date := (now() at time zone 'Africa/Dar_es_Salaam')::date;
 v_leads boolean := public.has_access('leads');
 v_service boolean := public.has_access('service');
 v_quotes boolean := public.has_access('proformas');
 v_clients boolean := public.is_active_staff();
 v_late jsonb; v_due jsonb; v_count_1 bigint;
 v_count_2 bigint;
 v_count_3 bigint;
 v_count_4 bigint;
 v_count_5 bigint;
 v_count_6 bigint;
 v_count_7 bigint;
 v_count_8 bigint;
 v_count_9 bigint;
 v_count_10 bigint;
 v_count_11 bigint;
 v_count_12 bigint;
 v_count_13 bigint;
 v_count_14 bigint;
 v_count_15 bigint;
 v_count_16 bigint;
 v_count_17 bigint;
 v_count_18 bigint;

begin
 if not public.inventory_active_staff() then raise exception 'Active staff access is required' using errcode='42501'; end if;
 -- Overdue and due today, per kind of work. An order step's date is its latest reported delay, else its due date.
 if v_leads then v_count_1 := (select count(*) from public.sales_leads where stage not in ('won','lost') and next_action_on < v_today); end if;
 v_count_2 := (select count(*) from public.team_tasks where status='open' and due_at < v_today::timestamp at time zone 'Africa/Dar_es_Salaam');
 v_count_3 := (select count(*) from public.work_assignments w where w.status='open' and coalesce((select d.expected_on from public.work_delays d
            where d.assignment_id=w.id order by d.recorded_at desc, d.id desc limit 1), w.due_on) < v_today);
 if v_service then v_count_4 := (select count(*) from public.service_cases where status='scheduled' and scheduled_for < v_today); end if;
 select jsonb_build_object(
  'leads', case when v_leads then v_count_1 end,
  'tasks', v_count_2,
  'steps', v_count_3,
  'service', case when v_service then v_count_4 end)
 into v_late;
 if v_leads then v_count_5 := (select count(*) from public.sales_leads where stage not in ('won','lost') and next_action_on = v_today); end if;
 v_count_6 := (select count(*) from public.team_tasks where status='open' and due_at >= v_today::timestamp at time zone 'Africa/Dar_es_Salaam' and due_at < (v_today+1)::timestamp at time zone 'Africa/Dar_es_Salaam');
 v_count_7 := (select count(*) from public.work_assignments w where w.status='open' and coalesce((select d.expected_on from public.work_delays d
            where d.assignment_id=w.id order by d.recorded_at desc, d.id desc limit 1), w.due_on) = v_today);
 if v_service then v_count_8 := (select count(*) from public.service_cases where status='scheduled' and scheduled_for = v_today); end if;
 select jsonb_build_object(
  'leads', case when v_leads then v_count_5 end,
  'tasks', v_count_6,
  'steps', v_count_7,
  'service', case when v_service then v_count_8 end)
 into v_due;

 v_count_9 := (select sum(value::bigint) from jsonb_each_text(v_late) where value is not null);
 v_count_10 := (select sum(value::bigint) from jsonb_each_text(v_due) where value is not null);
 if v_leads then v_count_11 := (select count(*) from public.sales_leads where stage not in ('won','lost')); end if;
 if v_service then v_count_12 := (select count(*) from public.service_cases where case_type='service' and source_case_id is null and status not in ('completed','cancelled')); end if;
 if v_clients then v_count_13 := (select count(*) from public.organizations where deleted_at is null and parent_id is null); end if;
 if v_service then v_count_14 := (select count(*) from public.service_cases where case_type='service' and status='scheduled'); end if;
 if v_quotes then v_count_15 := (select count(*) from public.sales_proformas where deleted_at is null and status in ('draft','sent')); end if;
 if v_leads then v_count_16 := (select count(*) from public.customer_requests where kind in ('inquiry','quote') and status in ('received','in_progress')); end if;
 if v_clients then v_count_17 := (select count(*) from public.contacts where deleted_at is null and status<>'incorrect'); end if;
 v_count_18 := (select count(*) from public.team_tasks where status='open');
 return jsonb_build_object(
  'today', v_today,
  'open', jsonb_build_object(
   'overdue', v_count_9,
   'overdue_parts', v_late,
   'due_today', v_count_10,
   'due_today_parts', v_due,
   'opportunities', case when v_leads then v_count_11 end,
   'cases', case when v_service then v_count_12 end,
   'accounts', case when v_clients then v_count_13 end,
   'scheduled_service', case when v_service then v_count_14 end,
   'quotes', case when v_quotes then v_count_15 end,
   'webqueries', case when v_leads then v_count_16 end,
   'contacts', case when v_clients then v_count_17 end,
   'tasks', v_count_18));
end $$;

create or replace function public.dashboard_counts(p_periodic_from date, p_periodic_to date, p_result_from date, p_result_to date)
returns jsonb language plpgsql stable security invoker set search_path=public,pg_temp set jit=off as $$
declare
 v_leads boolean := public.has_access('leads');
 v_service boolean := public.has_access('service');
 v_quotes boolean := public.has_access('proformas');
 v_clients boolean := public.is_active_staff();
 v_p_start timestamptz; v_p_end timestamptz; v_r_start timestamptz; v_r_end timestamptz; v_count_1 bigint;
 v_count_2 bigint;
 v_count_3 bigint;
 v_count_4 bigint;
 v_count_5 bigint;
 v_count_6 bigint;
 v_count_7 bigint;
 v_count_8 bigint;
 v_count_9 bigint;
 v_count_10 bigint;
 v_count_11 bigint;
 v_count_12 bigint;
 v_count_13 bigint;

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

 if v_leads then v_count_1 := (select count(*) from public.sales_leads where created_at >= v_p_start and created_at < v_p_end); end if;
 if v_service then v_count_2 := (select count(*) from public.service_cases where case_type='service' and source_case_id is null and created_at >= v_p_start and created_at < v_p_end); end if;
 if v_service then v_count_3 := (select count(distinct e.case_id) from public.service_case_events e join public.service_cases c on c.id=e.case_id
     where c.case_type='service' and e.to_status='scheduled' and e.from_status is distinct from 'scheduled' and e.created_at >= v_p_start and e.created_at < v_p_end); end if;
 if v_quotes then v_count_4 := (select count(*) from public.sales_proformas where deleted_at is null and created_at >= v_p_start and created_at < v_p_end); end if;
 if v_leads then v_count_5 := (select count(*) from public.customer_requests where kind in ('inquiry','quote') and created_at >= v_p_start and created_at < v_p_end); end if;
 v_count_6 := (select count(*) from public.team_tasks where created_at >= v_p_start and created_at < v_p_end);
 if v_service then v_count_7 := (select count(distinct e.case_id) from public.service_case_events e join public.service_cases c on c.id=e.case_id
     where c.case_type='service' and c.source_case_id is null and c.status='cancelled' and e.to_status='cancelled' and e.created_at >= v_r_start and e.created_at < v_r_end); end if;
 if v_service then v_count_8 := (select count(*) from public.service_cases where case_type='service' and source_case_id is null and status='completed' and completed_at >= v_r_start and completed_at < v_r_end); end if;
 if v_leads then v_count_9 := (select count(distinct e.lead_id) from public.sales_lead_events e join public.sales_leads l on l.id=e.lead_id
     where e.action='won' and l.stage='won' and e.created_at >= v_r_start and e.created_at < v_r_end); end if;
 if v_leads then v_count_10 := (select count(distinct e.lead_id) from public.sales_lead_events e join public.sales_leads l on l.id=e.lead_id
     where e.action='lost' and l.stage='lost' and e.created_at >= v_r_start and e.created_at < v_r_end); end if;
 if v_quotes then v_count_11 := (select count(distinct e.proforma_id) from public.sales_proforma_events e join public.sales_proformas p on p.id=e.proforma_id
     where p.deleted_at is null and p.status in ('accepted','rejected','cancelled') and e.to_status in ('accepted','rejected','cancelled') and e.created_at >= v_r_start and e.created_at < v_r_end); end if;
 v_count_12 := (select count(*) from public.team_tasks where status='done' and closed_at >= v_r_start and closed_at < v_r_end);
 if v_leads then v_count_13 := (select count(*) from public.customer_requests where kind in ('inquiry','quote') and status in ('resolved','closed') and closed_at >= v_r_start and closed_at < v_r_end); end if;
 return public.dashboard_open_counts() || jsonb_build_object(
  'periodic', jsonb_build_object(
   'opportunities', case when v_leads then v_count_1 end,
   'cases', case when v_service then v_count_2 end,
   'scheduled_service', case when v_service then v_count_3 end,
   'quotes', case when v_quotes then v_count_4 end,
   'webqueries', case when v_leads then v_count_5 end,
   'tasks', v_count_6),
  'result', jsonb_build_object(
   'cases_cancelled', case when v_service then v_count_7 end,
   'cases_resolved', case when v_service then v_count_8 end,
   -- A lead counts once, and only while it is still won (or lost): a lost lead that was reopened is not lost.
   'opportunities_won', case when v_leads then v_count_9 end,
   'opportunities_lost', case when v_leads then v_count_10 end,
   'quotes_closed', case when v_quotes then v_count_11 end,
   'tasks_completed', v_count_12,
   'webqueries_closed', case when v_leads then v_count_13 end));
end $$;

revoke all on function public.dashboard_open_counts() from public,anon;
grant execute on function public.dashboard_open_counts() to authenticated;
commit;
