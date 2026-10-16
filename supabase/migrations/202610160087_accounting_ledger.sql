-- Accounting core (owner decision, 16 October 2026): double-entry books inside the ERP.
-- Chart of accounts, balanced journal entries, customer invoices from accepted Pro formas, customer receipts with
-- allocation, a books lock date, and the standard reports (trial balance, profit and loss, balance sheet, customer
-- ageing, account ledger). TZS only in this version.
-- Rules the database enforces, not the page: every entry balances; posted entries, lines and allocations are never
-- edited or deleted (corrections are reversals); only people with accounting access read or write; nothing is posted
-- on or before the lock date; a retried save with the same id returns the first result instead of posting twice.
-- TallyPrime stays the official books until the accountant signs off a parallel run.
-- Rollback: revoke execute on the functions below and hide the menu; posted history stays.
begin;

create table if not exists public.acc_accounts (
 id uuid primary key,
 code text not null unique check (code ~ '^[0-9]{4,6}$'),
 name text not null check (length(trim(name)) between 2 and 120),
 account_type text not null check (account_type in ('asset','liability','equity','income','expense')),
 system_key text unique,
 active boolean not null default true,
 version integer not null default 1 check (version > 0),
 created_by uuid references auth.users(id),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);

create table if not exists public.acc_settings (
 id boolean primary key default true check (id),
 locked_through date,
 version integer not null default 1 check (version > 0),
 updated_by uuid references auth.users(id),
 updated_at timestamptz not null default now()
);
insert into public.acc_settings(id) values (true) on conflict do nothing;

create sequence if not exists public.acc_journal_number_seq;
create sequence if not exists public.acc_invoice_number_seq;
create sequence if not exists public.acc_receipt_number_seq;

create table if not exists public.acc_journal_entries (
 id uuid primary key,
 entry_number text not null unique,
 entry_date date not null,
 memo text not null check (length(trim(memo)) between 3 and 500),
 source_type text not null check (source_type in ('manual','invoice','receipt','reversal')),
 source_id uuid,
 reverses_entry_id uuid unique references public.acc_journal_entries(id),
 currency text not null default 'TZS' check (currency = 'TZS'),
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now()
);
create index if not exists acc_journal_entries_date on public.acc_journal_entries(entry_date);

create table if not exists public.acc_journal_lines (
 id uuid primary key default gen_random_uuid(),
 entry_id uuid not null references public.acc_journal_entries(id),
 line_no integer not null check (line_no > 0),
 account_id uuid not null references public.acc_accounts(id),
 debit_minor bigint not null default 0 check (debit_minor >= 0),
 credit_minor bigint not null default 0 check (credit_minor >= 0),
 organization_id uuid references public.organizations(id),
 description text not null default '' check (length(description) <= 300),
 check ((debit_minor > 0) <> (credit_minor > 0)),
 unique (entry_id, line_no)
);
create index if not exists acc_journal_lines_account on public.acc_journal_lines(account_id);
create index if not exists acc_journal_lines_org on public.acc_journal_lines(organization_id) where organization_id is not null;

create table if not exists public.acc_invoices (
 id uuid primary key,
 invoice_number text not null unique,
 proforma_id uuid not null references public.sales_proformas(id),
 proforma_revision integer not null,
 organization_id uuid not null references public.organizations(id),
 invoice_date date not null,
 due_date date not null,
 tax_invoice_reference text not null default '' check (length(tax_invoice_reference) <= 80),
 currency text not null default 'TZS' check (currency = 'TZS'),
 subtotal_minor bigint not null check (subtotal_minor >= 0),
 discount_minor bigint not null check (discount_minor >= 0),
 tax_minor bigint not null check (tax_minor >= 0),
 total_minor bigint not null check (total_minor > 0 and total_minor = subtotal_minor - discount_minor + tax_minor),
 lines jsonb not null,
 journal_entry_id uuid not null unique references public.acc_journal_entries(id),
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(),
 voided_at timestamptz,
 voided_by uuid references auth.users(id),
 void_reason text,
 void_entry_id uuid unique references public.acc_journal_entries(id),
 check (due_date >= invoice_date),
 check ((voided_at is null) = (voided_by is null) and (voided_at is null) = (void_reason is null) and (voided_at is null) = (void_entry_id is null))
);
create unique index if not exists acc_invoices_one_live_per_proforma on public.acc_invoices(proforma_id) where voided_at is null;
create index if not exists acc_invoices_org on public.acc_invoices(organization_id);

