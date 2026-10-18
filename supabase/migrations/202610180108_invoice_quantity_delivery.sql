-- Reserve and deliver each ERP invoice's quantities independently of the accepted order balance.
begin;

create function public.invoice_delivery_quantities(p_invoice_id uuid)
returns table(proforma_line_id uuid,product_id uuid,quantity integer)
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_invoice public.acc_invoices; v_identified integer; v_count integer;
begin
 select i.* into v_invoice from public.acc_invoices i join public.sales_proformas pf
  on pf.id=i.proforma_id and pf.revision=i.proforma_revision and pf.organization_id=i.organization_id
 where i.id=p_invoice_id and i.voided_at is null and pf.status='accepted' and pf.deleted_at is null;
 if not found then raise exception 'This delivery needs an active ERP invoice for the current accepted Pro forma revision'; end if;
 if jsonb_typeof(v_invoice.lines) is distinct from 'array' or jsonb_array_length(v_invoice.lines)=0 then
  raise exception 'The ERP invoice has no valid quantities to deliver';
 end if;
 select count(*),count(*) filter(where item ? 'proforma_line_id') into v_count,v_identified from jsonb_array_elements(v_invoice.lines) item;
 if v_identified not in (0,v_count) then raise exception 'The ERP invoice contains incomplete Pro forma line identities'; end if;
 if v_identified>0 then
  if exists(select 1 from jsonb_array_elements(v_invoice.lines) item
   left join public.sales_proforma_lines pl on pl.id=(item->>'proforma_line_id')::uuid and pl.proforma_id=v_invoice.proforma_id
   where pl.id is null or (item->>'product_id')::uuid is distinct from pl.product_id
    or coalesce(item->>'quantity','') !~ '^[1-9][0-9]*$'
    or (item->>'quantity')::numeric>pl.quantity) then
   raise exception 'ERP invoice quantities do not match the accepted Pro forma';
  end if;
  if exists(select 1 from jsonb_array_elements(v_invoice.lines) item group by item->>'proforma_line_id' having count(*)>1) then
   raise exception 'An ERP invoice cannot contain duplicate Pro forma lines';
  end if;
 end if;
 if exists(select 1 from public.sales_proforma_lines pl where pl.proforma_id=v_invoice.proforma_id
  and (v_identified=0 or exists(select 1 from jsonb_array_elements(v_invoice.lines) item where (item->>'proforma_line_id')::uuid=pl.id))
  and (select c.category from public.product_inventory_classifications c where c.product_id=pl.product_id order by c.version desc limit 1)='non_stock') then
  raise exception 'Non-stock invoice lines are not supported by stock delivery; ask Accounts to handle this order separately';
 end if;
 if v_identified=0 then
  -- Historical invoices covered the complete quote; never infer a partial quantity from a product match.
  return query select pl.id,pl.product_id,pl.quantity from public.sales_proforma_lines pl where pl.proforma_id=v_invoice.proforma_id;
 else
  return query select pl.id,pl.product_id,(item->>'quantity')::integer from jsonb_array_elements(v_invoice.lines) item
   join public.sales_proforma_lines pl on pl.id=(item->>'proforma_line_id')::uuid and pl.proforma_id=v_invoice.proforma_id;
 end if;
end $$;

