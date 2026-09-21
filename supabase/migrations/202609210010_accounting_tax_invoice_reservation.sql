begin;

create or replace function public.guard_tax_invoice_stock_reservation()
returns trigger language plpgsql set search_path=public,pg_temp as $$
declare v_required integer; v_allocated integer; v_reserved integer; v_line record;
begin
 if old.status='accounts_approved' and new.status='tax_invoice_created' then
  for v_line in select id,quantity from public.sales_proforma_lines where proforma_id=new.proforma_id loop
   select coalesce(sum(dl.quantity),0)::integer into v_allocated
   from public.sales_delivery_lines dl join public.sales_delivery_notes dn on dn.id=dl.delivery_note_id
   where dl.proforma_line_id=v_line.id and dl.delivery_note_id<>new.id and dn.status<>'cancelled';
   v_required:=v_line.quantity-v_allocated;
   select coalesce(sum(quantity),0)::integer into v_allocated from public.sales_delivery_lines where delivery_note_id=new.id and proforma_line_id=v_line.id;
   if v_allocated<>v_required then raise exception 'Tax Invoice must reserve stock for every remaining accepted Pro forma quantity'; end if;
  end loop;
  select count(*) into v_required from public.sales_delivery_lines where delivery_note_id=new.id;
  if v_required=0 then raise exception 'Tax Invoice must reserve stock before it is created'; end if;
  for v_line in select lot_id,sum(quantity)::integer quantity from public.sales_delivery_lines where delivery_note_id=new.id group by lot_id loop
   select reserved_units into v_reserved from public.inventory_lots where id=v_line.lot_id;
   if v_reserved<v_line.quantity then raise exception 'Tax Invoice stock reservation is incomplete'; end if;
  end loop;
 end if;
 return new;
end $$;

create trigger sales_tax_invoice_requires_stock before update of status on public.sales_delivery_notes
for each row execute function public.guard_tax_invoice_stock_reservation();

create or replace function public.release_cancelled_tax_invoice_stock()
returns trigger language plpgsql set search_path=public,pg_temp as $$
declare v_line record; v_lot public.inventory_lots;
begin
 if new.status='cancelled' and old.status in ('tax_invoice_created','sent_to_sales') then
  for v_line in select lot_id,sum(quantity)::integer quantity from public.sales_delivery_lines where delivery_note_id=new.id group by lot_id order by lot_id loop
   select * into v_lot from public.inventory_lots where id=v_line.lot_id for update;
   if not found or v_lot.reserved_units<v_line.quantity then raise exception 'Reserved Haadi stock is inconsistent; cancellation stopped'; end if;
   update public.inventory_lots set reserved_units=reserved_units-v_line.quantity,version=version+1,updated_at=now() where id=v_line.lot_id;
  end loop;
 end if;
 return new;
end $$;

create trigger release_cancelled_tax_invoice_stock before update of status on public.sales_delivery_notes
for each row execute function public.release_cancelled_tax_invoice_stock();

