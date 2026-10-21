-- Receipt identities are permanent; a return reuses the same identity instead of receiving it twice.
-- The rollout snapshot is derived eligibility metadata only. It changes no stock quantity or valuation,
-- invents no serials, and includes in-transit cartons once (dispatch already removed them from their lot).
begin;
lock table public.inventory_lots,public.inventory_transfers in share row exclusive mode;
create table public.inventory_serial_rollout(id boolean primary key default true check(id),started_at timestamptz not null default now());
insert into public.inventory_serial_rollout(id) values(true);
create table public.inventory_legacy_serial_lots(lot_id uuid primary key references public.inventory_lots(id));
insert into public.inventory_legacy_serial_lots select id from public.inventory_lots;
create table public.inventory_legacy_serial_allowances(
 product_id uuid primary key references public.products(id),initial_units bigint not null check(initial_units>=0),
 captured_units bigint not null default 0 check(captured_units>=0 and captured_units<=initial_units)
);
insert into public.inventory_legacy_serial_allowances(product_id,initial_units)
select product_id,sum(units) from (
 select l.product_id,l.sealed_cartons::bigint*p.units_per_carton+l.loose_units as units
 from public.inventory_lots l join public.product_pack_definitions p on p.id=l.pack_definition_id
 union all select product_id,expected_units from public.inventory_transfers where status='in_transit'
) stock group by product_id;
create table public.inventory_serial_receipts(
 id uuid primary key default gen_random_uuid(),product_id uuid not null references public.products(id),
 serial_number text not null check(length(serial_number) between 1 and 120 and serial_number=trim(serial_number)),
 lot_id uuid not null references public.inventory_lots(id),
 source text not null check(source in ('receiving','legacy_stock','legacy_return')),
 return_line_id uuid references public.sales_return_lines(id),recorded_by uuid not null references auth.users(id),recorded_at timestamptz not null default now(),
 check((source='legacy_return')=(return_line_id is not null))
);
create unique index inventory_serial_product_identity on public.inventory_serial_receipts(product_id,upper(serial_number));
create trigger inventory_serial_receipts_immutable before update or delete on public.inventory_serial_receipts for each row execute function public.deny_inventory_mutation();
alter table public.delivery_line_serials add column inventory_serial_id uuid references public.inventory_serial_receipts(id);
alter table public.inventory_serial_rollout enable row level security;
alter table public.inventory_legacy_serial_lots enable row level security;
alter table public.inventory_legacy_serial_allowances enable row level security;
alter table public.inventory_serial_receipts enable row level security;
revoke all on public.inventory_serial_rollout,public.inventory_legacy_serial_lots,public.inventory_legacy_serial_allowances,public.inventory_serial_receipts from public,anon,authenticated;
grant select on public.inventory_serial_receipts to authenticated;
create policy inventory_serial_receipts_read on public.inventory_serial_receipts for select to authenticated using
 ((select public.has_access('stock')) or (select public.has_access('deliveries')) or (select public.has_access('service')));

-- The chosen units move with a carton transfer; quantities never imply which serial moved.
create table public.inventory_transfer_serials(
 transfer_id uuid not null references public.inventory_transfers(id),inventory_serial_id uuid not null references public.inventory_serial_receipts(id),
 recorded_by uuid not null references auth.users(id),recorded_at timestamptz not null default clock_timestamp(),
 arrived_by uuid references auth.users(id),arrived_at timestamptz,
 primary key(transfer_id,inventory_serial_id),check((arrived_at is null)=(arrived_by is null))
);
create index inventory_transfer_serials_identity on public.inventory_transfer_serials(inventory_serial_id,recorded_at desc);
create index inventory_movements_serial_receipt on public.inventory_movements(transfer_id) where movement_type='transfer_receipt';
alter table public.inventory_transfer_serials enable row level security;
revoke all on public.inventory_transfer_serials from public,anon,authenticated;
grant select on public.inventory_transfer_serials to authenticated;
create policy inventory_transfer_serials_read on public.inventory_transfer_serials for select to authenticated using
 ((select public.has_access('stock')) or (select public.has_access('deliveries')));
