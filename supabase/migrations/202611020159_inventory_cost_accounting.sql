-- Inventory is activated only against verified physical quantities and an imported opening GL.
-- Physical lots remain independent of the product cost formula. Revenue and COGS share invoice dates.
begin;

update public.acc_accounts set system_key='cogs' where id='a0000000-0000-4000-8000-000000005000' and system_key is null;
insert into public.acc_accounts(id,code,name,account_type,system_key) values
 ('a0000000-0000-4000-8000-000000005200','5200','Inventory losses and count adjustments','expense','inventory_adjustment') on conflict(id) do nothing;
alter table public.acc_journal_entries drop constraint acc_journal_entries_source_type_check;
alter table public.acc_journal_entries add constraint acc_journal_entries_source_type_check check(source_type in
 ('manual','invoice','receipt','reversal','credit_note','supplier_bill','supplier_payment','supplier_refund','supplier_credit','inventory_cost'));

create table public.acc_inventory_activation(
 id uuid primary key, singleton boolean not null default true unique check(singleton),
 policy text not null check(policy in ('weighted_average','fifo')),cutover_date date not null,
 gl_import_id uuid not null references public.acc_financial_imports(id),rows jsonb not null,
 reference text not null check(length(reference) between 5 and 500),total_minor bigint not null check(total_minor>=0),
 created_by uuid not null references auth.users(id),created_at timestamptz not null default clock_timestamp()
);
create table public.acc_stock_receipts(
 id uuid primary key,purchase_order_line_id uuid not null references public.purchase_order_lines(id),
 supplier_id uuid not null references public.suppliers(id),product_id uuid not null references public.products(id),
 lot_id uuid not null references public.inventory_lots(id),quantity integer not null check(quantity between 1 and 1000000),
 received_on date not null,reference text not null check(length(reference) between 2 and 120),
 inspection text not null check(inspection in ('pass','quarantine')),note text not null,
 request_content jsonb not null,movement_id uuid not null unique references public.inventory_movements(id),
 created_by uuid not null references auth.users(id),created_at timestamptz not null default clock_timestamp()
);
create table public.acc_stock_receipt_costs(
 receipt_id uuid not null references public.acc_stock_receipts(id),bill_id uuid not null references public.acc_supplier_bills(id),
 total_minor bigint not null check(total_minor>0),created_at timestamptz not null default now(),primary key(receipt_id,bill_id)
);
create table public.acc_stock_cost_events(
 id uuid primary key default gen_random_uuid(),product_id uuid not null references public.products(id),
 source_type text not null,source_id uuid not null,source_line_id uuid not null,
 event_date date not null,acquired_on date,quantity bigint not null,value_minor bigint not null,
 journal_entry_id uuid references public.acc_journal_entries(id),created_by uuid not null references auth.users(id),
 created_at timestamptz not null default clock_timestamp(),unique(source_type,source_id,source_line_id)
);
create table public.acc_stock_fifo_allocations(
 event_id uuid not null references public.acc_stock_cost_events(id),layer_event_id uuid not null references public.acc_stock_cost_events(id),
 quantity bigint not null check(quantity<>0),value_minor bigint not null,
 check((quantity>0 and value_minor>=0) or (quantity<0 and value_minor<=0)),primary key(event_id,layer_event_id)
);
create table public.acc_stock_invoice_costs(
 invoice_id uuid not null references public.acc_invoices(id),proforma_line_id uuid not null references public.sales_proforma_lines(id),
 product_id uuid not null references public.products(id),quantity integer not null check(quantity>0),
 value_minor bigint not null check(value_minor>=0),event_id uuid not null unique references public.acc_stock_cost_events(id),
 primary key(invoice_id,proforma_line_id)
);
create table public.acc_stock_return_costs(
 return_line_id uuid primary key references public.sales_return_lines(id),invoice_id uuid not null references public.acc_invoices(id),
 proforma_line_id uuid not null references public.sales_proforma_lines(id),quantity integer not null check(quantity>0),
 value_minor bigint not null check(value_minor>=0),created_at timestamptz not null default now()
);
create table public.acc_stock_value_corrections(
 id uuid primary key,event_id uuid not null unique references public.acc_stock_cost_events(id),
 layer_event_id uuid not null references public.acc_stock_cost_events(id),amount_minor bigint not null check(amount_minor<>0),
 correction_date date not null,evidence text not null check(length(evidence) between 5 and 500),created_by uuid not null references auth.users(id)
);
create table public.acc_supplier_stock_returns(
 id uuid primary key,bill_id uuid not null references public.acc_supplier_bills(id),line_no integer not null,
 receipt_id uuid not null references public.acc_stock_receipts(id),lot_id uuid not null references public.inventory_lots(id),
 customer_return_line_id uuid references public.sales_return_lines(id),
 quantity integer not null check(quantity>0),net_minor bigint not null check(net_minor>0),tax_minor bigint not null check(tax_minor>=0),
 return_date date not null,reference text not null,reason text not null,request_content jsonb not null,
 cost_event_id uuid not null references public.acc_stock_cost_events(id),offset_entry_id uuid not null references public.acc_journal_entries(id),
 serial_ids uuid[] not null default '{}',created_by uuid not null references auth.users(id),created_at timestamptz not null default clock_timestamp()
);
create table public.acc_supplier_stock_return_voids(
 return_id uuid primary key references public.acc_supplier_stock_returns(id),void_date date not null,reason text not null,
 created_by uuid not null references auth.users(id),created_at timestamptz not null default clock_timestamp()
);

