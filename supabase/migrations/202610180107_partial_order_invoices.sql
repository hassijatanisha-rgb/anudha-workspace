-- Accounts invoices reviewed quantities; the accepted quote and all posted history stay intact.
begin;

alter table public.acc_invoices add column if not exists request_content jsonb;
alter table public.sales_delivery_notes add column if not exists invoice_id uuid references public.acc_invoices(id);
create index if not exists sales_delivery_notes_invoice on public.sales_delivery_notes(invoice_id) where invoice_id is not null;
alter table public.pending_stock_requests add column if not exists proforma_line_id uuid references public.sales_proforma_lines(id);
create unique index if not exists pending_stock_order_line on public.pending_stock_requests(proforma_line_id) where proforma_line_id is not null;
drop index if exists public.acc_invoices_one_live_per_proforma;
create index if not exists acc_invoices_live_proforma on public.acc_invoices(proforma_id) where voided_at is null;
drop trigger if exists sales_proformas_zz_invoice_on_accept on public.sales_proformas;

-- Retire both whole-quote entry points, including their internal caller.
create or replace function public.acc_create_invoice(p_id uuid,p_proforma_id uuid,p_invoice_date date,p_due_date date,p_tax_reference text default '')
returns public.acc_invoices language plpgsql security definer set search_path=public,pg_temp as $$
begin
 perform public.acc_require_access();
 raise exception 'Review the order quantities in Accounts before creating an invoice';
end $$;

