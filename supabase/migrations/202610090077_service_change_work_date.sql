-- Service & maintenance: a job that already has a work date could not get a new one. Every installation and service
-- report adds the next planned maintenance as a scheduled job, so when the customer asked for another day the service
-- team could only start the job or cancel it. "Change work date" now moves a scheduled job to another day (today or
-- later); the date change is kept in the job history. Otherwise unchanged from migration 060.
begin;
CREATE OR REPLACE FUNCTION public.advance_service_case(p_id uuid, p_expected_version integer, p_action text, p_assigned_user_id uuid DEFAULT NULL::uuid, p_scheduled_for date DEFAULT NULL::date, p_note text DEFAULT ''::text)
 RETURNS service_cases
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_row public.service_cases; v_from text; v_to text; v_assignee uuid;
begin
 perform public.require_access('service');
 if not public.inventory_active_staff() then raise exception 'Active staff access is required'; end if;
 if length(trim(coalesce(p_note,''))) not between 2 and 2000 then raise exception 'Enter a progress note'; end if;
 select * into v_row from public.service_cases where id=p_id and version=p_expected_version for update;
 if not found then raise exception 'Service case changed; refresh before continuing'; end if;
 v_from:=v_row.status;
 if p_action='assign' and v_from='new' then v_to:='assigned';
 elsif p_action='reassign' and v_from in ('assigned','scheduled') then v_to:=v_from;
 elsif p_action='schedule' and v_from in ('assigned','scheduled') then v_to:='scheduled';
 elsif p_action='start' and v_from='scheduled' then v_to:='on_site';
 elsif p_action='submit_report' and v_from='on_site' then v_to:='report_required';
 elsif p_action='cancel' and v_from in ('new','assigned','scheduled') then v_to:='cancelled';
 else raise exception 'This is not the next allowed service step'; end if;
 v_assignee:=case when p_action in ('assign','reassign') then p_assigned_user_id else v_row.assigned_user_id end;
 if v_to not in ('new','cancelled') and (v_assignee is null or not exists(select 1 from public.staff where user_id=v_assignee and active=true)) then raise exception 'Choose an active employee'; end if;
 if p_action='schedule' and (p_scheduled_for is null or p_scheduled_for<current_date) then raise exception 'Choose today or a future work date'; end if;
 update public.service_cases set status=v_to,assigned_user_id=v_assignee,
  hod_user_id=case when p_action='assign' then auth.uid() else hod_user_id end,
  scheduled_for=case when p_action='schedule' then p_scheduled_for else scheduled_for end,
  started_at=case when p_action='start' then now() else started_at end,
  completed_at=completed_at,
  version=version+1,updated_at=now()
 where id=v_row.id returning * into v_row;
 insert into public.service_case_events(id,case_id,from_status,to_status,note,assigned_user_id,actor_user_id)
 values(gen_random_uuid(),v_row.id,v_from,v_to,trim(p_note),v_assignee,auth.uid());
 return v_row;
end $function$;
commit;