create function public.guard_inventory_transfer_serials()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
 if tg_op='DELETE' then raise exception 'Serial transfer history is permanent'; end if;
 if (new.transfer_id,new.inventory_serial_id,new.recorded_by,new.recorded_at) is distinct from (old.transfer_id,old.inventory_serial_id,old.recorded_by,old.recorded_at)
  or old.arrived_at is not null or new.arrived_at is null or new.arrived_by is null then raise exception 'Only the first confirmed arrival can update a transferred serial'; end if;
 return new;
end $$;
create trigger inventory_transfer_serials_guard before update or delete on public.inventory_transfer_serials for each row execute function public.guard_inventory_transfer_serials();

-- Returns use the exact available-lot identity selected by resolve_sales_return_line.
-- A selected transfer dominates its earlier receipt/return; transit, missing units and quarantine have no usable lot.
create function public.inventory_serial_available_lot(p_inventory_serial_id uuid)
returns uuid language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_receipt public.inventory_serial_receipts;v_lot uuid;v_since timestamptz;v_delivery record;v_transfer record;
begin
 select * into v_receipt from public.inventory_serial_receipts where id=p_inventory_serial_id;
 if not found then return null; end if;
 v_lot:=v_receipt.lot_id;v_since:=v_receipt.recorded_at;
 select x.*,n.status as delivery_status into v_delivery from public.delivery_line_serials x
 join public.sales_delivery_notes n on n.id=x.delivery_note_id
 where x.product_id=v_receipt.product_id and upper(x.serial_number)=upper(v_receipt.serial_number) and n.status in ('out_for_delivery','delivered')
 order by x.recorded_at desc,x.id desc limit 1;
 if found then
  if v_delivery.returned_at is null then return null; end if;
  select available.id,r.resolved_at into v_lot,v_since from public.sales_return_lines r
  join public.inventory_lots q on q.id=r.quarantine_lot_id
  join public.inventory_lots available on available.product_id=q.product_id and available.location_id=q.location_id and available.pack_definition_id=q.pack_definition_id
   and available.batch_number=q.batch_number and coalesce(available.expiry_date,'infinity'::date)=coalesce(q.expiry_date,'infinity'::date) and available.stock_status='available'
  where r.id=v_delivery.return_line_id and r.resolution='restock';
  if not found then return null; end if;
 end if;
 select t.id,t.status,s.arrived_at,greatest(t.dispatched_at,s.recorded_at) as moved_at into v_transfer
 from public.inventory_transfer_serials s join public.inventory_transfers t on t.id=s.transfer_id
 where s.inventory_serial_id=v_receipt.id order by greatest(t.dispatched_at,s.recorded_at) desc,s.transfer_id desc limit 1;
 if found and v_transfer.moved_at>=v_since then
  if v_transfer.status<>'received' or v_transfer.arrived_at is null then return null; end if;
  select (array_agg(distinct lot_id))[1] into v_lot from public.inventory_movements where transfer_id=v_transfer.id and movement_type='transfer_receipt' having count(distinct lot_id)=1;
  if not found then return null; end if;
 end if;
 if not exists(select 1 from public.inventory_lots where id=v_lot and product_id=v_receipt.product_id and stock_status='available') then return null; end if;
 return v_lot;
end $$;

-- Transfers carry eligibility through their actual movement history; new receipt-only lots do not acquire it.
create function public.inventory_lot_has_legacy_serial_stock(p_lot_id uuid)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 with recursive origins(id) as (
  select p_lot_id union select t.source_lot_id from origins o
  join public.inventory_movements m on m.lot_id=o.id and m.movement_type in ('transfer_receipt','quarantine_receipt')
  join public.inventory_transfers t on t.id=m.transfer_id
 ) select exists(select 1 from origins join public.inventory_legacy_serial_lots l on l.lot_id=origins.id)