create function public.assert_delivery_invoice_quantities(p_note public.sales_delivery_notes)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare v_invoice public.acc_invoices; v_line record; v_others bigint; v_current bigint;
begin
 select i.* into v_invoice from public.acc_invoices i join public.sales_proformas pf
  on pf.id=i.proforma_id and pf.revision=i.proforma_revision and pf.organization_id=i.organization_id
 where i.proforma_id=p_note.proforma_id and i.organization_id=p_note.organization_id and i.voided_at is null
  and i.invoice_number=p_note.tax_invoice_reference and (p_note.invoice_id is null or i.id=p_note.invoice_id)
  and pf.status='accepted' and pf.deleted_at is null;
 if not found then raise exception 'This delivery needs its active linked ERP invoice before reservation or dispatch'; end if;
 if not exists(select 1 from public.sales_delivery_lines where delivery_note_id=p_note.id) then
  raise exception 'The ERP invoice must reserve stock before delivery';
 end if;
 if exists(select 1 from public.sales_delivery_lines dl
  left join public.invoice_delivery_quantities(v_invoice.id) q on q.proforma_line_id=dl.proforma_line_id and q.product_id=dl.product_id
  where dl.delivery_note_id=p_note.id and q.proforma_line_id is null) then
  raise exception 'Delivery stock contains quantities outside its linked ERP invoice';
 end if;
 for v_line in select * from public.invoice_delivery_quantities(v_invoice.id) loop
  select coalesce(sum(dl.quantity),0) into v_others from public.sales_delivery_lines dl
   join public.sales_delivery_notes dn on dn.id=dl.delivery_note_id
   where dl.proforma_line_id=v_line.proforma_line_id and dn.id<>p_note.id and dn.status<>'cancelled'
    and (dn.invoice_id=v_invoice.id or (dn.invoice_id is null and dn.proforma_id=v_invoice.proforma_id and dn.tax_invoice_reference=v_invoice.invoice_number));
  select coalesce(sum(dl.quantity),0) into v_current from public.sales_delivery_lines dl
   where dl.delivery_note_id=p_note.id and dl.proforma_line_id=v_line.proforma_line_id;
  if v_current<>v_line.quantity-v_others or v_current<0 then
   raise exception 'Delivery quantities must exactly match the remaining quantities of its linked ERP invoice';
  end if;
 end loop;
 if exists(select 1 from public.sales_proforma_lines pl where pl.proforma_id=p_note.proforma_id and pl.quantity<
  (select coalesce(sum(dl.quantity),0) from public.sales_delivery_lines dl join public.sales_delivery_notes dn on dn.id=dl.delivery_note_id
   where dl.proforma_line_id=pl.id and dn.status<>'cancelled')) then
  raise exception 'Delivery quantities exceed the accepted Pro forma balance';
 end if;
end $$;

create or replace function public.guard_tax_invoice_stock_reservation()
returns trigger language plpgsql set search_path=public,pg_temp as $$
declare v_reserved integer; v_line record;
begin
 if old.status is distinct from new.status and new.status in ('tax_invoice_created','sent_to_sales','packing','ready','out_for_delivery','delivered') then
  perform public.assert_delivery_invoice_quantities(new);
 end if;
 if old.status='accounts_approved' and new.status='tax_invoice_created' then
  for v_line in select lot_id,sum(quantity)::integer quantity from public.sales_delivery_lines where delivery_note_id=new.id group by lot_id loop
   select reserved_units into v_reserved from public.inventory_lots where id=v_line.lot_id;
   if v_reserved is null or v_reserved<v_line.quantity then raise exception 'Tax Invoice stock reservation is incomplete'; end if;
  end loop;
 end if;
 return new;
end $$;

create function public.guard_delivery_invoice_identity()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
 if old.invoice_id is not null and new.invoice_id is distinct from old.invoice_id then
  raise exception 'A delivery cannot change its linked ERP invoice';
 end if;
 if coalesce(old.tax_invoice_reference,'')<>'' and new.tax_invoice_reference is distinct from old.tax_invoice_reference then
  raise exception 'A delivery cannot change its linked ERP invoice reference';
 end if;
 return new;
end $$;
create trigger sales_delivery_invoice_identity before update of invoice_id,tax_invoice_reference on public.sales_delivery_notes
for each row execute function public.guard_delivery_invoice_identity();

create or replace function public.create_tax_invoice_and_reserve_stock(p_id uuid,p_expected_version integer,p_tax_invoice_reference text)
returns public.sales_delivery_notes language plpgsql security definer set search_path=public,pg_temp as $$
declare v_row public.sales_delivery_notes; v_invoice public.acc_invoices; v_candidates uuid[]; v_line record; v_lot public.inventory_lots;
 v_needed integer; v_take integer; v_other_invoice bigint; v_other_order bigint; v_reserved integer:=0;
