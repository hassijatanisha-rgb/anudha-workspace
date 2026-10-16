-- Retry only the same normalized request; assign work only to staff who can read it.
begin;

create or replace function public.customer_request_assignees(p_request_id uuid)
returns table(user_id uuid,display_name text)
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_kind text;
begin
 select r.kind into v_kind from public.customer_requests r where r.id=p_request_id;
 if not found then raise exception 'Request not found'; end if;
 if not (public.has_access('leads') or (v_kind in ('complaint','support') and public.has_access('service'))) then
  raise exception 'You do not have access to this request. Ask your department head.' using errcode='42501';
 end if;
 return query select s.user_id,s.display_name from public.staff s
 where s.active and (s.role='owner' or 'leads'=any(s.access)
  or (v_kind in ('complaint','support') and 'service'=any(s.access)))
 order by s.display_name,s.user_id;
end $$;
revoke all on function public.customer_request_assignees(uuid) from public,anon;
grant execute on function public.customer_request_assignees(uuid) to authenticated;

do $migration$
declare r record; v_oid oid; v_definition text;
begin
 for r in select * from (values
  ('public.submit_customer_request(text,text,text,text,text,text,text,text,text,text)',
   $old$ select * into v_row from public.customer_requests r where r.phone = v_phone and r.message = trim(p_message)
  and r.created_at > now() - interval '10 minutes' order by r.created_at desc limit 1;$old$,
   $new$ -- The phone lock also serializes identical retries arriving from different connections.
 perform pg_advisory_xact_lock(hashtextextended('customer-request-phone:'||v_phone,0));
 select * into v_row from public.customer_requests r
 where r.phone=v_phone and r.kind=p_kind and r.name=trim(p_name)
  and r.email=lower(trim(coalesce(p_email,''))) and r.organization=trim(coalesce(p_organization,''))
  and r.product=trim(coalesce(p_product,'')) and r.quantity=trim(coalesce(p_quantity,'')) and r.message=trim(p_message)
  and r.contact_channel=(case when p_channel in ('whatsapp','email','phone') then p_channel else 'whatsapp' end)
  and r.created_at > now() - interval '10 minutes' order by r.created_at desc limit 1;$new$),
  ('public.advance_customer_request(uuid,integer,text,uuid,text)',
   $old$  if p_assigned_user_id is null or not exists(select 1 from public.staff where user_id=p_assigned_user_id and active) then raise exception 'Choose an active employee'; end if;$old$,
   $new$  -- Lock the recipient's grants until the assignment commits; never test the caller's areas for them.
  perform 1 from public.staff s where s.user_id=p_assigned_user_id and s.active
   and (s.role='owner' or 'leads'=any(s.access) or (v_row.kind in ('complaint','support') and 'service'=any(s.access))) for share;
  if not found then raise exception 'Choose an active employee with access to this request'; end if;$new$)
 ) as patches(signature,old_body,new_body) loop
  v_oid:=to_regprocedure(r.signature);
  if v_oid is null then raise exception 'Missing expected customer request RPC: %',r.signature; end if;
  if not (select prosecdef and prolang=(select oid from pg_language where lanname='plpgsql') from pg_proc where oid=v_oid) then
   raise exception 'Expected SECURITY DEFINER plpgsql customer request RPC: %',r.signature;
  end if;
  v_definition:=pg_get_functiondef(v_oid);
  if strpos(v_definition,r.new_body)>0 then continue; end if;
  if (length(v_definition)-length(replace(v_definition,r.old_body,'')))/length(r.old_body)<>1 then
   raise exception 'Unexpected customer request RPC implementation: %',r.signature;
  end if;
  execute replace(v_definition,r.old_body,r.new_body);
 end loop;
end $migration$;

commit;
