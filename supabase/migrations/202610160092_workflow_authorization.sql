-- Close authorization gaps in supporting files and existing workflow saves.
begin;

create or replace function public.document_attachment_parent_access(p_record_type text,p_record_id uuid)
returns boolean language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
 if auth.uid() is null or public.inventory_active_staff() is not true then return false; end if;
 case p_record_type
 -- Delivery staff can read Pro formas and their items under migration 072.
 when 'proforma' then return (public.has_access('proformas') or public.has_access('deliveries'))
  and exists(select 1 from public.sales_proformas where id=p_record_id);
 when 'delivery' then return public.has_access('deliveries') and exists(select 1 from public.sales_delivery_notes where id=p_record_id);
 when 'service' then return public.has_access('service') and exists(select 1 from public.service_cases where id=p_record_id);
 when 'accounting' then return public.accounting_access() and exists(select 1 from public.accounting_drafts where id=p_record_id);
 else return false;
 end case;
end $$;

-- Amend the installed bodies so report fixes, locks, validation and RPC grants remain intact.
-- Abort on an unexpected body instead of silently leaving a workflow unprotected.
do $migration$
declare v_oid oid; v_definition text; v_replacement text; r record;
begin
 for r in select * from (values
  ('public.complete_service_report(uuid,integer,date,text,text,text,text,text,text,text,uuid,text,date,text,date,text,text,date,text,boolean,text,boolean,text,date,text,text,bigint,text,integer,jsonb,jsonb)',
   $old$ if not public.inventory_active_staff() then raise exception 'Active staff access is required'; end if;$old$,
   $guard$ perform public.require_access('service');$guard$),
  ('public.save_purchase_request(uuid,integer,uuid,text,date,text,jsonb)',
   $old$  if v_row.version <> p_expected_version then raise exception 'Purchase request changed; refresh and compare'; end if;$old$,
   $guard$  if v_row.requested_by is distinct from auth.uid() and not public.inventory_owner() then
   raise exception 'Only the requester or the owner can edit this purchase request' using errcode='42501';
  end if;$guard$),
  ('public.save_team_task(uuid,integer,text,text,text,timestamp with time zone,uuid)',
   $old$ update public.team_tasks set title=trim(p_title),details=coalesce(p_details,''),urgency=p_urgency,due_at=p_due_at,assignee_user_id=p_assignee,$old$,
   $guard$ if p_due_at is distinct from v_row.due_at and not public.inventory_owner() then
  raise exception 'A new deadline needs your department head''s approval. Use "Ask for more time".' using errcode='42501';
 end if;$guard$)
 ) as patches(signature,anchor,guard) loop
  v_oid := to_regprocedure(r.signature);
  if v_oid is null then raise exception 'Missing expected workflow RPC: %',r.signature; end if;
  if not (select prosecdef and prolang=(select oid from pg_language where lanname='plpgsql') from pg_proc where oid=v_oid) then
   raise exception 'Expected SECURITY DEFINER plpgsql workflow RPC: %',r.signature;
  end if;
  v_definition := pg_get_functiondef(v_oid);
  v_replacement := r.guard||E'\n'||r.anchor;
  if strpos(v_definition,v_replacement)>0 then continue; end if;
  if (length(v_definition)-length(replace(v_definition,r.anchor,'')))/length(r.anchor)<>1 then
   raise exception 'Unexpected workflow RPC implementation: %',r.signature;
  end if;
  execute replace(v_definition,r.anchor,v_replacement);
 end loop;
end $migration$;

commit;