do $$ declare t text;begin
 foreach t in array array['acc_inventory_activation','acc_stock_receipts','acc_stock_receipt_costs','acc_stock_cost_events','acc_stock_fifo_allocations','acc_stock_invoice_costs','acc_stock_return_costs','acc_stock_value_corrections','acc_supplier_stock_returns','acc_supplier_stock_return_voids'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('grant select on public.%I to authenticated',t);
  execute format('create policy %I on public.%I for select to authenticated using((select public.accounting_access()))',t||'_read',t);
  execute format('create trigger %I before update or delete on public.%I for each row execute function public.acc_deny_change()',t||'_immutable',t);
 end loop;
end $$;

create function public.receive_supplier_stock(p_id uuid,p_purchase_order_line_id uuid,p_lot_id uuid,p_expected_version integer,
 p_quantity integer,p_received_on date,p_reference text,p_inspection text,p_note text,p_lot_details jsonb default '{}',p_serials text[] default '{}')
returns public.acc_stock_receipts language plpgsql security definer set search_path=public,pg_temp as $$
declare v public.acc_stock_receipts;v_line public.purchase_order_lines;v_po public.purchase_orders;v_lot public.inventory_lots;
 v_request jsonb;v_movement uuid:=gen_random_uuid();v_serials text[];v_serial text;v_status text;
begin
 if not(public.has_access('stock') or public.accounting_access()) then raise exception 'Stock or Accounting access is required';end if;
 perform public.acc_inventory_lock();
 select coalesce(array_agg(trim(s) order by upper(trim(s))),'{}') into v_serials from unnest(coalesce(p_serials,'{}')) s;
 v_request:=jsonb_build_object('purchase_order_line_id',p_purchase_order_line_id,'lot_id',p_lot_id,'expected_version',p_expected_version,'quantity',p_quantity,
  'received_on',p_received_on,'reference',trim(p_reference),'inspection',p_inspection,'note',trim(coalesce(p_note,'')),'lot_details',coalesce(p_lot_details,'{}'),'serials',v_serials);
 select * into v from public.acc_stock_receipts where id=p_id;
 if found then if v.request_content is distinct from v_request then raise exception 'Receipt id was already used for different details';end if;return v;end if;
 if p_id is null or p_lot_id is null or p_expected_version is null or p_expected_version<0 or p_quantity is null or p_quantity not between 1 and 1000000 then raise exception 'Receipt, lot, version and a positive whole base quantity are required';end if;
 if p_received_on is null or not isfinite(p_received_on) or p_received_on>current_date or length(trim(coalesce(p_reference,''))) not between 2 and 120
  or p_inspection is null or p_inspection not in ('pass','quarantine') or length(coalesce(p_note,''))>1000 then raise exception 'Enter the actual receipt date, reference and inspection result';end if;
 if exists(select 1 from public.acc_inventory_activation) then perform public.acc_inventory_date(p_received_on);end if;
 select * into v_line from public.purchase_order_lines where id=p_purchase_order_line_id for update;
 if not found then raise exception 'Choose a purchase-order line';end if;
 select * into v_po from public.purchase_orders where id=v_line.purchase_order_id for update;
 if v_po.status not in ('ordered','closed') or v_po.supplier_id is null then raise exception 'Receive against an ordered purchase with a supplier';end if;
 if p_quantity+(select coalesce(sum(quantity),0) from public.acc_stock_receipts where purchase_order_line_id=v_line.id)>v_line.quantity then raise exception 'Receipt quantities exceed this ordered base quantity';end if;
 v_status:=case when p_inspection='pass' then 'available' else 'quarantine' end;
 if p_expected_version=0 then
  if jsonb_typeof(p_lot_details) is distinct from 'object' or p_lot_details-array['location_id','pack_definition_id','batch_number','expiry_date']<>'{}' then raise exception 'Supply location, pack definition, batch and expiry for a new lot';end if;
  if not exists(select 1 from public.inventory_locations where id=(p_lot_details->>'location_id')::uuid and active) or
   not exists(select 1 from public.product_pack_definitions where id=(p_lot_details->>'pack_definition_id')::uuid and product_id=v_line.product_id) then raise exception 'Choose an active location and this product''s pack definition';end if;
  insert into public.inventory_lots(id,product_id,location_id,pack_definition_id,batch_number,expiry_date,loose_units,stock_status)
  values(p_lot_id,v_line.product_id,(p_lot_details->>'location_id')::uuid,(p_lot_details->>'pack_definition_id')::uuid,
   trim(coalesce(p_lot_details->>'batch_number','')),nullif(p_lot_details->>'expiry_date','')::date,p_quantity,v_status) returning * into v_lot;
 else
  select * into v_lot from public.inventory_lots where id=p_lot_id and version=p_expected_version and product_id=v_line.product_id and stock_status=v_status for update;
  if not found then raise exception 'Selected lot changed or does not match the product and inspection status';end if;
  if coalesce(p_lot_details,'{}')<>'{}' then raise exception 'Keep existing lot details unchanged';end if;
  update public.inventory_lots set loose_units=loose_units+p_quantity,version=version+1,updated_at=now() where id=p_lot_id returning * into v_lot;
 end if;
 if v_status='available' and v_lot.expiry_date<current_date then raise exception 'Expired receipts must go into quarantine';end if;
 if public.delivery_product_requires_serial(v_line.product_id) then
  if cardinality(v_serials)<>p_quantity or p_quantity>10000 or exists(select 1 from unnest(v_serials) s where length(s) not between 1 and 120)
   or (select count(distinct upper(s)) from unnest(v_serials) s)<>p_quantity then raise exception 'Enter one unique real serial number for every received machine unit (at most 10000)';end if;
  for v_serial in select unnest(v_serials) loop
   perform pg_advisory_xact_lock(hashtextextended('inventory-serial:'||v_line.product_id::text||':'||upper(v_serial),0));
   if exists(select 1 from public.inventory_serial_receipts where product_id=v_line.product_id and upper(serial_number)=upper(v_serial))
    or exists(select 1 from public.delivery_line_serials where product_id=v_line.product_id and upper(serial_number)=upper(v_serial)) then raise exception 'Serial already identifies this product; use its return workflow';end if;
   insert into public.inventory_serial_receipts(product_id,serial_number,lot_id,source,recorded_by) values(v_line.product_id,v_serial,p_lot_id,'receiving',auth.uid());
  end loop;
 elsif cardinality(v_serials)>0 then raise exception 'This product does not use machine serial numbers';end if;
 insert into public.inventory_movements(id,lot_id,movement_type,loose_unit_change,base_unit_change,reason,actor_user_id)
 values(v_movement,p_lot_id,'supplier_receipt',p_quantity,p_quantity,'Supplier receipt '||trim(p_reference),auth.uid());
 insert into public.acc_stock_receipts(id,purchase_order_line_id,supplier_id,product_id,lot_id,quantity,received_on,reference,inspection,note,request_content,movement_id,created_by)
 values(p_id,v_line.id,v_po.supplier_id,v_line.product_id,p_lot_id,p_quantity,p_received_on,trim(p_reference),p_inspection,trim(coalesce(p_note,'')),v_request,v_movement,auth.uid()) returning * into v;
 return v;
end $$;

create function public.inventory_cost_status() returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_activation jsonb;v_products jsonb;v_lots jsonb;v_receipts jsonb;v_orders jsonb;v_gl bigint;v_stock bigint;
begin
 perform public.acc_require_access();
 select public.acc_supplier_json(to_jsonb(a))-'rows' into v_activation from public.acc_inventory_activation a;
 select coalesce(sum(value_minor),0) into v_stock from public.acc_stock_cost_events;
 select coalesce(sum(debit_minor-credit_minor),0) into v_gl from public.acc_journal_lines where account_id=public.acc_account_by_key('inventory');
 select coalesce(jsonb_agg(jsonb_build_object('product_id',p.id,'product_name',p.name,'physical_quantity',coalesce(s.q,0),'quarantine_quantity',coalesce(s.quarantine,0),
  'financial_quantity',coalesce(c.q,0),'inventory_value_minor',coalesce(c.v,0)::text,'invoiced_undispatched_quantity',coalesce(i.q,0),'invoiced_undispatched_value_minor',coalesce(i.v,0)::text,
  'in_transit_quantity',(select coalesce(sum(expected_units),0) from public.inventory_transfers where product_id=p.id and status='in_transit'),
  'uncosted_quantity',(select coalesce(sum(r.quantity),0) from public.acc_stock_receipts r where r.product_id=p.id and r.created_at>(select created_at from public.acc_inventory_activation)
   and not exists(select 1 from public.acc_stock_receipt_costs rc join public.acc_supplier_bills b on b.id=rc.bill_id and b.voided_on is null where rc.receipt_id=r.id)),
  'returned_pending_credit_quantity',(select coalesce(sum(r.quantity),0) from public.sales_return_lines r join public.acc_stock_return_costs rc on rc.return_line_id=r.id where r.product_id=p.id and r.resolution is null
   and coalesce((select sum(quantity) from public.acc_stock_cost_events where source_line_id=r.id and source_type in ('return_credit','return_credit_void')),0)=0)) order by p.name),'[]') into v_products
 from public.products p left join lateral(select sum(l.sealed_cartons::bigint*d.units_per_carton+l.loose_units) q,
  sum(l.sealed_cartons::bigint*d.units_per_carton+l.loose_units) filter(where l.stock_status='quarantine') quarantine
  from public.inventory_lots l join public.product_pack_definitions d on d.id=l.pack_definition_id where l.product_id=p.id) s on true
 left join lateral(select sum(quantity) q,sum(value_minor) v from public.acc_stock_cost_events where product_id=p.id) c on true
 left join lateral(select sum(ic.quantity-coalesce(issued.q,0)) q,sum(ic.value_minor-round(ic.value_minor::numeric*coalesce(issued.q,0)/ic.quantity)) v
  from public.acc_stock_invoice_costs ic join public.acc_invoices inv on inv.id=ic.invoice_id and inv.voided_at is null
  left join lateral(select sum(x.quantity) q from public.inventory_issues x join public.sales_delivery_lines dl on dl.id=x.delivery_line_id
   join public.sales_delivery_notes dn on dn.id=dl.delivery_note_id where dn.invoice_id=ic.invoice_id and dl.proforma_line_id=ic.proforma_line_id) issued on true where ic.product_id=p.id) i on true
 where s.q>0 or c.q<>0 or i.q>0;
 select coalesce(jsonb_agg(jsonb_build_object('id',l.id,'product_id',l.product_id,'product_name',p.name,'location_id',l.location_id,'location_name',loc.name,
  'pack_definition_id',l.pack_definition_id,'batch_number',l.batch_number,'expiry_date',l.expiry_date,'stock_status',l.stock_status,'version',l.version,
  'quantity',l.sealed_cartons::bigint*d.units_per_carton+l.loose_units,'reserved_units',l.reserved_units,'requires_serial',public.delivery_product_requires_serial(l.product_id)) order by p.name,loc.name,l.batch_number),'[]') into v_lots
 from public.inventory_lots l join public.products p on p.id=l.product_id join public.inventory_locations loc on loc.id=l.location_id join public.product_pack_definitions d on d.id=l.pack_definition_id;
 select coalesce(jsonb_agg(to_jsonb(r)||jsonb_build_object('product_name',p.name,'supplier_name',s.name,'bill_id',c.bill_id,'total_cost_minor',c.total_minor::text,
  'purchase_order_id',(select purchase_order_id from public.purchase_order_lines where id=r.purchase_order_line_id)) order by r.created_at desc),'[]') into v_receipts
 from public.acc_stock_receipts r join public.products p on p.id=r.product_id join public.suppliers s on s.id=r.supplier_id
 left join lateral(select cost.bill_id,cost.total_minor from public.acc_stock_receipt_costs cost join public.acc_supplier_bills b on b.id=cost.bill_id where cost.receipt_id=r.id and b.voided_on is null) c on true;
 select coalesce(jsonb_agg(jsonb_build_object('id',l.id,'purchase_order_id',po.id,'po_number',po.po_number,'supplier_id',po.supplier_id,'supplier_name',s.name,
  'product_id',l.product_id,'product_name',p.name,'quantity',l.quantity,'received_quantity',(select coalesce(sum(quantity),0) from public.acc_stock_receipts where purchase_order_line_id=l.id),
  'requires_serial',public.delivery_product_requires_serial(l.product_id)) order by po.created_at desc,l.line_number),'[]') into v_orders
 from public.purchase_order_lines l join public.purchase_orders po on po.id=l.purchase_order_id join public.products p on p.id=l.product_id join public.suppliers s on s.id=po.supplier_id where po.status in ('ordered','closed');
 return jsonb_build_object('enabled',v_activation is not null,'activation',v_activation,'policy',v_activation->>'policy','cutover_date',v_activation->>'cutover_date',
  'recognition','invoice','products',v_products,'lots',v_lots,'receipts',v_receipts,'purchase_order_lines',v_orders,
  'inventory_value_minor',v_stock::text,'gl_inventory_minor',v_gl::text,'difference_minor',(v_gl-v_stock)::text,
  'locations',(select coalesce(jsonb_agg(to_jsonb(x) order by name),'[]') from public.inventory_locations x where active),
  'pack_definitions',(select coalesce(jsonb_agg(to_jsonb(x) order by product_id,version desc),'[]') from public.product_pack_definitions x),
  'customer_return_lines',(select coalesce(jsonb_agg(to_jsonb(l)||jsonb_build_object('return_number',r.return_number,'product_name',p.name) order by r.received_at desc),'[]') from public.sales_return_lines l join public.sales_returns r on r.id=l.return_id join public.products p on p.id=l.product_id where l.resolution is null),
  'supplier_stock_returns',(select coalesce(jsonb_agg(public.acc_supplier_json(to_jsonb(r))||jsonb_build_object('product_name',p.name,'supplier_name',s.name,'voided_on',v.void_date) order by r.created_at desc),'[]')
   from public.acc_supplier_stock_returns r join public.acc_stock_receipts receipt on receipt.id=r.receipt_id join public.products p on p.id=receipt.product_id join public.suppliers s on s.id=receipt.supplier_id left join public.acc_supplier_stock_return_voids v on v.return_id=r.id),
  'value_corrections',(select coalesce(jsonb_agg(public.acc_supplier_json(to_jsonb(c))||jsonb_build_object('product_id',e.product_id,'product_name',p.name) order by c.correction_date desc,c.id),'[]')
   from public.acc_stock_value_corrections c join public.acc_stock_cost_events e on e.id=c.layer_event_id join public.products p on p.id=e.product_id),
  'cost_layers',(select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'product_id',e.product_id,'product_name',p.name,'source_type',e.source_type,'source_id',e.source_id,'event_date',e.event_date,'quantity',e.quantity,'value_minor',e.value_minor::text,
   'remaining_scope',case when v_activation->>'policy'='fifo' then 'layer' else 'product' end,
   'remaining_quantity',case when v_activation->>'policy'='fifo' then e.quantity-coalesce(a.q,0) else c.q end,
   'remaining_value_minor',(case when v_activation->>'policy'='fifo' then e.value_minor-coalesce(a.v,0)+coalesce((select sum(amount_minor) from public.acc_stock_value_corrections where layer_event_id=e.id),0) else c.v end)::text) order by e.event_date desc,e.created_at desc),'[]')
   from public.acc_stock_cost_events e join public.products p on p.id=e.product_id
   left join lateral(select sum(quantity) q,sum(value_minor) v from public.acc_stock_fifo_allocations where layer_event_id=e.id) a on true
   left join lateral(select sum(quantity) q,sum(value_minor) v from public.acc_stock_cost_events where product_id=e.product_id) c on true where e.quantity>0 and e.source_type<>'invoice_void'),
  'opening_gl_batches',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'source',source,'created_at',created_at) order by created_at desc),'[]') from public.acc_financial_imports where import_kind='opening'));