$$;

-- Reuse the established owner-only count transaction, with its exact version and movement history.
alter function public.set_inventory_opening_balance(uuid,integer,uuid,uuid,uuid,text,date,integer,integer,text) rename to set_inventory_opening_balance_internal;
revoke all on function public.set_inventory_opening_balance_internal(uuid,integer,uuid,uuid,uuid,text,date,integer,integer,text) from public,anon,authenticated;
create function public.set_inventory_opening_balance(p_lot_id uuid,p_expected_version integer,p_product_id uuid,p_location_id uuid,p_pack_definition_id uuid,p_batch_number text,p_expiry_date date,p_sealed_cartons integer,p_loose_units integer,p_reason text)
returns public.inventory_lots language plpgsql security definer set search_path=public,pg_temp as $$
declare v_product uuid:=p_product_id;v_lot public.inventory_lots;v_units integer;
begin
 if not public.inventory_owner() then raise exception 'Owner access is required'; end if;
 if p_expected_version<>0 then
  select * into v_lot from public.inventory_lots where id=p_lot_id for update;
  v_product:=v_lot.product_id;
 end if;
 if public.delivery_product_requires_serial(v_product) then
  select units_per_carton into v_units from public.product_pack_definitions where id=coalesce(v_lot.pack_definition_id,p_pack_definition_id);
  if p_expected_version=0 or p_sealed_cartons::bigint*v_units+p_loose_units is distinct from v_lot.sealed_cartons::bigint*v_units+v_lot.loose_units then
   raise exception 'Receive serial-tracked stock with one real serial per added unit. Count reductions need a reviewed serial adjustment; a physical-count correction cannot bypass serial identity';
  end if;
 end if;
 return public.set_inventory_opening_balance_internal(p_lot_id,p_expected_version,p_product_id,p_location_id,p_pack_definition_id,p_batch_number,p_expiry_date,p_sealed_cartons,p_loose_units,p_reason);
end $$;

-- Counts are final counts, as in the existing physical-count form; serials identify only the added units.
create function public.receive_serialized_inventory(p_lot_id uuid,p_expected_version integer,p_product_id uuid,p_location_id uuid,p_pack_definition_id uuid,p_batch_number text,p_expiry_date date,p_sealed_cartons integer,p_loose_units integer,p_reason text,p_serials text[])
returns public.inventory_lots language plpgsql security definer set search_path=public,pg_temp as $$
declare v_lot public.inventory_lots;v_old public.inventory_lots;v_units integer;v_added bigint;v_serials text[];v_serial text;
begin
 if not public.inventory_owner() then raise exception 'Owner access is required'; end if;
 if p_expected_version<>0 then
  select * into v_old from public.inventory_lots where id=p_lot_id and version=p_expected_version and stock_status='available' for update;
  if not found then raise exception 'Stock changed; refresh before receiving'; end if;
  if (p_product_id,p_location_id,p_pack_definition_id) is distinct from (v_old.product_id,v_old.location_id,v_old.pack_definition_id) then raise exception 'Keep the stock lot identity when receiving additional units'; end if;
 end if;
 if not public.delivery_product_requires_serial(p_product_id) then raise exception 'This product does not need serial numbers'; end if;
 select units_per_carton into v_units from public.product_pack_definitions where id=p_pack_definition_id and product_id=p_product_id;
 if not found then raise exception 'Choose a saved pack definition for this product'; end if;
 v_added:=(p_sealed_cartons::bigint-coalesce(v_old.sealed_cartons,0))*v_units+p_loose_units-coalesce(v_old.loose_units,0);
 if v_added is null or v_added not between 1 and 10000 then raise exception 'Receive between 1 and 10000 additional units at a time'; end if;
 select coalesce(array_agg(trim(s)),'{}') into v_serials from unnest(p_serials) s where trim(s)<>'';
 if cardinality(v_serials)<>v_added then raise exception 'Enter exactly % real serial number(s) for the added units',v_added; end if;
 if exists(select 1 from unnest(v_serials) s where length(s)>120) or (select count(distinct upper(s)) from unnest(v_serials) s)<>v_added then raise exception 'Serial numbers must be unique and at most 120 characters'; end if;
 -- Match outgoing/legacy capture locks so a simultaneous receipt cannot create a second identity.
 for v_serial in select upper(s) from unnest(v_serials) s order by upper(s) loop
  perform pg_advisory_xact_lock(hashtextextended('inventory-serial:'||p_product_id::text||':'||v_serial,0));
  if exists(select 1 from public.inventory_serial_receipts where product_id=p_product_id and upper(serial_number)=v_serial)
   or exists(select 1 from public.delivery_line_serials where product_id=p_product_id and upper(serial_number)=v_serial) then
   raise exception 'Serial % already identifies this product. Use the recorded return workflow for a unit that came back',v_serial;
  end if;
 end loop;
 v_lot:=public.set_inventory_opening_balance_internal(p_lot_id,p_expected_version,p_product_id,p_location_id,p_pack_definition_id,p_batch_number,p_expiry_date,p_sealed_cartons,p_loose_units,p_reason);
 insert into public.inventory_serial_receipts(product_id,serial_number,lot_id,source,recorded_by)
 select p_product_id,s,v_lot.id,'receiving',auth.uid() from unnest(v_serials) s;
 return v_lot;
