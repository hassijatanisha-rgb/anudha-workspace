-- The ERP is the accounting package (owner decision, 16 October 2026): tax invoices are made here, not in TallyPrime.
-- Adds customer TIN/VRN (kept apart from the client record, whose edits reset its approval), the TRA receipt for each
-- invoice, and changes the Accounts task made on Submit to accounting. Until the ERP has its own TRA connection
-- (needs TRA registration), Accounts records the TRA receipt number and verification code from the TRA system used.
begin;

create table if not exists public.acc_customer_tax_ids (
 organization_id uuid primary key references public.organizations(id),
 tin text not null default '' check (tin='' or tin ~ '^[0-9][0-9-]{7,14}[0-9]$'),
 vrn text not null default '' check (vrn='' or vrn ~ '^[0-9A-Za-z][0-9A-Za-z-]{4,19}$'),
 version integer not null default 1 check (version > 0),
 updated_by uuid references auth.users(id),
 updated_at timestamptz not null default now()
);
alter table public.acc_customer_tax_ids enable row level security;
drop policy if exists acc_customer_tax_ids_read on public.acc_customer_tax_ids;
create policy acc_customer_tax_ids_read on public.acc_customer_tax_ids for select to authenticated using ((select public.accounting_access()));
revoke all on public.acc_customer_tax_ids from public, anon, authenticated;
grant select on public.acc_customer_tax_ids to authenticated;

alter table public.acc_invoices add column if not exists buyer_tin text not null default '';
alter table public.acc_invoices add column if not exists buyer_vrn text not null default '';
alter table public.acc_invoices add column if not exists tra_receipt_number text not null default '' check (length(tra_receipt_number) <= 60);
alter table public.acc_invoices add column if not exists tra_verification_code text not null default '' check (length(tra_verification_code) <= 60);
alter table public.acc_invoices add column if not exists fiscal_recorded_by uuid references auth.users(id);
alter table public.acc_invoices add column if not exists fiscal_recorded_at timestamptz;

-- Invoices and receipts change only to be voided once; an invoice not voided may also get its TRA receipt and buyer
-- tax numbers. Every other column stays as posted.
create or replace function public.acc_guard_void() returns trigger language plpgsql set search_path=public,pg_temp as $$
declare v_void text[]:=array['voided_at','voided_by','void_reason','void_entry_id'];
        v_fiscal text[]:=array['buyer_tin','buyer_vrn','tra_receipt_number','tra_verification_code','fiscal_recorded_by','fiscal_recorded_at'];
begin
 if tg_op='DELETE' then raise exception 'Posted accounting records cannot be deleted; void them instead' using errcode='42501'; end if;
 if old.voided_at is null and new.voided_at is not null and (to_jsonb(new)-v_void)=(to_jsonb(old)-v_void) then return new; end if;
 if old.voided_at is null and new.voided_at is null and (to_jsonb(new)-v_fiscal)=(to_jsonb(old)-v_fiscal) then return new; end if;
 raise exception 'Only an unvoided record can be voided, and nothing else may change' using errcode='42501';
end $$;

create or replace function public.set_customer_tax_ids(p_organization_id uuid, p_tin text, p_vrn text)
returns public.acc_customer_tax_ids language plpgsql security definer set search_path=public,pg_temp as $$
declare v public.acc_customer_tax_ids; v_tin text:=trim(coalesce(p_tin,'')); v_vrn text:=upper(trim(coalesce(p_vrn,'')));
begin
 perform public.acc_require_access();
 if not exists(select 1 from public.organizations where id=p_organization_id) then raise exception 'Customer not found'; end if;
 if v_tin<>'' and v_tin !~ '^[0-9][0-9-]{7,14}[0-9]$' then raise exception 'TIN should be digits, for example 100-113-473'; end if;
 if v_vrn<>'' and v_vrn !~ '^[0-9A-Z][0-9A-Z-]{4,19}$' then raise exception 'VRN should look like 10-001061-P'; end if;
 insert into public.acc_customer_tax_ids(organization_id,tin,vrn,updated_by) values(p_organization_id,v_tin,v_vrn,auth.uid())
 on conflict(organization_id) do update set tin=excluded.tin,vrn=excluded.vrn,version=acc_customer_tax_ids.version+1,updated_by=excluded.updated_by,updated_at=now()
 returning * into v;
 return v;
end $$;

-- The TRA receipt for an invoice, with the buyer's tax numbers as printed. Also saves the numbers on the customer.
create or replace function public.record_invoice_fiscal(p_invoice_id uuid, p_receipt_number text, p_verification_code text, p_buyer_tin text, p_buyer_vrn text)
returns public.acc_invoices language plpgsql security definer set search_path=public,pg_temp as $$
declare v public.acc_invoices; v_receipt text:=trim(coalesce(p_receipt_number,'')); v_code text:=trim(coalesce(p_verification_code,''));
begin
 perform public.acc_require_access();
 select * into v from public.acc_invoices where id=p_invoice_id for update;
 if not found then raise exception 'Invoice not found'; end if;
 if v.voided_at is not null then raise exception 'This invoice is void'; end if;
 if length(v_receipt) not between 1 and 60 then raise exception 'Type the TRA receipt number'; end if;
 if length(v_code)>60 then raise exception 'The verification code is too long'; end if;
 perform public.set_customer_tax_ids(v.organization_id,p_buyer_tin,p_buyer_vrn);
 update public.acc_invoices set tra_receipt_number=v_receipt,tra_verification_code=v_code,
  buyer_tin=trim(coalesce(p_buyer_tin,'')),buyer_vrn=upper(trim(coalesce(p_buyer_vrn,''))),fiscal_recorded_by=auth.uid(),fiscal_recorded_at=now()
 where id=p_invoice_id returning * into v;
 return v;