end $$;

create function public.acc_stock_bill_cost() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_l jsonb;v_r public.acc_stock_receipts;v_po uuid;v_seen uuid[]:='{}';v_cost public.acc_stock_cost_events;
begin
 if tg_op='INSERT' and not exists(select 1 from jsonb_array_elements(new.lines) l where l->>'stock_receipt_id' is not null) then return new;end if;
 perform public.acc_inventory_lock();
 if tg_op='UPDATE' then
  if new.voided_on is not null and old.voided_on is null and exists(select 1 from public.acc_stock_receipt_costs where bill_id=old.id) then
   perform public.acc_inventory_date(new.voided_on);
   for v_cost in select * from public.acc_stock_cost_events where source_type='supplier_receipt' and source_id=old.id loop
    if exists(select 1 from public.acc_stock_cost_events where product_id=v_cost.product_id and created_at>v_cost.created_at and (quantity<0 or source_type='value_correction') and not(source_type='supplier_bill_void' and source_id=old.id)) then
     raise exception 'This stock bill has subsequent cost activity; use a supplier stock return or dated valuation correction';
    end if;
    insert into public.acc_stock_cost_events(product_id,source_type,source_id,source_line_id,event_date,quantity,value_minor,journal_entry_id,created_by)
    values(v_cost.product_id,'supplier_bill_void',old.id,v_cost.source_line_id,new.voided_on,-v_cost.quantity,-v_cost.value_minor,new.void_entry_id,auth.uid());
    if (select policy from public.acc_inventory_activation)='fifo' then
     insert into public.acc_stock_fifo_allocations(event_id,layer_event_id,quantity,value_minor)
     select id,v_cost.id,v_cost.quantity,v_cost.value_minor from public.acc_stock_cost_events where source_type='supplier_bill_void' and source_id=old.id and source_line_id=v_cost.source_line_id;
    end if;
   end loop;
  end if;
  return new;
 end if;
 for v_l in select * from jsonb_array_elements(new.lines) where value->>'stock_receipt_id' is not null loop
  if not exists(select 1 from public.acc_inventory_activation) then raise exception 'Activate verified opening inventory before posting stock supplier bills';end if;
  perform public.acc_inventory_date(new.bill_date);
  select * into v_r from public.acc_stock_receipts where id=(v_l->>'stock_receipt_id')::uuid;
  if not found or v_r.product_id is distinct from (v_l->>'product_id')::uuid or v_r.quantity is distinct from (v_l->>'stock_quantity')::integer or v_r.supplier_id is distinct from new.supplier_id then raise exception 'Stock bill must match the receipt supplier, product and exact base quantity';end if;
  select purchase_order_id into v_po from public.purchase_order_lines where id=v_r.purchase_order_line_id;
  if new.purchase_order_id is distinct from v_po then raise exception 'Stock bill must identify the receipt purchase order';end if;
  if v_r.created_at<=(select created_at from public.acc_inventory_activation) or new.bill_date<v_r.received_on then raise exception 'Stock bills must cover receipts after activation and cannot predate receipt';end if;
  if v_r.id=any(v_seen) or exists(select 1 from public.acc_stock_receipt_costs c join public.acc_supplier_bills b on b.id=c.bill_id where c.receipt_id=v_r.id and b.voided_on is null) then raise exception 'A receipt can be costed by exactly one active supplier bill line';end if;
  v_seen:=v_seen||v_r.id;
  insert into public.acc_stock_receipt_costs(receipt_id,bill_id,total_minor) values(v_r.id,new.id,(v_l->>'net_minor')::bigint);
  insert into public.acc_stock_cost_events(product_id,source_type,source_id,source_line_id,event_date,acquired_on,quantity,value_minor,journal_entry_id,created_by)
  values(v_r.product_id,'supplier_receipt',new.id,v_r.id,new.bill_date,v_r.received_on,v_r.quantity,(v_l->>'net_minor')::bigint,new.journal_entry_id,auth.uid());
 end loop;
 return new;
end $$;
create trigger acc_stock_supplier_bill after insert on public.acc_supplier_bills for each row execute function public.acc_stock_bill_cost();
create trigger acc_stock_supplier_bill_void before update on public.acc_supplier_bills for each row execute function public.acc_stock_bill_cost();