create or replace function public.order_invoice_quantities(p_proforma_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_pf public.sales_proformas; v_legacy boolean; v_lines jsonb;
begin
 perform public.acc_require_access();
 select * into v_pf from public.sales_proformas where id=p_proforma_id and deleted_at is null;
 if not found then raise exception 'Pro forma not found'; end if;
 -- Old posted invoices cannot safely be split retrospectively: they occupy the whole order.
 select exists(select 1 from public.acc_invoices i where i.proforma_id=p_proforma_id and i.voided_at is null
  and (jsonb_array_length(i.lines)=0 or exists(select 1 from jsonb_array_elements(i.lines) l where nullif(l->>'proforma_line_id','') is null))) into v_legacy;
 select coalesce(jsonb_agg(jsonb_build_object(
  'proforma_line_id',l.id,'product_id',l.product_id,'description',l.description,'uom',l.uom,
  'ordered_quantity',l.quantity,'invoiced_quantity',a.quantity,'remaining_quantity',greatest(0,l.quantity-a.quantity),
  'available_quantity',coalesce((select sum(greatest(0,lot.loose_units-lot.reserved_units)) from public.inventory_lots lot
    join public.inventory_locations loc on loc.id=lot.location_id
    where lot.product_id=l.product_id and lot.stock_status='available' and loc.active and loc.is_dispatch_hub
     and (lot.expiry_date is null or lot.expiry_date>=current_date)),0),
  'unit_price_minor',l.unit_price_minor,'discount_basis_points',l.discount_basis_points,'tax_basis_points',l.tax_basis_points
 ) order by l.sort_order),'[]'::jsonb) into v_lines
 from public.sales_proforma_lines l cross join lateral (
  select case when v_legacy then l.quantity else coalesce((select sum((x->>'quantity')::integer)
   from public.acc_invoices i cross join lateral jsonb_array_elements(i.lines) x
   where i.proforma_id=p_proforma_id and i.voided_at is null and x->>'proforma_line_id'=l.id::text),0)::integer end quantity
 ) a where l.proforma_id=p_proforma_id;
 return jsonb_build_object('proforma_id',v_pf.id,'version',v_pf.version,'document_number',v_pf.document_number,
  'status',v_pf.status,'currency',v_pf.currency,'legacy_invoice',v_legacy,'lines',v_lines);
end $$;

-- Keep a partially invoiced order in the Accounts queue until every quantity is covered.
create or replace view public.acc_waiting_proformas with (security_invoker=true) as
 select p.id,p.document_number,p.organization_id,p.currency,p.total_minor,p.accepted_at
 from public.sales_proformas p
 where (select public.accounting_access()) and p.status='accepted' and p.deleted_at is null
  and not exists(select 1 from public.acc_invoices i where i.proforma_id=p.id and i.voided_at is null
   and (jsonb_array_length(i.lines)=0 or exists(select 1 from jsonb_array_elements(i.lines) x where nullif(x->>'proforma_line_id','') is null)))
  and exists(select 1 from public.sales_proforma_lines l where l.proforma_id=p.id and l.quantity>coalesce((
   select sum((x->>'quantity')::integer) from public.acc_invoices i cross join lateral jsonb_array_elements(i.lines) x
   where i.proforma_id=p.id and i.voided_at is null and x->>'proforma_line_id'=l.id::text),0));

-- A void can reopen an order balance after its earlier follow-up was completed.
create or replace function public.handoff_pending() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 begin
  if new.status='waiting' and (tg_op='INSERT' or (new.proforma_line_id is not null and old.status<>'waiting')) then
   perform public.auto_assign_work('pending',new.id,new.request_number,'Tell the customer when the stock arrives',coalesce(new.salesperson_user_id,new.created_by));
  elsif tg_op='UPDATE' and new.status<>old.status and new.status<>'waiting' then
   perform public.auto_close_work('pending',new.id,case when new.status='fulfilled' then 'done' else 'cancelled' end,
    case when new.proforma_line_id is not null and new.status='fulfilled' then 'Allocated to invoice' else 'Pending order '||new.status end);
  end if;
 exception when others then raise warning 'Automatic handoff for pending order % failed: %',new.id,sqlerrm;
 end;
 return null;
end $$;
revoke all on function public.handoff_pending() from public,anon,authenticated;

-- Only this synchronizer controls order-linked balances. Standalone pending requests retain their old workflow.
create or replace function public.sync_order_pending(p_proforma_id uuid)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare v_pf public.sales_proformas; v_line jsonb; v_row public.pending_stock_requests; v_new public.pending_stock_requests;
 v_owner uuid; v_remaining integer; v_note text;
begin
 select * into v_pf from public.sales_proformas where id=p_proforma_id for update;
 if not found then raise exception 'Pro forma not found'; end if;
 select user_id into v_owner from public.staff where user_id=v_pf.prepared_by and active;
 if v_owner is null then v_owner:=auth.uid(); end if;
 for v_line in select * from jsonb_array_elements(public.order_invoice_quantities(p_proforma_id)->'lines') loop
  v_remaining:=(v_line->>'remaining_quantity')::integer;
  select * into v_row from public.pending_stock_requests where proforma_line_id=(v_line->>'proforma_line_id')::uuid for update;
  if not found then
   if v_remaining=0 then continue; end if;
   insert into public.pending_stock_requests(id,request_number,status,organization_id,contact_id,product_id,quantity,proforma_id,
    proforma_line_id,salesperson_user_id,notes,expires_on,created_by)
   values(gen_random_uuid(),'PS-'||lpad(nextval('public.pending_stock_number_seq')::text,6,'0'),'waiting',v_pf.organization_id,v_pf.contact_id,
    (v_line->>'product_id')::uuid,v_remaining,v_pf.id,(v_line->>'proforma_line_id')::uuid,v_owner,
    'Uninvoiced balance of '||v_pf.document_number,(current_date+interval '6 months')::date,auth.uid()) returning * into v_new;
   insert into public.pending_stock_events(request_id,action,from_status,to_status,note,expires_on,actor_user_id)
   values(v_new.id,'order_balance',null,'waiting',v_new.notes,v_new.expires_on,auth.uid());
  elsif v_remaining>0 and (v_row.status<>'waiting' or v_row.quantity<>v_remaining) then
   v_note:=case when v_row.status='waiting' then 'Uninvoiced order balance updated' else 'Order balance reopened after invoice void' end;
   update public.pending_stock_requests set quantity=v_remaining,status='waiting',closed_by=null,closed_at=null,close_note='',
    version=version+1,updated_at=now() where id=v_row.id returning * into v_new;
   insert into public.pending_stock_events(request_id,action,from_status,to_status,note,expires_on,actor_user_id)
   values(v_new.id,'order_balance',v_row.status,'waiting',v_note,v_new.expires_on,auth.uid());
  elsif v_remaining=0 and v_row.status<>'fulfilled' then
   update public.pending_stock_requests set status='fulfilled',close_note='Allocated to invoice',closed_by=auth.uid(),closed_at=now(),
    version=version+1,updated_at=now() where id=v_row.id returning * into v_new;
   insert into public.pending_stock_events(request_id,action,from_status,to_status,note,expires_on,actor_user_id)
   values(v_new.id,'order_balance',v_row.status,'fulfilled','Allocated to invoice',v_new.expires_on,auth.uid());
  end if;
 end loop;
end $$;

create or replace function public.invoice_order_quantities(p_id uuid,p_proforma_id uuid,p_expected_version integer,
 p_invoice_date date,p_due_date date,p_lines jsonb,p_accounts_reference text,p_expected_delivery_date date,p_tax_reference text default '')
returns public.acc_invoices language plpgsql security definer set search_path=public,pg_temp as $$
declare v_pf public.sales_proformas; v public.acc_invoices; v_ids public.acc_customer_tax_ids; v_dn public.sales_delivery_notes;
 v_actor uuid; v_request jsonb; v_selected jsonb; v_line record; v_lines jsonb:='[]'::jsonb; v_delivery jsonb:='[]'::jsonb;
 v_entry uuid:=gen_random_uuid(); v_ranges jsonb; v_used int4multirange; v_free int4range; v_start integer; v_end integer; v_needed integer;
 v_gross bigint; v_discount bigint; v_tax bigint; v_before_discount bigint; v_after_discount bigint;
 v_subtotal bigint:=0; v_discounts bigint:=0; v_taxes bigint:=0; v_total bigint; v_review jsonb;
begin
 v_actor:=public.acc_require_access();
 perform public.require_access('deliveries');
 if p_id is null or p_proforma_id is null or p_expected_version is null then raise exception 'Invoice, order and version are required'; end if;
 if jsonb_typeof(p_lines) is distinct from 'array' then raise exception 'Choose between 1 and 100 order lines'; end if;
 if jsonb_array_length(p_lines) not between 1 and 100 then raise exception 'Choose between 1 and 100 order lines'; end if;
 if exists(select 1 from jsonb_array_elements(p_lines) x where jsonb_typeof(x) is distinct from 'object'
  or coalesce(x->>'proforma_line_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  or coalesce(x->>'quantity','') !~ '^[1-9][0-9]{0,6}$') then raise exception 'Choose valid order lines and positive whole quantities'; end if;
 if exists(select 1 from jsonb_array_elements(p_lines) x where (x->>'quantity')::integer>1000000)
  or (select count(distinct (x->>'proforma_line_id')::uuid) from jsonb_array_elements(p_lines) x)<>jsonb_array_length(p_lines) then
  raise exception 'Use each order line once with a quantity from 1 to 1,000,000';
 end if;
 select jsonb_agg(jsonb_build_object('proforma_line_id',(x->>'proforma_line_id')::uuid,'quantity',(x->>'quantity')::integer)
  order by (x->>'proforma_line_id')::uuid) into v_selected from jsonb_array_elements(p_lines) x;
 v_request:=jsonb_build_object('proforma_id',p_proforma_id,'expected_version',p_expected_version,'invoice_date',p_invoice_date,
  'due_date',p_due_date,'lines',v_selected,'accounts_reference',trim(coalesce(p_accounts_reference,'')),
  'expected_delivery_date',p_expected_delivery_date,'tax_reference',trim(coalesce(p_tax_reference,'')));
 -- Parent first also serializes invoice/void/delivery competing for this order's balances.
 select * into v_pf from public.sales_proformas where id=p_proforma_id for update;
 if not found or v_pf.deleted_at is not null then raise exception 'Pro forma not found'; end if;
 perform pg_advisory_xact_lock(hashtextextended('reviewed-invoice:'||p_id::text,0));
 select * into v from public.acc_invoices where id=p_id;
 if found then
  if v.created_by=v_actor and v.request_content=v_request then return v; end if;
  raise exception 'This invoice request was already used with different details; refresh and compare';
 end if;
 if v_pf.version<>p_expected_version then raise exception 'Accepted Pro forma changed; refresh before invoicing'; end if;
 if v_pf.status<>'accepted' then raise exception 'Only an accepted Pro forma can be invoiced'; end if;
 if v_pf.currency<>'TZS' then raise exception 'Only TZS Pro formas can be invoiced in this version'; end if;
 if p_invoice_date is null or p_due_date is null or p_due_date<p_invoice_date then raise exception 'Choose an invoice date and a due date on or after it'; end if;
 if length(trim(coalesce(p_tax_reference,'')))>80 then raise exception 'The tax invoice reference is too long'; end if;
 if length(trim(coalesce(p_accounts_reference,''))) not between 2 and 120 then raise exception 'Enter the Accounts approval reference'; end if;
 if p_expected_delivery_date is null or p_expected_delivery_date<current_date then raise exception 'Expected delivery date cannot be in the past'; end if;
 if (select count(*) from public.sales_proforma_lines l join jsonb_array_elements(v_selected) x on l.id=(x->>'proforma_line_id')::uuid
  where l.proforma_id=p_proforma_id)<>jsonb_array_length(v_selected) then raise exception 'Every selected line must belong to this order'; end if;
 v_review:=public.order_invoice_quantities(p_proforma_id);
 if (v_review->>'legacy_invoice')::boolean then raise exception 'This order already has a legacy whole-order invoice; review or void it before invoicing quantities'; end if;
 -- Confirm the saved quote's money still agrees with its immutable accepted lines.
 if exists(select 1 from (
  select sum(gross)::bigint sub,sum(discount)::bigint disc,sum(round((gross-discount)*tax_basis_points/10000))::bigint tax
  from (select quantity::numeric*unit_price_minor gross,round(quantity::numeric*unit_price_minor*discount_basis_points/10000) discount,
   tax_basis_points::numeric from public.sales_proforma_lines where proforma_id=p_proforma_id) amounts
 ) a where a.sub is distinct from v_pf.subtotal_minor or a.disc is distinct from v_pf.discount_minor or a.tax is distinct from v_pf.tax_minor)
 or v_pf.total_minor<=0 or v_pf.total_minor<>v_pf.subtotal_minor-v_pf.discount_minor+v_pf.tax_minor then
  raise exception 'The Pro forma totals do not add up; check it before invoicing';
 end if;
 for v_line in select l.*, (x->>'quantity')::integer selected_quantity from public.sales_proforma_lines l
  join jsonb_array_elements(v_selected) x on l.id=(x->>'proforma_line_id')::uuid order by l.sort_order loop
  if v_line.selected_quantity>(select (x->>'remaining_quantity')::integer from jsonb_array_elements(v_review->'lines') x
   where x->>'proforma_line_id'=v_line.id::text) then raise exception 'An invoice quantity exceeds the remaining order balance'; end if;
  -- Unit-position intervals preserve cumulative rounding and reclaim exactly the amounts of voided slices.
  select coalesce(range_agg(int4range((r->>0)::integer,(r->>1)::integer,'[)')),'{}'::int4multirange) into v_used
  from public.acc_invoices i cross join lateral jsonb_array_elements(i.lines) x
  cross join lateral jsonb_array_elements(x->'allocation_ranges') r
  where i.proforma_id=p_proforma_id and i.voided_at is null and x->>'proforma_line_id'=v_line.id::text;
  v_needed:=v_line.selected_quantity; v_ranges:='[]'::jsonb; v_discount:=0; v_tax:=0;
  for v_free in select unnest(int4multirange(int4range(0,v_line.quantity,'[)'))-v_used) loop
   exit when v_needed=0;
   v_start:=lower(v_free); v_end:=v_start+least(v_needed,upper(v_free)-v_start);
   v_before_discount:=round(v_start::numeric*v_line.unit_price_minor*v_line.discount_basis_points/10000)::bigint;
   v_after_discount:=round(v_end::numeric*v_line.unit_price_minor*v_line.discount_basis_points/10000)::bigint;
   v_discount:=v_discount+v_after_discount-v_before_discount;
   v_tax:=v_tax+round((v_end::numeric*v_line.unit_price_minor-v_after_discount)*v_line.tax_basis_points/10000)::bigint
    -round((v_start::numeric*v_line.unit_price_minor-v_before_discount)*v_line.tax_basis_points/10000)::bigint;
   v_ranges:=v_ranges||jsonb_build_array(jsonb_build_array(v_start,v_end)); v_needed:=v_needed-(v_end-v_start);
  end loop;
  if v_needed<>0 then raise exception 'An invoice quantity exceeds the remaining order balance'; end if;
  v_gross:=v_line.selected_quantity::bigint*v_line.unit_price_minor;
  v_lines:=v_lines||jsonb_build_array(jsonb_build_object('proforma_line_id',v_line.id,'product_id',v_line.product_id,
   'description',v_line.description,'quantity',v_line.selected_quantity,'uom',v_line.uom,'unit_price_minor',v_line.unit_price_minor,
   'discount_basis_points',v_line.discount_basis_points,'tax_basis_points',v_line.tax_basis_points,
   'subtotal_minor',v_gross,'discount_minor',v_discount,'tax_minor',v_tax,'total_minor',v_gross-v_discount+v_tax,'allocation_ranges',v_ranges));
  v_delivery:=v_delivery||jsonb_build_array(jsonb_build_object('proformaLineId',v_line.id,'quantity',v_line.selected_quantity));
  v_subtotal:=v_subtotal+v_gross; v_discounts:=v_discounts+v_discount; v_taxes:=v_taxes+v_tax;
 end loop;
 v_total:=v_subtotal-v_discounts+v_taxes;
 if v_total<=0 then raise exception 'The selected invoice quantities must have a positive total'; end if;
 select * into v_ids from public.acc_customer_tax_ids where organization_id=v_pf.organization_id;
 perform public.acc_post(v_entry,p_invoice_date,'Customer invoice for '||v_pf.document_number,'invoice',p_id,null,
  jsonb_build_array(jsonb_build_object('account_id',public.acc_account_by_key('receivables'),'debit_minor',v_total,'organization_id',v_pf.organization_id,'description',v_pf.document_number),
   jsonb_build_object('account_id',public.acc_account_by_key('sales'),'credit_minor',v_subtotal-v_discounts,'description',v_pf.document_number))
  ||case when v_taxes>0 then jsonb_build_array(jsonb_build_object('account_id',public.acc_account_by_key('vat_output'),'credit_minor',v_taxes,'description','VAT '||v_pf.document_number)) else '[]'::jsonb end);
 insert into public.acc_invoices(id,invoice_number,proforma_id,proforma_revision,organization_id,invoice_date,due_date,tax_invoice_reference,
  subtotal_minor,discount_minor,tax_minor,total_minor,lines,journal_entry_id,created_by,buyer_tin,buyer_vrn,request_content)
 values(p_id,'INV-'||to_char(p_invoice_date,'YYYY')||'-'||lpad(nextval('public.acc_invoice_number_seq')::text,6,'0'),v_pf.id,v_pf.revision,
  v_pf.organization_id,p_invoice_date,p_due_date,trim(coalesce(p_tax_reference,'')),v_subtotal,v_discounts,v_taxes,v_total,v_lines,v_entry,
  v_actor,coalesce(v_ids.tin,''),coalesce(v_ids.vrn,''),v_request) returning * into v;
 -- This validator is installed with migration 108; an interrupted rollout must fail before reserving.
 perform public.invoice_delivery_quantities(v.id);
 v_dn:=public.create_sales_delivery_note(gen_random_uuid(),v_pf.id,v_pf.version,trim(p_accounts_reference),p_expected_delivery_date,v_delivery);
 update public.sales_delivery_notes set invoice_id=v.id where id=v_dn.id;
 perform public.create_tax_invoice_and_reserve_stock(v_dn.id,v_dn.version,v.invoice_number);
 perform public.sync_order_pending(v_pf.id);
 return v;
end $$;

create or replace function public.void_invoice(p_invoice_id uuid,p_date date,p_reason text)
returns public.acc_invoices language plpgsql security definer set search_path=public,pg_temp as $$
declare v public.acc_invoices; v_actor uuid; v_rev uuid:=gen_random_uuid(); v_pf uuid;
begin
 v_actor:=public.acc_require_access();
 if p_reason is null or length(trim(p_reason))<5 then raise exception 'Give a reason of at least 5 characters'; end if;
 select proforma_id into v_pf from public.acc_invoices where id=p_invoice_id;
 perform 1 from public.sales_proformas where id=v_pf for update;
 select * into v from public.acc_invoices where id=p_invoice_id for update;
 if not found then raise exception 'Invoice not found'; end if;
 if v.voided_at is not null then return v; end if;
 if exists(select 1 from public.sales_delivery_notes n where (n.invoice_id=v.id or
  (n.invoice_id is null and n.proforma_id=v.proforma_id and n.tax_invoice_reference=v.invoice_number))
  and n.status in ('tax_invoice_created','sent_to_sales','packing','ready','out_for_delivery','delivered')) then
  raise exception 'This invoice is linked to an active or completed delivery and cannot be voided. Cancel any delivery that has not been dispatched first.';
 end if;
 if public.acc_invoice_paid_minor(p_invoice_id)>0 then raise exception 'Void the receipts paid against this invoice first'; end if;
 perform public.acc_reverse(v_rev,v.journal_entry_id,p_date,'Void '||v.invoice_number||': '||trim(p_reason));
 update public.acc_invoices set voided_at=now(),voided_by=v_actor,void_reason=trim(p_reason),void_entry_id=v_rev where id=p_invoice_id returning * into v;
 perform public.sync_order_pending(v.proforma_id);
 return v;
end $$;

-- Preserve the old pending RPCs, but do not let them independently close an order balance.
do $migration$
declare r record; v_definition text;
begin
 for r in select * from (values
  ('public.advance_pending_stock_request(uuid,integer,text,text,integer)',
   $old$ if v_row.version <> p_expected_version then raise exception 'Pending request changed; refresh and compare'; end if;$old$,
   $new$ if v_row.proforma_line_id is not null and p_action<>'extend' then raise exception 'Order-linked pending quantities are updated by invoicing or voiding the order'; end if;
 if v_row.version <> p_expected_version then raise exception 'Pending request changed; refresh and compare'; end if;$new$),
  ('public.create_pending_stock_request(uuid,uuid,uuid,uuid,integer,uuid,uuid,uuid,text)',
   $old$  -- A retried request with identical content returns the saved row; anything else is a conflict.$old$,
   $new$  if v_row.proforma_line_id is not null then raise exception 'Order-linked pending quantities are updated by invoicing or voiding the order'; end if;
  -- A retried request with identical content returns the saved row; anything else is a conflict.$new$),
  ('public.handoff_proforma()',
   $old$'Check the invoice for '||new.document_number||' in Customer invoices and record its TRA receipt'$old$,
   $new$'Review quantities and available stock for '||new.document_number||' in Accounts, then invoice the ready quantities'$new$)
 ) p(signature,old_body,new_body) loop
  v_definition:=pg_get_functiondef(to_regprocedure(r.signature));
  if v_definition is null then raise exception 'Missing partial-order dependency: %',r.signature; end if;
  if strpos(v_definition,r.new_body)>0 then continue; end if;
  if (length(v_definition)-length(replace(v_definition,r.old_body,'')))/length(r.old_body)<>1 then
   raise exception 'Unexpected partial-order dependency: %',r.signature;
  end if;
  execute replace(v_definition,r.old_body,r.new_body);
 end loop;
end $migration$;

revoke all on function public.sync_order_pending(uuid),public.acc_create_invoice(uuid,uuid,date,date,text) from public,anon,authenticated;
revoke all on function public.order_invoice_quantities(uuid),public.invoice_order_quantities(uuid,uuid,integer,date,date,jsonb,text,date,text) from public,anon,authenticated;
grant execute on function public.order_invoice_quantities(uuid),public.invoice_order_quantities(uuid,uuid,integer,date,date,jsonb,text,date,text) to authenticated;
commit;
