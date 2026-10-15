-- Service & maintenance: every installed or serviced machine gets its next maintenance visit as an open service job
-- (one open service job per machine, migration 008). Recording a repair for a complaint then only said "This machine
-- already has open service work", without saying which job, so the service team could not find it. The message now
-- names the open job, its state and date, and what to do. Otherwise unchanged from migration 060.
begin;
create or replace function public.create_service_case(p_id uuid, p_asset_id uuid, p_contact_id uuid, p_problem_summary text)
 returns public.service_cases language plpgsql security definer set search_path to 'public','pg_temp' as $function$
declare v_asset public.equipment_assets; v_row public.service_cases; v_number text; v_open public.service_cases;
begin
 perform public.require_access('service');
 if not public.inventory_active_staff() then raise exception 'Active staff access is required'; end if;
 if length(trim(coalesce(p_problem_summary,''))) not between 2 and 4000 then raise exception 'Describe the requested service work'; end if;
 select * into v_asset from public.equipment_assets where id=p_asset_id and status in ('active','in_service') for update;
 if not found then raise exception 'Choose an installed machine'; end if;
 select * into v_open from public.service_cases where asset_id=p_asset_id and case_type='service' and status not in ('completed','cancelled') order by created_at limit 1;
 if found then
  raise exception 'This machine already has open service job % (%). Do the repair on that job: open it under Service & maintenance schedule, or cancel it first.',
   v_open.case_number, replace(v_open.status,'_',' ')||coalesce(', work date '||to_char(v_open.scheduled_for,'DD Mon YYYY'),'')
   using hint='open_service_job';
 end if;
 if p_contact_id is not null and not exists(select 1 from public.contacts where id=p_contact_id and organization_id=v_asset.organization_id and deleted_at is null and status<>'incorrect') then raise exception 'Choose a current contact for this client'; end if;
 v_number:='SRV-'||to_char(current_date,'YYYY')||'-'||lpad(nextval('public.service_case_number_seq')::text,6,'0');
 insert into public.service_cases(id,case_number,case_type,asset_id,organization_id,contact_id,product_id,problem_summary,created_by)
 values(p_id,v_number,'service',v_asset.id,v_asset.organization_id,p_contact_id,v_asset.product_id,trim(p_problem_summary),auth.uid()) returning * into v_row;
 insert into public.service_case_events(id,case_id,to_status,note,actor_user_id) values(gen_random_uuid(),v_row.id,'new','Service request recorded',auth.uid());
 return v_row;
end $function$;
commit;
