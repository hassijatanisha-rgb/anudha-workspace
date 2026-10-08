-- REVIEW CANDIDATE ONLY: not numbered or approved for activation.
-- Baseline: immutable migration 046. Functions only; no data/role changes.
-- Obtain independent review, current migration-number coordination and activation approval.
-- Forward-only correction; reverting these predicates would restore unsafe retry acceptance.
begin;
create or replace function public.save_supplier(p_id uuid, p_expected_version integer, p_fields jsonb)
returns public.suppliers language plpgsql security definer set search_path=public,pg_temp as $$
declare v_row public.suppliers; v_new public.suppliers; v_active boolean;
begin
 if not public.inventory_active_staff() then raise exception 'Active staff access is required'; end if;
 if p_id is null or p_expected_version is null or p_expected_version < 0 or p_fields is null or jsonb_typeof(p_fields) <> 'object' then raise exception 'Supplier request, expected version and fields are required'; end if;
 v_active := coalesce((p_fields->>'active')::boolean, true);
 perform pg_advisory_xact_lock(hashtextextended('supplier:'||p_id::text,0));
 select * into v_row from public.suppliers where id=p_id for update;
 if p_expected_version = 0 then
  if found then
   if v_row.created_by=auth.uid() and v_row.version=1
    and row(v_row.name,v_row.country,v_row.contact_name,v_row.phone,v_row.email,v_row.tin,v_row.payment_terms,v_row.notes,v_row.active)
     is not distinct from row(trim(coalesce(p_fields->>'name','')),trim(coalesce(p_fields->>'country','')),
      trim(coalesce(p_fields->>'contact_name','')),trim(coalesce(p_fields->>'phone','')),lower(trim(coalesce(p_fields->>'email',''))),
      trim(coalesce(p_fields->>'tin','')),trim(coalesce(p_fields->>'payment_terms','')),coalesce(p_fields->>'notes',''),v_active) then return v_row; end if;
   raise exception 'Supplier already exists; refresh and compare';
  end if;
  if not v_active then raise exception 'New suppliers start active'; end if;
  begin
   insert into public.suppliers(id,supplier_number,name,country,contact_name,phone,email,tin,payment_terms,notes,created_by)
   values(p_id,'SUP-'||lpad(nextval('public.supplier_number_seq')::text,6,'0'),trim(coalesce(p_fields->>'name','')),trim(coalesce(p_fields->>'country','')),
    trim(coalesce(p_fields->>'contact_name','')),trim(coalesce(p_fields->>'phone','')),lower(trim(coalesce(p_fields->>'email',''))),trim(coalesce(p_fields->>'tin','')),
    trim(coalesce(p_fields->>'payment_terms','')),coalesce(p_fields->>'notes',''),auth.uid())
   returning * into v_new;
  exception when unique_violation then raise exception 'A supplier with this name already exists';
  end;
  return v_new;
 end if;
 if not found then raise exception 'Supplier not found'; end if;
 if v_row.version <> p_expected_version then raise exception 'Supplier changed; refresh and compare'; end if;
 if v_active is distinct from v_row.active and not public.inventory_owner() then raise exception 'Only the owner can deactivate or reactivate a supplier'; end if;
 begin
  update public.suppliers set name=trim(coalesce(p_fields->>'name','')),country=trim(coalesce(p_fields->>'country','')),contact_name=trim(coalesce(p_fields->>'contact_name','')),
   phone=trim(coalesce(p_fields->>'phone','')),email=lower(trim(coalesce(p_fields->>'email',''))),tin=trim(coalesce(p_fields->>'tin','')),
   payment_terms=trim(coalesce(p_fields->>'payment_terms','')),notes=coalesce(p_fields->>'notes',''),active=v_active,version=version+1,updated_at=now()
  where id=p_id returning * into v_new;
 exception when unique_violation then raise exception 'A supplier with this name already exists';
 end;
 return v_new;
