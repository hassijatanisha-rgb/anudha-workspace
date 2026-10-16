-- Invoice on submit (owner decision, 16 October 2026): when Sales presses Submit to accounting, the accepted Pro forma
-- becomes a posted customer invoice in the Books straight away. Invoice date = the day it was accepted (Dar es Salaam);
-- due date from the payment terms ("7 days" → 7 days; "before", "advance", "cash", "immediate" → same day; else 30 days).
-- If the invoice cannot be made (books locked for that date, not TZS, totals do not add up) the submission still
-- succeeds and the Pro forma stays on Books overview under "waiting for an invoice" for Accounts to handle by hand.
-- Accepted is a final Pro forma state, so there is no automatic void; Accounts voids the invoice if an order falls through.
begin;

-- The balance check runs at commit as the signed-in person. A salesperson cannot read the books, so without
-- security definer the check would see no lines and refuse every invoice made on their Submit to accounting.
create or replace function public.acc_check_entry_balance() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_debit bigint; v_credit bigint; v_lines integer;
begin
 select coalesce(sum(debit_minor),0),coalesce(sum(credit_minor),0),count(*) into v_debit,v_credit,v_lines from public.acc_journal_lines where entry_id=new.entry_id;
 if v_lines<2 or v_debit<>v_credit or v_debit=0 then raise exception 'Journal entry does not balance: debits % and credits %', v_debit, v_credit using errcode='23514'; end if;
 return null;
end $$;
revoke all on function public.acc_check_entry_balance() from public, anon, authenticated;

-- The invoice itself, without the access check: used by Accounts (create_invoice_from_proforma) and by the trigger.
create or replace function public.acc_create_invoice(p_id uuid, p_proforma_id uuid, p_invoice_date date, p_due_date date, p_tax_reference text default '')
returns public.acc_invoices language plpgsql security definer set search_path=public,pg_temp as $$
declare v public.acc_invoices; v_pf public.sales_proformas; v_lines jsonb; v_entry uuid:=gen_random_uuid(); v_actor uuid:=auth.uid();
begin
 if v_actor is null then raise exception 'Sign in before invoicing' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended('acc-invoice-pf:'||coalesce(p_proforma_id::text,''),0));
 select * into v from public.acc_invoices where id=p_id;
 if found then
  if v.proforma_id<>p_proforma_id then raise exception 'This invoice id was already used for another Pro forma; refresh'; end if;
  return v;
 end if;
 if p_invoice_date is null or p_due_date is null or p_due_date<p_invoice_date then raise exception 'Choose an invoice date and a due date on or after it'; end if;
 if length(coalesce(p_tax_reference,''))>80 then raise exception 'The tax invoice reference is too long'; end if;
 select * into v_pf from public.sales_proformas where id=p_proforma_id for share;
 if not found or v_pf.deleted_at is not null then raise exception 'Pro forma not found'; end if;
 if v_pf.status<>'accepted' then raise exception 'Only an accepted Pro forma can be invoiced'; end if;
 if v_pf.currency<>'TZS' then raise exception 'Only TZS Pro formas can be invoiced in this version'; end if;
 if v_pf.total_minor<=0 or v_pf.total_minor<>v_pf.subtotal_minor-v_pf.discount_minor+v_pf.tax_minor then raise exception 'The Pro forma totals do not add up; check it before invoicing'; end if;
 if exists(select 1 from public.acc_invoices where proforma_id=p_proforma_id and voided_at is null) then raise exception 'This Pro forma already has an invoice'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('product_id',l.product_id,'description',l.description,'quantity',l.quantity,'uom',l.uom,'unit_price_minor',l.unit_price_minor,'discount_basis_points',l.discount_basis_points,'tax_basis_points',l.tax_basis_points) order by l.sort_order),'[]'::jsonb)
 into v_lines from public.sales_proforma_lines l where l.proforma_id=p_proforma_id;
 perform public.acc_post(v_entry,p_invoice_date,'Customer invoice for '||v_pf.document_number,'invoice',p_id,null,
  jsonb_build_array(
   jsonb_build_object('account_id',public.acc_account_by_key('receivables'),'debit_minor',v_pf.total_minor,'organization_id',v_pf.organization_id,'description',v_pf.document_number),
   jsonb_build_object('account_id',public.acc_account_by_key('sales'),'credit_minor',v_pf.subtotal_minor-v_pf.discount_minor,'description',v_pf.document_number))
  || case when v_pf.tax_minor>0 then jsonb_build_array(jsonb_build_object('account_id',public.acc_account_by_key('vat_output'),'credit_minor',v_pf.tax_minor,'description','VAT '||v_pf.document_number)) else '[]'::jsonb end);
 insert into public.acc_invoices(id,invoice_number,proforma_id,proforma_revision,organization_id,invoice_date,due_date,tax_invoice_reference,subtotal_minor,discount_minor,tax_minor,total_minor,lines,journal_entry_id,created_by)
 values(p_id,'INV-'||to_char(p_invoice_date,'YYYY')||'-'||lpad(nextval('public.acc_invoice_number_seq')::text,6,'0'),p_proforma_id,v_pf.revision,v_pf.organization_id,p_invoice_date,p_due_date,trim(coalesce(p_tax_reference,'')),
  v_pf.subtotal_minor,v_pf.discount_minor,v_pf.tax_minor,v_pf.total_minor,v_lines,v_entry,v_actor)
 returning * into v;
 return v;
end $$;

create or replace function public.create_invoice_from_proforma(p_id uuid, p_proforma_id uuid, p_invoice_date date, p_due_date date, p_tax_reference text default '')
returns public.acc_invoices language plpgsql security definer set search_path=public,pg_temp as $$
begin
 perform public.acc_require_access();
 return public.acc_create_invoice(p_id,p_proforma_id,p_invoice_date,p_due_date,p_tax_reference);
end $$;

-- Days until payment from the Pro forma's payment terms.
create or replace function public.acc_due_days(p_terms text) returns integer language sql immutable set search_path=public,pg_temp as $$
 select case
  when coalesce(p_terms,'') ~* '([0-9]{1,3})\s*days?' then least((regexp_match(p_terms,'([0-9]{1,3})\s*[dD][aA][yY]'))[1]::integer,365)
  when coalesce(p_terms,'') ~* '(before|advance|cash|immediate)' then 0
  else 30 end
$$;

create or replace function public.acc_invoice_on_accept() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_date date:=(coalesce(new.accepted_at,now()) at time zone 'Africa/Dar_es_Salaam')::date;
begin
 if new.status='accepted' and old.status is distinct from 'accepted' then
  begin
   perform public.acc_create_invoice(gen_random_uuid(),new.id,v_date,v_date+public.acc_due_days(new.payment_terms),'');
  exception when others then
   -- The submission stands; Books overview lists this Pro forma as waiting for an invoice.
   raise warning 'Automatic invoice for % not made: %', new.document_number, sqlerrm;
  end;
 end if;
 return null;
end $$;
drop trigger if exists sales_proformas_zz_invoice_on_accept on public.sales_proformas;
create trigger sales_proformas_zz_invoice_on_accept after update of status on public.sales_proformas for each row execute function public.acc_invoice_on_accept();

revoke all on function public.acc_create_invoice(uuid,uuid,date,date,text), public.acc_due_days(text), public.acc_invoice_on_accept() from public, anon, authenticated;
revoke all on function public.create_invoice_from_proforma(uuid,uuid,date,date,text) from public, anon;
grant execute on function public.create_invoice_from_proforma(uuid,uuid,date,date,text) to authenticated;

commit;
