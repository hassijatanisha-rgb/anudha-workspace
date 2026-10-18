-- Stock reservation uses the ERP invoice already made for the accepted Pro forma.
begin;

do $migration$
declare r record; v_oid oid; v_definition text;
begin
 for r in select * from (values
  ('public.create_tax_invoice_and_reserve_stock(uuid,integer,text)',true,
   $old$ v_needed integer; v_take integer;$old$,
   $new$ v_needed integer; v_take integer; v_invoice_reference text;$new$),
  ('public.create_tax_invoice_and_reserve_stock(uuid,integer,text)',true,
   $old$ if length(trim(coalesce(p_tax_invoice_reference,''))) not between 2 and 120 then raise exception 'Enter a valid Tax Invoice number or reference'; end if;$old$,
   $new$ if length(trim(coalesce(p_tax_invoice_reference,'')))>120 then raise exception 'ERP invoice number is too long'; end if;$new$),
  ('public.create_tax_invoice_and_reserve_stock(uuid,integer,text)',true,
   $old$ if exists(select 1 from public.sales_delivery_lines where delivery_note_id=v_row.id) then raise exception 'Stock is already allocated to this order'; end if;$old$,
   $new$ if exists(select 1 from public.sales_delivery_lines where delivery_note_id=v_row.id) then raise exception 'Stock is already allocated to this order'; end if;
 select i.invoice_number into v_invoice_reference from public.acc_invoices i
 join public.sales_proformas pf on pf.id=i.proforma_id and pf.revision=i.proforma_revision
 where i.proforma_id=v_row.proforma_id and i.organization_id=v_row.organization_id and i.voided_at is null
 for share of i;
 if not found then
  raise exception 'This Pro forma needs an active ERP invoice for its current revision before stock can be reserved. Ask Accounts to check Customer invoices.';
 end if;
 if trim(coalesce(p_tax_invoice_reference,''))<>'' and trim(p_tax_invoice_reference)<>v_invoice_reference then
  raise exception 'The reference does not match this Pro forma''s active ERP invoice. Refresh and use its ERP invoice number.';
 end if;
 p_tax_invoice_reference:=v_invoice_reference;$new$),
  ('public.guard_tax_invoice_stock_reservation()',false,
   $old$ if old.status='accounts_approved' and new.status='tax_invoice_created' then$old$,
   $new$ if old.status='accounts_approved' and new.status='tax_invoice_created' then
  perform 1 from public.acc_invoices i
  join public.sales_proformas pf on pf.id=i.proforma_id and pf.revision=i.proforma_revision
  where i.proforma_id=new.proforma_id and i.organization_id=new.organization_id and i.voided_at is null
   and i.invoice_number=new.tax_invoice_reference
  for share of i;
  if not found then raise exception 'Link the active ERP invoice for this Pro forma before recording the tax invoice'; end if;$new$)
 ) as patches(signature,security_definer,old_body,new_body) loop
  v_oid:=to_regprocedure(r.signature);
  if v_oid is null then raise exception 'Missing expected invoice delivery function: %',r.signature; end if;
  if not (select prosecdef=r.security_definer and prolang=(select oid from pg_language where lanname='plpgsql') from pg_proc where oid=v_oid) then
   raise exception 'Unexpected invoice delivery function security: %',r.signature;
  end if;
  v_definition:=pg_get_functiondef(v_oid);
  if strpos(v_definition,r.new_body)>0 then continue; end if;
  if (length(v_definition)-length(replace(v_definition,r.old_body,'')))/length(r.old_body)<>1 then
   raise exception 'Unexpected invoice delivery function implementation: %',r.signature;
  end if;
  execute replace(v_definition,r.old_body,r.new_body);
 end loop;
end $migration$;

commit;
