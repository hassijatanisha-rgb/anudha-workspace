-- Cancel a financially reversed order without deleting its accepted quote or transaction history.
begin;

do $acceptance_history$
declare v_name text;
begin
 select conname into strict v_name from pg_constraint where conrelid='public.sales_proformas'::regclass and contype='c'
  and pg_get_constraintdef(oid) like '%accepted_at%' and pg_get_constraintdef(oid) like '%acceptance_reference%';
 execute format('alter table public.sales_proformas drop constraint %I',v_name);
end $acceptance_history$;
alter table public.sales_proformas add constraint sales_proformas_acceptance_history check (
 (status='accepted' and accepted_at is not null and accepted_by is not null and acceptance_reference is not null)
 or (status='cancelled' and ((accepted_at is null and accepted_by is null and acceptance_reference is null)
  or (accepted_at is not null and accepted_by is not null and acceptance_reference is not null)))
 or (status in ('draft','sent','rejected') and accepted_at is null and accepted_by is null and acceptance_reference is null)
);

create function public.cancel_accepted_sales_order(p_id uuid,p_expected_version integer,p_reason text)
returns public.sales_proformas language plpgsql security definer set search_path=public,pg_temp as $$
declare v_pf public.sales_proformas; v_pending public.pending_stock_requests; v_org uuid;
 v_reason text:=trim(coalesce(p_reason,'')); v_actor uuid:=auth.uid();
begin
 if v_actor is null or not (public.inventory_owner() or public.accounting_access()) then
  raise exception 'Owner or accounting access is required' using errcode='42501';
 end if;
 if p_id is null or p_expected_version is null then raise exception 'Order and expected version are required'; end if;
 if length(v_reason) not between 5 and 300 then raise exception 'Give a cancellation reason of 5 to 300 characters'; end if;
 select organization_id into v_org from public.sales_proformas where id=p_id;
 if not found then raise exception 'Pro forma not found'; end if;
 -- Match receipt/return-credit -> inventory -> order lock order before checking any balances.
 perform pg_advisory_xact_lock(hashtextextended('acc-receipt-org:'||v_org::text,0));
 if to_regprocedure('public.acc_inventory_lock()') is not null then perform public.acc_inventory_lock(); end if;
 select * into v_pf from public.sales_proformas where id=p_id for update;
 if v_pf.version<>p_expected_version then raise exception 'Accepted Pro forma changed; refresh before cancelling'; end if;
 if v_pf.status<>'accepted' or v_pf.deleted_at is not null then raise exception 'Only an active accepted Pro forma can be cancelled'; end if;
 perform 1 from public.acc_invoices where proforma_id=p_id order by id for update;
 perform 1 from public.sales_delivery_notes where proforma_id=p_id order by id for update;
 if exists(select 1 from public.sales_delivery_notes where proforma_id=p_id and status not in ('cancelled','delivered')) then
  raise exception 'Cancel active deliveries before cancelling the accepted order';
 end if;
 if exists(select 1 from public.acc_invoices i where i.proforma_id=p_id and i.voided_at is not null
  and not exists(select 1 from public.acc_journal_entries e where e.id=i.void_entry_id and e.entry_date<=current_date)) then
  raise exception 'Every invoice void must be effective today before cancelling the order';
 end if;
 -- Check every future accounting boundary, including a dated credit void followed by a later repost.
 if exists(select 1 from public.acc_invoices i cross join public.acc_credit_event_dates(v_org,current_date) d
  cross join lateral public.acc_invoice_credit_position(i.id,d.event_date) b
  where i.proforma_id=p_id and (b.paid_minor<>0 or b.applied_credit_minor<>0 or b.credit_used_minor<>0 or b.refunded_minor<>0
   or (i.voided_at is null and (b.credited_minor<>i.total_minor or b.residual_minor<>0))
   or (i.voided_at is not null and b.credited_minor<>0))) then
  raise exception 'Void or fully credit every invoice and resolve payments and customer credit before cancelling the order';
 end if;
 if exists(select 1 from public.sales_delivery_lines l join public.sales_delivery_notes n on n.id=l.delivery_note_id
  where n.proforma_id=p_id and n.status='delivered' and l.quantity<>(select coalesce(sum(r.quantity),0)
   from public.sales_return_lines r join public.sales_returns h on h.id=r.return_id
   where r.delivery_line_id=l.id and r.resolution is not null and h.status='resolved')) then
  raise exception 'Every delivered quantity must have a resolved return before cancelling the order';
 end if;
 -- Service intake locks its asset before creating a case. Existing open jobs are never silently closed here.
 perform 1 from public.equipment_assets a join public.sales_delivery_lines l on l.id=a.source_delivery_line_id
  join public.sales_delivery_notes n on n.id=l.delivery_note_id where n.proforma_id=p_id order by a.id for update of a;
 if exists(select 1 from public.service_cases c where c.status not in ('completed','cancelled') and
  (c.source_delivery_note_id in(select id from public.sales_delivery_notes where proforma_id=p_id)
   or c.asset_id in(select a.id from public.equipment_assets a join public.sales_delivery_lines l on l.id=a.source_delivery_line_id
    join public.sales_delivery_notes n on n.id=l.delivery_note_id where n.proforma_id=p_id))) then
  raise exception 'Resolve open installation and service jobs before cancelling the order';
 end if;
 for v_pending in select * from public.pending_stock_requests where proforma_id=p_id order by id for update loop
  if v_pending.status='waiting' then
   update public.pending_stock_requests set status='cancelled',close_note=v_reason,closed_by=v_actor,closed_at=now(),
    version=version+1,updated_at=now() where id=v_pending.id;
   insert into public.pending_stock_events(request_id,action,from_status,to_status,note,expires_on,actor_user_id)
   values(v_pending.id,'order_cancel','waiting','cancelled',v_reason,v_pending.expires_on,v_actor);
  end if;
  -- Automatic handoff triggers swallow errors; this explicit close must succeed in the same transaction.
  perform public.auto_close_work('pending',v_pending.id,'cancelled',v_reason);
 end loop;
 perform public.auto_close_work('proforma',p_id,'cancelled',v_reason);
 update public.sales_proformas set status='cancelled',version=version+1,updated_at=now() where id=p_id returning * into v_pf;
 insert into public.sales_proforma_events(id,proforma_id,from_status,to_status,reference,actor_user_id)
 values(gen_random_uuid(),p_id,'accepted','cancelled',v_reason,v_actor);
 return v_pf;
