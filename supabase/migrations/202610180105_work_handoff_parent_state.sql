-- Current work uses the saved document identity and cannot reopen a finished workflow.
begin;

do $migration$
declare
 v_oid oid := to_regprocedure('public.hand_off_work(uuid,text,uuid,text,text,uuid,date,text,uuid)');
 v_definition text;
 r record;
begin
 if v_oid is null then raise exception 'Missing expected work handoff RPC'; end if;
 if not (select prosecdef and prolang=(select oid from pg_language where lanname='plpgsql') from pg_proc where oid=v_oid) then
  raise exception 'Expected SECURITY DEFINER plpgsql work handoff RPC';
 end if;
 v_definition:=pg_get_functiondef(v_oid);
 if strpos(v_definition,'public.work_assignment_access(p_record_type,auth.uid())')=0
  or strpos(v_definition,'public.work_assignment_access(p_record_type,p_assignee_user_id)')=0 then
  raise exception 'Expected work handoff access guards from migration 100';
 end if;
 for r in select * from (values
  ($old$declare v_row public.work_assignments; v_open public.work_assignments;$old$,
   $new$declare v_row public.work_assignments; v_open public.work_assignments; v_parent_label text; v_parent_status text;$new$),
  ($old$ if length(trim(coalesce(p_record_label,''))) not between 1 and 200 then raise exception 'Record label is required'; end if;$old$,
   $new$ -- Match the workflow triggers' parent-before-work lock order.
 case p_record_type
  when 'proforma' then
   select document_number,status into v_parent_label,v_parent_status
   from public.sales_proformas where id=p_record_id and deleted_at is null for share;
  when 'delivery' then
   select delivery_number,status into v_parent_label,v_parent_status
   from public.sales_delivery_notes where id=p_record_id for share;
  when 'service' then
   select case_number,status into v_parent_label,v_parent_status
   from public.service_cases where id=p_record_id for share;
  else null;
 end case;
 if v_parent_label is not null then p_record_label:=v_parent_label; end if;
 if length(trim(coalesce(p_record_label,''))) not between 1 and 200 then raise exception 'Record label is required'; end if;$new$),
  ($old$ if not public.work_record_exists(p_record_type,p_record_id) then raise exception 'That record no longer exists'; end if;$old$,
   $new$ -- An identical saved request has already returned, even if the workflow is now finished.
 if p_record_type in ('proforma','delivery','service') and v_parent_label is null then
  raise exception 'That record no longer exists';
 end if;
 if (p_record_type='proforma' and v_parent_status in ('rejected','cancelled'))
  or (p_record_type='delivery' and v_parent_status in ('delivered','cancelled'))
  or (p_record_type='service' and v_parent_status in ('completed','cancelled')) then
  raise exception 'This record is no longer open for new handoffs';
 end if;
 if not public.work_record_exists(p_record_type,p_record_id) then raise exception 'That record no longer exists'; end if;$new$)
 ) as patches(old_body,new_body) loop
  if strpos(v_definition,r.new_body)>0 then continue; end if;
  if (length(v_definition)-length(replace(v_definition,r.old_body,'')))/length(r.old_body)<>1 then
   raise exception 'Unexpected work handoff implementation';
  end if;
  v_definition:=replace(v_definition,r.old_body,r.new_body);
 end loop;
 execute v_definition;
end $migration$;

commit;
