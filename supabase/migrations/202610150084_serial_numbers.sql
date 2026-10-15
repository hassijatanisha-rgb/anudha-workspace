-- Serial numbers on delivered units (owner decisions, 15 October 2026).
-- The stores head or the owner marks which products need serial numbers. For those products, the serials of the exact
-- units are entered while packing; a delivery cannot go out until each such line has one serial per unit. Serials can
-- be corrected until dispatch and are permanent afterwards. A unit's serial is out with one customer at a time; when it
-- comes back as a return, stores mark it returned and it may go out again. Anyone with stock, delivery or service access
-- can look up which customer has a serial.
begin;

create table if not exists public.product_serial_settings(
 product_id uuid primary key references public.products(id),
 serial_required boolean not null,
 version integer not null default 1 check(version>0),
 updated_by uuid not null, updated_at timestamptz not null default now()
);
create table if not exists public.delivery_line_serials(
 id uuid primary key default gen_random_uuid(),
 delivery_line_id uuid not null references public.sales_delivery_lines(id),
 delivery_note_id uuid not null references public.sales_delivery_notes(id),
 product_id uuid not null,
 serial_number text not null check(length(serial_number) between 1 and 120 and serial_number=trim(serial_number)),
 recorded_by uuid not null, recorded_at timestamptz not null default now(),
 returned_at timestamptz, returned_by uuid, return_line_id uuid references public.sales_return_lines(id),
 check((returned_at is null)=(returned_by is null) and (returned_at is null)=(return_line_id is null))
);
-- A unit is on one delivery at a time until it comes back.
create unique index if not exists delivery_serial_out_once on public.delivery_line_serials(product_id, upper(serial_number)) where returned_at is null;
create index if not exists delivery_line_serials_line on public.delivery_line_serials(delivery_line_id);
create index if not exists delivery_line_serials_number on public.delivery_line_serials(upper(serial_number));

create or replace function public.guard_delivery_line_serials() returns trigger language plpgsql set search_path to 'public','pg_temp' as $$
declare v_status text;
begin
 select status into v_status from public.sales_delivery_notes where id=old.delivery_note_id;
 if tg_op='DELETE' then
  if v_status in ('out_for_delivery','delivered') then raise exception 'Serial numbers of a dispatched delivery are permanent'; end if;
  return old;
 end if;
 if (new.id,new.delivery_line_id,new.delivery_note_id,new.product_id,new.serial_number,new.recorded_by,new.recorded_at)
   is distinct from (old.id,old.delivery_line_id,old.delivery_note_id,old.product_id,old.serial_number,old.recorded_by,old.recorded_at)
   or old.returned_at is not null then
  raise exception 'Serial numbers are permanent; only a return can be recorded once';
 end if;
 return new;
end $$;
drop trigger if exists delivery_line_serials_guard on public.delivery_line_serials;
create trigger delivery_line_serials_guard before update or delete on public.delivery_line_serials for each row execute function public.guard_delivery_line_serials();

-- A cancelled delivery frees the serials it was holding.
create or replace function public.release_cancelled_delivery_serials() returns trigger language plpgsql security definer set search_path to 'public','pg_temp' as $$
begin
 if new.status='cancelled' and old.status is distinct from 'cancelled' then delete from public.delivery_line_serials where delivery_note_id=new.id; end if;
 return new;
end $$;
drop trigger if exists sales_delivery_notes_release_serials on public.sales_delivery_notes;
create trigger sales_delivery_notes_release_serials after update of status on public.sales_delivery_notes for each row execute function public.release_cancelled_delivery_serials();

alter table public.product_serial_settings enable row level security;
alter table public.delivery_line_serials enable row level security;
revoke all on public.product_serial_settings, public.delivery_line_serials from public, anon, authenticated;
grant select on public.product_serial_settings, public.delivery_line_serials to authenticated;
drop policy if exists product_serial_settings_read on public.product_serial_settings;
create policy product_serial_settings_read on public.product_serial_settings for select to authenticated using ((select public.inventory_active_staff()));
drop policy if exists delivery_line_serials_read on public.delivery_line_serials;
create policy delivery_line_serials_read on public.delivery_line_serials for select to authenticated
 using ((select public.has_access('deliveries')) or (select public.has_access('stock')) or (select public.has_access('service')));