begin
 perform public.require_access('deliveries');
 if not public.inventory_active_staff() then raise exception 'Active staff access is required'; end if;
 if length(trim(coalesce(p_tax_invoice_reference,'')))>120 then raise exception 'ERP invoice number is too long'; end if;
 -- Invoice creation, cancellation, void and reservation serialize against the same accepted quote.
 perform 1 from public.sales_proformas pf join public.sales_delivery_notes dn on dn.proforma_id=pf.id where dn.id=p_id for update of pf;
 select * into v_row from public.sales_delivery_notes where id=p_id and version=p_expected_version and status='accounts_approved' for update;
 if not found then raise exception 'Accounts order changed; refresh before creating the Tax Invoice'; end if;
 if exists(select 1 from public.sales_delivery_lines where delivery_note_id=v_row.id) then raise exception 'Stock is already allocated to this order'; end if;
 select array_agg(i.id order by i.id) into v_candidates from public.acc_invoices i
  join public.sales_proformas pf on pf.id=i.proforma_id and pf.revision=i.proforma_revision and pf.organization_id=i.organization_id
  where i.proforma_id=v_row.proforma_id and i.organization_id=v_row.organization_id and i.voided_at is null
   and (v_row.invoice_id is null or i.id=v_row.invoice_id)
   and (trim(coalesce(p_tax_invoice_reference,''))='' or i.invoice_number=trim(p_tax_invoice_reference))
   and (v_row.invoice_id is not null or trim(coalesce(p_tax_invoice_reference,''))<>'' or exists(
    select 1 from public.invoice_delivery_quantities(i.id) q where q.quantity>
     (select coalesce(sum(dl.quantity),0) from public.sales_delivery_lines dl join public.sales_delivery_notes dn on dn.id=dl.delivery_note_id
      where dl.proforma_line_id=q.proforma_line_id and dn.status<>'cancelled'
       and (dn.invoice_id=i.id or (dn.invoice_id is null and dn.proforma_id=i.proforma_id and dn.tax_invoice_reference=i.invoice_number)))));
 if coalesce(cardinality(v_candidates),0)=0 then
  raise exception 'No matching active ERP invoice has quantities to deliver for this Pro forma';
 elsif cardinality(v_candidates)>1 then
  raise exception 'More than one active ERP invoice needs delivery; select its exact ERP invoice number';
 end if;
 select * into v_invoice from public.acc_invoices where id=v_candidates[1] for share;
 for v_line in select q.*,pl.quantity ordered_quantity from public.invoice_delivery_quantities(v_invoice.id) q
  join public.sales_proforma_lines pl on pl.id=q.proforma_line_id order by pl.sort_order,pl.id loop
  select coalesce(sum(dl.quantity),0),coalesce(sum(dl.quantity) filter(where dn.invoice_id=v_invoice.id or
   (dn.invoice_id is null and dn.proforma_id=v_invoice.proforma_id and dn.tax_invoice_reference=v_invoice.invoice_number)),0)
   into v_other_order,v_other_invoice from public.sales_delivery_lines dl join public.sales_delivery_notes dn on dn.id=dl.delivery_note_id
   where dl.proforma_line_id=v_line.proforma_line_id and dn.id<>v_row.id and dn.status<>'cancelled';
  v_needed:=v_line.quantity-v_other_invoice;
  if v_needed<0 or v_needed+v_other_order>v_line.ordered_quantity then raise exception 'ERP invoice quantities exceed the remaining accepted Pro forma balance'; end if;
  if v_needed=0 then continue; end if;
  for v_lot in select lot.* from public.inventory_lots lot join public.inventory_locations location on location.id=lot.location_id
   where lot.product_id=v_line.product_id and lot.stock_status='available' and location.active=true and location.is_dispatch_hub=true
    and lot.loose_units-lot.reserved_units>0 and (lot.expiry_date is null or lot.expiry_date>=current_date)
   order by lot.expiry_date nulls last,lot.created_at,lot.id for update of lot loop
   v_take:=least(v_needed,v_lot.loose_units-v_lot.reserved_units);
   update public.inventory_lots set reserved_units=reserved_units+v_take,version=version+1,updated_at=now() where id=v_lot.id;
   insert into public.sales_delivery_lines(id,delivery_note_id,proforma_line_id,product_id,lot_id,quantity)
    values(gen_random_uuid(),v_row.id,v_line.proforma_line_id,v_line.product_id,v_lot.id,v_take);
   v_needed:=v_needed-v_take; v_reserved:=v_reserved+v_take;
   exit when v_needed=0;
  end loop;
  if v_needed>0 then raise exception 'Not enough available stock at Haadi for product %; ERP invoice and reservation were not completed',v_line.product_id; end if;
 end loop;
 if v_reserved=0 then raise exception 'Every quantity on this ERP invoice is already assigned to a delivery'; end if;
 update public.sales_delivery_notes set invoice_id=v_invoice.id,status='tax_invoice_created',tax_invoice_reference=v_invoice.invoice_number,
  version=version+1,updated_at=now() where id=v_row.id returning * into v_row;
 insert into public.sales_delivery_events(id,delivery_note_id,from_status,to_status,reference,actor_user_id)
  values(gen_random_uuid(),v_row.id,'accounts_approved','tax_invoice_created',v_row.tax_invoice_reference,auth.uid());
 return v_row;
