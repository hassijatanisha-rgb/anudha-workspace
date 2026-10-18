-- Match receipt inspection: a dated lot expires before current_date; today and undated lots remain usable.
begin;

do $migration$
declare r record; v_oid oid; v_definition text;
begin
 for r in select * from (values
  ('public.create_tax_invoice_and_reserve_stock(uuid,integer,text)',
   $old$    and lot.loose_units-lot.reserved_units>0$old$,
   $new$    and lot.loose_units-lot.reserved_units>0 and (lot.expiry_date is null or lot.expiry_date>=current_date)$new$),
  ('public.packing_pick_lots(public.sales_delivery_notes)',
   $old$    and lot.loose_units-lot.reserved_units>0$old$,
   $new$    and lot.loose_units-lot.reserved_units>0 and (lot.expiry_date is null or lot.expiry_date>=current_date)$new$),
  ('public.start_sales_delivery_packing(uuid,integer,jsonb)',
   $old$  if v_lot.loose_units-v_lot.reserved_units<v_line.quantity then raise exception 'Haadi stock is no longer sufficient for this packing list'; end if;$old$,
   $new$  if v_lot.expiry_date<current_date then raise exception 'This lot has expired; choose non-expired Haadi stock'; end if;
  if v_lot.loose_units-v_lot.reserved_units<v_line.quantity then raise exception 'Haadi stock is no longer sufficient for this packing list'; end if;$new$),
  ('public.start_reserved_sales_delivery_packing(uuid,integer)',
   $old$  where lot.id=v_line.lot_id and lot.stock_status='available' and location.active=true and location.is_dispatch_hub=true for update of lot;$old$,
   $new$  where lot.id=v_line.lot_id and lot.stock_status='available' and location.active=true and location.is_dispatch_hub=true
   and (lot.expiry_date is null or lot.expiry_date>=current_date) for update of lot;$new$),
  ('public.packing_take_next()',
   $old$     where lot.id=v_line.lot_id and lot.stock_status='available' and location.active and location.is_dispatch_hub for update of lot;$old$,
   $new$     where lot.id=v_line.lot_id and lot.stock_status='available' and location.active and location.is_dispatch_hub
      and (lot.expiry_date is null or lot.expiry_date>=current_date) for update of lot;$new$),
  ('public.advance_sales_delivery(uuid,integer,text,text,text,text,text)',
   $old$   where lot.id=v_line.lot_id and lot.product_id=v_line.product_id and lot.stock_status='available' and location.active=true and location.is_dispatch_hub=true for update of lot;$old$,
   $new$   where lot.id=v_line.lot_id and lot.product_id=v_line.product_id and lot.stock_status='available' and location.active=true and location.is_dispatch_hub=true
    and (lot.expiry_date is null or lot.expiry_date>=current_date) for update of lot;$new$)
 ) as patches(signature,old_body,new_body) loop
  v_oid:=to_regprocedure(r.signature);
  if v_oid is null then raise exception 'Missing expected order-expiry function: %',r.signature; end if;
  if not (select prosecdef and prolang=(select oid from pg_language where lanname='plpgsql') from pg_proc where oid=v_oid) then
   raise exception 'Unexpected order-expiry function security: %',r.signature;
  end if;
  v_definition:=pg_get_functiondef(v_oid);
  if strpos(v_definition,r.new_body)>0 then continue; end if;
  if (length(v_definition)-length(replace(v_definition,r.old_body,'')))/length(r.old_body)<>1 then
   raise exception 'Unexpected order-expiry function implementation: %',r.signature;
  end if;
  execute replace(v_definition,r.old_body,r.new_body);
 end loop;
end $migration$;

commit;