create function public.acc_stock_invoice_cost() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_l jsonb;v_event public.acc_stock_cost_events;v_cost public.acc_stock_invoice_costs;v_date date;v_restored uuid;
begin
 if not exists(select 1 from public.acc_inventory_activation) or new.opening_import_id is not null then return new;end if;
 perform public.acc_inventory_lock();
 if tg_op='UPDATE' then
  if old.voided_at is null and new.voided_at is not null then
   select entry_date into v_date from public.acc_journal_entries where id=new.void_entry_id;
   for v_cost in select * from public.acc_stock_invoice_costs where invoice_id=new.id order by product_id,proforma_line_id loop
    v_restored:=public.acc_inventory_restore(v_cost.product_id,v_cost.quantity,v_cost.value_minor,v_date,'invoice_void',new.id,v_cost.proforma_line_id,'cogs');
    if (select policy from public.acc_inventory_activation)='fifo' then
     insert into public.acc_stock_fifo_allocations(event_id,layer_event_id,quantity,value_minor)
     select v_restored,layer_event_id,-quantity,-value_minor from public.acc_stock_fifo_allocations where event_id=v_cost.event_id;
    end if;
   end loop;
  end if;
  return new;
 end if;
 perform public.acc_inventory_date(new.invoice_date);
 if jsonb_array_length(new.lines)=0 then raise exception 'New inventory invoices require verified product quantities';end if;
 for v_l in select * from jsonb_array_elements(new.lines) order by value->>'product_id',value->>'proforma_line_id' loop
  if nullif(v_l->>'proforma_line_id','') is null or nullif(v_l->>'product_id','') is null then raise exception 'Legacy whole-order invoices cannot infer inventory cost';end if;
  v_event:=public.acc_inventory_consume((v_l->>'product_id')::uuid,(v_l->>'quantity')::integer,new.invoice_date,'invoice',new.id,(v_l->>'proforma_line_id')::uuid,'cogs');
  insert into public.acc_stock_invoice_costs(invoice_id,proforma_line_id,product_id,quantity,value_minor,event_id)
  values(new.id,(v_l->>'proforma_line_id')::uuid,(v_l->>'product_id')::uuid,(v_l->>'quantity')::integer,-v_event.value_minor,v_event.id);
 end loop;
 return new;
end $$;
create trigger acc_stock_invoice after insert or update on public.acc_invoices for each row execute function public.acc_stock_invoice_cost();

create function public.acc_stock_issue_cost() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_invoice uuid;v_line uuid;v_cost public.acc_stock_invoice_costs;v_qty bigint;
begin
 if not exists(select 1 from public.acc_inventory_activation) then return new;end if;
 perform public.acc_inventory_lock();
 if new.delivery_line_id is null then
  perform public.acc_inventory_consume(new.product_id,new.quantity,new.issued_on,'direct_issue',new.id,new.id,'cogs');
 else
  select n.invoice_id,l.proforma_line_id into v_invoice,v_line from public.sales_delivery_lines l join public.sales_delivery_notes n on n.id=l.delivery_note_id where l.id=new.delivery_line_id;
  select * into v_cost from public.acc_stock_invoice_costs where invoice_id=v_invoice and proforma_line_id=v_line;
  if not found then raise exception 'Delivery has no verified invoice cost allocation; Accounts must reconcile it before dispatch';end if;
  select coalesce(sum(i.quantity),0) into v_qty from public.inventory_issues i join public.sales_delivery_lines l on l.id=i.delivery_line_id
   join public.sales_delivery_notes n on n.id=l.delivery_note_id where n.invoice_id=v_invoice and l.proforma_line_id=v_line;
  if v_qty>v_cost.quantity then raise exception 'Physical issues exceed the quantities already costed on this invoice';end if;
 end if;
 return new;
end $$;
create trigger acc_stock_issue after insert on public.inventory_issues for each row execute function public.acc_stock_issue_cost();

create function public.acc_stock_return_cost() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_invoice uuid;v_line uuid;v_cost public.acc_stock_invoice_costs;v_qty bigint;v_value bigint;v_part bigint;
begin
 if not exists(select 1 from public.acc_inventory_activation) then return new;end if;
 perform public.acc_inventory_lock();
 if tg_op='UPDATE' then
  if old.resolution is null and new.resolution is not null then
   if coalesce((select sum(quantity) from public.acc_stock_cost_events where source_type in ('return_credit','return_credit_void') and source_line_id=new.id),0)<>new.quantity then raise exception 'Accounts must post the return credit and original cost before stock can be released or written off';end if;
   if new.resolution='return_to_supplier' and not exists(select 1 from public.acc_supplier_stock_returns where customer_return_line_id=new.id) then raise exception 'Use Accounts supplier stock return to remove the returned goods and post its supplier credit together';end if;
  end if;
  return new;
 end if;
 select n.invoice_id,l.proforma_line_id into v_invoice,v_line from public.sales_delivery_lines l join public.sales_delivery_notes n on n.id=l.delivery_note_id where l.id=new.delivery_line_id;
 select * into v_cost from public.acc_stock_invoice_costs where invoice_id=v_invoice and proforma_line_id=v_line;
 if not found then raise exception 'This legacy sale has no verified original stock cost; Accounts must reconcile its return cost';end if;
 select coalesce(sum(quantity),0),coalesce(sum(value_minor),0) into v_qty,v_value from public.acc_stock_return_costs where invoice_id=v_invoice and proforma_line_id=v_line;
 if v_qty+new.quantity>v_cost.quantity then raise exception 'Returned quantity exceeds the original cost allocation';end if;
 v_part:=round(v_cost.value_minor::numeric*(v_qty+new.quantity)/v_cost.quantity)::bigint-v_value;
 insert into public.acc_stock_return_costs(return_line_id,invoice_id,proforma_line_id,quantity,value_minor) values(new.id,v_invoice,v_line,new.quantity,v_part);
 return new;
end $$;
create trigger acc_stock_return after insert or update on public.sales_return_lines for each row execute function public.acc_stock_return_cost();

create function public.acc_stock_credit_cost() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_line record;
begin
 if not exists(select 1 from public.acc_inventory_activation) then return new;end if;
 perform public.acc_inventory_lock();
 for v_line in select r.id,r.product_id,c.quantity,c.value_minor,c.invoice_id from public.sales_return_lines r
  left join public.acc_stock_return_costs c on c.return_line_id=r.id where r.return_id=new.return_id order by r.product_id,r.id loop
  if v_line.invoice_id is distinct from new.invoice_id then raise exception 'Return credit has no verified original invoice cost';end if;
  perform public.acc_inventory_restore(v_line.product_id,v_line.quantity,v_line.value_minor,new.credit_date,'return_credit',new.id,v_line.id,'cogs');
 end loop;
 return new;
end $$;
create trigger acc_stock_credit after insert on public.acc_credit_notes for each row execute function public.acc_stock_credit_cost();

alter table public.inventory_movements drop constraint inventory_movements_movement_type_check;
alter table public.inventory_movements add constraint inventory_movements_movement_type_check check(movement_type in
 ('opening_balance','opening_adjustment','transfer_dispatch','transfer_receipt','quarantine_receipt','break_pack','consumer_issue','consumer_return','return_release','return_write_off','return_to_supplier','supplier_receipt','supplier_stock_return','supplier_return_void'));
create function public.acc_stock_movement_cost() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_product uuid;v_delta bigint;v_q bigint;v_v bigint;v_cost bigint;
begin
 if not exists(select 1 from public.acc_inventory_activation) then return new;end if;
 perform public.acc_inventory_lock();select product_id into v_product from public.inventory_lots where id=new.lot_id;
 if new.movement_type in ('supplier_receipt','consumer_issue','consumer_return','break_pack','return_release','transfer_dispatch','supplier_stock_return','supplier_return_void') then return new;end if;
 if new.movement_type='return_to_supplier' then raise exception 'Use a reviewed supplier stock correction for returned stock';end if;
 if new.movement_type in ('opening_balance','opening_adjustment') and new.base_unit_change>0 then raise exception 'Receive new purchases against their supplier PO; positive count corrections need an explicitly verified acquisition cost';end if;
 v_delta:=new.base_unit_change;
 if new.movement_type in ('transfer_receipt','quarantine_receipt') then
  select new.base_unit_change-expected_units into v_delta from public.inventory_transfers where id=new.transfer_id;
  if v_delta>0 then raise exception 'A transfer surplus needs a verified quantity/cost correction; do not invent acquisition cost';end if;
 end if;
 if v_delta<0 then
  perform public.acc_inventory_consume(v_product,-v_delta,current_date,'stock_adjustment',new.id,new.id,'inventory_adjustment');
 elsif v_delta<>0 then raise exception 'Unsupported uncosted inventory movement';
 end if;
 return new;
end $$;
create trigger acc_stock_movement after insert on public.inventory_movements for each row execute function public.acc_stock_movement_cost();