end $$;
revoke all on function public.cancel_accepted_sales_order(uuid,integer,text) from public,anon,authenticated;
grant execute on function public.cancel_accepted_sales_order(uuid,integer,text) to authenticated;

-- Retain the installed validation and retry behavior while closing the paths that could reopen cancelled work.
do $guards$
declare r record; v text;
begin
 for r in select * from (values
  ('public.sync_order_pending(uuid)',
   $old$ if not found then raise exception 'Pro forma not found'; end if;$old$,
   $new$ if not found then raise exception 'Pro forma not found'; end if;
 if v_pf.status<>'accepted' or v_pf.deleted_at is not null then return; end if;$new$),
  ('public.create_pending_stock_request(uuid,uuid,uuid,uuid,integer,uuid,uuid,uuid,text)',
   $old$ if p_proforma_id is not null and not exists(select 1 from public.sales_proformas where id=p_proforma_id and organization_id=p_organization_id and deleted_at is null) then raise exception 'Choose a Pro forma for the same client'; end if;$old$,
   $new$ if p_proforma_id is not null then
  perform 1 from public.sales_proformas where id=p_proforma_id and organization_id=p_organization_id and deleted_at is null
   and status in ('draft','sent','accepted') for share;
  if not found then raise exception 'Choose an open Pro forma for the same client'; end if;
 end if;$new$),
  ('public.hand_off_work(uuid,text,uuid,text,text,uuid,date,text,uuid)',
   $old$  when 'service' then$old$,
   $new$  when 'pending' then
   select request_number,status into v_parent_label,v_parent_status
   from public.pending_stock_requests where id=p_record_id for share;
  when 'service' then$new$),
  ('public.hand_off_work(uuid,text,uuid,text,text,uuid,date,text,uuid)',
   $old$ if p_record_type in ('proforma','delivery','service') and v_parent_label is null then$old$,
   $new$ if p_record_type in ('proforma','delivery','service','pending') and v_parent_label is null then$new$),
  ('public.hand_off_work(uuid,text,uuid,text,text,uuid,date,text,uuid)',
   $old$ if (p_record_type='proforma' and v_parent_status in ('rejected','cancelled'))$old$,
   $new$ if (p_record_type='pending' and v_parent_status<>'waiting')
  or (p_record_type='proforma' and v_parent_status in ('rejected','cancelled'))$new$),
  ('public.void_return_credit_note(uuid,date,text)',
   $old$ perform public.acc_credit_date(p_date);$old$,
   $new$ if exists(select 1 from public.acc_invoices i join public.sales_proformas p on p.id=i.proforma_id
  where i.id=c.invoice_id and p.status='cancelled') then
  raise exception 'A cancelled order must retain its posted return credits';
 end if;
 perform public.acc_credit_date(p_date);$new$),
  ('public.acc_check_credit_target(uuid,date,bigint)',
   $old$ if p_date<i.invoice_date then$old$,
   $new$ -- Settlement writers and cancellation already hold the same customer advisory lock.
 if exists(select 1 from public.sales_proformas where id=i.proforma_id and status='cancelled') then
  raise exception 'A cancelled order cannot receive new invoice settlements';
 end if;
 if p_date<i.invoice_date then$new$)
 ) patches(signature,old_body,new_body) loop
  v:=pg_get_functiondef(to_regprocedure(r.signature));
  if v is null or (length(v)-length(replace(v,r.old_body,'')))/length(r.old_body)<>1 then
   raise exception 'Unexpected accepted-order cancellation dependency: %',r.signature;
  end if;
  execute replace(v,r.old_body,r.new_body);
 end loop;
end $guards$;

commit;