end $$;

-- A missing receipt can only be identified against the finite pre-rollout stock pool, explicitly acknowledged.
create function public.capture_delivery_inventory_serial(p_product_id uuid,p_serial text,p_lot_id uuid,p_legacy_confirmed boolean)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare v_id uuid;v_previous public.delivery_line_serials;v_return public.sales_return_lines;v_rollout timestamptz;
begin
 perform pg_advisory_xact_lock(hashtextextended('inventory-serial:'||p_product_id::text||':'||upper(p_serial),0));
 select * into v_previous from public.delivery_line_serials where product_id=p_product_id and upper(serial_number)=upper(p_serial) order by recorded_at desc,id desc limit 1;
 if v_previous.returned_at is not null then
  select * into v_return from public.sales_return_lines where id=v_previous.return_line_id;
  if v_return.resolution is distinct from 'restock' then raise exception 'Serial % came back but has not been inspected and released to stock',p_serial; end if;
 end if;
 select id into v_id from public.inventory_serial_receipts where product_id=p_product_id and upper(serial_number)=upper(p_serial);
 if found then
  if public.inventory_serial_available_lot(v_id) is distinct from p_lot_id then raise exception 'Serial % is not available in the selected stock lot; confirm its actual transfer or return receipt',p_serial; end if;
  return v_id;
 end if;
 if not exists(select 1 from public.inventory_lots where id=p_lot_id and product_id=p_product_id and stock_status='available') then raise exception 'Choose available stock for this serial'; end if;
 select started_at into v_rollout from public.inventory_serial_rollout where id;
 if v_previous.returned_at>=v_rollout and v_previous.recorded_at<v_rollout and v_return.resolution='restock' then
  insert into public.inventory_serial_receipts(product_id,serial_number,lot_id,source,return_line_id,recorded_by)
  values(p_product_id,p_serial,p_lot_id,'legacy_return',v_return.id,auth.uid()) returning id into v_id;
  if public.inventory_serial_available_lot(v_id) is distinct from p_lot_id then raise exception 'The returned serial is not restocked in the selected stock lot'; end if;
 else
  if p_legacy_confirmed is distinct from true or not public.inventory_lot_has_legacy_serial_stock(p_lot_id) then
   raise exception 'Serial % has no receiving record. Only verified pre-rollout stock can use the explicit legacy-stock confirmation',p_serial;
  end if;
  update public.inventory_legacy_serial_allowances set captured_units=captured_units+1 where product_id=p_product_id and captured_units<initial_units;
  if not found then raise exception 'No unidentified pre-rollout units remain for this product. Record new stock and its serial numbers at receiving'; end if;
  insert into public.inventory_serial_receipts(product_id,serial_number,lot_id,source,recorded_by)
  values(p_product_id,p_serial,p_lot_id,'legacy_stock',auth.uid()) returning id into v_id;
 end if;
 if public.inventory_serial_available_lot(v_id) is distinct from p_lot_id then raise exception 'The captured serial is not available in the selected stock lot'; end if;
 return v_id;