end $$;

-- Invoices take the customer's saved tax numbers when they are made.
create or replace function public.acc_create_invoice(p_id uuid, p_proforma_id uuid, p_invoice_date date, p_due_date date, p_tax_reference text default '')
returns public.acc_invoices language plpgsql security definer set search_path=public,pg_temp as $$
declare v public.acc_invoices; v_pf public.sales_proformas; v_lines jsonb; v_entry uuid:=gen_random_uuid(); v_actor uuid:=auth.uid(); v_ids public.acc_customer_tax_ids;
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
 select * into v_ids from public.acc_customer_tax_ids where organization_id=v_pf.organization_id;
 select coalesce(jsonb_agg(jsonb_build_object('product_id',l.product_id,'description',l.description,'quantity',l.quantity,'uom',l.uom,'unit_price_minor',l.unit_price_minor,'discount_basis_points',l.discount_basis_points,'tax_basis_points',l.tax_basis_points) order by l.sort_order),'[]'::jsonb)
 into v_lines from public.sales_proforma_lines l where l.proforma_id=p_proforma_id;
 perform public.acc_post(v_entry,p_invoice_date,'Customer invoice for '||v_pf.document_number,'invoice',p_id,null,
  jsonb_build_array(
   jsonb_build_object('account_id',public.acc_account_by_key('receivables'),'debit_minor',v_pf.total_minor,'organization_id',v_pf.organization_id,'description',v_pf.document_number),
   jsonb_build_object('account_id',public.acc_account_by_key('sales'),'credit_minor',v_pf.subtotal_minor-v_pf.discount_minor,'description',v_pf.document_number))
  || case when v_pf.tax_minor>0 then jsonb_build_array(jsonb_build_object('account_id',public.acc_account_by_key('vat_output'),'credit_minor',v_pf.tax_minor,'description','VAT '||v_pf.document_number)) else '[]'::jsonb end);
 insert into public.acc_invoices(id,invoice_number,proforma_id,proforma_revision,organization_id,invoice_date,due_date,tax_invoice_reference,subtotal_minor,discount_minor,tax_minor,total_minor,lines,journal_entry_id,created_by,buyer_tin,buyer_vrn)
 values(p_id,'INV-'||to_char(p_invoice_date,'YYYY')||'-'||lpad(nextval('public.acc_invoice_number_seq')::text,6,'0'),p_proforma_id,v_pf.revision,v_pf.organization_id,p_invoice_date,p_due_date,trim(coalesce(p_tax_reference,'')),
  v_pf.subtotal_minor,v_pf.discount_minor,v_pf.tax_minor,v_pf.total_minor,v_lines,v_entry,v_actor,coalesce(v_ids.tin,''),coalesce(v_ids.vrn,''))
 returning * into v;
 return v;
end $$;

-- Submit to accounting now asks Accounts to check the ERP invoice and record its TRA receipt (no TallyPrime step).
create or replace function public.handoff_proforma()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
begin
 begin
  if tg_op='INSERT' then
   perform public.auto_assign_work('proforma',new.id,new.document_number,'Prepare the Pro forma and send it to the customer',coalesce(new.prepared_by,auth.uid()));
  elsif new.status is distinct from old.status then
   if new.status='sent' then
    perform public.auto_assign_work('proforma',new.id,new.document_number,'Follow up until the customer accepts',coalesce(new.prepared_by,auth.uid()));
   elsif new.status='accepted' then
    perform public.auto_assign_work('proforma',new.id,new.document_number,'Check the invoice for '||new.document_number||' in Customer invoices and record its TRA receipt',public.workflow_step_default('invoice'),'Customer accepted: '||coalesce(new.acceptance_reference,''));
   elsif new.status in ('rejected','cancelled') then
    perform public.auto_close_work('proforma',new.id,'cancelled','Pro forma '||new.status);
   end if;
  end if;
 exception when others then raise warning 'Automatic handoff for Pro forma % failed: %', new.id, sqlerrm;
 end;
 return null;
end $function$;

revoke all on function public.set_customer_tax_ids(uuid,text,text), public.record_invoice_fiscal(uuid,text,text,text,text), public.acc_create_invoice(uuid,uuid,date,date,text) from public, anon, authenticated;
grant execute on function public.set_customer_tax_ids(uuid,text,text), public.record_invoice_fiscal(uuid,text,text,text,text) to authenticated;

commit;
