-- Only newly saved lines acquire a workbook gross price. Historical revisions, accepted
-- orders and posted invoices keep the monetary terms originally agreed with the customer.
begin;

alter table public.sales_proforma_lines add column gross_unit_price_minor bigint
 check (gross_unit_price_minor between 0 and 9000000000000000);

-- The configured net is still enforced by the central-price trigger. Only its matching
-- imported gross in the same currency can supply a VAT-inclusive rounding basis.
create function public.quote_workbook_gross(p_source jsonb,p_currency text,p_price bigint,p_tax integer,p_expected jsonb)
returns bigint language plpgsql immutable set search_path=pg_catalog as $$
declare rate numeric; gross numeric;
begin
 if jsonb_typeof(p_source->'tax_basis_points')='number' then
  rate:=(p_source->>'tax_basis_points')::numeric;
  if rate<>trunc(rate) or rate not between 0 and 10000 or rate is distinct from p_tax::numeric then
   raise exception 'The product VAT rate changed. Refresh the catalogue and re-select the product.';
  end if;
 end if;
 if rate=1800 and p_source->>'import_price_basis'='gross' and p_currency in ('TZS','USD')
    and p_source->>'currency'=p_currency and p_source->'import_net_price_minor'=to_jsonb(p_price) then
  if jsonb_typeof(p_source->'gross_price_minor') is distinct from 'number' then
   raise exception 'The imported VAT-inclusive product price needs review by Accounts.';
  end if;
  gross:=(p_source->>'gross_price_minor')::numeric;
  if gross<>trunc(gross) or gross not between 0 and 9000000000000000 or round(gross*10000/(10000+rate))<>p_price then
   raise exception 'The imported VAT-inclusive product price needs review by Accounts.';
  end if;
 end if;
 if p_expected is not null and p_expected<>'null'::jsonb and p_expected is distinct from to_jsonb(gross) then
  raise exception 'The VAT-inclusive product price changed. Refresh the catalogue and re-select the product.';
 end if;
 return gross::bigint;
end $$;

-- Cumulative amounts at a position on the order line. Partial invoices and returns
-- take differences at the two ends of each reserved range, including holes after voids.
create function public.sales_line_amounts(p_position integer,p_quantity integer,p_price bigint,p_discount integer,p_tax integer,p_gross bigint)
returns table(subtotal bigint,discount bigint,tax bigint) language plpgsql immutable set search_path=pg_catalog as $$
declare amount numeric; inclusive numeric; net numeric; full_gross numeric; full_discount numeric;
begin
 if p_gross is null then
  amount:=p_position::numeric*p_price;
  subtotal:=amount;
  discount:=round(amount*p_discount/10000);
  tax:=round((amount-discount)*p_tax/10000);
 else
  amount:=p_position::numeric*p_gross;
  inclusive:=amount-round(amount*p_discount/10000);
  net:=round(inclusive*10000/(10000+p_tax));
  tax:=inclusive-net;
  full_gross:=p_quantity::numeric*p_gross;
  full_discount:=round(full_gross*10000/(10000+p_tax))
   -round((full_gross-round(full_gross*p_discount/10000))*10000/(10000+p_tax));
  -- Allocate the saved net discount monotonically even for small unit prices and
  -- 0.01% discounts, where independently extracting two rounded nets can decrease it.
  discount:=div(2*full_discount*p_position+p_quantity,2*p_quantity);
  subtotal:=net+discount;
 end if;
 return next;
end $$;
revoke all on function public.quote_workbook_gross(jsonb,text,bigint,integer,jsonb),
 public.sales_line_amounts(integer,integer,bigint,integer,integer,bigint) from public,anon,authenticated;