end $$;
create or replace function public.save_purchase_request(p_id uuid, p_expected_version integer, p_supplier_id uuid, p_currency text, p_expected_on date, p_notes text, p_lines jsonb)
returns public.purchase_orders language plpgsql security definer set search_path=public,pg_temp as $$
declare v_row public.purchase_orders; v_new public.purchase_orders; v_line jsonb; v_n integer := 0; v_product uuid; v_qty integer; v_price bigint; v_pending uuid;
begin
 if not public.inventory_active_staff() then raise exception 'Active staff access is required'; end if;
 if p_id is null or p_expected_version is null or p_expected_version < 0 then raise exception 'Purchase request and expected version are required'; end if;
 if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) not between 1 and 200 then raise exception 'Add between 1 and 200 items'; end if;
 if coalesce(p_currency,'TZS') not in ('TZS','USD','EUR') then raise exception 'Choose TZS, USD or EUR'; end if;
 if length(coalesce(p_notes,'')) > 4000 then raise exception 'Notes are too long'; end if;
 if p_supplier_id is not null and not exists(select 1 from public.suppliers where id=p_supplier_id and active) then raise exception 'Choose an active supplier'; end if;
 perform pg_advisory_xact_lock(hashtextextended('purchase:'||p_id::text,0));
 select * into v_row from public.purchase_orders where id=p_id for update;
 if p_expected_version = 0 then
  if found then
   if v_row.requested_by=auth.uid() and v_row.version=1 and v_row.status='requested'
    and row(v_row.supplier_id,v_row.currency,v_row.expected_on,v_row.notes)
     is not distinct from row(p_supplier_id,coalesce(p_currency,'TZS'),p_expected_on,coalesce(p_notes,''))
    and (select jsonb_agg(jsonb_build_array(product_id,quantity,unit_price_minor,pending_request_id,note) order by line_number)
     from public.purchase_order_lines where purchase_order_id=p_id)
     = (select jsonb_agg(jsonb_build_array((item->>'product_id')::uuid,(item->>'quantity')::integer,
       nullif(item->>'unit_price_minor','')::bigint,nullif(item->>'pending_request_id','')::uuid,left(coalesce(item->>'note',''),500)) order by position)
      from jsonb_array_elements(p_lines) with ordinality as incoming(item,position)) then return v_row; end if;
   raise exception 'Purchase request already exists; refresh and compare';
  end if;
  insert into public.purchase_orders(id,po_number,status,supplier_id,currency,expected_on,notes,requested_by)
  values(p_id,'PO-'||lpad(nextval('public.purchase_order_number_seq')::text,6,'0'),'requested',p_supplier_id,coalesce(p_currency,'TZS'),p_expected_on,coalesce(p_notes,''),auth.uid())
  returning * into v_new;
  insert into public.purchase_order_events(purchase_order_id,action,from_status,to_status,note,actor_user_id) values(p_id,'request',null,'requested','',auth.uid());
 else
  if not found then raise exception 'Purchase request not found'; end if;
  if v_row.version <> p_expected_version then raise exception 'Purchase request changed; refresh and compare'; end if;
  if v_row.status <> 'requested' then raise exception 'Only a request that is not yet approved can be edited'; end if;
  delete from public.purchase_order_lines where purchase_order_id=p_id;
  update public.purchase_orders set supplier_id=p_supplier_id,currency=coalesce(p_currency,'TZS'),expected_on=p_expected_on,notes=coalesce(p_notes,''),version=version+1,updated_at=now()
  where id=p_id returning * into v_new;
  insert into public.purchase_order_events(purchase_order_id,action,from_status,to_status,note,actor_user_id) values(p_id,'edit','requested','requested','Items or details changed',auth.uid());
 end if;
 for v_line in select value from jsonb_array_elements(p_lines) loop
  v_n := v_n + 1;
  begin
   v_product := (v_line->>'product_id')::uuid; v_qty := (v_line->>'quantity')::integer;
   v_price := nullif(v_line->>'unit_price_minor','')::bigint; v_pending := nullif(v_line->>'pending_request_id','')::uuid;
  exception when others then raise exception 'Item % has an invalid product, quantity, price or pending order', v_n;
  end;
  if v_product is null or not exists(select 1 from public.products where id=v_product and deleted_at is null) then raise exception 'Item % needs an active product', v_n; end if;
  if v_qty is null or v_qty not between 1 and 1000000 then raise exception 'Item % needs a whole quantity from 1 to 1,000,000', v_n; end if;
  if v_price is not null and v_price < 0 then raise exception 'Item % has a negative price', v_n; end if;
  if v_pending is not null and not exists(select 1 from public.pending_stock_requests where id=v_pending and product_id=v_product) then raise exception 'Item % is linked to a pending order for a different product', v_n; end if;
  insert into public.purchase_order_lines(purchase_order_id,line_number,product_id,quantity,unit_price_minor,pending_request_id,note)
  values(p_id,v_n,v_product,v_qty,v_price,v_pending,left(coalesce(v_line->>'note',''),500));
 end loop;
 return v_new;
end $$;
commit;
