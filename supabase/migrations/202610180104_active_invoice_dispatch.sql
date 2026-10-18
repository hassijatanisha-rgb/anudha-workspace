-- Keep the linked ERP invoice active through reservation, dispatch and delivery.
begin;

do $migration$
declare r record; v_oid oid; v_definition text;
begin
 for r in select * from (values
  ('public.advance_sales_delivery(uuid,integer,text,text,text,text,text)',
   $old$ if p_action in ('ready','dispatch') then$old$,
   $new$ if p_action='dispatch' then
  perform 1 from public.acc_invoices i
  join public.sales_proformas pf on pf.id=i.proforma_id and pf.revision=i.proforma_revision
  where i.proforma_id=v_row.proforma_id and i.organization_id=v_row.organization_id
   and i.invoice_number=v_row.tax_invoice_reference and i.voided_at is null
  for share of i;
  if not found then
   raise exception 'This delivery needs its active linked ERP invoice before dispatch. Ask Accounts to check Customer invoices.';
  end if;
 end if;

 if p_action in ('ready','dispatch') then$new$),
  ('public.void_invoice(uuid,date,text)',
   $old$ if public.acc_invoice_paid_minor(p_invoice_id)>0 then raise exception 'Void the receipts paid against this invoice first'; end if;$old$,
   $new$ -- The invoice row is already locked. Reservation and dispatch hold a share lock on it,
 -- so this check sees their committed delivery state without reversing the note/invoice lock order.
 if exists(select 1 from public.sales_delivery_notes n
  where n.proforma_id=v.proforma_id and n.tax_invoice_reference=v.invoice_number
   and n.status in ('tax_invoice_created','sent_to_sales','packing','ready','out_for_delivery','delivered')) then
  raise exception 'This invoice is linked to an active or completed delivery and cannot be voided. Cancel any delivery that has not been dispatched first.';
 end if;
 if public.acc_invoice_paid_minor(p_invoice_id)>0 then raise exception 'Void the receipts paid against this invoice first'; end if;$new$)
 ) as patches(signature,old_body,new_body) loop
  v_oid:=to_regprocedure(r.signature);
  if v_oid is null then raise exception 'Missing expected active-invoice function: %',r.signature; end if;
  if not (select prosecdef and prolang=(select oid from pg_language where lanname='plpgsql') from pg_proc where oid=v_oid) then
   raise exception 'Unexpected active-invoice function security: %',r.signature;
  end if;
  v_definition:=pg_get_functiondef(v_oid);
  if strpos(v_definition,r.new_body)>0 then continue; end if;
  if (length(v_definition)-length(replace(v_definition,r.old_body,'')))/length(r.old_body)<>1 then
   raise exception 'Unexpected active-invoice function implementation: %',r.signature;
  end if;
  execute replace(v_definition,r.old_body,r.new_body);
 end loop;
end $migration$;

commit;
