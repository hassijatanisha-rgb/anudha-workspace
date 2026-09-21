begin;

alter table public.sales_delivery_notes drop constraint sales_delivery_notes_status_check;
alter table public.sales_delivery_notes alter column status set default 'accounts_approved';
alter table public.sales_delivery_notes add column tax_invoice_reference text check (tax_invoice_reference is null or length(trim(tax_invoice_reference)) between 2 and 120);

alter table public.sales_delivery_notes add constraint sales_delivery_notes_status_check
 check (status in ('draft','accounts_approved','tax_invoice_created','sent_to_sales','packing','ready','out_for_delivery','delivered','cancelled'));
alter table public.sales_delivery_notes add constraint sales_delivery_notes_carrier_length check (carrier is null or length(trim(carrier)) between 2 and 200);
alter table public.sales_delivery_notes add constraint sales_delivery_notes_tracking_length check (tracking_reference is null or length(trim(tracking_reference)) between 2 and 200);
alter table public.sales_delivery_notes add constraint sales_delivery_notes_recipient_length check (recipient_name is null or length(trim(recipient_name)) between 2 and 200);
alter table public.sales_delivery_notes add constraint sales_delivery_notes_proof_length check (proof_reference is null or length(trim(proof_reference)) between 2 and 500);

create or replace function public.normalize_sales_delivery_initial_event()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
 if new.to_status='draft' then new.to_status:='accounts_approved'; end if;
 return new;
end $$;

create trigger normalize_sales_delivery_initial_event
before insert on public.sales_delivery_events
for each row execute function public.normalize_sales_delivery_initial_event();

create or replace function public.create_sales_delivery_note(
 p_id uuid,p_proforma_id uuid,p_expected_proforma_version integer,p_accounts_reference text,p_expected_delivery_date date,p_lines jsonb
)
returns public.sales_delivery_notes language plpgsql security definer set search_path=public,pg_temp as $$
declare v_proforma public.sales_proformas; v_row public.sales_delivery_notes; v_number text;
begin
 if not public.inventory_active_staff() then raise exception 'Active staff access is required'; end if;
 if length(trim(coalesce(p_accounts_reference,''))) not between 2 and 120 then raise exception 'Enter the Accounts approval reference'; end if;
 if p_expected_delivery_date is null or p_expected_delivery_date<current_date then raise exception 'Expected delivery date cannot be in the past'; end if;
 select * into v_proforma from public.sales_proformas where id=p_proforma_id and version=p_expected_proforma_version and status='accepted' for update;
 if not found then raise exception 'Submitted Pro forma changed; refresh before recording approval'; end if;
 if exists(select 1 from public.sales_delivery_notes where proforma_id=p_proforma_id and status not in ('cancelled','delivered')) then raise exception 'This Pro forma already has an open delivery'; end if;
 if not exists(
  select 1 from public.sales_proforma_lines pl where pl.proforma_id=p_proforma_id and pl.quantity>
   coalesce((select sum(dl.quantity) from public.sales_delivery_lines dl join public.sales_delivery_notes dn on dn.id=dl.delivery_note_id where dl.proforma_line_id=pl.id and dn.status<>'cancelled'),0)
 ) then raise exception 'Every accepted quantity is already assigned to a delivery'; end if;
 v_number:='DN-'||to_char(current_date,'YYYY')||'-'||lpad(nextval('public.delivery_note_number_seq')::text,6,'0');
 insert into public.sales_delivery_notes(id,delivery_number,proforma_id,organization_id,contact_id,accounts_reference,expected_delivery_date,created_by)
 values(p_id,v_number,v_proforma.id,v_proforma.organization_id,v_proforma.contact_id,trim(p_accounts_reference),p_expected_delivery_date,auth.uid()) returning * into v_row;
 insert into public.sales_delivery_events(id,delivery_note_id,to_status,reference,actor_user_id)
 values(gen_random_uuid(),v_row.id,'accounts_approved',v_row.accounts_reference,auth.uid());
 return v_row;
end $$;