create or replace function public.create_tax_invoice_and_reserve_stock(p_id uuid,p_expected_version integer,p_tax_invoice_reference text)
returns public.sales_delivery_notes language plpgsql security definer set search_path=public,pg_temp as $$
declare v_row public.sales_delivery_notes; v_line record; v_lot public.inventory_lots; v_needed integer; v_take integer;
begin
 if not public.inventory_active_staff() then raise exception 'Active staff access is required'; end if;
 if length(trim(coalesce(p_tax_invoice_reference,''))) not between 2 and 120 then raise exception 'Enter a valid Tax Invoice number or reference'; end if;
 select * into v_row from public.sales_delivery_notes where id=p_id and version=p_expected_version and status='accounts_approved' for update;
 if not found then raise exception 'Accounts order changed; refresh before creating the Tax Invoice'; end if;
 if exists(select 1 from public.sales_delivery_lines where delivery_note_id=v_row.id) then raise exception 'Stock is already allocated to this order'; end if;

 for v_line in select id,product_id,quantity from public.sales_proforma_lines where proforma_id=v_row.proforma_id order by sort_order,id loop
  select v_line.quantity-coalesce(sum(dl.quantity),0)::integer into v_needed
  from public.sales_delivery_lines dl join public.sales_delivery_notes dn on dn.id=dl.delivery_note_id
  where dl.proforma_line_id=v_line.id and dl.delivery_note_id<>v_row.id and dn.status<>'cancelled';
  if v_needed<=0 then continue; end if;
  for v_lot in
   select lot.* from public.inventory_lots lot join public.inventory_locations location on location.id=lot.location_id
   where lot.product_id=v_line.product_id and lot.stock_status='available' and location.active=true and location.is_dispatch_hub=true
    and lot.loose_units-lot.reserved_units>0
   order by lot.expiry_date nulls last,lot.created_at,lot.id for update of lot
  loop
   v_take:=least(v_needed,v_lot.loose_units-v_lot.reserved_units);
   update public.inventory_lots set reserved_units=reserved_units+v_take,version=version+1,updated_at=now() where id=v_lot.id;
   insert into public.sales_delivery_lines(id,delivery_note_id,proforma_line_id,product_id,lot_id,quantity)
   values(gen_random_uuid(),v_row.id,v_line.id,v_line.product_id,v_lot.id,v_take);
   v_needed:=v_needed-v_take;
   exit when v_needed=0;
  end loop;
  if v_needed>0 then raise exception 'Not enough available stock at Haadi for product %; Tax Invoice was not created',v_line.product_id; end if;
 end loop;

 update public.sales_delivery_notes set status='tax_invoice_created',tax_invoice_reference=trim(p_tax_invoice_reference),version=version+1,updated_at=now()
 where id=v_row.id returning * into v_row;
 insert into public.sales_delivery_events(id,delivery_note_id,from_status,to_status,reference,actor_user_id)
 values(gen_random_uuid(),v_row.id,'accounts_approved','tax_invoice_created',v_row.tax_invoice_reference,auth.uid());
 return v_row;
end $$;

create or replace function public.start_reserved_sales_delivery_packing(p_id uuid,p_expected_version integer)
returns public.sales_delivery_notes language plpgsql security definer set search_path=public,pg_temp as $$
declare v_row public.sales_delivery_notes; v_line record; v_lot public.inventory_lots;
begin
 if not public.inventory_active_staff() then raise exception 'Active staff access is required'; end if;
 select * into v_row from public.sales_delivery_notes where id=p_id and version=p_expected_version and status='sent_to_sales' for update;
 if not found then raise exception 'Delivery changed; refresh before starting packing'; end if;
 if not exists(select 1 from public.sales_delivery_lines where delivery_note_id=v_row.id) then raise exception 'The Tax Invoice has no reserved stock'; end if;
 for v_line in select lot_id,sum(quantity)::integer quantity from public.sales_delivery_lines where delivery_note_id=v_row.id group by lot_id order by lot_id loop
  select lot.* into v_lot from public.inventory_lots lot join public.inventory_locations location on location.id=lot.location_id
  where lot.id=v_line.lot_id and lot.stock_status='available' and location.active=true and location.is_dispatch_hub=true for update of lot;
  if not found or v_lot.reserved_units<v_line.quantity or v_lot.loose_units<v_line.quantity then raise exception 'Reserved Haadi stock is no longer sufficient for this delivery'; end if;
 end loop;
 update public.sales_delivery_notes set status='packing',version=version+1,updated_at=now() where id=v_row.id returning * into v_row;
 insert into public.sales_delivery_events(id,delivery_note_id,from_status,to_status,reference,actor_user_id)
 values(gen_random_uuid(),v_row.id,'sent_to_sales','packing','Packing started from Tax Invoice reservation',auth.uid());
 return v_row;
end $$;

revoke all on function public.create_tax_invoice_and_reserve_stock(uuid,integer,text),public.start_reserved_sales_delivery_packing(uuid,integer) from public,anon;
grant execute on function public.create_tax_invoice_and_reserve_stock(uuid,integer,text),public.start_reserved_sales_delivery_packing(uuid,integer) to authenticated;

commit;