create or replace function public.set_product_serial_required(p_product_id uuid, p_required boolean)
returns public.product_serial_settings language plpgsql security definer set search_path to 'public','pg_temp' as $$
declare v_row public.product_serial_settings;
begin
 if not public.packing_supervisor() then raise exception 'Only the stores head or the owner can choose which products need serial numbers.'; end if;
 if p_product_id is null or p_required is null then raise exception 'Product and choice are required'; end if;
 if not exists(select 1 from public.products where id=p_product_id and deleted_at is null) then raise exception 'Product is unavailable'; end if;
 insert into public.product_serial_settings(product_id,serial_required,updated_by) values(p_product_id,p_required,auth.uid())
 on conflict(product_id) do update set serial_required=excluded.serial_required,version=public.product_serial_settings.version+1,updated_by=auth.uid(),updated_at=now()
 returning * into v_row;
 return v_row;
end $$;

-- p_lines: [{"deliveryLineId": uuid, "serials": ["SN1","SN2"]}]; each listed line's serials are replaced as a whole.
create or replace function public.record_delivery_serials(p_delivery_note_id uuid, p_expected_version integer, p_lines jsonb)
returns setof public.delivery_line_serials language plpgsql security definer set search_path to 'public','pg_temp' as $$
declare v_note public.sales_delivery_notes; v_item record; v_line public.sales_delivery_lines; v_serials text[]; v_taken text;
begin
 if not (public.has_access('deliveries') or public.has_access('stock')) then raise exception 'You need delivery or stock access to record serial numbers.'; end if;
 if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) not between 1 and 100 then raise exception 'Choose the items to record serial numbers for'; end if;
 select * into v_note from public.sales_delivery_notes where id=p_delivery_note_id and version=p_expected_version for update;
 if not found then raise exception 'Delivery changed; refresh before continuing'; end if;
 if v_note.status not in ('sent_to_sales','packing','ready') then raise exception 'Serial numbers are recorded while packing, before the delivery goes out'; end if;
 for v_item in select (e->>'deliveryLineId')::uuid line_id, e->'serials' serials from jsonb_array_elements(p_lines) e loop
  select * into v_line from public.sales_delivery_lines where id=v_item.line_id and delivery_note_id=v_note.id for update;
  if not found then raise exception 'An item is not on this delivery'; end if;
  if not exists(select 1 from public.product_serial_settings where product_id=v_line.product_id and serial_required) then raise exception 'This product does not need serial numbers'; end if;
  if jsonb_typeof(v_item.serials) is distinct from 'array' then raise exception 'Enter the serial numbers as a list'; end if;
  select coalesce(array_agg(trim(value) order by ordinality),'{}') into v_serials from jsonb_array_elements_text(v_item.serials) with ordinality where trim(value)<>'';
  if cardinality(v_serials)<>v_line.quantity then raise exception 'Enter exactly % serial number(s) for this item; % entered', v_line.quantity, cardinality(v_serials); end if;
  if (select count(distinct upper(s)) from unnest(v_serials) s)<>cardinality(v_serials) then raise exception 'The same serial number is entered twice'; end if;
  if exists(select 1 from unnest(v_serials) s where length(s)>120) then raise exception 'A serial number is too long'; end if;
  delete from public.delivery_line_serials where delivery_line_id=v_line.id;
  select x.serial_number into v_taken from public.delivery_line_serials x join unnest(v_serials) s on upper(s)=upper(x.serial_number)
   where x.product_id=v_line.product_id and x.returned_at is null limit 1;
  if found then raise exception 'Serial % is already on another delivery that has not come back', v_taken; end if;
  insert into public.delivery_line_serials(delivery_line_id,delivery_note_id,product_id,serial_number,recorded_by)
  select v_line.id,v_note.id,v_line.product_id,s,auth.uid() from unnest(v_serials) s;
 end loop;
 return query select * from public.delivery_line_serials where delivery_note_id=v_note.id order by delivery_line_id, serial_number;