end $$;

-- Keep the installed authorization, serial, expiry, ownership and signed-proof checks intact.
do $migration$
declare r record; v_oid oid; v_definition text;
begin
 for r in select * from (values
  ('public.create_sales_delivery_note(uuid,uuid,integer,text,date,jsonb)',
   $old$ if exists(select 1 from public.sales_delivery_notes where proforma_id=p_proforma_id and status not in ('cancelled','delivered')) then raise exception 'This Pro forma already has an open delivery'; end if;$old$,
   $new$ -- Each invoice may have its own delivery, but uninvoiced order balances cannot enter packing.
 if not exists(select 1 from public.acc_invoices i where i.proforma_id=v_proforma.id
  and i.proforma_revision=v_proforma.revision and i.organization_id=v_proforma.organization_id and i.voided_at is null
  and exists(select 1 from public.invoice_delivery_quantities(i.id) q where q.quantity>
   (select coalesce(sum(dl.quantity),0) from public.sales_delivery_lines dl join public.sales_delivery_notes dn on dn.id=dl.delivery_note_id
    where dl.proforma_line_id=q.proforma_line_id and dn.status<>'cancelled'
     and (dn.invoice_id=i.id or (dn.invoice_id is null and dn.proforma_id=i.proforma_id and dn.tax_invoice_reference=i.invoice_number))))) then
  raise exception 'Invoice the ready quantities in Accounts before creating a delivery; every existing invoice quantity is already assigned';
 end if;$new$),
  ('public.advance_sales_delivery(uuid,integer,text,text,text,text,text)',
   $old$ select * into v_row from public.sales_delivery_notes where id=p_id and version=p_expected_version for update;$old$,
   $new$ perform 1 from public.sales_proformas pf join public.sales_delivery_notes dn on dn.proforma_id=pf.id where dn.id=p_id for update of pf;
 select * into v_row from public.sales_delivery_notes where id=p_id and version=p_expected_version for update;$new$),
  ('public.advance_sales_delivery(uuid,integer,text,text,text,text,text)',
   $old$   and i.invoice_number=v_row.tax_invoice_reference and i.voided_at is null$old$,
   $new$   and i.invoice_number=v_row.tax_invoice_reference and i.voided_at is null
   and (v_row.invoice_id is null or i.id=v_row.invoice_id)$new$),
  ('public.advance_sales_delivery(uuid,integer,text,text,text,text,text)',
   $old$ if p_action='dispatch' then
  perform 1 from public.acc_invoices i$old$,
   $new$ if p_action='dispatch' then
  perform public.assert_delivery_invoice_quantities(v_row);
  perform 1 from public.acc_invoices i$new$)
 ) as patches(signature,old_body,new_body) loop
  v_oid:=to_regprocedure(r.signature);
  if v_oid is null then raise exception 'Missing expected invoice quantity function: %',r.signature; end if;
  if not (select prosecdef and prolang=(select oid from pg_language where lanname='plpgsql') from pg_proc where oid=v_oid) then
   raise exception 'Unexpected invoice quantity function security: %',r.signature;
  end if;
  v_definition:=pg_get_functiondef(v_oid);
  if strpos(v_definition,r.new_body)>0 then continue; end if;
  if (length(v_definition)-length(replace(v_definition,r.old_body,'')))/length(r.old_body)<>1 then
   raise exception 'Unexpected invoice quantity function implementation: %',r.signature;
  end if;
  execute replace(v_definition,r.old_body,r.new_body);
 end loop;
end $migration$;

revoke all on function public.invoice_delivery_quantities(uuid),public.assert_delivery_invoice_quantities(public.sales_delivery_notes),
 public.guard_delivery_invoice_identity() from public,anon,authenticated;
revoke all on function public.create_tax_invoice_and_reserve_stock(uuid,integer,text) from public,anon;
grant execute on function public.create_tax_invoice_and_reserve_stock(uuid,integer,text) to authenticated;

commit;
