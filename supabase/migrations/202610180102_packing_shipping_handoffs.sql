-- Keep the delivery page and packing queue on the same claim, stock and completion rules.
begin;

-- Patch only the installed entry points; retain their current stock, serial and proof checks.
do $migration$
declare r record; v_oid oid; v_definition text;
begin
 for r in select * from (values
  ('public.create_tax_invoice_and_reserve_stock(uuid,integer,text)',
   $old$ if not public.inventory_active_staff() then raise exception 'Active staff access is required'; end if;$old$,
   $new$ perform public.require_access('deliveries');
 if not public.inventory_active_staff() then raise exception 'Active staff access is required'; end if;$new$),
  ('public.start_reserved_sales_delivery_packing(uuid,integer)',
   $old$ if not public.inventory_active_staff() then raise exception 'Active staff access is required'; end if;$old$,
   $new$ perform public.require_access('deliveries');
 if not public.inventory_active_staff() then raise exception 'Active staff access is required'; end if;$new$),
  ('public.start_reserved_sales_delivery_packing(uuid,integer)',
   $old$ select * into v_row from public.sales_delivery_notes where id=p_id and version=p_expected_version and status='sent_to_sales' for update;$old$,
   $new$ perform pg_advisory_xact_lock(hashtextextended('packing-packer:'||auth.uid()::text, 0));
 if exists(select 1 from public.sales_delivery_notes where packer_user_id=auth.uid() and status='packing') then
  raise exception 'You already have an order in packing. Press Packed on it first.';
 end if;
 select * into v_row from public.sales_delivery_notes where id=p_id and version=p_expected_version and status='sent_to_sales' for update;$new$),
  ('public.start_sales_delivery_packing(uuid,integer,jsonb)',
   $old$ if jsonb_typeof(p_lines)<>'array' or jsonb_array_length(p_lines) not between 1 and 100 then raise exception 'Choose at least one item to pack'; end if;$old$,
   $new$ if p_lines is null or jsonb_typeof(p_lines)<>'array' or jsonb_array_length(p_lines) not between 1 and 100 then raise exception 'Choose at least one item to pack'; end if;$new$),
  ('public.start_sales_delivery_packing(uuid,integer,jsonb)',
   $old$ select * into v_row from public.sales_delivery_notes where id=p_id and version=p_expected_version and status='sent_to_sales' for update;$old$,
   $new$ perform pg_advisory_xact_lock(hashtextextended('packing-packer:'||auth.uid()::text, 0));
 if exists(select 1 from public.sales_delivery_notes where packer_user_id=auth.uid() and status='packing') then
  raise exception 'You already have an order in packing. Press Packed on it first.';
 end if;
 select * into v_row from public.sales_delivery_notes where id=p_id and version=p_expected_version and status='sent_to_sales' for update;$new$),
  ('public.start_reserved_sales_delivery_packing(uuid,integer)',
   $old$ update public.sales_delivery_notes set status='packing',version=version+1,updated_at=now() where id=v_row.id returning * into v_row;$old$,
   $new$ update public.sales_delivery_notes set status='packing',packer_user_id=auth.uid(),packing_taken_at=now(),packing_auto_reserved=false,
  packing_blocked_reason=null,packing_blocked_at=null,version=version+1,updated_at=now() where id=v_row.id returning * into v_row;$new$),
  ('public.start_sales_delivery_packing(uuid,integer,jsonb)',
   $old$ update public.sales_delivery_notes set status='packing',version=version+1,updated_at=now() where id=v_row.id returning * into v_row;$old$,
   $new$ update public.sales_delivery_notes set status='packing',packer_user_id=auth.uid(),packing_taken_at=now(),packing_auto_reserved=true,
  packing_blocked_reason=null,packing_blocked_at=null,version=version+1,updated_at=now() where id=v_row.id returning * into v_row;$new$),
  ('public.start_reserved_sales_delivery_packing(uuid,integer)',
   $old$ return v_row;$old$,
   $new$ perform public.auto_assign_work('delivery',v_row.id,v_row.delivery_number,'Pack '||v_row.delivery_number,auth.uid());
 return v_row;$new$),
  ('public.start_sales_delivery_packing(uuid,integer,jsonb)',
   $old$ return v_row;$old$,
   $new$ perform public.auto_assign_work('delivery',v_row.id,v_row.delivery_number,'Pack '||v_row.delivery_number,auth.uid());
 return v_row;$new$),
  ('public.packing_take_next()',
   $old$   perform public.auto_assign_work('delivery', v_row.id, v_row.delivery_number, 'Pack '||v_row.delivery_number||' (taken from the packing queue)', v_me);$old$,
   $new$   perform public.auto_assign_work('delivery', v_row.id, v_row.delivery_number, 'Pack '||v_row.delivery_number, v_me);$new$),
  ('public.advance_sales_delivery(uuid,integer,text,text,text,text,text)',
   $old$ v_from:=v_row.status;$old$,
   $new$ if p_action='ready' and v_row.packer_user_id is distinct from auth.uid() and not public.packing_supervisor() then
  raise exception 'Only % (who took this order), the stores head or the owner can mark it packed',public.packing_staff_name(v_row.packer_user_id) using errcode='42501';
 end if;
 if p_action in ('ready','dispatch') and not exists(select 1 from public.sales_delivery_lines where delivery_note_id=v_row.id) then
  raise exception 'Select stock for this delivery before marking it ready or sending it out';
 end if;
 v_from:=v_row.status;$new$),
  ('public.packing_release(uuid,integer,text)',
   $old$  delete from public.sales_delivery_lines where delivery_note_id=v_row.id;$old$,
   $new$  delete from public.delivery_line_serials where delivery_note_id=v_row.id;
  delete from public.sales_delivery_lines where delivery_note_id=v_row.id;$new$),
  ('public.order_live_status(uuid[])',
   $old$   'queued_at',n.packing_queued_at,'blocked_reason',n.packing_blocked_reason,$old$,
   $new$   'queued_at',n.packing_queued_at,'blocked_reason',n.packing_blocked_reason,
   'remaining_quantity',(select coalesce(sum(greatest(pl.quantity-coalesce((select sum(dl.quantity)
     from public.sales_delivery_lines dl join public.sales_delivery_notes dn on dn.id=dl.delivery_note_id
     where dl.proforma_line_id=pl.id and dn.status='delivered'),0),0)),0)
    from public.sales_proforma_lines pl where pl.proforma_id=n.proforma_id),$new$)
 ) as patches(signature,old_body,new_body) loop
  v_oid:=to_regprocedure(r.signature);
  if v_oid is null then raise exception 'Missing expected packing RPC: %',r.signature; end if;
  if not (select prosecdef and prolang=(select oid from pg_language where lanname='plpgsql') from pg_proc where oid=v_oid) then
   raise exception 'Expected SECURITY DEFINER plpgsql packing RPC: %',r.signature;
  end if;
  v_definition:=pg_get_functiondef(v_oid);
  if strpos(v_definition,r.new_body)>0 then continue; end if;
  if (length(v_definition)-length(replace(v_definition,r.old_body,'')))/length(r.old_body)<>1 then
   raise exception 'Unexpected packing RPC implementation: %',r.signature;
  end if;
  execute replace(v_definition,r.old_body,r.new_body);
 end loop;