end $$;

create or replace function public.record_delivery_serials(p_delivery_note_id uuid,p_expected_version integer,p_lines jsonb)
returns setof public.delivery_line_serials language plpgsql security definer set search_path=public,pg_temp as $$
declare v_note public.sales_delivery_notes;v_item record;v_line public.sales_delivery_lines;v_serials text[];v_taken text;v_serial text;v_inventory_id uuid;
begin
 if not (public.has_access('deliveries') or public.has_access('stock')) then raise exception 'You need delivery or stock access to record serial numbers.'; end if;
 if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) not between 1 and 100 then raise exception 'Choose the items to record serial numbers for'; end if;
 select * into v_note from public.sales_delivery_notes where id=p_delivery_note_id and version=p_expected_version for update;
 if not found then raise exception 'Delivery changed; refresh before continuing'; end if;
 if v_note.status not in ('sent_to_sales','packing','ready') then raise exception 'Serial numbers are recorded while packing, before the delivery goes out'; end if;
 for v_item in select (e->>'deliveryLineId')::uuid line_id,e->'serials' serials,coalesce((e->>'legacyConfirmed')::boolean,false) legacy_confirmed from jsonb_array_elements(p_lines) e loop
  select * into v_line from public.sales_delivery_lines where id=v_item.line_id and delivery_note_id=v_note.id for update;
  if not found then raise exception 'An item is not on this delivery'; end if;
  if not public.delivery_product_requires_serial(v_line.product_id) then raise exception 'This product does not need serial numbers'; end if;
  if jsonb_typeof(v_item.serials) is distinct from 'array' then raise exception 'Enter the serial numbers as a list'; end if;
  select coalesce(array_agg(trim(value) order by ordinality),'{}') into v_serials from jsonb_array_elements_text(v_item.serials) with ordinality where trim(value)<>'';
  if cardinality(v_serials)<>v_line.quantity then raise exception 'Enter exactly % serial number(s) for this item; % entered',v_line.quantity,cardinality(v_serials); end if;
  if (select count(distinct upper(s)) from unnest(v_serials) s)<>cardinality(v_serials) then raise exception 'The same serial number is entered twice'; end if;
  if exists(select 1 from unnest(v_serials) s where length(s)>120) then raise exception 'A serial number is too long'; end if;
  perform 1 from public.inventory_lots where id=v_line.lot_id for update;
  delete from public.delivery_line_serials where delivery_line_id=v_line.id;
  select x.serial_number into v_taken from public.delivery_line_serials x join unnest(v_serials) s on upper(s)=upper(x.serial_number)
   where x.product_id=v_line.product_id and x.returned_at is null limit 1;
  if found then raise exception 'Serial % is already on another delivery that has not come back',v_taken; end if;
  for v_serial in select s from unnest(v_serials) s order by upper(s) loop
   v_inventory_id:=public.capture_delivery_inventory_serial(v_line.product_id,v_serial,v_line.lot_id,v_item.legacy_confirmed);
   insert into public.delivery_line_serials(delivery_line_id,delivery_note_id,product_id,serial_number,recorded_by,inventory_serial_id)
   values(v_line.id,v_note.id,v_line.product_id,v_serial,auth.uid(),v_inventory_id);
  end loop;
 end loop;
 update public.sales_delivery_notes set version=version+1,updated_at=now() where id=v_note.id;
 return query select * from public.delivery_line_serials where delivery_note_id=v_note.id order by delivery_line_id,serial_number;