end $$;

-- Stores mark which serials came back on a return line; those units may then go out again.
create or replace function public.mark_serials_returned(p_return_line_id uuid, p_serials text[])
returns setof public.delivery_line_serials language plpgsql security definer set search_path to 'public','pg_temp' as $$
declare v_line public.sales_return_lines; v_marked integer; v_wanted integer;
begin
 if not (public.has_access('deliveries') or public.has_access('stock')) then raise exception 'You need delivery or stock access to record returned serial numbers.'; end if;
 select * into v_line from public.sales_return_lines where id=p_return_line_id for update;
 if not found then raise exception 'Return line not found'; end if;
 select count(*) into v_marked from public.delivery_line_serials where return_line_id=v_line.id;
 select count(distinct upper(trim(s))) into v_wanted from unnest(coalesce(p_serials,'{}')) s where trim(s)<>'';
 if v_wanted<1 then raise exception 'Choose the serial numbers that came back'; end if;
 if v_marked+v_wanted>v_line.quantity then raise exception 'This return has % unit(s); % already marked', v_line.quantity, v_marked; end if;
 update public.delivery_line_serials set returned_at=now(),returned_by=auth.uid(),return_line_id=v_line.id
 where delivery_line_id=v_line.delivery_line_id and returned_at is null and upper(serial_number) in (select upper(trim(s)) from unnest(p_serials) s);
 get diagnostics v_marked = row_count;
 if v_marked<>v_wanted then raise exception 'A serial number is not one that went out on this delivery, or is already marked returned'; end if;
 return query select * from public.delivery_line_serials where return_line_id=v_line.id order by serial_number;
end $$;

-- Who has this serial: customer, delivery and state.
create or replace function public.find_serial(p_serial text)
returns table(serial_number text, product_id uuid, delivery_number text, delivery_status text, organization_name text, dispatched_at timestamptz, delivered_at timestamptz, returned_at timestamptz)
language sql stable security definer set search_path to 'public','pg_temp' as $$
 select x.serial_number, x.product_id, n.delivery_number, n.status, o.name, n.dispatched_at, n.delivered_at, x.returned_at
 from public.delivery_line_serials x join public.sales_delivery_notes n on n.id=x.delivery_note_id left join public.organizations o on o.id=n.organization_id
 where (public.has_access('deliveries') or public.has_access('stock') or public.has_access('service'))
  and length(trim(coalesce(p_serial,''))) between 2 and 120 and upper(x.serial_number) like '%'||upper(trim(p_serial))||'%'
 order by x.recorded_at desc limit 50
$$;

revoke all on function public.set_product_serial_required(uuid,boolean), public.record_delivery_serials(uuid,integer,jsonb), public.mark_serials_returned(uuid,text[]),
 public.find_serial(text), public.guard_delivery_line_serials(), public.release_cancelled_delivery_serials() from public, anon;
grant execute on function public.set_product_serial_required(uuid,boolean), public.record_delivery_serials(uuid,integer,jsonb), public.mark_serials_returned(uuid,text[]),
 public.find_serial(text) to authenticated;

-- Same transitions as 081; dispatch now needs every serial-tracked unit's serial number.
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
 -- serial_numbers_084
 if p_action='dispatch' and exists(select 1 from public.sales_delivery_lines l join public.product_serial_settings s on s.product_id=l.product_id and s.serial_required
   where l.delivery_note_id=v_row.id and l.quantity<>(select count(*) from public.delivery_line_serials x where x.delivery_line_id=l.id and x.returned_at is null)) then
  raise exception 'Enter the serial number of every unit that needs one before this delivery goes out (Serial numbers on this delivery).';
 end if;
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
