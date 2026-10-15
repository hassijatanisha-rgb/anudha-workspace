-- Move stock: receiving a transfer that passed inspection always failed with "violates check constraint
-- inventory_lots_stock_status_check". The receiving lot was written with stock_status 'received', a transfer status,
-- while a stock lot is only 'available' or 'quarantine'. Cartons that pass inspection now arrive as available stock at
-- the new godown; the transfer itself is still marked received. Otherwise unchanged from migration 060.
begin;
create or replace function public.receive_inventory_transfer(p_id uuid, p_expected_version integer, p_actual_units integer, p_inspection text, p_note text)
 returns public.inventory_transfers language plpgsql security definer set search_path to 'public','pg_temp' as $function$
declare v_transfer public.inventory_transfers; v_lot public.inventory_lots; v_status text; v_lot_status text; v_batch text; v_expiry date;
begin
 perform public.require_access('stock');
 if not public.inventory_active_staff() then raise exception 'Active staff access is required'; end if;
 if p_actual_units<0 then raise exception 'Counted units cannot be negative'; end if;
 select * into v_transfer from public.inventory_transfers where id=p_id and version=p_expected_version and status='in_transit' for update;
 if not found then raise exception 'Transfer changed; refresh before receiving'; end if;
 select batch_number,expiry_date into v_batch,v_expiry from public.inventory_lots where id=v_transfer.source_lot_id;
 if p_actual_units<>v_transfer.expected_units or p_inspection<>'pass' or (v_expiry is not null and v_expiry<current_date) then
  v_status:='quarantine';
 else
  v_status:='received';
 end if;
 v_lot_status:=case when v_status='received' then 'available' else 'quarantine' end;
 insert into public.inventory_lots(id,product_id,location_id,pack_definition_id,batch_number,expiry_date,sealed_cartons,loose_units,stock_status)
 values(gen_random_uuid(),v_transfer.product_id,v_transfer.to_location_id,v_transfer.pack_definition_id,v_batch,v_expiry,case when v_status='received' then v_transfer.cartons else 0 end,case when v_status='quarantine' then p_actual_units else 0 end,v_lot_status)
 on conflict (product_id,location_id,pack_definition_id,batch_number,(coalesce(expiry_date,'infinity'::date)),stock_status)
 do update set sealed_cartons=public.inventory_lots.sealed_cartons+excluded.sealed_cartons,loose_units=public.inventory_lots.loose_units+excluded.loose_units,version=public.inventory_lots.version+1,updated_at=now()
 returning * into v_lot;
 insert into public.inventory_movements(id,lot_id,transfer_id,movement_type,sealed_carton_change,loose_unit_change,base_unit_change,reason,actor_user_id)
 values(gen_random_uuid(),v_lot.id,v_transfer.id,case when v_status='received' then 'transfer_receipt' else 'quarantine_receipt' end,case when v_status='received' then v_transfer.cartons else 0 end,case when v_status='quarantine' then p_actual_units else 0 end,p_actual_units,trim(p_note),auth.uid());
 update public.inventory_transfers set status=v_status,actual_units=p_actual_units,inspection_note=trim(p_note),received_by=auth.uid(),received_at=now(),version=version+1 where id=v_transfer.id returning * into v_transfer;
 return v_transfer;
end $function$;
revoke all on function public.receive_inventory_transfer(uuid,integer,integer,text,text) from public,anon;
grant execute on function public.receive_inventory_transfer(uuid,integer,integer,text,text) to authenticated;
commit;