end $$;

-- Existing quantity transactions remain authoritative; tracked transfers add explicit dispatch and arrival identities.
alter function public.dispatch_inventory_transfer(uuid,integer,integer,text) rename to dispatch_inventory_transfer_internal;
alter function public.receive_inventory_transfer(uuid,integer,integer,text,text) rename to receive_inventory_transfer_internal;
revoke all on function public.dispatch_inventory_transfer_internal(uuid,integer,integer,text),public.receive_inventory_transfer_internal(uuid,integer,integer,text,text) from public,anon,authenticated;
create function public.dispatch_inventory_transfer(p_id uuid,p_expected_version integer,p_expected_lot_version integer,p_reason text)
returns public.inventory_transfers language plpgsql security definer set search_path=public,pg_temp as $$
begin
 perform public.require_access('stock');
 if exists(select 1 from public.inventory_transfers where id=p_id and public.delivery_product_requires_serial(product_id)) then raise exception 'Enter the exact serials in these cartons before dispatching serial-tracked stock'; end if;
 return public.dispatch_inventory_transfer_internal(p_id,p_expected_version,p_expected_lot_version,p_reason);
end $$;
create function public.receive_inventory_transfer(p_id uuid,p_expected_version integer,p_actual_units integer,p_inspection text,p_note text)
returns public.inventory_transfers language plpgsql security definer set search_path=public,pg_temp as $$
begin
 perform public.require_access('stock');
 if exists(select 1 from public.inventory_transfers where id=p_id and public.delivery_product_requires_serial(product_id)) then raise exception 'Scan the exact arrived serials when receiving serial-tracked stock'; end if;
 return public.receive_inventory_transfer_internal(p_id,p_expected_version,p_actual_units,p_inspection,p_note);
end $$;
create function public.dispatch_serialized_inventory_transfer(p_id uuid,p_expected_version integer,p_expected_lot_version integer,p_reason text,p_serials text[],p_legacy_confirmed boolean)
returns public.inventory_transfers language plpgsql security definer set search_path=public,pg_temp as $$
declare v_transfer public.inventory_transfers;v_serials text[];v_serial text;v_id uuid;v_ids uuid[]:='{}';
begin
 perform public.require_access('stock');
 select * into v_transfer from public.inventory_transfers where id=p_id and version=p_expected_version and status='requested' for update;
 if not found then raise exception 'Transfer changed; refresh before dispatch'; end if;
 if not public.delivery_product_requires_serial(v_transfer.product_id) then raise exception 'This product does not need serial numbers'; end if;
 perform 1 from public.inventory_lots where id=v_transfer.source_lot_id and version=p_expected_lot_version and stock_status='available' for update;
 if not found then raise exception 'Source stock changed; refresh before dispatch'; end if;
 select coalesce(array_agg(trim(s)),'{}') into v_serials from unnest(p_serials) s where trim(s)<>'';
 if v_transfer.expected_units>10000 or cardinality(v_serials)<>v_transfer.expected_units then raise exception 'Enter one real serial for each of the % units in these cartons (at most 10000 per transfer)',v_transfer.expected_units; end if;
 if (select count(distinct upper(s)) from unnest(v_serials) s)<>cardinality(v_serials) or exists(select 1 from unnest(v_serials) s where length(s)>120) then raise exception 'Transfer serials must be unique and at most 120 characters'; end if;
 for v_serial in select s from unnest(v_serials) s order by upper(s) loop
  if exists(select 1 from public.delivery_line_serials where product_id=v_transfer.product_id and upper(serial_number)=upper(v_serial) and returned_at is null) then raise exception 'Serial % is assigned to a delivery and cannot be transferred',v_serial; end if;
  v_id:=public.capture_delivery_inventory_serial(v_transfer.product_id,v_serial,v_transfer.source_lot_id,p_legacy_confirmed);
  v_ids:=array_append(v_ids,v_id);
 end loop;
 v_transfer:=public.dispatch_inventory_transfer_internal(p_id,p_expected_version,p_expected_lot_version,p_reason);
 insert into public.inventory_transfer_serials(transfer_id,inventory_serial_id,recorded_by) select v_transfer.id,s,auth.uid() from unnest(v_ids) s;
 return v_transfer;