create table if not exists public.acc_receipts (
 id uuid primary key,
 receipt_number text not null unique,
 organization_id uuid not null references public.organizations(id),
 receipt_date date not null,
 amount_minor bigint not null check (amount_minor > 0),
 method text not null check (method in ('bank','cash','mobile_money','cheque')),
 reference text not null default '' check (length(reference) <= 120),
 deposit_account_id uuid not null references public.acc_accounts(id),
 journal_entry_id uuid not null unique references public.acc_journal_entries(id),
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(),
 voided_at timestamptz,
 voided_by uuid references auth.users(id),
 void_reason text,
 void_entry_id uuid unique references public.acc_journal_entries(id),
 check ((voided_at is null) = (voided_by is null) and (voided_at is null) = (void_reason is null) and (voided_at is null) = (void_entry_id is null))
);
create index if not exists acc_receipts_org on public.acc_receipts(organization_id);

create table if not exists public.acc_receipt_allocations (
 receipt_id uuid not null references public.acc_receipts(id),
 invoice_id uuid not null references public.acc_invoices(id),
 amount_minor bigint not null check (amount_minor > 0),
 primary key (receipt_id, invoice_id)
);
create index if not exists acc_receipt_allocations_invoice on public.acc_receipt_allocations(invoice_id);

-- Posted history is permanent. Invoices and receipts may only be voided once, through the void functions.
create or replace function public.acc_deny_change() returns trigger language plpgsql set search_path=public,pg_temp as $$
begin raise exception 'Posted accounting records cannot be changed or deleted; post a reversal instead' using errcode='42501'; end $$;
create or replace function public.acc_guard_void() returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
 if tg_op='DELETE' then raise exception 'Posted accounting records cannot be deleted; void them instead' using errcode='42501'; end if;
 if old.voided_at is not null or new.voided_at is null
  or (to_jsonb(new)-'voided_at'-'voided_by'-'void_reason'-'void_entry_id') <> (to_jsonb(old)-'voided_at'-'voided_by'-'void_reason'-'void_entry_id') then
  raise exception 'Only an unvoided record can be voided, and nothing else may change' using errcode='42501';
 end if;
 return new;
end $$;
drop trigger if exists acc_journal_entries_immutable on public.acc_journal_entries;
create trigger acc_journal_entries_immutable before update or delete on public.acc_journal_entries for each row execute function public.acc_deny_change();
drop trigger if exists acc_journal_lines_immutable on public.acc_journal_lines;
create trigger acc_journal_lines_immutable before update or delete on public.acc_journal_lines for each row execute function public.acc_deny_change();
drop trigger if exists acc_receipt_allocations_immutable on public.acc_receipt_allocations;
create trigger acc_receipt_allocations_immutable before update or delete on public.acc_receipt_allocations for each row execute function public.acc_deny_change();
drop trigger if exists acc_invoices_void_only on public.acc_invoices;
create trigger acc_invoices_void_only before update or delete on public.acc_invoices for each row execute function public.acc_guard_void();
drop trigger if exists acc_receipts_void_only on public.acc_receipts;
create trigger acc_receipts_void_only before update or delete on public.acc_receipts for each row execute function public.acc_guard_void();

-- Every entry balances, checked when the transaction commits.
create or replace function public.acc_check_entry_balance() returns trigger language plpgsql set search_path=public,pg_temp as $$
declare v_debit bigint; v_credit bigint; v_lines integer;
begin
 select coalesce(sum(debit_minor),0),coalesce(sum(credit_minor),0),count(*) into v_debit,v_credit,v_lines from public.acc_journal_lines where entry_id=new.entry_id;
 if v_lines<2 or v_debit<>v_credit or v_debit=0 then raise exception 'Journal entry does not balance: debits % and credits %', v_debit, v_credit using errcode='23514'; end if;
 return null;
end $$;
drop trigger if exists acc_journal_lines_balanced on public.acc_journal_lines;
create constraint trigger acc_journal_lines_balanced after insert on public.acc_journal_lines deferrable initially deferred for each row execute function public.acc_check_entry_balance();

alter table public.acc_accounts enable row level security;
alter table public.acc_settings enable row level security;
alter table public.acc_journal_entries enable row level security;
alter table public.acc_journal_lines enable row level security;
alter table public.acc_invoices enable row level security;
alter table public.acc_receipts enable row level security;
alter table public.acc_receipt_allocations enable row level security;
do $$ declare t text; begin
 foreach t in array array['acc_accounts','acc_settings','acc_journal_entries','acc_journal_lines','acc_invoices','acc_receipts','acc_receipt_allocations'] loop
  execute format('drop policy if exists %I on public.%I', t||'_read', t);
  execute format('create policy %I on public.%I for select to authenticated using ((select public.accounting_access()))', t||'_read', t);
  execute format('revoke all on public.%I from public, anon, authenticated', t);
  execute format('grant select on public.%I to authenticated', t);
 end loop;
end $$;
revoke all on sequence public.acc_journal_number_seq, public.acc_invoice_number_seq, public.acc_receipt_number_seq from public, anon, authenticated;

create or replace function public.acc_require_access() returns uuid language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
 if not public.accounting_access() then raise exception 'Accounting access is required' using errcode='42501'; end if;
 return auth.uid();
end $$;