-- Amend the installed entry points in place to retain their later workflow and ledger locks.
do $migration$
declare target record; patch record; definition text;
begin
 for target in select signature,jsonb_agg(jsonb_build_object('old_text',old_fragment,'new_text',new_fragment)) fragments from (values
  ('public.enforce_product_sale_price()',
   $old$ if v_kind='placement' and new.unit_price_minor=0 then return new; end if;$old$,
   $new$ if v_kind='placement' and new.unit_price_minor=0 then
  if new.gross_unit_price_minor is not null then raise exception 'Placement machines must have zero charge'; end if;
  return new;
 end if;
 if new.gross_unit_price_minor is distinct from public.quote_workbook_gross(
  (select p.source from public.products p where p.id=new.product_id for share),v_currency,new.unit_price_minor,new.tax_basis_points,null) then
  raise exception 'Use the current VAT-inclusive product price. Refresh the catalogue and re-select the product.';
 end if;$new$),
  ('public.save_sales_proforma(uuid,integer,uuid,uuid,text,date,text,text,text,jsonb,text,uuid,boolean,text,text)',
   $old$ select coalesce(sum(gross),0),coalesce(sum(discount),0),coalesce(sum(round((gross-discount)*tax_basis_points/10000)),0)
 into v_subtotal,v_discount,v_tax from (
  select (line->>'quantity')::bigint*(line->>'unitPriceMinor')::bigint as gross,
         round((line->>'quantity')::numeric*(line->>'unitPriceMinor')::numeric*(line->>'discountBasisPoints')::numeric/10000) as discount,
         (line->>'taxBasisPoints')::numeric as tax_basis_points
  from jsonb_array_elements(p_lines) line
 ) totals;
$old$,
   $new$ -- Lock the source metadata before totaling. Never trust a caller-supplied gross price.
 select jsonb_agg((item.line-'grossUnitPriceMinor') || jsonb_strip_nulls(jsonb_build_object(
  'grossUnitPriceMinor',public.quote_workbook_gross(
   case when v_kind='sale' then item.source end,p_currency,(item.line->>'unitPriceMinor')::bigint,
   (item.line->>'taxBasisPoints')::integer,item.line->'grossUnitPriceMinor'))) order by item.n)
 into p_lines from (
  select q.line,q.n,p.source from jsonb_array_elements(p_lines) with ordinality q(line,n)
  join public.products p on p.id=(q.line->>'productId')::uuid order by p.id for share of p
 ) item;
 if jsonb_array_length(p_lines) is distinct from v_count then raise exception 'One or more products are unavailable'; end if;
 select sum(a.subtotal),sum(a.discount),sum(a.tax) into v_subtotal,v_discount,v_tax
 from jsonb_array_elements(p_lines) l cross join lateral public.sales_line_amounts(
  (l->>'quantity')::integer,(l->>'quantity')::integer,(l->>'unitPriceMinor')::bigint,
  (l->>'discountBasisPoints')::integer,(l->>'taxBasisPoints')::integer,(l->>'grossUnitPriceMinor')::bigint) a;
$new$),
  ('public.save_sales_proforma(uuid,integer,uuid,uuid,text,date,text,text,text,jsonb,text,uuid,boolean,text,text)',
   $old$quantity,uom,unit_price_minor,discount_basis_points,tax_basis_points)$old$,
   $new$quantity,uom,unit_price_minor,discount_basis_points,tax_basis_points,gross_unit_price_minor)$new$),
  ('public.save_sales_proforma(uuid,integer,uuid,uuid,text,date,text,text,text,jsonb,text,uuid,boolean,text,text)',
   $old$(line->>'taxBasisPoints')::integer
 from jsonb_array_elements(p_lines) with ordinality$old$,
   $new$(line->>'taxBasisPoints')::integer,(line->>'grossUnitPriceMinor')::bigint
 from jsonb_array_elements(p_lines) with ordinality$new$),
  ('public.save_sales_proforma(uuid,integer,uuid,uuid,text,date,text,text,text,jsonb,text,uuid,boolean,text,text)',
   $old$'taxBasisPoints',l.tax_basis_points) order by l.sort_order$old$,
   $new$'taxBasisPoints',l.tax_basis_points)
   ||jsonb_strip_nulls(jsonb_build_object('grossUnitPriceMinor',l.gross_unit_price_minor)) order by l.sort_order$new$),
  ('public.invoice_order_quantities(uuid,uuid,integer,date,date,jsonb,text,date,text)',
   $old$  select sum(gross)::bigint sub,sum(discount)::bigint disc,sum(round((gross-discount)*tax_basis_points/10000))::bigint tax
  from (select quantity::numeric*unit_price_minor gross,round(quantity::numeric*unit_price_minor*discount_basis_points/10000) discount,
   tax_basis_points::numeric from public.sales_proforma_lines where proforma_id=p_proforma_id) amounts
$old$,
   $new$  select sum(a.subtotal) sub,sum(a.discount) disc,sum(a.tax) tax
  from public.sales_proforma_lines l cross join lateral public.sales_line_amounts(
   l.quantity,l.quantity,l.unit_price_minor,l.discount_basis_points,l.tax_basis_points,l.gross_unit_price_minor) a
  where l.proforma_id=p_proforma_id
$new$),
  ('public.invoice_order_quantities(uuid,uuid,integer,date,date,jsonb,text,date,text)',
   $old$v_before_discount bigint; v_after_discount bigint;$old$,
   $new$v_before record; v_after record;$new$),
  ('public.invoice_order_quantities(uuid,uuid,integer,date,date,jsonb,text,date,text)',
   $old$v_ranges:='[]'::jsonb; v_discount:=0; v_tax:=0;$old$,
   $new$v_ranges:='[]'::jsonb; v_gross:=0; v_discount:=0; v_tax:=0;$new$),
  ('public.invoice_order_quantities(uuid,uuid,integer,date,date,jsonb,text,date,text)',
   $old$   v_before_discount:=round(v_start::numeric*v_line.unit_price_minor*v_line.discount_basis_points/10000)::bigint;
   v_after_discount:=round(v_end::numeric*v_line.unit_price_minor*v_line.discount_basis_points/10000)::bigint;
   v_discount:=v_discount+v_after_discount-v_before_discount;
   v_tax:=v_tax+round((v_end::numeric*v_line.unit_price_minor-v_after_discount)*v_line.tax_basis_points/10000)::bigint
    -round((v_start::numeric*v_line.unit_price_minor-v_before_discount)*v_line.tax_basis_points/10000)::bigint;
$old$,
   $new$   select * into v_before from public.sales_line_amounts(v_start,v_line.quantity,v_line.unit_price_minor,
    v_line.discount_basis_points,v_line.tax_basis_points,v_line.gross_unit_price_minor);
   select * into v_after from public.sales_line_amounts(v_end,v_line.quantity,v_line.unit_price_minor,
    v_line.discount_basis_points,v_line.tax_basis_points,v_line.gross_unit_price_minor);
   v_gross:=v_gross+v_after.subtotal-v_before.subtotal;
   v_discount:=v_discount+v_after.discount-v_before.discount;
   v_tax:=v_tax+v_after.tax-v_before.tax;
$new$),
  ('public.invoice_order_quantities(uuid,uuid,integer,date,date,jsonb,text,date,text)',
   $old$  v_gross:=v_line.selected_quantity::bigint*v_line.unit_price_minor;
$old$,
   $new$$new$),
  ('public.invoice_order_quantities(uuid,uuid,integer,date,date,jsonb,text,date,text)',
   $old$'allocation_ranges',v_ranges));$old$,
   $new$'allocation_ranges',v_ranges)
   ||jsonb_strip_nulls(jsonb_build_object('gross_unit_price_minor',v_line.gross_unit_price_minor)));$new$),
  ('public.create_return_credit_note(uuid,integer,uuid)',
   $old$v_before bigint; v_after bigint;$old$,
   $new$v_before record; v_after record; v_gross bigint;$new$),
  ('public.create_return_credit_note(uuid,integer,uuid)',
   $old$  v_net_total:=coalesce((v_item->>'subtotal_minor')::bigint-(v_item->>'discount_minor')::bigint,
   v_quantity::bigint*v_price-round(v_quantity::numeric*v_price*v_discount/10000)::bigint);
  v_tax_total:=coalesce((v_item->>'tax_minor')::bigint,round(v_net_total::numeric*v_rate/10000)::bigint);
$old$,
   $new$  v_gross:=(v_item->>'gross_unit_price_minor')::bigint;
  select * into v_after from public.sales_line_amounts(v_quantity,v_row.quantity,v_price,v_discount,v_rate,v_gross);
  v_net_total:=coalesce((v_item->>'subtotal_minor')::bigint-(v_item->>'discount_minor')::bigint,v_after.subtotal-v_after.discount);
  v_tax_total:=coalesce((v_item->>'tax_minor')::bigint,v_after.tax);
$new$),
  ('public.create_return_credit_note(uuid,integer,uuid)',
   $old$   v_before:=round(v_start::numeric*v_price*v_discount/10000)::bigint;
   v_after:=round(v_end::numeric*v_price*v_discount/10000)::bigint;
   v_net:=v_net+v_take::bigint*v_price-v_after+v_before;
   v_tax:=v_tax+round((v_end::numeric*v_price-v_after)*v_rate/10000)::bigint
    -round((v_start::numeric*v_price-v_before)*v_rate/10000)::bigint;
$old$,
   $new$   select * into v_before from public.sales_line_amounts(v_start,v_row.quantity,v_price,v_discount,v_rate,v_gross);
   select * into v_after from public.sales_line_amounts(v_end,v_row.quantity,v_price,v_discount,v_rate,v_gross);
   v_net:=v_net+(v_after.subtotal-v_after.discount)-(v_before.subtotal-v_before.discount);
   v_tax:=v_tax+v_after.tax-v_before.tax;
$new$)
 ) p(signature,old_fragment,new_fragment) group by signature loop
  definition:=pg_get_functiondef(target.signature::regprocedure);
  for patch in select * from jsonb_to_recordset(target.fragments) as f(old_text text,new_text text) loop
   if (length(definition)-length(replace(definition,patch.old_text,'')))/length(patch.old_text)<>1 then
    raise exception 'Unexpected workbook VAT migration dependency in %',target.signature;
   end if;
   definition:=replace(definition,patch.old_text,patch.new_text);
  end loop;
  execute definition;
 end loop;
end $migration$;
commit;
