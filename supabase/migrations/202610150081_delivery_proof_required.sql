-- Delivery proof file (owner decision, 12 October 2026).
-- A delivery can be recorded as Delivered only after a photo or scan of the signed delivery note is uploaded to that
-- delivery, after it went out for delivery. Uploaded files are verified against storage and cannot be changed or
-- deleted (migration 025), so the proof stays with the delivery. Several deliveries may be out with one driver at
-- once (multi-drop); nothing here limits that.
begin;

create or replace function public.advance_sales_delivery(p_id uuid, p_expected_version integer, p_action text, p_carrier text DEFAULT ''::text, p_tracking_reference text DEFAULT ''::text, p_recipient_name text DEFAULT ''::text, p_proof_reference text DEFAULT ''::text)
 RETURNS sales_delivery_notes
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_row public.sales_delivery_notes; v_from text; v_to text; v_line record; v_lot public.inventory_lots; v_issue_id uuid; v_reference text;
begin
 perform public.require_access('deliveries');
 if not public.inventory_active_staff() then raise exception 'Active staff access is required'; end if;
 select * into v_row from public.sales_delivery_notes where id=p_id and version=p_expected_version for update;
 if not found then raise exception 'Delivery changed; refresh before continuing'; end if;
 v_from:=v_row.status;
 if p_action='tax_invoice' and v_from='accounts_approved' then v_to:='tax_invoice_created';
 elsif p_action='send_to_sales' and v_from='tax_invoice_created' then v_to:='sent_to_sales';
 elsif p_action='ready' and v_from='packing' then v_to:='ready';
 elsif p_action='dispatch' and v_from='ready' then v_to:='out_for_delivery';
 elsif p_action='deliver' and v_from='out_for_delivery' then v_to:='delivered';
 elsif p_action='cancel' and v_from in ('accounts_approved','tax_invoice_created','sent_to_sales','packing','ready') then v_to:='cancelled';
 else raise exception 'This is not the next allowed delivery step'; end if;

 if p_action='tax_invoice' and length(trim(coalesce(p_proof_reference,''))) not between 2 and 120 then raise exception 'Enter a valid tax invoice number or reference'; end if;
 if p_action='dispatch' and (length(trim(coalesce(p_carrier,''))) not between 2 and 200 or length(trim(coalesce(p_tracking_reference,''))) not between 2 and 200) then raise exception 'Enter a valid driver or vehicle and out-for-delivery reference'; end if;
 if p_action='deliver' and (length(trim(coalesce(p_recipient_name,''))) not between 2 and 200 or length(trim(coalesce(p_proof_reference,''))) not between 2 and 500) then raise exception 'Enter a valid recipient and signed delivery-note proof reference'; end if;
 if p_action='cancel' and length(trim(coalesce(p_proof_reference,''))) not between 2 and 500 then raise exception 'Enter a valid cancellation reason'; end if;
 -- delivery_proof_081
 if p_action='deliver' and not exists(select 1 from public.document_attachments a
   where a.record_type='delivery' and a.record_id=v_row.id and a.uploaded_at>=coalesce(v_row.dispatched_at,'-infinity'::timestamptz)) then
  raise exception 'Upload a photo or scan of the signed delivery note first (Upload / view documents on this delivery), then record delivery.';
 end if;

 if p_action in ('ready','dispatch') then
  for v_line in select lot_id,product_id,sum(quantity)::integer as quantity from public.sales_delivery_lines where delivery_note_id=v_row.id group by lot_id,product_id order by lot_id loop
   select lot.* into v_lot from public.inventory_lots lot join public.inventory_locations location on location.id=lot.location_id
   where lot.id=v_line.lot_id and lot.product_id=v_line.product_id and lot.stock_status='available' and location.active=true and location.is_dispatch_hub=true for update of lot;
   if not found or v_lot.reserved_units<v_line.quantity or v_lot.loose_units<v_line.quantity then raise exception 'Reserved Haadi stock is no longer sufficient for this delivery'; end if;
  end loop;
 end if;

 if p_action='dispatch' then
  for v_line in select * from public.sales_delivery_lines where delivery_note_id=v_row.id order by lot_id,id loop
   select * into v_lot from public.inventory_lots where id=v_line.lot_id for update;
   update public.inventory_lots set loose_units=loose_units-v_line.quantity,reserved_units=reserved_units-v_line.quantity,version=version+1,updated_at=now() where id=v_lot.id;
   v_issue_id:=gen_random_uuid();
   insert into public.inventory_issues(id,lot_id,organization_id,product_id,quantity,issued_on,reference,reason,issued_by,delivery_note_id,delivery_line_id)
   values(v_issue_id,v_lot.id,v_row.organization_id,v_line.product_id,v_line.quantity,current_date,v_row.delivery_number,'Out for delivery from accepted '||(select document_number from public.sales_proformas where id=v_row.proforma_id),auth.uid(),v_row.id,v_line.id);
   update public.sales_delivery_lines set inventory_issue_id=v_issue_id where id=v_line.id;
   insert into public.inventory_movements(id,lot_id,movement_type,loose_unit_change,base_unit_change,reason,actor_user_id)
   values(gen_random_uuid(),v_lot.id,'consumer_issue',-v_line.quantity,-v_line.quantity,'Delivery '||v_row.delivery_number||' · '||trim(p_tracking_reference),auth.uid());
  end loop;
 end if;
 if p_action='cancel' and v_from in ('packing','ready') then
  for v_line in select lot_id,sum(quantity)::integer quantity from public.sales_delivery_lines where delivery_note_id=v_row.id group by lot_id order by lot_id loop
   select * into v_lot from public.inventory_lots where id=v_line.lot_id for update;
   if not found or v_lot.reserved_units<v_line.quantity then raise exception 'Reserved Haadi stock is inconsistent; cancellation stopped'; end if;
   update public.inventory_lots set reserved_units=reserved_units-v_line.quantity,version=version+1,updated_at=now() where id=v_line.lot_id;
  end loop;
 end if;

 v_reference:=case
  when p_action='tax_invoice' then trim(p_proof_reference)
  when p_action='dispatch' then trim(p_tracking_reference)
  when p_action in ('deliver','cancel') then trim(p_proof_reference)
  when p_action='send_to_sales' then 'Sent to downstairs sales'
  when p_action='start_packing' then 'Packing started'
  else 'Packing and stock checked'
 end;
 update public.sales_delivery_notes set status=v_to,version=version+1,updated_at=now(),
  tax_invoice_reference=case when p_action='tax_invoice' then trim(p_proof_reference) else tax_invoice_reference end,
  carrier=case when p_action='dispatch' then trim(p_carrier) else carrier end,
  tracking_reference=case when p_action='dispatch' then trim(p_tracking_reference) else tracking_reference end,
  dispatched_by=case when p_action='dispatch' then auth.uid() else dispatched_by end,
  dispatched_at=case when p_action='dispatch' then now() else dispatched_at end,
  recipient_name=case when p_action='deliver' then trim(p_recipient_name) else recipient_name end,
  proof_reference=case when p_action='deliver' then trim(p_proof_reference) else proof_reference end,
  delivered_by=case when p_action='deliver' then auth.uid() else delivered_by end,
  delivered_at=case when p_action='deliver' then now() else delivered_at end
 where id=v_row.id returning * into v_row;
 insert into public.sales_delivery_events(id,delivery_note_id,from_status,to_status,reference,actor_user_id)
 values(gen_random_uuid(),v_row.id,v_from,v_to,v_reference,auth.uid());
 return v_row;
end $function$;

commit;