end $$;
create function public.receive_serialized_inventory_transfer(p_id uuid,p_expected_version integer,p_actual_units integer,p_inspection text,p_note text,p_serials text[],p_legacy_confirmed boolean)
returns public.inventory_transfers language plpgsql security definer set search_path=public,pg_temp as $$
declare v_transfer public.inventory_transfers;v_serials text[];v_serial text;v_id uuid;v_count integer;v_rollout timestamptz;v_ids uuid[]:='{}';
begin
 perform public.require_access('stock');
 select * into v_transfer from public.inventory_transfers where id=p_id and version=p_expected_version and status='in_transit' for update;
 if not found then raise exception 'Transfer changed; refresh before receiving'; end if;
 if not public.delivery_product_requires_serial(v_transfer.product_id) then raise exception 'This product does not need serial numbers'; end if;
 if p_actual_units is null or p_actual_units not between 0 and 10000 or p_actual_units>v_transfer.expected_units then raise exception 'Count only the dispatched units that arrived; unexpected additional units need a separately reviewed receipt'; end if;
 if p_inspection is null or p_inspection not in ('pass','damaged') then raise exception 'Confirm whether the arrived units passed inspection'; end if;
 select coalesce(array_agg(trim(s)),'{}') into v_serials from unnest(p_serials) s where trim(s)<>'';
 if cardinality(v_serials)<>p_actual_units then raise exception 'Scan exactly % arrived serial(s); do not include missing units',p_actual_units; end if;
 if (select count(distinct upper(s)) from unnest(v_serials) s)<>cardinality(v_serials) or exists(select 1 from unnest(v_serials) s where length(s)>120) then raise exception 'Arrived serials must be unique and at most 120 characters'; end if;
 select count(*) into v_count from public.inventory_transfer_serials where transfer_id=v_transfer.id;
 if v_count=0 then
  select started_at into v_rollout from public.inventory_serial_rollout where id;
  if v_transfer.dispatched_at is null or v_transfer.dispatched_at>=v_rollout or (p_actual_units>0 and p_legacy_confirmed is distinct from true) then raise exception 'This transfer has no dispatched serial selection. Only a pre-rollout transfer can use explicit legacy arrival confirmation'; end if;
  perform 1 from public.inventory_lots where id=v_transfer.source_lot_id for update;
  for v_serial in select s from unnest(v_serials) s order by upper(s) loop
   if exists(select 1 from public.delivery_line_serials where product_id=v_transfer.product_id and upper(serial_number)=upper(v_serial) and returned_at is null)
    or exists(select 1 from public.inventory_serial_receipts where product_id=v_transfer.product_id and upper(serial_number)=upper(v_serial) and source='receiving') then raise exception 'Serial % cannot belong to this pre-rollout transfer',v_serial; end if;
   v_id:=public.capture_delivery_inventory_serial(v_transfer.product_id,v_serial,v_transfer.source_lot_id,true);
   insert into public.inventory_transfer_serials(transfer_id,inventory_serial_id,recorded_by) values(v_transfer.id,v_id,auth.uid());
  end loop;
 elsif v_count<>v_transfer.expected_units then
  raise exception 'The dispatched serial selection is incomplete; review this transfer before receiving';
 end if;
 for v_serial in select s from unnest(v_serials) s loop
  select s.inventory_serial_id into v_id from public.inventory_transfer_serials s join public.inventory_serial_receipts r on r.id=s.inventory_serial_id
   where s.transfer_id=v_transfer.id and upper(r.serial_number)=upper(v_serial) and r.product_id=v_transfer.product_id;
  if not found then raise exception 'Serial % was not selected for this transfer',v_serial; end if;
  v_ids:=array_append(v_ids,v_id);
 end loop;
 if p_actual_units=0 then
  if length(trim(coalesce(p_note,''))) not between 3 and 1000 then raise exception 'Record what happened to the missing units'; end if;
  update public.inventory_transfers set status='quarantine',actual_units=0,inspection_note=trim(p_note),received_by=auth.uid(),received_at=now(),version=version+1 where id=v_transfer.id returning * into v_transfer;
 else
  v_transfer:=public.receive_inventory_transfer_internal(p_id,p_expected_version,p_actual_units,p_inspection,p_note);
 end if;
 update public.inventory_transfer_serials set arrived_at=now(),arrived_by=auth.uid() where transfer_id=v_transfer.id and inventory_serial_id=any(v_ids);
 return v_transfer;
