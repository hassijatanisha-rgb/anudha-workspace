-- Assigning a step does not grant access to its workflow. Keep explicit handoffs within the
-- employee's existing areas; the immutable handoff chain and business workflow RPCs stay intact.
begin;

create or replace function public.work_assignment_access(p_record_type text,p_user_id uuid)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select exists(select 1 from public.staff s where s.user_id=p_user_id and s.active and
  case p_record_type
   when 'proforma' then s.role='owner' or 'proformas'=any(s.access)
   when 'delivery' then s.role='owner' or 'deliveries'=any(s.access)
   when 'tally_invoice' then s.role='owner' or 'deliveries'=any(s.access)
   when 'service' then s.role='owner' or 'service'=any(s.access)
   when 'lead' then s.role='owner' or 'leads'=any(s.access)
   when 'purchase' then s.role='owner' or 'purchasing'=any(s.access)
   -- Pending-stock requests remain available to all active staff in the existing workflow.
   when 'pending' then true
   else false end)
$$;
revoke all on function public.work_assignment_access(text,uuid) from public,anon,authenticated;

-- Patch the installed RPCs so existing retry, locking, version and immutable-history rules survive.
-- The active-staff guard before these additions also checks the actor's two-step sign-in.
do $migration$
declare v_oid oid; v_definition text; v_replacement text; r record;
begin
 for r in select * from (values
  ('public.hand_off_work(uuid,text,uuid,text,text,uuid,date,text,uuid)',
   $old$ if not public.inventory_active_staff() then raise exception 'Active staff access is required'; end if;$old$,
   $guard$ if public.work_assignment_access(p_record_type,auth.uid()) is not true then
  raise exception 'You do not have access to assign this kind of work. Ask your department head.' using errcode='42501';
 end if;
 if public.work_assignment_access(p_record_type,p_assignee_user_id) is not true then
  raise exception 'Choose an active employee with access to this workflow.' using errcode='42501';
 end if;$guard$),
  ('public.close_work_assignment(uuid,integer,text,text)',
   $old$ if not found then raise exception 'Handoff not found'; end if;$old$,
   $guard$ if public.work_assignment_access(v_row.record_type,auth.uid()) is not true then
  raise exception 'You do not have access to close this kind of work. Ask your department head.' using errcode='42501';
 end if;$guard$)
 ) as patches(signature,anchor,guard) loop
  v_oid:=to_regprocedure(r.signature);
  if v_oid is null then raise exception 'Missing expected assignment RPC: %',r.signature; end if;
  if not (select prosecdef and prolang=(select oid from pg_language where lanname='plpgsql') from pg_proc where oid=v_oid) then
   raise exception 'Expected SECURITY DEFINER plpgsql assignment RPC: %',r.signature;
  end if;
  v_definition:=pg_get_functiondef(v_oid);
  v_replacement:=r.anchor||E'\n'||r.guard;
  if strpos(v_definition,v_replacement)>0 then continue; end if;
  if (length(v_definition)-length(replace(v_definition,r.anchor,'')))/length(r.anchor)<>1 then
   raise exception 'Unexpected assignment RPC implementation: %',r.signature;
  end if;
  execute replace(v_definition,r.anchor,v_replacement);
 end loop;
end $migration$;

commit;