-- Standard chart of accounts for a Tanzanian medical equipment trading company. The accountant adjusts it to match
-- the TallyPrime ledgers; system accounts (receivables, VAT output, sales, bank) are used by automatic postings.
insert into public.acc_accounts(id,code,name,account_type,system_key) values
 ('a0000000-0000-4000-8000-000000001100','1100','Cash on hand','asset','cash'),
 ('a0000000-0000-4000-8000-000000001110','1110','Petty cash','asset',null),
 ('a0000000-0000-4000-8000-000000001200','1200','Bank - main TZS account','asset','bank'),
 ('a0000000-0000-4000-8000-000000001250','1250','Mobile money','asset','mobile_money'),
 ('a0000000-0000-4000-8000-000000001300','1300','Accounts receivable (customers)','asset','receivables'),
 ('a0000000-0000-4000-8000-000000001400','1400','Inventory','asset',null),
 ('a0000000-0000-4000-8000-000000001500','1500','VAT input (recoverable)','asset',null),
 ('a0000000-0000-4000-8000-000000001600','1600','Prepayments and deposits','asset',null),
 ('a0000000-0000-4000-8000-000000001700','1700','Office and service equipment','asset',null),
 ('a0000000-0000-4000-8000-000000001710','1710','Motor vehicles','asset',null),
 ('a0000000-0000-4000-8000-000000001790','1790','Accumulated depreciation','asset',null),
 ('a0000000-0000-4000-8000-000000002100','2100','Accounts payable (suppliers)','liability','payables'),
 ('a0000000-0000-4000-8000-000000002200','2200','VAT output payable','liability','vat_output'),
 ('a0000000-0000-4000-8000-000000002300','2300','PAYE payable','liability',null),
 ('a0000000-0000-4000-8000-000000002310','2310','NSSF payable','liability',null),
 ('a0000000-0000-4000-8000-000000002320','2320','SDL payable','liability',null),
 ('a0000000-0000-4000-8000-000000002330','2330','WCF payable','liability',null),
 ('a0000000-0000-4000-8000-000000002400','2400','Withholding tax payable','liability',null),
 ('a0000000-0000-4000-8000-000000002500','2500','Accrued expenses','liability',null),
 ('a0000000-0000-4000-8000-000000002600','2600','Customer advances','liability',null),
 ('a0000000-0000-4000-8000-000000002700','2700','Loans','liability',null),
 ('a0000000-0000-4000-8000-000000003000','3000','Owner''s capital','equity',null),
 ('a0000000-0000-4000-8000-000000003100','3100','Retained earnings','equity','retained_earnings'),
 ('a0000000-0000-4000-8000-000000003200','3200','Drawings','equity',null),
 ('a0000000-0000-4000-8000-000000004000','4000','Sales - equipment and consumables','income','sales'),
 ('a0000000-0000-4000-8000-000000004100','4100','Installation and service income','income',null),
 ('a0000000-0000-4000-8000-000000004200','4200','Spares sales','income',null),
 ('a0000000-0000-4000-8000-000000004900','4900','Other income','income',null),
 ('a0000000-0000-4000-8000-000000005000','5000','Cost of goods sold','expense',null),
 ('a0000000-0000-4000-8000-000000005100','5100','Freight, clearing and duty','expense',null),
 ('a0000000-0000-4000-8000-000000006000','6000','Salaries and wages','expense',null),
 ('a0000000-0000-4000-8000-000000006010','6010','Employer NSSF, SDL and WCF','expense',null),
 ('a0000000-0000-4000-8000-000000006100','6100','Rent','expense',null),
 ('a0000000-0000-4000-8000-000000006200','6200','Electricity and water','expense',null),
 ('a0000000-0000-4000-8000-000000006300','6300','Transport and fuel','expense',null),
 ('a0000000-0000-4000-8000-000000006400','6400','Telephone and internet','expense',null),
 ('a0000000-0000-4000-8000-000000006500','6500','Office expenses','expense',null),
 ('a0000000-0000-4000-8000-000000006600','6600','Repairs and maintenance','expense',null),
 ('a0000000-0000-4000-8000-000000006700','6700','Bank charges','expense',null),
 ('a0000000-0000-4000-8000-000000006800','6800','Professional fees','expense',null),
 ('a0000000-0000-4000-8000-000000006900','6900','Depreciation','expense',null),
 ('a0000000-0000-4000-8000-000000006950','6950','Exchange differences','expense',null),
 ('a0000000-0000-4000-8000-000000006990','6990','Other expenses','expense',null)
on conflict (id) do nothing;

create or replace function public.acc_account_by_key(p_key text) returns uuid language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v uuid;
begin
 select id into v from public.acc_accounts where system_key=p_key and active;
 if v is null then raise exception 'The % account is missing or inactive; ask the accountant to restore it', p_key; end if;
 return v;
end $$;

