-- Credit drafts consume the linked invoice's saved monetary allocations, including split-invoice rounding.
begin;

create or replace function public.create_return_credit_note(p_return_id uuid,p_expected_version integer,p_draft_id uuid)
returns public.accounting_drafts language plpgsql security definer set search_path=public,pg_temp as $$
declare v_return public.sales_returns; v_note public.sales_delivery_notes; v_invoice public.acc_invoices;
 v_draft public.accounting_drafts; v_pf uuid; v_currency text; v_row record; v_item jsonb; v_ranges jsonb; v_range jsonb;
 v_lines jsonb:='[]'::jsonb; v_body jsonb; v_allocated jsonb; v_total bigint:=0;
 v_prior_qty bigint; v_saved_qty bigint; v_prior_net bigint; v_prior_tax bigint; v_quantity integer;
 v_price bigint; v_discount integer; v_rate integer; v_net bigint; v_tax bigint; v_net_total bigint; v_tax_total bigint;
 v_skip integer; v_needed integer; v_start integer; v_end integer; v_take integer; v_before bigint; v_after bigint;
begin
 if public.accounting_access() is not true then raise exception 'Only accounts staff can create a credit note.'; end if;
 if p_draft_id is null then raise exception 'Credit Note draft identity is required'; end if;
 -- Use the same parent-first lock order as invoice/void/delivery. It also serializes credits across deliveries/lots.
 select dn.proforma_id into v_pf from public.sales_returns r join public.sales_delivery_notes dn on dn.id=r.delivery_note_id where r.id=p_return_id;
 perform 1 from public.sales_proformas where id=v_pf for update;
 select * into v_return from public.sales_returns where id=p_return_id and version=p_expected_version for update;
 if not found then raise exception 'Return changed; refresh before continuing'; end if;
 if v_return.credit_note_draft_id is not null then
  if v_return.credit_note_draft_id=p_draft_id then select * into v_draft from public.accounting_drafts where id=p_draft_id; return v_draft; end if;
  raise exception 'A credit note draft already exists for this return';
 end if;
 select * into v_note from public.sales_delivery_notes where id=v_return.delivery_note_id;
 select currency into v_currency from public.sales_proformas where id=v_note.proforma_id;
 select * into v_invoice from public.acc_invoices i
  where i.proforma_id=v_note.proforma_id and i.organization_id=v_return.organization_id
   and i.invoice_number=v_note.tax_invoice_reference and (v_note.invoice_id is null or i.id=v_note.invoice_id)
  for update;
 if v_note.invoice_id is not null and v_invoice.id is null then raise exception 'The return delivery does not match its ERP invoice'; end if;
 if v_invoice.id is not null then
  if v_invoice.voided_at is not null then raise exception 'A voided ERP invoice cannot create a return credit draft'; end if;
  perform public.invoice_delivery_quantities(v_invoice.id);
  v_currency:=v_invoice.currency;
 end if;
 -- A product may span several lots; price its returned order line once, not each physical lot independently.
 for v_row in select pl.*,sum(rl.quantity)::integer returned_quantity
  from public.sales_return_lines rl join public.sales_delivery_lines dl on dl.id=rl.delivery_line_id
  join public.sales_proforma_lines pl on pl.id=dl.proforma_line_id
  where rl.return_id=v_return.id group by pl.id order by pl.sort_order loop
  v_prior_qty:=0; v_prior_net:=0; v_prior_tax:=0;
  if v_invoice.id is not null then
   select item into v_item from jsonb_array_elements(v_invoice.lines) item where item->>'proforma_line_id'=v_row.id::text;
   if v_item is null and not exists(select 1 from jsonb_array_elements(v_invoice.lines) item where item ? 'proforma_line_id') then
    -- Historical whole-order snapshots were saved in Pro forma sort order, including repeated products.
    select v_invoice.lines->(ordered.position::integer-1) into v_item from
     (select id,row_number() over(order by sort_order) position from public.sales_proforma_lines where proforma_id=v_note.proforma_id) ordered
     where ordered.id=v_row.id;
    if (v_item->>'quantity')::integer is distinct from v_row.quantity then raise exception 'The historical ERP invoice quantities cannot be verified'; end if;
   end if;
   if v_item is null or (v_item->>'product_id')::uuid is distinct from v_row.product_id then raise exception 'Returned goods are not on the linked ERP invoice'; end if;
   v_quantity:=(v_item->>'quantity')::integer;
   select coalesce(sum(rl.quantity),0) into v_prior_qty from public.sales_returns r
    join public.sales_return_lines rl on rl.return_id=r.id join public.sales_delivery_lines dl on dl.id=rl.delivery_line_id
    join public.sales_delivery_notes dn on dn.id=r.delivery_note_id
    where r.credit_note_draft_id is not null and dl.proforma_line_id=v_row.id
     and (dn.invoice_id=v_invoice.id or (dn.invoice_id is null and dn.proforma_id=v_invoice.proforma_id and dn.tax_invoice_reference=v_invoice.invoice_number));
   -- Read immutable first-save history: editing a draft must never release its allocated return quantities or money.
   select coalesce(sum((item->>'quantityReturned')::bigint),0),coalesce(sum((item->>'netMinor')::bigint),0),coalesce(sum((item->>'taxMinor')::bigint),0)
    into v_saved_qty,v_prior_net,v_prior_tax from public.sales_returns r
    join public.sales_delivery_notes dn on dn.id=r.delivery_note_id
    join public.accounting_draft_history h on h.draft_id=r.credit_note_draft_id and h.version=1
    cross join lateral jsonb_array_elements(h.body->'lines') item
    where h.body->'source'->>'invoiceId'=v_invoice.id::text and item->>'proformaLineId'=v_row.id::text
     and (dn.invoice_id=v_invoice.id or (dn.invoice_id is null and dn.proforma_id=v_invoice.proforma_id and dn.tax_invoice_reference=v_invoice.invoice_number));
   if v_saved_qty<>v_prior_qty then raise exception 'Earlier credit drafts for this ERP invoice need Accounts review before another credit draft'; end if;
   if v_prior_qty+v_row.returned_quantity>v_quantity then raise exception 'Return credits exceed the linked ERP invoice quantity'; end if;
  else
   -- Preserve pre-ERP deliveries whose external tax-invoice reference has no ERP snapshot.
   v_item:=to_jsonb(v_row); v_quantity:=v_row.returned_quantity;
  end if;
  v_price:=(v_item->>'unit_price_minor')::bigint; v_discount:=(v_item->>'discount_basis_points')::integer; v_rate:=(v_item->>'tax_basis_points')::integer;
  v_net_total:=coalesce((v_item->>'subtotal_minor')::bigint-(v_item->>'discount_minor')::bigint,
   v_quantity::bigint*v_price-round(v_quantity::numeric*v_price*v_discount/10000)::bigint);
  v_tax_total:=coalesce((v_item->>'tax_minor')::bigint,round(v_net_total::numeric*v_rate/10000)::bigint);
  v_ranges:=coalesce(v_item->'allocation_ranges',jsonb_build_array(jsonb_build_array(0,v_quantity)));
  v_skip:=v_prior_qty::integer; v_needed:=v_row.returned_quantity; v_net:=0; v_tax:=0; v_allocated:='[]'::jsonb;
  for v_range in select * from jsonb_array_elements(v_ranges) loop
   v_start:=(v_range->>0)::integer; v_end:=(v_range->>1)::integer;
   v_take:=least(v_skip,v_end-v_start); v_start:=v_start+v_take; v_skip:=v_skip-v_take;
   v_take:=least(v_needed,v_end-v_start); v_end:=v_start+v_take;
   if v_take=0 then continue; end if;
   v_before:=round(v_start::numeric*v_price*v_discount/10000)::bigint;
   v_after:=round(v_end::numeric*v_price*v_discount/10000)::bigint;
   v_net:=v_net+v_take::bigint*v_price-v_after+v_before;
   v_tax:=v_tax+round((v_end::numeric*v_price-v_after)*v_rate/10000)::bigint
    -round((v_start::numeric*v_price-v_before)*v_rate/10000)::bigint;
   v_allocated:=v_allocated||jsonb_build_array(jsonb_build_array(v_start,v_end)); v_needed:=v_needed-v_take;
   exit when v_needed=0;
  end loop;
  if v_needed<>0 or v_net<0 or v_tax<0 or v_prior_net+v_net>v_net_total or v_prior_tax+v_tax>v_tax_total
   or (v_prior_qty+v_row.returned_quantity=v_quantity and (v_prior_net+v_net<>v_net_total or v_prior_tax+v_tax<>v_tax_total)) then
   raise exception 'Return credit amounts do not reconcile with the linked invoice';
  end if;
  v_lines:=v_lines||jsonb_build_array(jsonb_build_object('particulars',v_row.description||' · '||v_row.returned_quantity||' '||v_row.uom||' returned ('||v_return.return_number||')',
   'amount',to_char((v_net+v_tax)/100.0,'FM999999999999990.00'),'quantityReturned',v_row.returned_quantity,
   'netMinor',v_net,'taxMinor',v_tax,'proformaLineId',v_row.id,'allocationRanges',v_allocated));
  v_total:=v_total+v_net+v_tax;
 end loop;
 if jsonb_array_length(v_lines)=0 then raise exception 'This return has no priced items'; end if;
 if jsonb_array_length(v_lines)>100 then raise exception 'Credit Note draft needs at most 100 rows'; end if;
 v_body:=jsonb_build_object('number','','date',to_char(now() at time zone 'Africa/Dar_es_Salaam','YYYY-MM-DD'),
  'reference',coalesce(v_note.tax_invoice_reference,''),'reference_date',coalesce(to_char(v_note.delivered_at at time zone 'Africa/Dar_es_Salaam','YYYY-MM-DD'),''),
  'party',coalesce((select name from public.organizations where id=v_return.organization_id),''),'amount_words','',
  'lines',v_lines,'currency',coalesce(v_currency,'TZS'),'totalMinor',v_total,
  'source',jsonb_build_object('returnId',v_return.id,'returnNumber',v_return.return_number,'deliveryNumber',v_note.delivery_number,'taxInvoiceReference',v_note.tax_invoice_reference,'invoiceId',v_invoice.id));
 insert into public.accounting_drafts(id,kind,version,organization_id,contact_id,body,created_by,updated_by)
 values(p_draft_id,'credit_note',1,v_return.organization_id,null,v_body,auth.uid(),auth.uid()) returning * into v_draft;
 insert into public.accounting_draft_history(draft_id,version,organization_id,contact_id,body,actor_id) values(v_draft.id,1,v_draft.organization_id,null,v_draft.body,auth.uid());
 update public.sales_returns set credit_note_draft_id=v_draft.id,version=version+1 where id=v_return.id;
 return v_draft;
end $$;
revoke all on function public.create_return_credit_note(uuid,integer,uuid) from public,anon,authenticated;
grant execute on function public.create_return_credit_note(uuid,integer,uuid) to authenticated;
commit;