-- Count gains are explicit acquisition values; ordinary opening/count RPCs may never invent these values.
create function public.post_inventory_count_gain(p_id uuid,p_lot_id uuid,p_expected_version integer,p_quantity integer,p_total_cost_minor bigint,p_date date,p_evidence text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_lot public.inventory_lots;v public.acc_stock_cost_events;v_entry uuid;v_request text;
begin
 perform public.acc_require_access();perform public.acc_inventory_lock();
 v_request:=jsonb_build_object('lot_id',p_lot_id,'expected_version',p_expected_version,'quantity',p_quantity,'total_cost_minor',p_total_cost_minor,'date',p_date,'evidence',trim(p_evidence))::text;
 select * into v from public.acc_stock_cost_events where source_type='count_gain' and source_id=p_id;
 if found then
  if not exists(select 1 from public.inventory_movements where id=p_id and reason=v_request) then raise exception 'Count correction id was already used for different details';end if;return public.acc_supplier_json(to_jsonb(v));
 end if;
 if p_id is null or p_quantity is null or p_quantity<=0 or p_total_cost_minor is null or p_total_cost_minor<0 or p_total_cost_minor>9007199254740991
  or length(trim(coalesce(p_evidence,''))) not between 5 and 500 then raise exception 'Enter positive found quantity, verified total acquisition cost and evidence';end if;
 perform public.acc_inventory_date(p_date);
 if not exists(select 1 from public.acc_inventory_activation) then raise exception 'Activate inventory accounting before posting count corrections';end if;
 select * into v_lot from public.inventory_lots where id=p_lot_id and version=p_expected_version for update;
 if not found then raise exception 'Stock changed; refresh before correcting';end if;
 if public.delivery_product_requires_serial(v_lot.product_id) then raise exception 'Machine count corrections require a reviewed serial identity adjustment';end if;
 update public.inventory_lots set loose_units=loose_units+p_quantity,version=version+1,updated_at=now() where id=p_lot_id;
 -- The explicit cost is posted first; this movement kind cannot enter the implicit count-cost path.
 v_entry:=public.acc_inventory_restore(v_lot.product_id,p_quantity,p_total_cost_minor,p_date,'count_gain',p_id,p_lot_id,'inventory_adjustment');
 insert into public.inventory_movements(id,lot_id,movement_type,loose_unit_change,base_unit_change,reason,actor_user_id)
 values(p_id,p_lot_id,'supplier_receipt',p_quantity,p_quantity,v_request,auth.uid());
 select * into v from public.acc_stock_cost_events where id=v_entry;return public.acc_supplier_json(to_jsonb(v));
end $$;

-- A single transaction lock precedes stock/order row locks. Existing entry points acquire it below.
create function public.acc_inventory_lock() returns void language sql security definer set search_path=public,pg_temp as $$
 select pg_advisory_xact_lock(hashtextextended('acc-financial-import',0));
 select pg_advisory_xact_lock(hashtextextended('acc-inventory-cost',0))
$$;
create function public.acc_inventory_date(p_date date) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare v_cutover date;v_last date;v_lock date;
begin
 select cutover_date into v_cutover from public.acc_inventory_activation;
 select locked_through into v_lock from public.acc_settings where id for share;
 if p_date is null or not isfinite(p_date) or p_date<=v_cutover or p_date<=v_lock or p_date>current_date then
  raise exception 'Inventory posting date must be after cutover and the books lock, and no later than today';
 end if;
 select max(event_date) into v_last from public.acc_stock_cost_events;
 if p_date<v_last then raise exception 'Inventory costs cannot be backdated before the latest cost posting (%)',v_last;end if;
end $$;

create function public.acc_inventory_consume(p_product uuid,p_quantity bigint,p_date date,p_kind text,p_source uuid,p_line uuid,p_expense_key text)
returns public.acc_stock_cost_events language plpgsql security definer set search_path=public,pg_temp as $$
declare v_policy text;v_qty bigint;v_value bigint;v_cost bigint:=0;v_needed bigint:=p_quantity;v_take bigint;v_part bigint;
 v_layer record;v_event public.acc_stock_cost_events;v_journal uuid;v_alloc jsonb:='[]';v_a jsonb;
begin
 perform public.acc_inventory_lock();perform public.acc_inventory_date(p_date);
 select policy into v_policy from public.acc_inventory_activation;
 if v_policy is null then raise exception 'Inventory accounting has not been activated';end if;
 if p_quantity is null or p_quantity<=0 then raise exception 'A positive cost quantity is required';end if;
 if exists(select 1 from public.acc_stock_receipts r where r.product_id=p_product
  and r.created_at>(select created_at from public.acc_inventory_activation) and not exists(select 1 from public.acc_stock_receipt_costs c join public.acc_supplier_bills b on b.id=c.bill_id where c.receipt_id=r.id and b.voided_on is null)) then
  raise exception 'This product has uncosted receipts; Accounts must post its verified supplier costs first';
 end if;
 select coalesce(sum(quantity),0),coalesce(sum(value_minor),0) into v_qty,v_value from public.acc_stock_cost_events where product_id=p_product;
 if v_qty<p_quantity or v_value<0 then raise exception 'Not enough verified inventory cost for this product';end if;
 if v_policy='weighted_average' then
  v_cost:=case when p_quantity=v_qty then v_value else round(v_value::numeric*p_quantity/v_qty)::bigint end;
 else
  for v_layer in select e.id,e.quantity-coalesce(a.q,0) q,e.value_minor-coalesce(a.v,0)+coalesce((select sum(amount_minor) from public.acc_stock_value_corrections where layer_event_id=e.id),0) v
   from public.acc_stock_cost_events e left join lateral(select sum(quantity) q,sum(value_minor) v from public.acc_stock_fifo_allocations where layer_event_id=e.id) a on true
   where e.product_id=p_product and e.quantity>0 and e.source_type<>'invoice_void' and e.quantity>coalesce(a.q,0) order by coalesce(e.acquired_on,e.event_date),e.created_at,e.id loop
   v_take:=least(v_needed,v_layer.q);v_part:=case when v_take=v_layer.q then v_layer.v else round(v_layer.v::numeric*v_take/v_layer.q)::bigint end;
   v_alloc:=v_alloc||jsonb_build_array(jsonb_build_object('id',v_layer.id,'q',v_take,'v',v_part));
   v_cost:=v_cost+v_part;v_needed:=v_needed-v_take;exit when v_needed=0;
  end loop;
  if v_needed<>0 then raise exception 'FIFO cost layers are incomplete';end if;
 end if;
 if v_cost>0 then
  v_journal:=gen_random_uuid();
  perform public.acc_post(v_journal,p_date,'Inventory cost: '||p_kind,'inventory_cost',p_source,null,jsonb_build_array(
   jsonb_build_object('account_id',public.acc_account_by_key(p_expense_key),'debit_minor',v_cost),
   jsonb_build_object('account_id',public.acc_account_by_key('inventory'),'credit_minor',v_cost)));
 end if;
 insert into public.acc_stock_cost_events(product_id,source_type,source_id,source_line_id,event_date,quantity,value_minor,journal_entry_id,created_by)
 values(p_product,p_kind,p_source,p_line,p_date,-p_quantity,-v_cost,v_journal,auth.uid()) returning * into v_event;
 for v_a in select * from jsonb_array_elements(v_alloc) loop
  insert into public.acc_stock_fifo_allocations(event_id,layer_event_id,quantity,value_minor) values(v_event.id,(v_a->>'id')::uuid,(v_a->>'q')::bigint,(v_a->>'v')::bigint);
 end loop;
 return v_event;
end $$;

create function public.acc_inventory_restore(p_product uuid,p_quantity bigint,p_value bigint,p_date date,p_kind text,p_source uuid,p_line uuid,p_expense_key text)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare v_entry uuid;v_id uuid;
begin
 perform public.acc_inventory_lock();perform public.acc_inventory_date(p_date);
 if p_quantity<=0 or p_value<0 then raise exception 'Restored stock needs a positive quantity and nonnegative verified cost';end if;
 if p_value>0 then
  v_entry:=gen_random_uuid();perform public.acc_post(v_entry,p_date,'Inventory cost: '||p_kind,'inventory_cost',p_source,null,jsonb_build_array(
   jsonb_build_object('account_id',public.acc_account_by_key('inventory'),'debit_minor',p_value),
   jsonb_build_object('account_id',public.acc_account_by_key(p_expense_key),'credit_minor',p_value)));
 end if;
 insert into public.acc_stock_cost_events(product_id,source_type,source_id,source_line_id,event_date,quantity,value_minor,journal_entry_id,created_by)
 values(p_product,p_kind,p_source,p_line,p_date,p_quantity,p_value,v_entry,auth.uid()) returning id into v_id;
 return v_id;
end $$;

create function public.activate_inventory_costing(p_id uuid,p_policy text,p_cutover date,p_gl_import_id uuid,p_rows jsonb,p_reference text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v public.acc_inventory_activation;v_r jsonb;v_lot public.inventory_lots;v_qty bigint;v_value bigint;v_total bigint:=0;v_gl bigint;v_all_gl bigint;v_seen uuid[]:='{}';v_date date;
begin
 perform public.acc_require_access();if not public.inventory_owner() then raise exception 'Owner approval is required to activate inventory accounting';end if;
 perform public.acc_inventory_lock();perform pg_advisory_xact_lock(hashtextextended('acc-financial-import',0));
 select * into v from public.acc_inventory_activation;
 if found then
  if (v.id,v.policy,v.cutover_date,v.gl_import_id,v.rows,v.reference) is distinct from (p_id,p_policy,p_cutover,p_gl_import_id,p_rows,trim(p_reference)) then raise exception 'Inventory costing was already activated with different details; posted history cannot be recosted';end if;
  return public.acc_supplier_json(to_jsonb(v));
 end if;
 if p_id is null or p_policy not in ('weighted_average','fifo') or p_policy is null then raise exception 'Choose the approved weighted_average or fifo accounting policy';end if;
 if p_cutover is null or p_cutover<>current_date-1 then raise exception 'Use yesterday as opening cutover and activate against verified current physical stock before new operations';end if;
 if length(trim(coalesce(p_reference,''))) not between 5 and 500 then raise exception 'Enter the Accounts sign-off and evidence reference';end if;
 if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows)>10000 or octet_length(p_rows::text)>4194304 then raise exception 'Supply at most 10000 verified opening stock rows (4 MB)';end if;
 if exists(select 1 from public.inventory_transfers where status='in_transit') or exists(select 1 from public.inventory_lots where reserved_units>0)
  or exists(select 1 from public.sales_delivery_notes where status not in ('delivered','cancelled')) then raise exception 'Finish or cancel open deliveries and transfers before inventory cutover';end if;
 if exists(select 1 from public.sales_return_lines where resolution is null) then raise exception 'Resolve existing returns before inventory cutover';end if;
 if exists(select 1 from public.acc_invoices where voided_at is null and opening_import_id is null and invoice_date>p_cutover) then raise exception 'Cutover cannot follow a current-period invoice; activate before new invoicing';end if;
 if exists(select 1 from public.inventory_movements where (created_at at time zone 'Africa/Dar_es_Salaam')::date>p_cutover) then raise exception 'Reconcile today''s stock movements before a later cutover; no historical costs are inferred';end if;
 if not exists(select 1 from public.acc_financial_imports where id=p_gl_import_id and import_kind='opening') then raise exception 'Choose an existing opening GL import';end if;
 if not exists(select 1 from public.acc_imported_journals where import_id=p_gl_import_id) or exists(
  select 1 from public.acc_imported_journals j join public.acc_journal_entries e on e.id=j.entry_id where j.import_id=p_gl_import_id and
  (e.entry_date<>p_cutover or exists(select 1 from public.acc_journal_entries r where r.reverses_entry_id=e.id))) then raise exception 'Opening GL must be unreversed and dated at the cutover';end if;
 for v_r in select * from jsonb_array_elements(p_rows) loop
  if jsonb_typeof(v_r)<>'object' or v_r-array['lot_id','expected_version','quantity','total_cost_minor','evidence_reference','acquired_on']<>'{}' then raise exception 'Opening rows contain unknown fields';end if;
  select * into v_lot from public.inventory_lots where id=(v_r->>'lot_id')::uuid for update;
  if not found or v_lot.id=any(v_seen) or v_lot.version is distinct from (v_r->>'expected_version')::integer then raise exception 'Opening lot is missing, duplicated or changed';end if;
  v_seen:=v_seen||v_lot.id;
  select v_lot.sealed_cartons::bigint*units_per_carton+v_lot.loose_units into v_qty from public.product_pack_definitions where id=v_lot.pack_definition_id;
  if v_qty<=0 or v_qty is distinct from (v_r->>'quantity')::bigint then raise exception 'Verified quantity must exactly match physical stock';end if;
  if coalesce(v_r->>'total_cost_minor','')!~'^[0-9]+$' or length(trim(coalesce(v_r->>'evidence_reference','')))<3 then raise exception 'Enter verified acquisition cost and its evidence for every lot';end if;
  v_value:=(v_r->>'total_cost_minor')::bigint;if v_value>9007199254740991 then raise exception 'Opening cost is too large';end if;
  v_date:=coalesce(nullif(v_r->>'acquired_on','')::date,p_cutover);
  if v_date>p_cutover or not isfinite(v_date) or (p_policy='fifo' and nullif(v_r->>'acquired_on','') is null) then raise exception 'FIFO needs each opening lot''s verified acquisition date on or before cutover';end if;
  v_total:=v_total+v_value;if v_total>9007199254740991 then raise exception 'Opening total is too large';end if;
 end loop;
 if exists(select 1 from public.inventory_lots l join public.product_pack_definitions p on p.id=l.pack_definition_id where l.sealed_cartons::bigint*p.units_per_carton+l.loose_units>0 and not(l.id=any(v_seen))) then raise exception 'Include every positive physical lot, including quarantine';end if;
 select coalesce(sum(l.debit_minor-l.credit_minor),0) into v_gl from public.acc_imported_journals j join public.acc_journal_lines l on l.entry_id=j.entry_id where j.import_id=p_gl_import_id and l.account_id=public.acc_account_by_key('inventory');
 select coalesce(sum(l.debit_minor-l.credit_minor),0) into v_all_gl from public.acc_journal_lines l where l.account_id=public.acc_account_by_key('inventory');
 if v_total<>v_gl or v_total<>v_all_gl then raise exception 'Verified stock value % must equal imported opening inventory % and the GL control balance %',v_total,v_gl,v_all_gl;end if;
 insert into public.acc_inventory_activation(id,policy,cutover_date,gl_import_id,rows,reference,total_minor,created_by)
 values(p_id,p_policy,p_cutover,p_gl_import_id,p_rows,trim(p_reference),v_total,auth.uid()) returning * into v;
 for v_r in select * from jsonb_array_elements(p_rows) order by coalesce(nullif(value->>'acquired_on','')::date,p_cutover),value->>'lot_id' loop
  insert into public.acc_stock_cost_events(product_id,source_type,source_id,source_line_id,event_date,acquired_on,quantity,value_minor,created_by)
  select product_id,'opening',p_id,id,p_cutover,coalesce(nullif(v_r->>'acquired_on','')::date,p_cutover),(v_r->>'quantity')::bigint,(v_r->>'total_cost_minor')::bigint,auth.uid() from public.inventory_lots where id=(v_r->>'lot_id')::uuid;
 end loop;
 return public.acc_supplier_json(to_jsonb(v));
end $$;

create function public.correct_inventory_value(p_id uuid,p_layer_event_id uuid,p_amount_minor bigint,p_date date,p_evidence text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v public.acc_stock_value_corrections;v_layer public.acc_stock_cost_events;v_qty bigint;v_value bigint;v_journal uuid:=gen_random_uuid();v_event uuid;
begin
 perform public.acc_require_access();perform public.acc_inventory_lock();
 select * into v from public.acc_stock_value_corrections where id=p_id;
 if found then if (v.layer_event_id,v.amount_minor,v.correction_date,v.evidence) is distinct from (p_layer_event_id,p_amount_minor,p_date,trim(p_evidence)) then raise exception 'Valuation correction id was already used for different details';end if;return public.acc_supplier_json(to_jsonb(v));end if;
 perform public.acc_inventory_date(p_date);
 if p_id is null or p_amount_minor is null or p_amount_minor=0 or abs(p_amount_minor::numeric)>9007199254740991 or length(trim(coalesce(p_evidence,''))) not between 5 and 500 then raise exception 'Enter a dated nonzero verified value correction and evidence';end if;
 select * into v_layer from public.acc_stock_cost_events where id=p_layer_event_id and quantity>0 and source_type<>'invoice_void';
 if not found then raise exception 'Choose the acquisition cost layer being corrected';end if;
 select sum(quantity),sum(value_minor) into v_qty,v_value from public.acc_stock_cost_events where product_id=v_layer.product_id;
 if v_qty<=0 or v_value+p_amount_minor<0 then raise exception 'A valuation correction needs remaining inventory and cannot make its value negative';end if;
 if (select policy from public.acc_inventory_activation)='fifo' then
  select v_layer.quantity-coalesce(sum(quantity),0),v_layer.value_minor-coalesce(sum(value_minor),0)+(select coalesce(sum(amount_minor),0) from public.acc_stock_value_corrections where layer_event_id=v_layer.id)
   into v_qty,v_value from public.acc_stock_fifo_allocations where layer_event_id=v_layer.id;
  if v_qty<=0 or v_value+p_amount_minor<0 then raise exception 'The FIFO layer has no remaining units or its corrected value would be negative';end if;
 end if;
 perform public.acc_post(v_journal,p_date,'Inventory value correction: '||left(trim(p_evidence),450),'inventory_cost',p_id,null,jsonb_build_array(
  jsonb_build_object('account_id',public.acc_account_by_key('inventory'),'debit_minor',greatest(p_amount_minor,0),'credit_minor',greatest(-p_amount_minor,0)),
  jsonb_build_object('account_id',public.acc_account_by_key('inventory_adjustment'),'credit_minor',greatest(p_amount_minor,0),'debit_minor',greatest(-p_amount_minor,0))));
 insert into public.acc_stock_cost_events(product_id,source_type,source_id,source_line_id,event_date,quantity,value_minor,journal_entry_id,created_by)
 values(v_layer.product_id,'value_correction',p_id,p_layer_event_id,p_date,0,p_amount_minor,v_journal,auth.uid()) returning id into v_event;
 insert into public.acc_stock_value_corrections(id,event_id,layer_event_id,amount_minor,correction_date,evidence,created_by)
 values(p_id,v_event,p_layer_event_id,p_amount_minor,p_date,trim(p_evidence),auth.uid()) returning * into v;return public.acc_supplier_json(to_jsonb(v));
end $$;

create function public.acc_validate_supplier_stock_credit(p_credit_id uuid,p_bill_id uuid,p_line_no integer,p_stock_return_id uuid,p_net_minor bigint,p_tax_minor bigint,p_date date)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if not exists(select 1 from public.acc_supplier_stock_returns where id=p_stock_return_id and id=p_credit_id and bill_id=p_bill_id and line_no=p_line_no
  and net_minor=p_net_minor and tax_minor=p_tax_minor and return_date=p_date) then raise exception 'Record the actual supplier stock return and its credit together';end if;
end $$;

create function public.return_supplier_stock(p_id uuid,p_bill_id uuid,p_line_no integer,p_lot_id uuid,p_expected_version integer,p_quantity integer,
 p_date date,p_reference text,p_reason text,p_tax_minor bigint,p_serials text[] default '{}',p_customer_return_line_id uuid default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v public.acc_supplier_stock_returns;v_bill public.acc_supplier_bills;v_original jsonb;v_receipt public.acc_stock_receipts;v_lot public.inventory_lots;
 v_request jsonb;v_qty bigint;v_net bigint;v_prior bigint;v_cost public.acc_stock_cost_events;v_offset uuid:=gen_random_uuid();v_serials text[];v_ids uuid[];v_credit jsonb;
begin
 perform public.acc_require_access();perform public.acc_inventory_lock();
 select coalesce(array_agg(trim(s) order by upper(trim(s))),'{}') into v_serials from unnest(coalesce(p_serials,'{}')) s;
 v_request:=jsonb_build_object('bill_id',p_bill_id,'line_no',p_line_no,'lot_id',p_lot_id,'expected_version',p_expected_version,'quantity',p_quantity,'date',p_date,'reference',trim(p_reference),'reason',trim(p_reason),'tax_minor',p_tax_minor,'serials',v_serials,'customer_return_line_id',p_customer_return_line_id);
 select * into v from public.acc_supplier_stock_returns where id=p_id;
 if found then if v.request_content is distinct from v_request then raise exception 'Supplier return id was already used for different details';end if;
  return jsonb_build_object('return',public.acc_supplier_json(to_jsonb(v)),'credit',(select public.acc_supplier_json(to_jsonb(c)) from public.acc_supplier_credits c where id=p_id));end if;
 if p_id is null or p_quantity is null or p_quantity<=0 or p_tax_minor is null or p_tax_minor<0 or length(trim(coalesce(p_reason,''))) not between 5 and 300 or length(trim(coalesce(p_reference,''))) not between 1 and 120 then raise exception 'Enter actual returned units, explicit tax credit, reference and reason';end if;
 select * into v_bill from public.acc_supplier_bills where id=p_bill_id and voided_on is null;
 if not found then raise exception 'Choose the original active supplier bill';end if;
 v_original:=v_bill.lines->(p_line_no-1);
 select * into v_receipt from public.acc_stock_receipts where id=(v_original->>'stock_receipt_id')::uuid;
 if not found then raise exception 'Choose an original stock receipt bill line';end if;
 select * into v_lot from public.inventory_lots where id=p_lot_id and version=p_expected_version and product_id=v_receipt.product_id for update;
 if not found or v_lot.loose_units-v_lot.reserved_units<p_quantity then raise exception 'Choose enough unreserved loose units in the actual return lot';end if;
 if p_customer_return_line_id is not null and not exists(select 1 from public.sales_return_lines where id=p_customer_return_line_id and quarantine_lot_id=p_lot_id and quantity=p_quantity and resolution is null) then raise exception 'Select an unresolved customer return line with exactly these quarantined units';end if;
 select coalesce(sum(quantity),0),coalesce(sum(net_minor),0) into v_qty,v_prior from public.acc_supplier_stock_returns r where bill_id=p_bill_id and line_no=p_line_no and not exists(select 1 from public.acc_supplier_stock_return_voids where return_id=r.id);
 if v_qty+p_quantity>v_receipt.quantity then raise exception 'Supplier returns exceed the original received quantity';end if;
 v_net:=round((v_original->>'net_minor')::numeric*(v_qty+p_quantity)/v_receipt.quantity)::bigint-v_prior;
 if v_net<=0 then raise exception 'Returned quantity has no positive supplier credit amount';end if;
 v_ids:='{}';
 if public.delivery_product_requires_serial(v_lot.product_id) then
  select array_agg(id) into v_ids from public.inventory_serial_receipts s where s.product_id=v_lot.product_id
   and upper(s.serial_number)=any(select upper(x) from unnest(v_serials) x)
   and (public.inventory_serial_available_lot(s.id)=v_lot.id
    or (p_customer_return_line_id is not null and exists(select 1 from public.delivery_line_serials where inventory_serial_id=s.id and return_line_id=p_customer_return_line_id))
    or (v_lot.stock_status='quarantine' and s.lot_id=v_lot.id and not exists(select 1 from public.delivery_line_serials where inventory_serial_id=s.id) and not exists(select 1 from public.inventory_transfer_serials where inventory_serial_id=s.id)))
   and not exists(select 1 from public.acc_supplier_stock_returns r where s.id=any(r.serial_ids) and not exists(select 1 from public.acc_supplier_stock_return_voids where return_id=r.id));
  if cardinality(v_serials)<>p_quantity or coalesce(cardinality(v_ids),0)<>p_quantity then raise exception 'Select the actual available serial of every returned machine';end if;
 elsif cardinality(v_serials)>0 then raise exception 'This product does not use machine serial numbers';end if;
 v_cost:=public.acc_inventory_consume(v_lot.product_id,p_quantity,p_date,'supplier_stock_return',p_id,p_lot_id,'inventory_adjustment');
 update public.inventory_lots set loose_units=loose_units-p_quantity,version=version+1,updated_at=now() where id=p_lot_id;
 perform public.acc_post(v_offset,p_date,'Supplier return cost variance '||trim(p_reference),'inventory_cost',p_id,null,jsonb_build_array(
  jsonb_build_object('account_id',public.acc_account_by_key('inventory'),'debit_minor',v_net),
  jsonb_build_object('account_id',public.acc_account_by_key('inventory_adjustment'),'credit_minor',v_net)));
 insert into public.acc_supplier_stock_returns(id,bill_id,line_no,receipt_id,lot_id,customer_return_line_id,quantity,net_minor,tax_minor,return_date,reference,reason,request_content,cost_event_id,offset_entry_id,serial_ids,created_by)
 values(p_id,p_bill_id,p_line_no,v_receipt.id,p_lot_id,p_customer_return_line_id,p_quantity,v_net,p_tax_minor,p_date,trim(p_reference),trim(p_reason),v_request,v_cost.id,v_offset,v_ids,auth.uid()) returning * into v;
 insert into public.inventory_movements(id,lot_id,movement_type,loose_unit_change,base_unit_change,reason,actor_user_id)
 values(p_id,p_lot_id,'supplier_stock_return',-p_quantity,-p_quantity,trim(p_reason),auth.uid());
 v_credit:=public.post_supplier_credit(p_id,p_bill_id,p_date,p_reference,p_reason,jsonb_build_array(jsonb_build_object('line_no',p_line_no,'net_minor',v_net::text,'tax_minor',p_tax_minor::text,'stock_return_id',p_id)));
 if p_customer_return_line_id is not null then
  update public.sales_return_lines set resolution='return_to_supplier',resolution_note=trim(p_reason),condition_confirmed=false,resolved_by=auth.uid(),resolved_at=now() where id=p_customer_return_line_id;
  update public.sales_returns set version=version+1,status=case when exists(select 1 from public.sales_return_lines where return_id=sales_returns.id and resolution is null) then 'quarantined' else 'resolved' end
   where id=(select return_id from public.sales_return_lines where id=p_customer_return_line_id);
 end if;
 return jsonb_build_object('return',public.acc_supplier_json(to_jsonb(v)),'credit',v_credit);
end $$;

create function public.acc_void_supplier_stock_credit(p_credit_id uuid,p_date date,p_reason text)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare v public.acc_supplier_stock_returns;v_event public.acc_stock_cost_events;
begin
 perform public.acc_inventory_lock();select * into v from public.acc_supplier_stock_returns where id=p_credit_id;
 if not found then raise exception 'Supplier stock credit has no matching stock return';end if;
 if v.customer_return_line_id is not null then raise exception 'Resolved customer return history cannot be undone; record actual returned supplier goods as a new receipt';end if;
 if exists(select 1 from public.acc_supplier_stock_return_voids where return_id=v.id) then return;end if;
 select * into v_event from public.acc_stock_cost_events where id=v.cost_event_id;
 if exists(select 1 from public.acc_stock_cost_events where product_id=v_event.product_id and created_at>v_event.created_at) then raise exception 'Later inventory activity prevents undoing this return; post a new verified supplier receipt instead';end if;
 perform public.acc_inventory_restore(v_event.product_id,v.quantity,-v_event.value_minor,p_date,'supplier_return_void',v.id,v.lot_id,'inventory_adjustment');
 perform public.acc_reverse(gen_random_uuid(),v.offset_entry_id,p_date,'Undo supplier stock return: '||trim(p_reason));
 update public.inventory_lots set loose_units=loose_units+v.quantity,version=version+1,updated_at=now() where id=v.lot_id;
 insert into public.acc_supplier_stock_return_voids(return_id,void_date,reason,created_by) values(v.id,p_date,trim(p_reason),auth.uid());
 insert into public.inventory_movements(id,lot_id,movement_type,loose_unit_change,base_unit_change,reason,actor_user_id)
 values(gen_random_uuid(),v.lot_id,'supplier_return_void',v.quantity,v.quantity,'Undo supplier return: '||trim(p_reason),auth.uid());
end $$;

create function public.acc_inventory_control_guard() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_source text;v_original text;
begin
 if not exists(select 1 from public.acc_inventory_activation) or new.account_id<>public.acc_account_by_key('inventory') then return new;end if;
 select e.source_type,o.source_type into v_source,v_original from public.acc_journal_entries e left join public.acc_journal_entries o on o.id=e.reverses_entry_id where e.id=new.entry_id;
 if v_source='manual' or (v_source='reversal' and v_original='manual') then raise exception 'Active inventory control must reconcile through stock transactions, not manual or opening GL changes';end if;return new;
end $$;
create trigger acc_inventory_control before insert on public.acc_journal_lines for each row execute function public.acc_inventory_control_guard();

create function public.acc_void_return_credit_cost(p_credit_id uuid,p_date date)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare v public.acc_stock_cost_events;v_entry uuid;v_event uuid;
begin
 if not exists(select 1 from public.acc_inventory_activation) then return;end if;
 perform public.acc_inventory_lock();perform public.acc_inventory_date(p_date);
 for v in select * from public.acc_stock_cost_events where source_type='return_credit' and source_id=p_credit_id order by product_id,source_line_id loop
  if exists(select 1 from public.sales_return_lines where id=v.source_line_id and resolution is not null)
   or exists(select 1 from public.acc_stock_cost_events where product_id=v.product_id and created_at>v.created_at and (quantity<0 or source_type='value_correction') and not(source_type='return_credit_void' and source_id=p_credit_id)) then
   raise exception 'Return credit cannot be voided after stock resolution or subsequent cost consumption; reconcile a dated correction';
  end if;
  v_entry:=null;if v.journal_entry_id is not null then v_entry:=gen_random_uuid();perform public.acc_reverse(v_entry,v.journal_entry_id,p_date,'Void customer return cost');end if;
  insert into public.acc_stock_cost_events(product_id,source_type,source_id,source_line_id,event_date,quantity,value_minor,journal_entry_id,created_by)
  values(v.product_id,'return_credit_void',p_credit_id,v.source_line_id,p_date,-v.quantity,-v.value_minor,v_entry,auth.uid()) returning id into v_event;
  if (select policy from public.acc_inventory_activation)='fifo' then insert into public.acc_stock_fifo_allocations(event_id,layer_event_id,quantity,value_minor) values(v_event,v.id,v.quantity,v.value_minor);end if;
 end loop;
end $$;

-- Serialize before existing row locks, retaining each installed operation's authorization and checks.
do $migration$ declare r record;v text;v_begin text;v_prefix text;begin
 v:=pg_get_functiondef('public.inventory_serial_available_lot(uuid)'::regprocedure);
 v_begin:=' select * into v_receipt from public.inventory_serial_receipts where id=p_inventory_serial_id;';
 if strpos(v,v_begin)=0 then raise exception 'Serial supplier return insertion point changed';end if;
 execute replace(v,v_begin,' if exists(select 1 from public.acc_supplier_stock_returns r where p_inventory_serial_id=any(r.serial_ids) and not exists(select 1 from public.acc_supplier_stock_return_voids where return_id=r.id)) then return null;end if;'||chr(10)||v_begin);
 for r in select p.oid::regprocedure signature,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in
 ('post_manual_journal','invoice_order_quantities','void_invoice','post_return_credit_note','set_inventory_opening_balance','set_inventory_opening_balance_internal','receive_serialized_inventory',
 'dispatch_inventory_transfer','dispatch_inventory_transfer_internal','receive_inventory_transfer','receive_inventory_transfer_internal','dispatch_serialized_inventory_transfer',
 'receive_serialized_inventory_transfer','issue_consumer_units','open_inventory_cartons','advance_sales_delivery','record_sales_return','resolve_sales_return_line',
 'create_tax_invoice_and_reserve_stock','post_supplier_bill','acc_void_supplier_record','acc_supplier_lock') loop
  v:=pg_get_functiondef(r.signature);v_begin:=substring(v from '(?i)\mbegin\M');
  if v_begin is null then raise exception 'Expected PL/pgSQL inventory entry point: %',r.signature;end if;
  v_prefix:='';
  if r.proname='void_invoice' then v_prefix:=' perform pg_advisory_xact_lock(hashtextextended(''acc-receipt-org:''||(select organization_id::text from public.acc_invoices where id=p_invoice_id),0));'||chr(10);end if;
  if r.proname='post_return_credit_note' then v_prefix:=' perform pg_advisory_xact_lock(hashtextextended(''acc-receipt-org:''||(select organization_id::text from public.sales_returns where credit_note_draft_id=p_draft_id),0));'||chr(10);end if;
  v:=overlay(v placing v_begin||chr(10)||v_prefix||' perform public.acc_inventory_lock();' from strpos(v,v_begin) for length(v_begin));execute v;
 end loop;
 -- Manual control postings and reversals must not detach financial inventory from the cost ledger.
 v:=pg_get_functiondef('public.post_manual_journal(uuid,date,text,jsonb)'::regprocedure);
 v_begin:=' return public.acc_post(p_id,p_date,p_memo,''manual'',null,null,p_lines);';
 if strpos(v,v_begin)=0 then raise exception 'Inventory manual journal insertion point changed';end if;
 execute replace(v,v_begin,' if exists(select 1 from public.acc_inventory_activation) and exists(select 1 from jsonb_array_elements(v_requested) l join public.acc_accounts a on a.id=(l->>''account_id'')::uuid where a.system_key=''inventory'') then raise exception ''Use inventory receipts and dated cost corrections for the inventory control account'';end if;'||chr(10)||v_begin);
 v:=pg_get_functiondef('public.reverse_journal_entry(uuid,uuid,date,text)'::regprocedure);
 v_begin:=' return public.acc_reverse(p_id,p_entry_id,p_date,p_reason);';
 if strpos(v,v_begin)=0 then raise exception 'Inventory opening reversal insertion point changed';end if;
 execute replace(v,v_begin,' if exists(select 1 from public.acc_imported_journals j join public.acc_inventory_activation a on a.gl_import_id=j.import_id where j.entry_id=p_entry_id) then raise exception ''Opening journals supporting active inventory costing cannot be reversed'';end if;'||chr(10)||v_begin);
end $migration$;

do $$ declare f record;begin
 for f in select p.oid::regprocedure signature,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and
 (p.proname like 'acc_inventory_%' or p.proname like 'acc_stock_%' or p.proname in ('activate_inventory_costing','receive_supplier_stock','inventory_cost_status','post_inventory_count_gain','correct_inventory_value','return_supplier_stock','acc_validate_supplier_stock_credit','acc_void_supplier_stock_credit','acc_void_return_credit_cost')) loop
  execute format('revoke all on function %s from public,anon,authenticated',f.signature);
  if f.proname in ('activate_inventory_costing','receive_supplier_stock','inventory_cost_status','post_inventory_count_gain','correct_inventory_value','return_supplier_stock') then execute format('grant execute on function %s to authenticated',f.signature);end if;
 end loop;
end $$;
commit;