end $$;
revoke all on function public.dispatch_inventory_transfer(uuid,integer,integer,text),public.receive_inventory_transfer(uuid,integer,integer,text,text),
 public.dispatch_serialized_inventory_transfer(uuid,integer,integer,text,text[],boolean),public.receive_serialized_inventory_transfer(uuid,integer,integer,text,text,text[],boolean) from public,anon;
grant execute on function public.dispatch_inventory_transfer(uuid,integer,integer,text),public.receive_inventory_transfer(uuid,integer,integer,text,text),
 public.dispatch_serialized_inventory_transfer(uuid,integer,integer,text,text[],boolean),public.receive_serialized_inventory_transfer(uuid,integer,integer,text,text,text[],boolean) to authenticated;

-- Serial-tracked units must travel through the delivery/return workflow, never through an anonymous direct issue.
do $migration$
declare v_definition text;v_old text;
begin
 v_definition:=pg_get_functiondef('public.issue_consumer_units(uuid,uuid,integer,uuid,integer,date,text,text)'::regprocedure);
 v_old:=$old$ if not found then raise exception 'Stock changed; refresh before issuing'; end if;$old$;
 if (length(v_definition)-length(replace(v_definition,v_old,'')))/length(v_old)<>1 then raise exception 'Unexpected direct stock issue implementation'; end if;
 execute replace(v_definition,v_old,v_old||$new$
 if public.delivery_product_requires_serial(v_lot.product_id) then raise exception 'Serial-tracked units must be issued through a delivery with their real serial numbers'; end if;$new$);
 v_definition:=pg_get_functiondef('public.guard_machine_delivery_serials()'::regprocedure);
 v_old:=$old$serial.delivery_line_id=line.id and serial.returned_at is null$old$;
 if (length(v_definition)-length(replace(v_definition,v_old,'')))/length(v_old)<>1 then raise exception 'Unexpected machine delivery serial guard'; end if;
 execute replace(v_definition,v_old,v_old||' and serial.inventory_serial_id is not null and public.inventory_serial_available_lot(serial.inventory_serial_id)=line.lot_id');
end $migration$;
revoke all on function public.guard_inventory_transfer_serials(),public.inventory_serial_available_lot(uuid),public.inventory_lot_has_legacy_serial_stock(uuid),public.capture_delivery_inventory_serial(uuid,text,uuid,boolean) from public,anon,authenticated;
revoke all on function public.set_inventory_opening_balance(uuid,integer,uuid,uuid,uuid,text,date,integer,integer,text),public.receive_serialized_inventory(uuid,integer,uuid,uuid,uuid,text,date,integer,integer,text,text[]) from public,anon;
grant execute on function public.set_inventory_opening_balance(uuid,integer,uuid,uuid,uuid,text,date,integer,integer,text),public.receive_serialized_inventory(uuid,integer,uuid,uuid,uuid,text,date,integer,integer,text,text[]) to authenticated;
commit;