-- Internal poster. Lines: [{account_id, debit_minor, credit_minor, organization_id?, description?}].
create or replace function public.acc_post(p_entry_id uuid, p_date date, p_memo text, p_source_type text, p_source_id uuid, p_reverses uuid, p_lines jsonb)
returns public.acc_journal_entries language plpgsql security definer set search_path=public,pg_temp as $$
declare v_entry public.acc_journal_entries; v_line jsonb; v_no integer:=0; v_debit bigint:=0; v_credit bigint:=0; v_d bigint; v_c bigint; v_lock date; v_actor uuid:=auth.uid();
begin
 if v_actor is null then raise exception 'Sign in before posting' using errcode='42501'; end if;
 if p_entry_id is null or p_date is null then raise exception 'Entry id and date are required'; end if;
 if p_memo is null or length(trim(p_memo))<3 or length(p_memo)>500 then raise exception 'Write a description of 3 to 500 characters'; end if;
 select locked_through into v_lock from public.acc_settings where id;
 if v_lock is not null and p_date<=v_lock then raise exception 'The books are locked through %; choose a later date', v_lock; end if;
 if p_date > current_date + 31 then raise exception 'The date is too far in the future'; end if;
 if jsonb_typeof(p_lines)<>'array' or jsonb_array_length(p_lines)<2 or jsonb_array_length(p_lines)>200 then raise exception 'An entry needs between 2 and 200 lines'; end if;
 insert into public.acc_journal_entries(id,entry_number,entry_date,memo,source_type,source_id,reverses_entry_id,created_by)
 values(p_entry_id,'JE-'||to_char(p_date,'YYYY')||'-'||lpad(nextval('public.acc_journal_number_seq')::text,6,'0'),p_date,trim(p_memo),p_source_type,p_source_id,p_reverses,v_actor)
 returning * into v_entry;
 for v_line in select * from jsonb_array_elements(p_lines) loop
  v_no:=v_no+1;
  if jsonb_typeof(v_line)<>'object' then raise exception 'Line % is not valid', v_no; end if;
  begin v_d:=coalesce((v_line->>'debit_minor')::bigint,0); v_c:=coalesce((v_line->>'credit_minor')::bigint,0);
  exception when others then raise exception 'Line % has an invalid amount', v_no; end;
  if v_d<0 or v_c<0 or (v_d>0)=(v_c>0) then raise exception 'Line % needs either a debit or a credit above zero', v_no; end if;
  if not exists(select 1 from public.acc_accounts where id=(v_line->>'account_id')::uuid and active) then raise exception 'Line % uses an unknown or inactive account', v_no; end if;
  if nullif(v_line->>'organization_id','') is not null and not exists(select 1 from public.organizations where id=(v_line->>'organization_id')::uuid) then raise exception 'Line % names an unknown customer', v_no; end if;
  insert into public.acc_journal_lines(entry_id,line_no,account_id,debit_minor,credit_minor,organization_id,description)
  values(p_entry_id,v_no,(v_line->>'account_id')::uuid,v_d,v_c,nullif(v_line->>'organization_id','')::uuid,left(coalesce(v_line->>'description',''),300));
  v_debit:=v_debit+v_d;v_credit:=v_credit+v_c;
 end loop;
 if v_debit<>v_credit then raise exception 'Debits (%) and credits (%) must be equal', v_debit, v_credit; end if;
 return v_entry;
end $$;

-- Internal reversal: mirror every line of an entry.
create or replace function public.acc_reverse(p_new_id uuid, p_entry_id uuid, p_date date, p_reason text)
returns public.acc_journal_entries language plpgsql security definer set search_path=public,pg_temp as $$
declare v_old public.acc_journal_entries; v_lines jsonb;
begin
 select * into v_old from public.acc_journal_entries where id=p_entry_id for update;
 if not found then raise exception 'Journal entry not found'; end if;
 if exists(select 1 from public.acc_journal_entries where reverses_entry_id=p_entry_id) then raise exception 'This entry has already been reversed'; end if;
 if v_old.source_type='reversal' then raise exception 'A reversal cannot itself be reversed; post a new entry'; end if;
 if p_date<v_old.entry_date then raise exception 'A reversal cannot be dated before the original entry'; end if;
 select jsonb_agg(jsonb_build_object('account_id',account_id,'debit_minor',credit_minor,'credit_minor',debit_minor,'organization_id',organization_id,'description',description) order by line_no) into v_lines
 from public.acc_journal_lines where entry_id=p_entry_id;
 return public.acc_post(p_new_id,p_date,'Reversal of '||v_old.entry_number||': '||trim(coalesce(p_reason,'')),'reversal',v_old.source_id,p_entry_id,v_lines);
end $$;