end $migration$;

-- A later delivery of a partial order shows the balance the picker will actually reserve.
create or replace function public.packing_items(p_note public.sales_delivery_notes) returns jsonb
language sql stable security definer set search_path=public,pg_temp as $$
 select case when exists(select 1 from public.sales_delivery_lines where delivery_note_id=p_note.id) then
  (select coalesce(jsonb_agg(jsonb_build_object('name',p.name,'quantity',dl.quantity,'uom',pl.uom,'batch',coalesce(lot.batch_number,''))
    order by pl.sort_order, dl.id),'[]')
   from public.sales_delivery_lines dl join public.sales_proforma_lines pl on pl.id=dl.proforma_line_id
   join public.products p on p.id=dl.product_id left join public.inventory_lots lot on lot.id=dl.lot_id
   where dl.delivery_note_id=p_note.id)
 else
  (select coalesce(jsonb_agg(jsonb_build_object('name',balance.name,'quantity',balance.quantity,'uom',balance.uom,'batch','')
    order by balance.sort_order,balance.id),'[]') from (
   select pl.id,pl.sort_order,p.name,pl.uom,pl.quantity-coalesce((select sum(dl.quantity)
    from public.sales_delivery_lines dl join public.sales_delivery_notes dn on dn.id=dl.delivery_note_id
    where dl.proforma_line_id=pl.id and dn.status<>'cancelled'),0) quantity
   from public.sales_proforma_lines pl join public.products p on p.id=pl.product_id
   where pl.proforma_id=p_note.proforma_id
    and coalesce((select c.category from public.product_inventory_classifications c where c.product_id=pl.product_id order by c.version desc limit 1),'')<>'non_stock'
  ) balance where balance.quantity>0)
 end $$;

commit;
