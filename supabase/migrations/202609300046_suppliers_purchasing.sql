-- Suppliers and purchase orders (request → owner approval → ordered with LPO → closed or cancelled).
-- Additive only. Nothing here changes stock: receiving goods into stock belongs to the inventory receive workflow.
-- Prices are optional quotes; no accounting entries are created.
-- Rollback: hide the UI and revoke the RPCs in a reviewed forward migration; keep rows and history.
begin;

create sequence public.supplier_number_seq;
create sequence public.purchase_order_number_seq;

create table public.suppliers (
 id uuid primary key,
 supplier_number text not null unique,
 name text not null check (length(trim(name)) between 2 and 200),
 country text not null default '' check (length(country) <= 100),
 contact_name text not null default '' check (length(contact_name) <= 200),
 phone text not null default '' check (length(phone) <= 60),
 email text not null default '' check (length(email) <= 320 and (email = '' or email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')),
 tin text not null default '' check (length(tin) <= 60),
 payment_terms text not null default '' check (length(payment_terms) <= 300),
 notes text not null default '' check (length(notes) <= 4000),
 active boolean not null default true,
 version integer not null default 1 check (version > 0),
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
-- The same supplier cannot be entered twice under different capitalisation or spacing.
create unique index suppliers_unique_name on public.suppliers (lower(regexp_replace(trim(name),'\s+',' ','g')));
create index suppliers_created_by on public.suppliers(created_by);

create table public.purchase_orders (
 id uuid primary key,
 po_number text not null unique,
 status text not null check (status in ('requested','approved','ordered','closed','cancelled')),
 supplier_id uuid references public.suppliers(id),
 currency text not null default 'TZS' check (currency in ('TZS','USD','EUR')),
 expected_on date,
 lpo_reference text not null default '' check (length(lpo_reference) <= 120),
 notes text not null default '' check (length(notes) <= 4000),
 requested_by uuid not null references auth.users(id),
 approved_by uuid references auth.users(id),
 approved_at timestamptz,
 ordered_by uuid references auth.users(id),
 ordered_at timestamptz,
 closed_by uuid references auth.users(id),
 closed_at timestamptz,
 close_note text not null default '' check (length(close_note) <= 1000),
 version integer not null default 1 check (version > 0),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 check (status not in ('approved','ordered','closed') or (approved_by is not null and approved_at is not null)),
 check (status not in ('ordered','closed') or (ordered_by is not null and ordered_at is not null and supplier_id is not null and length(trim(lpo_reference)) >= 2)),
 check ((status in ('closed','cancelled')) = (closed_by is not null and closed_at is not null)),
 check (status <> 'cancelled' or length(trim(close_note)) >= 3)
);
create index purchase_orders_status on public.purchase_orders(status, expected_on nulls last, id);
create index purchase_orders_supplier on public.purchase_orders(supplier_id);
create index purchase_orders_requested_by on public.purchase_orders(requested_by);
create index purchase_orders_approved_by on public.purchase_orders(approved_by);
create index purchase_orders_ordered_by on public.purchase_orders(ordered_by);
create index purchase_orders_closed_by on public.purchase_orders(closed_by);

create table public.purchase_order_lines (
 id uuid primary key default gen_random_uuid(),
 purchase_order_id uuid not null references public.purchase_orders(id),
 line_number integer not null check (line_number between 1 and 200),
 product_id uuid not null references public.products(id),
 quantity integer not null check (quantity between 1 and 1000000),
 unit_price_minor bigint check (unit_price_minor is null or unit_price_minor >= 0),
 pending_request_id uuid references public.pending_stock_requests(id),
 note text not null default '' check (length(note) <= 500),
 unique (purchase_order_id, line_number)
);
create index purchase_order_lines_product on public.purchase_order_lines(product_id);
create index purchase_order_lines_pending on public.purchase_order_lines(pending_request_id);

create table public.purchase_order_events (
 id uuid primary key default gen_random_uuid(),
 purchase_order_id uuid not null references public.purchase_orders(id),
 action text not null,
 from_status text,
 to_status text not null,
 note text not null default '',
 actor_user_id uuid not null references auth.users(id),
 created_at timestamptz not null default now()
);
create index purchase_order_events_order on public.purchase_order_events(purchase_order_id, created_at);
create index purchase_order_events_actor on public.purchase_order_events(actor_user_id);

create function public.deny_purchasing_delete()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin raise exception 'Purchasing records are never hard-deleted and history is immutable'; end $$;
create trigger suppliers_no_delete before delete on public.suppliers for each row execute function public.deny_purchasing_delete();
create trigger purchase_orders_no_delete before delete on public.purchase_orders for each row execute function public.deny_purchasing_delete();
create trigger purchase_order_events_immutable before update or delete on public.purchase_order_events for each row execute function public.deny_purchasing_delete();
create trigger suppliers_no_truncate before truncate on public.suppliers for each statement execute function public.deny_purchasing_delete();
create trigger purchase_orders_no_truncate before truncate on public.purchase_orders for each statement execute function public.deny_purchasing_delete();
create trigger purchase_order_lines_no_truncate before truncate on public.purchase_order_lines for each statement execute function public.deny_purchasing_delete();
create trigger purchase_order_events_no_truncate before truncate on public.purchase_order_events for each statement execute function public.deny_purchasing_delete();
-- Lines may only be replaced while the order is still a request.
create function public.guard_purchase_order_lines()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
 if (select status from public.purchase_orders where id=coalesce(old.purchase_order_id,new.purchase_order_id)) <> 'requested' then
  raise exception 'Items can only change while the purchase order is a request';
 end if;
 return coalesce(new,old);
end $$;
create trigger purchase_order_lines_guard before insert or update or delete on public.purchase_order_lines for each row execute function public.guard_purchase_order_lines();

alter table public.suppliers enable row level security;
alter table public.purchase_orders enable row level security;
alter table public.purchase_order_lines enable row level security;
alter table public.purchase_order_events enable row level security;
create policy suppliers_read on public.suppliers for select to authenticated using ((select public.inventory_active_staff()));
create policy purchase_orders_read on public.purchase_orders for select to authenticated using ((select public.inventory_active_staff()));
create policy purchase_order_lines_read on public.purchase_order_lines for select to authenticated using ((select public.inventory_active_staff()));
create policy purchase_order_events_read on public.purchase_order_events for select to authenticated using ((select public.inventory_active_staff()));
revoke all on public.suppliers, public.purchase_orders, public.purchase_order_lines, public.purchase_order_events from public, anon, authenticated;
grant select on public.suppliers, public.purchase_orders, public.purchase_order_lines, public.purchase_order_events to authenticated;
revoke all on sequence public.supplier_number_seq, public.purchase_order_number_seq from public, anon, authenticated;

-- Create (expected version 0) or edit a supplier. Any active staff member may add or edit; only the owner may deactivate or reactivate.
create function public.save_supplier(p_id uuid, p_expected_version integer, p_fields jsonb)
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
   if v_row.created_by=auth.uid() and v_row.version=1 and v_row.name=trim(coalesce(p_fields->>'name','')) then return v_row; end if;
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

-- Create or edit a purchase request and replace its items in one step. Only possible while status is 'requested'.
-- p_lines: [{"product_id":uuid,"quantity":int,"unit_price_minor":int|null,"pending_request_id":uuid|null,"note":text}]
create function public.save_purchase_request(p_id uuid, p_expected_version integer, p_supplier_id uuid, p_currency text, p_expected_on date, p_notes text, p_lines jsonb)
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
    and (select count(*) from public.purchase_order_lines where purchase_order_id=p_id)=jsonb_array_length(p_lines) then return v_row; end if;
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

-- approve (owner) → order (supplier + LPO reference) → close (goods arrived note); cancel with a reason before closing.
create function public.advance_purchase_order(p_id uuid, p_expected_version integer, p_action text, p_note text default '', p_lpo_reference text default '', p_expected_on date default null)
returns public.purchase_orders language plpgsql security definer set search_path=public,pg_temp as $$
declare v_row public.purchase_orders; v_new public.purchase_orders; v_note text := trim(coalesce(p_note,'')); v_lpo text := trim(coalesce(p_lpo_reference,''));
begin
 if not public.inventory_active_staff() then raise exception 'Active staff access is required'; end if;
 if p_id is null or p_expected_version is null or p_action is null then raise exception 'Purchase order, expected version and action are required'; end if;
 if length(v_note) > 1000 or length(v_lpo) > 120 then raise exception 'Note or LPO reference is too long'; end if;
 perform pg_advisory_xact_lock(hashtextextended('purchase:'||p_id::text,0));
 select * into v_row from public.purchase_orders where id=p_id for update;
 if not found then raise exception 'Purchase order not found'; end if;
 if v_row.version <> p_expected_version then raise exception 'Purchase order changed; refresh and compare'; end if;
 if p_action='approve' then
  if not public.inventory_owner() then raise exception 'Only the owner can approve purchases'; end if;
  if v_row.status <> 'requested' then raise exception 'Only a request can be approved'; end if;
  update public.purchase_orders set status='approved',approved_by=auth.uid(),approved_at=now(),version=version+1,updated_at=now() where id=p_id returning * into v_new;
 elsif p_action='order' then
  if v_row.status <> 'approved' then raise exception 'Approve the purchase before ordering'; end if;
  if v_row.supplier_id is null then raise exception 'Choose the supplier before ordering'; end if;
  if length(v_lpo) < 2 then raise exception 'Enter the LPO number sent to the supplier'; end if;
  if p_expected_on is not null and p_expected_on < current_date then raise exception 'Expected arrival cannot be in the past'; end if;
  update public.purchase_orders set status='ordered',ordered_by=auth.uid(),ordered_at=now(),lpo_reference=v_lpo,expected_on=coalesce(p_expected_on,expected_on),version=version+1,updated_at=now()
  where id=p_id returning * into v_new;
 elsif p_action='close' then
  if v_row.status <> 'ordered' then raise exception 'Only an ordered purchase can be closed'; end if;
  if length(v_note) < 3 then raise exception 'Enter the delivery note or receipt reference'; end if;
  update public.purchase_orders set status='closed',closed_by=auth.uid(),closed_at=now(),close_note=v_note,version=version+1,updated_at=now() where id=p_id returning * into v_new;
 elsif p_action='cancel' then
  if v_row.status in ('closed','cancelled') then raise exception 'This purchase order is already finished'; end if;
  if v_row.status <> 'requested' and not public.inventory_owner() then raise exception 'Only the owner can cancel an approved or ordered purchase'; end if;
  if v_row.status = 'requested' and not public.inventory_owner() and v_row.requested_by <> auth.uid() then raise exception 'Only the requester or the owner can cancel this request'; end if;
  if length(v_note) < 3 then raise exception 'Enter why the purchase is cancelled'; end if;
  update public.purchase_orders set status='cancelled',closed_by=auth.uid(),closed_at=now(),close_note=v_note,version=version+1,updated_at=now() where id=p_id returning * into v_new;
 else
  raise exception 'Unknown purchase action';
 end if;
 insert into public.purchase_order_events(purchase_order_id,action,from_status,to_status,note,actor_user_id)
 values(p_id,p_action,v_row.status,v_new.status,case when p_action='order' then 'LPO '||v_lpo else v_note end,auth.uid());
 return v_new;
end $$;

revoke all on function public.save_supplier(uuid,integer,jsonb), public.save_purchase_request(uuid,integer,uuid,text,date,text,jsonb),
 public.advance_purchase_order(uuid,integer,text,text,text,date) from public, anon;
grant execute on function public.save_supplier(uuid,integer,jsonb), public.save_purchase_request(uuid,integer,uuid,text,date,text,jsonb),
 public.advance_purchase_order(uuid,integer,text,text,text,date) to authenticated;
commit;