create or replace function public.post_manual_journal(p_id uuid, p_date date, p_memo text, p_lines jsonb)
returns public.acc_journal_entries language plpgsql security definer set search_path=public,pg_temp as $$
declare v public.acc_journal_entries;
begin
 perform public.acc_require_access();
 perform pg_advisory_xact_lock(hashtextextended('acc-entry:'||p_id::text,0));
 select * into v from public.acc_journal_entries where id=p_id;
 if found then
  if v.source_type<>'manual' or v.entry_date<>p_date or v.memo<>trim(p_memo) then raise exception 'This entry id was already used for different details; refresh'; end if;
  return v;
 end if;
 return public.acc_post(p_id,p_date,p_memo,'manual',null,null,p_lines);
end $$;

create or replace function public.reverse_journal_entry(p_id uuid, p_entry_id uuid, p_date date, p_reason text)
returns public.acc_journal_entries language plpgsql security definer set search_path=public,pg_temp as $$
declare v public.acc_journal_entries; v_src text;
begin
 perform public.acc_require_access();
 if p_reason is null or length(trim(p_reason))<5 then raise exception 'Give a reason of at least 5 characters'; end if;
 select * into v from public.acc_journal_entries where id=p_id;
 if found then
  if v.reverses_entry_id is distinct from p_entry_id then raise exception 'This entry id was already used; refresh'; end if;
  return v;
 end if;
 select source_type into v_src from public.acc_journal_entries where id=p_entry_id;
 if v_src is null then raise exception 'Journal entry not found'; end if;
 if v_src='reversal' then raise exception 'A reversal cannot itself be reversed; post a new entry'; end if;
 if v_src<>'manual' then raise exception 'Invoices and receipts are corrected by voiding them, not by reversing their entry'; end if;
 return public.acc_reverse(p_id,p_entry_id,p_date,p_reason);
end $$;

create or replace function public.create_invoice_from_proforma(p_id uuid, p_proforma_id uuid, p_invoice_date date, p_due_date date, p_tax_reference text default '')
returns public.acc_invoices language plpgsql security definer set search_path=public,pg_temp as $$
declare v public.acc_invoices; v_pf public.sales_proformas; v_lines jsonb; v_entry uuid:=gen_random_uuid(); v_actor uuid;
begin
 v_actor:=public.acc_require_access();
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

create or replace function public.acc_invoice_paid_minor(p_invoice_id uuid, p_as_of date default null) returns bigint language sql stable security definer set search_path=public,pg_temp as $$
 select coalesce(sum(a.amount_minor),0)::bigint from public.acc_receipt_allocations a join public.acc_receipts r on r.id=a.receipt_id
 where a.invoice_id=p_invoice_id and r.voided_at is null and (p_as_of is null or r.receipt_date<=p_as_of)
$$;

create or replace function public.void_invoice(p_invoice_id uuid, p_date date, p_reason text)
returns public.acc_invoices language plpgsql security definer set search_path=public,pg_temp as $$
declare v public.acc_invoices; v_actor uuid; v_rev uuid:=gen_random_uuid();
begin
 v_actor:=public.acc_require_access();
 if p_reason is null or length(trim(p_reason))<5 then raise exception 'Give a reason of at least 5 characters'; end if;
 select * into v from public.acc_invoices where id=p_invoice_id for update;
 if not found then raise exception 'Invoice not found'; end if;
 if v.voided_at is not null then return v; end if;
 if public.acc_invoice_paid_minor(p_invoice_id)>0 then raise exception 'Void the receipts paid against this invoice first'; end if;
 perform public.acc_reverse(v_rev,v.journal_entry_id,p_date,'Void '||v.invoice_number||': '||trim(p_reason));
 update public.acc_invoices set voided_at=now(),voided_by=v_actor,void_reason=trim(p_reason),void_entry_id=v_rev where id=p_invoice_id returning * into v;
 return v;
end $$;