create or replace function public.start_sales_delivery_packing(p_id uuid,p_expected_version integer,p_lines jsonb)
returns public.sales_delivery_notes language plpgsql security definer set search_path=public,pg_temp as $$
declare v_row public.sales_delivery_notes; v_count integer; v_line record; v_lot public.inventory_lots;
begin
 if not public.inventory_active_staff() then raise exception 'Active staff access is required'; end if;
 if jsonb_typeof(p_lines)<>'array' or jsonb_array_length(p_lines) not between 1 and 100 then raise exception 'Choose at least one item to pack'; end if;
 select * into v_row from public.sales_delivery_notes where id=p_id and version=p_expected_version and status='sent_to_sales' for update;
 if not found then raise exception 'Delivery changed; refresh before starting packing'; end if;
 if exists(select 1 from public.sales_delivery_lines where delivery_note_id=p_id) then raise exception 'Packing stock has already been selected'; end if;
 if exists(select 1 from jsonb_array_elements(p_lines) line where coalesce((line->>'quantity')::integer,0) not between 1 and 1000000) then raise exception 'Every packing quantity must be a positive whole number'; end if;
 select count(*) into v_count from jsonb_array_elements(p_lines) line
 join public.sales_proforma_lines pl on pl.id=(line->>'proformaLineId')::uuid and pl.proforma_id=v_row.proforma_id
 join public.inventory_lots lot on lot.id=(line->>'lotId')::uuid and lot.product_id=pl.product_id and lot.stock_status='available'
 join public.inventory_locations location on location.id=lot.location_id and location.active=true and location.is_dispatch_hub=true;
 if v_count<>jsonb_array_length(p_lines) then raise exception 'Every packing item must use matching available stock at Haadi'; end if;
 if exists(
  select 1 from (
   select pl.id,pl.quantity,
    coalesce((select sum(dl.quantity) from public.sales_delivery_lines dl join public.sales_delivery_notes dn on dn.id=dl.delivery_note_id where dl.proforma_line_id=pl.id and dn.status<>'cancelled'),0)+
    coalesce((select sum((line->>'quantity')::integer) from jsonb_array_elements(p_lines) line where (line->>'proformaLineId')::uuid=pl.id),0) as allocated
   from public.sales_proforma_lines pl where pl.proforma_id=v_row.proforma_id
  ) totals where allocated>quantity
 ) then raise exception 'A packing quantity exceeds the submitted Pro forma balance'; end if;
 for v_line in select (line->>'lotId')::uuid lot_id,sum((line->>'quantity')::integer)::integer quantity from jsonb_array_elements(p_lines) line group by (line->>'lotId')::uuid order by (line->>'lotId')::uuid loop
  select * into v_lot from public.inventory_lots where id=v_line.lot_id for update;
  if v_lot.loose_units-v_lot.reserved_units<v_line.quantity then raise exception 'Haadi stock is no longer sufficient for this packing list'; end if;
  update public.inventory_lots set reserved_units=reserved_units+v_line.quantity,version=version+1,updated_at=now() where id=v_lot.id;
 end loop;
 insert into public.sales_delivery_lines(id,delivery_note_id,proforma_line_id,product_id,lot_id,quantity)
 select gen_random_uuid(),v_row.id,pl.id,pl.product_id,(line->>'lotId')::uuid,(line->>'quantity')::integer
 from jsonb_array_elements(p_lines) line join public.sales_proforma_lines pl on pl.id=(line->>'proformaLineId')::uuid;
 update public.sales_delivery_notes set status='packing',version=version+1,updated_at=now() where id=v_row.id returning * into v_row;
 insert into public.sales_delivery_events(id,delivery_note_id,from_status,to_status,reference,actor_user_id)
 values(gen_random_uuid(),v_row.id,'sent_to_sales','packing','Packing started and stock reserved',auth.uid());
 return v_row;
end $$;

create or replace function public.advance_sales_delivery(
 p_id uuid,p_expected_version integer,p_action text,p_carrier text default '',p_tracking_reference text default '',p_recipient_name text default '',p_proof_reference text default ''
)
returns public.sales_delivery_notes language plpgsql security definer set search_path=public,pg_temp as $$
declare v_row public.sales_delivery_notes; v_from text; v_to text; v_line record; v_lot public.inventory_lots; v_issue_id uuid; v_reference text;
begin
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
end $$;

revoke all on function public.advance_sales_delivery(uuid,integer,text,text,text,text,text) from public,anon;
grant execute on function public.advance_sales_delivery(uuid,integer,text,text,text,text,text) to authenticated;
revoke all on function public.start_sales_delivery_packing(uuid,integer,jsonb) from public,anon;
grant execute on function public.start_sales_delivery_packing(uuid,integer,jsonb) to authenticated;

commit;