-- Allocations: [{invoice_id, amount_minor}]. Any unallocated part stays as a customer credit on receivables.
create or replace function public.record_receipt(p_id uuid, p_organization_id uuid, p_date date, p_amount_minor bigint, p_method text, p_reference text, p_deposit_account_id uuid, p_allocations jsonb default '[]'::jsonb)
returns public.acc_receipts language plpgsql security definer set search_path=public,pg_temp as $$
declare v public.acc_receipts; v_actor uuid; v_entry uuid:=gen_random_uuid(); v_a jsonb; v_inv public.acc_invoices; v_amt bigint; v_total bigint:=0; v_seen uuid[]:='{}';
begin
 v_actor:=public.acc_require_access();
 perform pg_advisory_xact_lock(hashtextextended('acc-receipt-org:'||coalesce(p_organization_id::text,''),0));
 select * into v from public.acc_receipts where id=p_id;
 if found then
  if v.organization_id<>p_organization_id or v.amount_minor<>p_amount_minor or v.receipt_date<>p_date then raise exception 'This receipt id was already used for different details; refresh'; end if;
  return v;
 end if;
 if p_amount_minor is null or p_amount_minor<=0 then raise exception 'Enter an amount above zero'; end if;
 if p_method not in ('bank','cash','mobile_money','cheque') then raise exception 'Choose how the money was received'; end if;
 if length(coalesce(p_reference,''))>120 then raise exception 'The reference is too long'; end if;
 if not exists(select 1 from public.organizations where id=p_organization_id) then raise exception 'Customer not found'; end if;
 if not exists(select 1 from public.acc_accounts where id=p_deposit_account_id and active and account_type='asset' and system_key is distinct from 'receivables') then raise exception 'Choose the bank, cash or mobile money account the money went into'; end if;
 if jsonb_typeof(coalesce(p_allocations,'[]'::jsonb))<>'array' then raise exception 'Allocations are not valid'; end if;
 perform public.acc_post(v_entry,p_date,'Customer receipt'||case when length(trim(coalesce(p_reference,'')))>0 then ' '||trim(p_reference) else '' end,'receipt',p_id,null,
  jsonb_build_array(
   jsonb_build_object('account_id',p_deposit_account_id,'debit_minor',p_amount_minor,'description',p_method),
   jsonb_build_object('account_id',public.acc_account_by_key('receivables'),'credit_minor',p_amount_minor,'organization_id',p_organization_id,'description',p_method)));
 insert into public.acc_receipts(id,receipt_number,organization_id,receipt_date,amount_minor,method,reference,deposit_account_id,journal_entry_id,created_by)
 values(p_id,'RCT-'||to_char(p_date,'YYYY')||'-'||lpad(nextval('public.acc_receipt_number_seq')::text,6,'0'),p_organization_id,p_date,p_amount_minor,p_method,trim(coalesce(p_reference,'')),p_deposit_account_id,v_entry,v_actor)
 returning * into v;
 for v_a in select * from jsonb_array_elements(coalesce(p_allocations,'[]'::jsonb)) loop
  begin v_amt:=(v_a->>'amount_minor')::bigint; exception when others then raise exception 'An allocation amount is not valid'; end;
  if v_amt is null or v_amt<=0 then raise exception 'Allocation amounts must be above zero'; end if;
  select * into v_inv from public.acc_invoices where id=(v_a->>'invoice_id')::uuid for update;
  if not found or v_inv.voided_at is not null then raise exception 'An allocated invoice is missing or void'; end if;
  if v_inv.organization_id<>p_organization_id then raise exception 'Invoice % belongs to another customer', v_inv.invoice_number; end if;
  if v_inv.id=any(v_seen) then raise exception 'Invoice % is listed twice', v_inv.invoice_number; end if;
  v_seen:=v_seen||v_inv.id;
  if v_amt>v_inv.total_minor-public.acc_invoice_paid_minor(v_inv.id) then raise exception 'Invoice % has less than that left to pay', v_inv.invoice_number; end if;
  insert into public.acc_receipt_allocations(receipt_id,invoice_id,amount_minor) values(p_id,v_inv.id,v_amt);
  v_total:=v_total+v_amt;
 end loop;
 if v_total>p_amount_minor then raise exception 'Allocations add up to more than the amount received'; end if;
 return v;
end $$;

create or replace function public.void_receipt(p_receipt_id uuid, p_date date, p_reason text)
returns public.acc_receipts language plpgsql security definer set search_path=public,pg_temp as $$
declare v public.acc_receipts; v_actor uuid; v_rev uuid:=gen_random_uuid();
begin
 v_actor:=public.acc_require_access();
 if p_reason is null or length(trim(p_reason))<5 then raise exception 'Give a reason of at least 5 characters'; end if;
 select * into v from public.acc_receipts where id=p_receipt_id for update;
 if not found then raise exception 'Receipt not found'; end if;
 if v.voided_at is not null then return v; end if;
 perform public.acc_reverse(v_rev,v.journal_entry_id,p_date,'Void '||v.receipt_number||': '||trim(p_reason));
 update public.acc_receipts set voided_at=now(),voided_by=v_actor,void_reason=trim(p_reason),void_entry_id=v_rev where id=p_receipt_id returning * into v;
 return v;
end $$;

create or replace function public.save_ledger_account(p_id uuid, p_expected_version integer, p_code text, p_name text, p_type text, p_active boolean)
returns public.acc_accounts language plpgsql security definer set search_path=public,pg_temp as $$
declare v public.acc_accounts; v_actor uuid;
begin
 v_actor:=public.acc_require_access();
 if p_code is null or p_code !~ '^[0-9]{4,6}$' then raise exception 'The account code must be 4 to 6 digits'; end if;
 if p_name is null or length(trim(p_name)) not between 2 and 120 then raise exception 'The account name must be 2 to 120 characters'; end if;
 if p_type not in ('asset','liability','equity','income','expense') then raise exception 'Choose the account type'; end if;
 select * into v from public.acc_accounts where id=p_id for update;
 if not found then
  if p_expected_version is not null then raise exception 'Account not found; refresh'; end if;
  insert into public.acc_accounts(id,code,name,account_type,active,created_by) values(p_id,p_code,trim(p_name),p_type,coalesce(p_active,true),v_actor) returning * into v;
  return v;
 end if;
 if p_expected_version is distinct from v.version then raise exception 'Someone else changed this account; refresh'; end if;
 if v.system_key is not null and (p_active is false or p_type<>v.account_type) then raise exception 'This account is used by automatic postings; it cannot be switched off or change type'; end if;
 if p_type<>v.account_type and exists(select 1 from public.acc_journal_lines where account_id=p_id) then raise exception 'An account with postings cannot change type'; end if;
 update public.acc_accounts set code=p_code,name=trim(p_name),account_type=p_type,active=coalesce(p_active,true),version=version+1,updated_at=now() where id=p_id returning * into v;
 return v;
end $$;

create or replace function public.set_books_lock(p_expected_version integer, p_locked_through date)
returns public.acc_settings language plpgsql security definer set search_path=public,pg_temp as $$
declare v public.acc_settings;
begin
 perform public.acc_require_access();
 if not public.inventory_owner() then raise exception 'Only the owner can lock or unlock the books' using errcode='42501'; end if;
 update public.acc_settings set locked_through=p_locked_through,version=version+1,updated_by=auth.uid(),updated_at=now() where id and version=p_expected_version returning * into v;
 if not found then raise exception 'The lock date changed; refresh'; end if;
 return v;
end $$;

-- Reports. Balances are debit minus credit; income, liabilities and equity show positive when in credit.
create or replace function public.acc_trial_balance(p_as_of date)
returns table(account_id uuid, code text, name text, account_type text, debit_minor bigint, credit_minor bigint)
language plpgsql stable security definer set search_path=public,pg_temp as $$
#variable_conflict use_column
begin
 perform public.acc_require_access();
 return query
 select a.id,a.code,a.name,a.account_type,
  greatest(coalesce(sum(l.debit_minor-l.credit_minor),0),0)::bigint,
  greatest(coalesce(sum(l.credit_minor-l.debit_minor),0),0)::bigint
 from public.acc_accounts a
 join public.acc_journal_lines l on l.account_id=a.id
 join public.acc_journal_entries e on e.id=l.entry_id and e.entry_date<=p_as_of
 group by a.id having sum(l.debit_minor-l.credit_minor)<>0
 order by a.code;
end $$;

create or replace function public.acc_profit_and_loss(p_from date, p_to date)
returns table(account_id uuid, code text, name text, account_type text, amount_minor bigint)
language plpgsql stable security definer set search_path=public,pg_temp as $$
#variable_conflict use_column
begin
 perform public.acc_require_access();
 return query
 select a.id,a.code,a.name,a.account_type,
  (case when a.account_type='income' then sum(l.credit_minor-l.debit_minor) else sum(l.debit_minor-l.credit_minor) end)::bigint
 from public.acc_accounts a
 join public.acc_journal_lines l on l.account_id=a.id
 join public.acc_journal_entries e on e.id=l.entry_id and e.entry_date between p_from and p_to
 where a.account_type in ('income','expense')
 group by a.id having sum(l.debit_minor-l.credit_minor)<>0
 order by a.code;
end $$;

create or replace function public.acc_balance_sheet(p_as_of date)
returns table(account_id uuid, code text, name text, account_type text, amount_minor bigint)
language plpgsql stable security definer set search_path=public,pg_temp as $$
#variable_conflict use_column
begin
 perform public.acc_require_access();
 return query
 select a.id,a.code,a.name,a.account_type,
  (case when a.account_type='asset' then sum(l.debit_minor-l.credit_minor) else sum(l.credit_minor-l.debit_minor) end)::bigint
 from public.acc_accounts a
 join public.acc_journal_lines l on l.account_id=a.id
 join public.acc_journal_entries e on e.id=l.entry_id and e.entry_date<=p_as_of
 where a.account_type in ('asset','liability','equity')
 group by a.id having sum(l.debit_minor-l.credit_minor)<>0
 union all
 select null::uuid,'','Earnings to date (not yet closed to retained earnings)','equity',
  coalesce((select sum(l.credit_minor-l.debit_minor) from public.acc_journal_lines l join public.acc_accounts a on a.id=l.account_id and a.account_type in ('income','expense')
   join public.acc_journal_entries e on e.id=l.entry_id and e.entry_date<=p_as_of),0)::bigint
 order by 4,2;
end $$;

create or replace function public.acc_receivables_ageing(p_as_of date)
returns table(organization_id uuid, customer text, current_minor bigint, days_1_30_minor bigint, days_31_60_minor bigint, days_61_90_minor bigint, days_over_90_minor bigint, unapplied_credit_minor bigint, balance_minor bigint)
language plpgsql stable security definer set search_path=public,pg_temp as $$
#variable_conflict use_column
begin
 perform public.acc_require_access();
 return query
 with open_inv as (
  select i.organization_id,i.due_date,i.total_minor-public.acc_invoice_paid_minor(i.id,p_as_of) as due
  from public.acc_invoices i where i.invoice_date<=p_as_of and (i.voided_at is null or i.voided_at::date>p_as_of)
 ), credits as (
  select r.organization_id,sum(r.amount_minor-coalesce((select sum(a.amount_minor) from public.acc_receipt_allocations a where a.receipt_id=r.id),0)) as unapplied
  from public.acc_receipts r where r.receipt_date<=p_as_of and (r.voided_at is null or r.voided_at::date>p_as_of) group by r.organization_id
 ), b as (
  select o.organization_id,
   sum(case when p_as_of-o.due_date<=0 then o.due else 0 end) c0,
   sum(case when p_as_of-o.due_date between 1 and 30 then o.due else 0 end) c1,
   sum(case when p_as_of-o.due_date between 31 and 60 then o.due else 0 end) c2,
   sum(case when p_as_of-o.due_date between 61 and 90 then o.due else 0 end) c3,
   sum(case when p_as_of-o.due_date>90 then o.due else 0 end) c4
  from open_inv o where o.due>0 group by o.organization_id
 )
 select k.organization_id,org.name,coalesce(b.c0,0)::bigint,coalesce(b.c1,0)::bigint,coalesce(b.c2,0)::bigint,coalesce(b.c3,0)::bigint,coalesce(b.c4,0)::bigint,
  coalesce(cr.unapplied,0)::bigint,(coalesce(b.c0,0)+coalesce(b.c1,0)+coalesce(b.c2,0)+coalesce(b.c3,0)+coalesce(b.c4,0)-coalesce(cr.unapplied,0))::bigint
 from (select organization_id from b union select organization_id from credits where unapplied<>0) k
 join public.organizations org on org.id=k.organization_id
 left join b on b.organization_id=k.organization_id left join credits cr on cr.organization_id=k.organization_id
 order by 9 desc,2;
end $$;

create or replace function public.acc_account_ledger(p_account_id uuid, p_from date, p_to date)
returns table(entry_id uuid, entry_date date, entry_number text, memo text, description text, debit_minor bigint, credit_minor bigint, balance_minor bigint)
language plpgsql stable security definer set search_path=public,pg_temp as $$
#variable_conflict use_column
declare v_open bigint;
begin
 perform public.acc_require_access();
 select coalesce(sum(l.debit_minor-l.credit_minor),0) into v_open from public.acc_journal_lines l join public.acc_journal_entries e on e.id=l.entry_id where l.account_id=p_account_id and e.entry_date<p_from;
 return query
 select null::uuid,p_from,''::text,'Opening balance'::text,''::text,0::bigint,0::bigint,v_open
 union all
 select e.id,e.entry_date,e.entry_number,e.memo,l.description,l.debit_minor,l.credit_minor,
  (v_open+sum(l.debit_minor-l.credit_minor) over (order by e.entry_date,e.entry_number,l.line_no))::bigint
 from public.acc_journal_lines l join public.acc_journal_entries e on e.id=l.entry_id
 where l.account_id=p_account_id and e.entry_date between p_from and p_to
 order by 2,3;
end $$;

do $$ declare f text; begin
 foreach f in array array[
  'acc_post(uuid,date,text,text,uuid,uuid,jsonb)','acc_reverse(uuid,uuid,date,text)','acc_account_by_key(text)','acc_require_access()','acc_invoice_paid_minor(uuid,date)',
  'post_manual_journal(uuid,date,text,jsonb)','reverse_journal_entry(uuid,uuid,date,text)','create_invoice_from_proforma(uuid,uuid,date,date,text)','void_invoice(uuid,date,text)',
  'record_receipt(uuid,uuid,date,bigint,text,text,uuid,jsonb)','void_receipt(uuid,date,text)','save_ledger_account(uuid,integer,text,text,text,boolean)','set_books_lock(integer,date)',
  'acc_trial_balance(date)','acc_profit_and_loss(date,date)','acc_balance_sheet(date)','acc_receivables_ageing(date)','acc_account_ledger(uuid,date,date)'] loop
  execute 'revoke all on function public.'||f||' from public, anon, authenticated';
 end loop;
 foreach f in array array[
  'post_manual_journal(uuid,date,text,jsonb)','reverse_journal_entry(uuid,uuid,date,text)','create_invoice_from_proforma(uuid,uuid,date,date,text)','void_invoice(uuid,date,text)',
  'record_receipt(uuid,uuid,date,bigint,text,text,uuid,jsonb)','void_receipt(uuid,date,text)','save_ledger_account(uuid,integer,text,text,text,boolean)','set_books_lock(integer,date)',
  'acc_trial_balance(date)','acc_profit_and_loss(date,date)','acc_balance_sheet(date)','acc_receivables_ageing(date)','acc_account_ledger(uuid,date,date)'] loop
  execute 'grant execute on function public.'||f||' to authenticated';
 end loop;
end $$;

commit;
