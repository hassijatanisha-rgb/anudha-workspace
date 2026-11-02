-- Supplier subledger. Money is integer minor TZS; tax and acquisition cost are entered explicitly.
begin;
alter table public.acc_journal_entries drop constraint if exists acc_journal_entries_source_type_check;
alter table public.acc_journal_entries add constraint acc_journal_entries_source_type_check check(source_type in ('manual','invoice','receipt','reversal','credit_note','supplier_bill','supplier_payment','supplier_refund','supplier_credit'));
update public.acc_accounts set system_key='inventory' where id='a0000000-0000-4000-8000-000000001400' and system_key is null;
update public.acc_accounts set system_key='vat_input' where id='a0000000-0000-4000-8000-000000001500' and system_key is null;
create sequence public.acc_supplier_document_seq;

create table public.acc_opening_payable_imports (
 id uuid primary key,source text not null,cutover_date date not null,gl_import_id uuid not null references public.acc_financial_imports(id),
 rows jsonb not null,result jsonb not null,created_by uuid not null references auth.users(id),created_at timestamptz not null default now(),
 voided_on date,voided_at timestamptz,voided_by uuid references auth.users(id),void_reason text,void_entry_id uuid references public.acc_journal_entries(id),
 check((voided_on is null)=(voided_at is null) and (voided_on is null)=(voided_by is null) and (voided_on is null)=(void_reason is null))
);
create unique index acc_opening_payable_gl_live on public.acc_opening_payable_imports(gl_import_id) where voided_on is null;
create table public.acc_supplier_bills (
 id uuid primary key,bill_number text not null unique,supplier_id uuid not null references public.suppliers(id),bill_date date not null,due_date date not null,
 reference text not null check(length(reference) between 1 and 120),purchase_order_id uuid references public.purchase_orders(id),currency text not null default 'TZS' check(currency='TZS'),
 lines jsonb not null,net_minor bigint not null check(net_minor>0),tax_minor bigint not null check(tax_minor>=0),total_minor bigint not null check(total_minor=net_minor+tax_minor),
 journal_entry_id uuid unique references public.acc_journal_entries(id),opening_import_id uuid references public.acc_opening_payable_imports(id) deferrable initially deferred,opening_cutover_date date,
 created_by uuid not null references auth.users(id),created_at timestamptz not null default now(),
 voided_on date,voided_at timestamptz,voided_by uuid references auth.users(id),void_reason text,void_entry_id uuid references public.acc_journal_entries(id),
 check(due_date>=bill_date),check((opening_import_id is null and journal_entry_id is not null and opening_cutover_date is null) or (opening_import_id is not null and journal_entry_id is null and opening_cutover_date is not null and bill_date<=opening_cutover_date and tax_minor=0 and lines='[]')),
 check((voided_on is null)=(voided_at is null) and (voided_on is null)=(voided_by is null) and (voided_on is null)=(void_reason is null))
);
create unique index acc_supplier_bill_reference_live on public.acc_supplier_bills(supplier_id,lower(reference)) where voided_on is null;
create index acc_supplier_bills_supplier on public.acc_supplier_bills(supplier_id,bill_date);
create table public.acc_supplier_payments (
 id uuid primary key,payment_number text not null unique,supplier_id uuid not null references public.suppliers(id),payment_date date not null,
 amount_minor bigint not null check(amount_minor>0),method text not null check(method in ('bank','cash','mobile_money','cheque','opening')),reference text not null check(length(reference)<=120),
 payment_account_id uuid references public.acc_accounts(id),requested_allocations jsonb not null default '[]',journal_entry_id uuid unique references public.acc_journal_entries(id),
 opening_import_id uuid references public.acc_opening_payable_imports(id) deferrable initially deferred,opening_cutover_date date,
 created_by uuid not null references auth.users(id),created_at timestamptz not null default now(),
 voided_on date,voided_at timestamptz,voided_by uuid references auth.users(id),void_reason text,void_entry_id uuid references public.acc_journal_entries(id),
 check((opening_import_id is null and journal_entry_id is not null and payment_account_id is not null and method<>'opening' and opening_cutover_date is null) or (opening_import_id is not null and journal_entry_id is null and payment_account_id is null and method='opening' and payment_date=opening_cutover_date)),
 check((voided_on is null)=(voided_at is null) and (voided_on is null)=(voided_by is null) and (voided_on is null)=(void_reason is null))
);
create index acc_supplier_payments_supplier on public.acc_supplier_payments(supplier_id,payment_date);
create table public.acc_supplier_allocations (
 id uuid primary key,payment_id uuid not null references public.acc_supplier_payments(id),allocation_date date not null,lines jsonb not null,
 created_by uuid not null references auth.users(id),created_at timestamptz not null default now(),
 voided_on date,voided_at timestamptz,voided_by uuid references auth.users(id),void_reason text,void_entry_id uuid references public.acc_journal_entries(id),
 check((voided_on is null)=(voided_at is null) and (voided_on is null)=(voided_by is null) and (voided_on is null)=(void_reason is null))
);
create index acc_supplier_allocations_payment on public.acc_supplier_allocations(payment_id);
create table public.acc_supplier_refunds (
 id uuid primary key,refund_number text not null unique,payment_id uuid not null references public.acc_supplier_payments(id),supplier_id uuid not null references public.suppliers(id),refund_date date not null,
 amount_minor bigint not null check(amount_minor>0),method text not null check(method in ('bank','cash','mobile_money','cheque')),reference text not null check(length(reference)<=120),
 payment_account_id uuid not null references public.acc_accounts(id),journal_entry_id uuid not null unique references public.acc_journal_entries(id),
 created_by uuid not null references auth.users(id),created_at timestamptz not null default now(),
 voided_on date,voided_at timestamptz,voided_by uuid references auth.users(id),void_reason text,void_entry_id uuid references public.acc_journal_entries(id),
 check((voided_on is null)=(voided_at is null) and (voided_on is null)=(voided_by is null) and (voided_on is null)=(void_reason is null))
);
create index acc_supplier_refunds_payment on public.acc_supplier_refunds(payment_id);
create table public.acc_supplier_credits (
 id uuid primary key,credit_number text not null unique,bill_id uuid not null references public.acc_supplier_bills(id),supplier_id uuid not null references public.suppliers(id),credit_date date not null,
 reference text not null check(length(reference) between 1 and 120),reason text not null check(length(reason) between 5 and 300),lines jsonb not null,
 net_minor bigint not null check(net_minor>=0),tax_minor bigint not null check(tax_minor>=0),total_minor bigint not null check(total_minor>0 and total_minor=net_minor+tax_minor),
 journal_entry_id uuid not null unique references public.acc_journal_entries(id),created_by uuid not null references auth.users(id),created_at timestamptz not null default now(),
 voided_on date,voided_at timestamptz,voided_by uuid references auth.users(id),void_reason text,void_entry_id uuid references public.acc_journal_entries(id),
 check((voided_on is null)=(voided_at is null) and (voided_on is null)=(voided_by is null) and (voided_on is null)=(void_reason is null))
);
create index acc_supplier_credits_bill on public.acc_supplier_credits(bill_id);
create unique index acc_supplier_credit_reference_live on public.acc_supplier_credits(supplier_id,lower(reference)) where voided_on is null;

-- Credits on paid bills release dated applications back to their original payment.
-- The original allocation and the supplier credit are both retained permanently.
create table public.acc_supplier_credit_releases (
 credit_id uuid not null references public.acc_supplier_credits(id),allocation_id uuid not null references public.acc_supplier_allocations(id),
 bill_id uuid not null references public.acc_supplier_bills(id),release_date date not null,amount_minor bigint not null check(amount_minor>0),
 created_by uuid not null references auth.users(id),created_at timestamptz not null default now(),
 primary key(credit_id,allocation_id,bill_id,release_date)
);
alter table public.acc_supplier_credit_releases enable row level security;
create policy acc_supplier_credit_releases_read on public.acc_supplier_credit_releases for select to authenticated using((select public.accounting_access()));
revoke all on public.acc_supplier_credit_releases from public,anon,authenticated;
grant select on public.acc_supplier_credit_releases to authenticated;
create trigger acc_supplier_credit_releases_immutable before update or delete on public.acc_supplier_credit_releases for each row execute function public.acc_deny_change();

create function public.acc_supplier_guard_change() returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
 if tg_op='DELETE' then raise exception 'Supplier accounting history cannot be deleted' using errcode='42501'; end if;
 if old.voided_on is not null or new.voided_on is null or
 (to_jsonb(new)-array['voided_on','voided_at','voided_by','void_reason','void_entry_id']) is distinct from
 (to_jsonb(old)-array['voided_on','voided_at','voided_by','void_reason','void_entry_id']) then
 raise exception 'Supplier accounting history is immutable; use the correction action' using errcode='42501';end if;
 return new;
end $$;
do $$ declare t text;begin
 foreach t in array array['acc_opening_payable_imports','acc_supplier_bills','acc_supplier_payments','acc_supplier_allocations','acc_supplier_refunds','acc_supplier_credits'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('create policy %I on public.%I for select to authenticated using((select public.accounting_access()))',t||'_read',t);
 execute format('revoke all on public.%I from public,anon,authenticated',t);
 execute format('grant select on public.%I to authenticated',t);
 execute format('create trigger %I before update or delete on public.%I for each row execute function public.acc_supplier_guard_change()',t||'_immutable',t);
 end loop;
end $$;

create function public.acc_supplier_json(p_row jsonb) returns jsonb language plpgsql immutable set search_path=public,pg_temp as $$
declare v jsonb;begin
 if jsonb_typeof(p_row)='object' then
 select coalesce(jsonb_object_agg(key,case when key like '%\_minor' escape '\' and value<>'null'::jsonb then to_jsonb(value#>>'{}') else public.acc_supplier_json(value) end),'{}') into v from jsonb_each(p_row);return v;
 elsif jsonb_typeof(p_row)='array' then
 select coalesce(jsonb_agg(public.acc_supplier_json(value) order by ordinality),'[]') into v from jsonb_array_elements(p_row) with ordinality;return v;
 end if;return p_row;
end $$;
create function public.acc_supplier_lock() returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare v uuid;begin
 v:=public.acc_require_access();
 perform pg_advisory_xact_lock(hashtextextended('acc-financial-import',0));
 perform pg_advisory_xact_lock(hashtextextended('acc-supplier-books',0));
 return v;
end $$;
create function public.acc_supplier_date(p_date date) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare v date;begin
 if p_date is null or not isfinite(p_date) then raise exception 'Choose a valid accounting date';end if;
 select locked_through into v from public.acc_settings where id for share;
 if p_date<=v then raise exception 'The books are locked through %; choose a later date',v;end if;
end $$;
create function public.acc_supplier_cash_account(p_account uuid,p_method text) returns void language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
 if p_method is null or p_method not in ('bank','cash','mobile_money','cheque') or not exists(select 1 from public.acc_accounts where id=p_account and active and account_type='asset' and system_key is distinct from 'receivables' and code ~ '^1[12][0-9]{2}$') then
 raise exception 'Choose an active cash, bank or mobile money asset account (1100–1299) and a valid method';end if;
end $$;
create function public.acc_supplier_normalize_allocations(p_lines jsonb) returns jsonb language plpgsql immutable set search_path=public,pg_temp as $$
declare v jsonb;begin
 if p_lines is null or jsonb_typeof(p_lines)<>'array' or jsonb_array_length(p_lines)>200 then raise exception 'Supply at most 200 allocations';end if;
 if exists(select 1 from jsonb_array_elements(p_lines) l where jsonb_typeof(l)<>'object' or l-array['bill_id','amount_minor']<>'{}' or not(l?&array['bill_id','amount_minor']) or (l->>'amount_minor') !~ '^[0-9]+$' or l->>'amount_minor' is null or (l->>'amount_minor')::numeric<=0) then raise exception 'Every allocation needs bill_id and positive integer amount_minor only';end if;
 select coalesce(jsonb_agg(jsonb_build_object('bill_id',(l->>'bill_id')::uuid,'amount_minor',((l->>'amount_minor')::bigint)::text) order by (l->>'bill_id')::uuid),'[]') into v from jsonb_array_elements(p_lines) l;
 if exists(select 1 from jsonb_array_elements(v) l group by l->>'bill_id' having count(*)>1) then raise exception 'A bill may appear only once in an allocation';end if;
 return v;
end $$;
create function public.acc_supplier_released(p_allocation uuid,p_bill uuid default null,p_as_of date default null) returns bigint language sql stable security definer set search_path=public,pg_temp as $$
 select coalesce(sum(r.amount_minor),0)::bigint from public.acc_supplier_credit_releases r join public.acc_supplier_credits c on c.id=r.credit_id
 where r.allocation_id=p_allocation and(p_bill is null or r.bill_id=p_bill) and
 ((p_as_of is null and c.voided_on is null) or(p_as_of is not null and r.release_date<=p_as_of and(c.voided_on is null or c.voided_on>p_as_of)))
$$;
create function public.acc_supplier_bill_paid(p_bill uuid,p_as_of date default null) returns bigint language sql stable security definer set search_path=public,pg_temp as $$
 select coalesce(sum((l->>'amount_minor')::bigint-public.acc_supplier_released(a.id,p_bill,p_as_of)),0)::bigint from public.acc_supplier_allocations a cross join lateral jsonb_array_elements(a.lines) l
 where l->>'bill_id'=p_bill::text and ((p_as_of is null and a.voided_on is null) or (p_as_of is not null and a.allocation_date<=p_as_of and (a.voided_on is null or a.voided_on>p_as_of)))
$$;
create function public.acc_supplier_bill_credit(p_bill uuid,p_as_of date default null) returns bigint language sql stable security definer set search_path=public,pg_temp as $$
 select coalesce(sum(total_minor),0)::bigint from public.acc_supplier_credits where bill_id=p_bill and ((p_as_of is null and voided_on is null) or (p_as_of is not null and credit_date<=p_as_of and (voided_on is null or voided_on>p_as_of)))
$$;
create function public.acc_supplier_payment_available(p_payment uuid,p_as_of date default null) returns bigint language sql stable security definer set search_path=public,pg_temp as $$
 select p.amount_minor-coalesce((select sum((l->>'amount_minor')::bigint-public.acc_supplier_released(a.id,(l->>'bill_id')::uuid,p_as_of)) from public.acc_supplier_allocations a cross join lateral jsonb_array_elements(a.lines) l where a.payment_id=p.id and ((p_as_of is null and a.voided_on is null) or(p_as_of is not null and a.allocation_date<=p_as_of and(a.voided_on is null or a.voided_on>p_as_of)))),0)::bigint
 -coalesce((select sum(r.amount_minor) from public.acc_supplier_refunds r where r.payment_id=p.id and ((p_as_of is null and r.voided_on is null) or(p_as_of is not null and r.refund_date<=p_as_of and(r.voided_on is null or r.voided_on>p_as_of)))),0)::bigint from public.acc_supplier_payments p where p.id=p_payment
$$;

create function public.post_supplier_bill(p_id uuid,p_supplier_id uuid,p_date date,p_due_date date,p_reference text,p_lines jsonb,p_purchase_order_id uuid default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v public.acc_supplier_bills;v_actor uuid;v_l jsonb;v_lines jsonb:='[]';v_journal jsonb:='[]';v_account public.acc_accounts;v_net bigint:=0;v_tax bigint:=0;v_n bigint;v_t bigint;v_entry uuid:=gen_random_uuid();v_product uuid;v_receipt uuid;v_quantity bigint;
begin
 v_actor:=public.acc_supplier_lock();
 if p_id is null or p_date is null or not isfinite(p_date) or p_due_date is null or not isfinite(p_due_date) or p_due_date<p_date then raise exception 'Bill id and valid bill/due dates are required';end if;
 if length(trim(coalesce(p_reference,''))) not between 1 and 120 then raise exception 'Enter the supplier bill reference (1–120 characters)';end if;
 if p_lines is null or jsonb_typeof(p_lines)<>'array' or jsonb_array_length(p_lines) not between 1 and 198 then raise exception 'A bill needs 1–198 lines';end if;
 for v_l in select * from jsonb_array_elements(p_lines) loop
 if jsonb_typeof(v_l)<>'object' or v_l-array['account_id','net_minor','tax_minor','description','product_id','stock_receipt_id','stock_quantity']<>'{}' or not(v_l?&array['account_id','net_minor','tax_minor']) or coalesce(v_l->>'net_minor','')!~'^[0-9]+$' or coalesce(v_l->>'tax_minor','')!~'^[0-9]+$' then raise exception 'Bill lines need an account and explicit integer net_minor/tax_minor';end if;
 v_n:=(v_l->>'net_minor')::bigint;v_t:=(v_l->>'tax_minor')::bigint;
 if v_n<=0 or length(coalesce(v_l->>'description',''))>300 then raise exception 'Line net must be positive and description at most 300 characters';end if;
 v_product:=nullif(v_l->>'product_id','')::uuid;v_receipt:=nullif(v_l->>'stock_receipt_id','')::uuid;
 if nullif(v_l->>'stock_quantity','') is not null and v_l->>'stock_quantity'!~'^[0-9]+$' then raise exception 'Stock quantity must be a positive whole base-unit quantity';end if;
 v_quantity:=nullif(v_l->>'stock_quantity','')::bigint;
 v_lines:=v_lines||jsonb_build_array(jsonb_build_object('account_id',(v_l->>'account_id')::uuid,'net_minor',v_n::text,'tax_minor',v_t::text,'description',coalesce(v_l->>'description',''),'product_id',v_product,'stock_receipt_id',v_receipt,'stock_quantity',v_quantity::text));
 v_net:=v_net+v_n;v_tax:=v_tax+v_t;
 end loop;
 select * into v from public.acc_supplier_bills where id=p_id;
 if found then
 if v.supplier_id is distinct from p_supplier_id or v.bill_date is distinct from p_date or v.due_date is distinct from p_due_date or v.reference is distinct from trim(p_reference) or v.purchase_order_id is distinct from p_purchase_order_id or v.lines is distinct from v_lines then raise exception 'This bill id was already used for different details';end if;
 return public.acc_supplier_json(to_jsonb(v));end if;
 perform public.acc_supplier_date(p_date);
 if not exists(select 1 from public.suppliers where id=p_supplier_id and active) then raise exception 'Choose an active supplier';end if;
 if p_purchase_order_id is not null and not exists(select 1 from public.purchase_orders where id=p_purchase_order_id and supplier_id=p_supplier_id and currency='TZS' and status in ('ordered','closed')) then raise exception 'Choose an ordered TZS purchase order for this supplier';end if;
 for v_l in select * from jsonb_array_elements(v_lines) loop
 select * into v_account from public.acc_accounts where id=(v_l->>'account_id')::uuid and active;
 if not found or not(v_account.account_type='expense' or v_account.system_key='inventory') then raise exception 'Choose an active expense account or the inventory account';end if;
 if v_account.system_key='inventory' then
 if v_l->>'product_id' is null or v_l->>'stock_receipt_id' is null or coalesce((v_l->>'stock_quantity')::bigint,0)<=0 or to_regclass('public.acc_stock_receipts') is null then raise exception 'Stock bills require a verified receipt, product, base quantity and installed inventory accounting';end if;
 else
 if v_l->>'product_id' is not null or v_l->>'stock_receipt_id' is not null or v_l->>'stock_quantity' is not null then raise exception 'Use the inventory account for stock receipt lines';end if;
 end if;
 v_journal:=v_journal||jsonb_build_array(jsonb_build_object('account_id',v_account.id,'debit_minor',v_l->>'net_minor','description',v_l->>'description'));
 end loop;
 if v_tax>0 then v_journal:=v_journal||jsonb_build_array(jsonb_build_object('account_id',public.acc_account_by_key('vat_input'),'debit_minor',v_tax::text,'description','Input tax explicitly entered'));end if;
 v_journal:=v_journal||jsonb_build_array(jsonb_build_object('account_id',public.acc_account_by_key('payables'),'credit_minor',(v_net+v_tax)::text,'description',trim(p_reference)));
 perform public.acc_post(v_entry,p_date,'Supplier bill '||trim(p_reference),'supplier_bill',p_id,null,v_journal);
 insert into public.acc_supplier_bills(id,bill_number,supplier_id,bill_date,due_date,reference,purchase_order_id,lines,net_minor,tax_minor,total_minor,journal_entry_id,created_by)
 values(p_id,'BILL-'||lpad(nextval('public.acc_supplier_document_seq')::text,8,'0'),p_supplier_id,p_date,p_due_date,trim(p_reference),p_purchase_order_id,v_lines,v_net,v_tax,v_net+v_tax,v_entry,v_actor) returning * into v;
 return public.acc_supplier_json(to_jsonb(v));
end $$;

create function public.allocate_supplier_payment(p_id uuid,p_payment_id uuid,p_date date,p_allocations jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v public.acc_supplier_allocations;v_payment public.acc_supplier_payments;v_bill public.acc_supplier_bills;v_actor uuid;v_lines jsonb;v_l jsonb;v_total bigint:=0;v_amount bigint;
begin
 v_actor:=public.acc_supplier_lock();v_lines:=public.acc_supplier_normalize_allocations(p_allocations);
 if p_id is null or p_date is null or not isfinite(p_date) or jsonb_array_length(v_lines)=0 then raise exception 'Allocation id, valid date and at least one bill are required';end if;
 select * into v from public.acc_supplier_allocations where id=p_id;
 if found then
 if v.payment_id is distinct from p_payment_id or v.allocation_date is distinct from p_date or v.lines is distinct from v_lines then raise exception 'This allocation id was already used for different details';end if;
 return to_jsonb(v);end if;
 perform public.acc_supplier_date(p_date);
 select * into v_payment from public.acc_supplier_payments where id=p_payment_id and voided_on is null;
 if not found or p_date<v_payment.payment_date or (v_payment.opening_cutover_date is not null and p_date<=v_payment.opening_cutover_date) then raise exception 'Choose an active payment and allocation date on/after payment, after opening cutover';end if;
 for v_l in select * from jsonb_array_elements(v_lines) loop
 v_amount:=(v_l->>'amount_minor')::bigint;
 select * into v_bill from public.acc_supplier_bills where id=(v_l->>'bill_id')::uuid and voided_on is null;
 if not found or v_bill.supplier_id<>v_payment.supplier_id then raise exception 'An allocated bill is missing, void or belongs to another supplier';end if;
 if p_date<v_bill.bill_date or (v_bill.opening_cutover_date is not null and p_date<=v_bill.opening_cutover_date) then raise exception 'Allocate on/after the bill date and after any opening cutover';end if;
 if v_amount>v_bill.total_minor-public.acc_supplier_bill_paid(v_bill.id)-public.acc_supplier_bill_credit(v_bill.id) then raise exception 'Allocation exceeds the bill outstanding amount';end if;
 v_total:=v_total+v_amount;
 end loop;
 if v_total>public.acc_supplier_payment_available(p_payment_id) then raise exception 'Allocation exceeds the unapplied supplier payment';end if;
 insert into public.acc_supplier_allocations(id,payment_id,allocation_date,lines,created_by) values(p_id,p_payment_id,p_date,v_lines,v_actor) returning * into v;
 perform public.acc_supplier_validate_timeline(v_payment.supplier_id,p_date);
 return to_jsonb(v);
end $$;

create function public.post_supplier_payment(p_id uuid,p_supplier_id uuid,p_date date,p_amount_minor bigint,p_method text,p_reference text,p_payment_account_id uuid,p_allocations jsonb default '[]')
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v public.acc_supplier_payments;v_actor uuid;v_lines jsonb;v_entry uuid:=gen_random_uuid();
begin
 v_actor:=public.acc_supplier_lock();v_lines:=public.acc_supplier_normalize_allocations(p_allocations);
 if p_id is null or p_date is null or not isfinite(p_date) or p_amount_minor is null or p_amount_minor<=0 or length(coalesce(p_reference,''))>120 then raise exception 'Payment id, valid date, positive amount and reference up to 120 characters are required';end if;
 select * into v from public.acc_supplier_payments where id=p_id;
 if found then
 if v.supplier_id is distinct from p_supplier_id or v.payment_date is distinct from p_date or v.amount_minor is distinct from p_amount_minor or v.method is distinct from p_method or v.reference is distinct from trim(coalesce(p_reference,'')) or v.payment_account_id is distinct from p_payment_account_id or v.requested_allocations is distinct from v_lines then raise exception 'This payment id was already used for different details';end if;
 return public.acc_supplier_json(to_jsonb(v));end if;
 perform public.acc_supplier_date(p_date);perform public.acc_supplier_cash_account(p_payment_account_id,p_method);
 if not exists(select 1 from public.suppliers where id=p_supplier_id and active) then raise exception 'Choose an active supplier';end if;
 perform public.acc_post(v_entry,p_date,'Supplier payment '||trim(coalesce(p_reference,'')),'supplier_payment',p_id,null,jsonb_build_array(jsonb_build_object('account_id',public.acc_account_by_key('payables'),'debit_minor',p_amount_minor::text),jsonb_build_object('account_id',p_payment_account_id,'credit_minor',p_amount_minor::text)));
 insert into public.acc_supplier_payments(id,payment_number,supplier_id,payment_date,amount_minor,method,reference,payment_account_id,requested_allocations,journal_entry_id,created_by)
 values(p_id,'PAY-'||lpad(nextval('public.acc_supplier_document_seq')::text,8,'0'),p_supplier_id,p_date,p_amount_minor,p_method,trim(coalesce(p_reference,'')),p_payment_account_id,v_lines,v_entry,v_actor) returning * into v;
 if jsonb_array_length(v_lines)>0 then perform public.allocate_supplier_payment(p_id,p_id,p_date,v_lines);end if;
 perform public.acc_supplier_validate_timeline(p_supplier_id,p_date);
 return public.acc_supplier_json(to_jsonb(v));
end $$;

create function public.post_supplier_refund(p_id uuid,p_payment_id uuid,p_date date,p_amount_minor bigint,p_method text,p_reference text,p_payment_account_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v public.acc_supplier_refunds;v_payment public.acc_supplier_payments;v_actor uuid;v_entry uuid:=gen_random_uuid();
begin
 v_actor:=public.acc_supplier_lock();
 if p_id is null or p_date is null or not isfinite(p_date) or p_amount_minor is null or p_amount_minor<=0 or length(coalesce(p_reference,''))>120 then raise exception 'Refund id, valid date, positive amount and reference up to 120 characters are required';end if;
 select * into v from public.acc_supplier_refunds where id=p_id;
 if found then
 if v.payment_id is distinct from p_payment_id or v.refund_date is distinct from p_date or v.amount_minor is distinct from p_amount_minor or v.method is distinct from p_method or v.reference is distinct from trim(coalesce(p_reference,'')) or v.payment_account_id is distinct from p_payment_account_id then raise exception 'This refund id was already used for different details';end if;
 return public.acc_supplier_json(to_jsonb(v));end if;
 perform public.acc_supplier_date(p_date);perform public.acc_supplier_cash_account(p_payment_account_id,p_method);
 select * into v_payment from public.acc_supplier_payments where id=p_payment_id and voided_on is null;
 if not found or p_date<v_payment.payment_date or(p_date<=v_payment.opening_cutover_date) then raise exception 'Refund must follow the active payment and any opening cutover';end if;
 if p_amount_minor>public.acc_supplier_payment_available(p_payment_id) then raise exception 'Refund exceeds the unapplied supplier payment';end if;
 perform public.acc_post(v_entry,p_date,'Supplier refund '||trim(coalesce(p_reference,'')),'supplier_refund',p_id,null,jsonb_build_array(jsonb_build_object('account_id',p_payment_account_id,'debit_minor',p_amount_minor::text),jsonb_build_object('account_id',public.acc_account_by_key('payables'),'credit_minor',p_amount_minor::text)));
 insert into public.acc_supplier_refunds(id,refund_number,payment_id,supplier_id,refund_date,amount_minor,method,reference,payment_account_id,journal_entry_id,created_by)
 values(p_id,'REF-'||lpad(nextval('public.acc_supplier_document_seq')::text,8,'0'),p_payment_id,v_payment.supplier_id,p_date,p_amount_minor,p_method,trim(coalesce(p_reference,'')),p_payment_account_id,v_entry,v_actor) returning * into v;
 perform public.acc_supplier_validate_timeline(v_payment.supplier_id,p_date);
 return public.acc_supplier_json(to_jsonb(v));
end $$;

create function public.post_supplier_credit(p_id uuid,p_bill_id uuid,p_date date,p_reference text,p_reason text,p_lines jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v public.acc_supplier_credits;v_bill public.acc_supplier_bills;v_actor uuid;v_l jsonb;v_original jsonb;v_lines jsonb;v_journal jsonb:='[]';v_net bigint:=0;v_tax bigint:=0;v_n bigint;v_t bigint;v_prior_n bigint;v_prior_t bigint;v_entry uuid:=gen_random_uuid();
begin
 v_actor:=public.acc_supplier_lock();
 if p_id is null or p_date is null or not isfinite(p_date) or length(trim(coalesce(p_reference,''))) not between 1 and 120 or length(trim(coalesce(p_reason,''))) not between 5 and 300 then raise exception 'Credit id, valid date, reference and reason (5–300 characters) are required';end if;
 if p_lines is null or jsonb_typeof(p_lines)<>'array' or jsonb_array_length(p_lines) not between 1 and 198 then raise exception 'A credit needs 1–198 original bill lines';end if;
 if exists(select 1 from jsonb_array_elements(p_lines) l where jsonb_typeof(l)<>'object' or l-array['line_no','net_minor','tax_minor','stock_return_id']<>'{}' or not(l?&array['line_no','net_minor','tax_minor']) or coalesce(l->>'line_no','')!~'^[0-9]+$' or coalesce(l->>'net_minor','')!~'^[0-9]+$' or coalesce(l->>'tax_minor','')!~'^[0-9]+$') then raise exception 'Credit lines need original line_no and explicit integer net_minor/tax_minor';end if;
 select jsonb_agg(jsonb_build_object('line_no',(l->>'line_no')::int,'net_minor',((l->>'net_minor')::bigint)::text,'tax_minor',((l->>'tax_minor')::bigint)::text,'stock_return_id',nullif(l->>'stock_return_id','')::uuid) order by (l->>'line_no')::int) into v_lines from jsonb_array_elements(p_lines) l;
 if exists(select 1 from jsonb_array_elements(v_lines) l group by l->>'line_no' having count(*)>1) then raise exception 'A credit may reference each original line only once';end if;
 select * into v from public.acc_supplier_credits where id=p_id;
 if found then
 if v.bill_id is distinct from p_bill_id or v.credit_date is distinct from p_date or v.reference is distinct from trim(p_reference) or v.reason is distinct from trim(p_reason) or v.lines is distinct from v_lines then raise exception 'This credit id was already used for different details';end if;
 return public.acc_supplier_json(to_jsonb(v));end if;
 perform public.acc_supplier_date(p_date);
 select * into v_bill from public.acc_supplier_bills where id=p_bill_id and voided_on is null;
 if not found or v_bill.opening_import_id is not null or p_date<v_bill.bill_date then raise exception 'Choose an active ERP bill and credit date on/after its bill date';end if;
 for v_l in select * from jsonb_array_elements(v_lines) loop
 v_original:=v_bill.lines->((v_l->>'line_no')::int-1);v_n:=(v_l->>'net_minor')::bigint;v_t:=(v_l->>'tax_minor')::bigint;
 if (v_l->>'line_no')::int<1 or v_original is null or v_n+v_t<=0 then raise exception 'Choose an original bill line and a positive credit amount';end if;
 if v_original->>'stock_receipt_id' is not null then
 if v_l->>'stock_return_id' is null or to_regprocedure('public.acc_validate_supplier_stock_credit(uuid,uuid,integer,uuid,bigint,bigint,date)') is null then raise exception 'Stock credits require a verified supplier stock return';end if;
 execute 'select public.acc_validate_supplier_stock_credit($1,$2,$3,$4,$5,$6,$7)' using p_id,p_bill_id,(v_l->>'line_no')::int,(v_l->>'stock_return_id')::uuid,v_n,v_t,p_date;
 elsif v_l->>'stock_return_id' is not null then raise exception 'Expense credits cannot reference a stock return';end if;
 select coalesce(sum((l->>'net_minor')::bigint),0),coalesce(sum((l->>'tax_minor')::bigint),0) into v_prior_n,v_prior_t from public.acc_supplier_credits c cross join lateral jsonb_array_elements(c.lines) l where c.bill_id=p_bill_id and c.voided_on is null and l->>'line_no'=v_l->>'line_no';
 if v_n+v_prior_n>(v_original->>'net_minor')::bigint or v_t+v_prior_t>(v_original->>'tax_minor')::bigint then raise exception 'Credit exceeds original net or input-tax amount';end if;
 v_net:=v_net+v_n;v_tax:=v_tax+v_t;
 if v_n>0 then v_journal:=v_journal||jsonb_build_array(jsonb_build_object('account_id',v_original->>'account_id','credit_minor',v_n::text,'description',trim(p_reference)));end if;
 end loop;
 if v_tax>0 then v_journal:=v_journal||jsonb_build_array(jsonb_build_object('account_id',public.acc_account_by_key('vat_input'),'credit_minor',v_tax::text));end if;
 v_journal:=v_journal||jsonb_build_array(jsonb_build_object('account_id',public.acc_account_by_key('payables'),'debit_minor',(v_net+v_tax)::text));
 perform public.acc_post(v_entry,p_date,'Supplier credit '||trim(p_reference),'supplier_credit',p_id,null,v_journal);
 insert into public.acc_supplier_credits(id,credit_number,bill_id,supplier_id,credit_date,reference,reason,lines,net_minor,tax_minor,total_minor,journal_entry_id,created_by)
 values(p_id,'SCN-'||lpad(nextval('public.acc_supplier_document_seq')::text,8,'0'),p_bill_id,v_bill.supplier_id,p_date,trim(p_reference),trim(p_reason),v_lines,v_net,v_tax,v_net+v_tax,v_entry,v_actor) returning * into v;
 perform public.acc_supplier_release_credit(p_id);
 perform public.acc_supplier_validate_timeline(v_bill.supplier_id,p_date);
 return public.acc_supplier_json(to_jsonb(v));
end $$;

create function public.acc_supplier_release_credit(p_credit uuid) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare v_credit public.acc_supplier_credits;v_bill public.acc_supplier_bills;v_date date;v_excess bigint;v_row record;v_release bigint;
begin
 select * into strict v_credit from public.acc_supplier_credits where id=p_credit;
 select * into strict v_bill from public.acc_supplier_bills where id=v_credit.bill_id;
 for v_date in select distinct d from (
 select v_credit.credit_date d
 union all select a.allocation_date from public.acc_supplier_allocations a cross join lateral jsonb_array_elements(a.lines) l where l->>'bill_id'=v_bill.id::text
 union all select a.voided_on from public.acc_supplier_allocations a cross join lateral jsonb_array_elements(a.lines) l where l->>'bill_id'=v_bill.id::text
 union all select credit_date from public.acc_supplier_credits where bill_id=v_bill.id
 union all select voided_on from public.acc_supplier_credits where bill_id=v_bill.id
 ) dates where d>=v_credit.credit_date order by d loop
 v_excess:=public.acc_supplier_bill_paid(v_bill.id,v_date)+public.acc_supplier_bill_credit(v_bill.id,v_date)-v_bill.total_minor;
 if v_excess<=0 then continue;end if;
 for v_row in select a.id,(l->>'amount_minor')::bigint-public.acc_supplier_released(a.id,v_bill.id,v_date) available
 from public.acc_supplier_allocations a cross join lateral jsonb_array_elements(a.lines) l
 where l->>'bill_id'=v_bill.id::text and a.allocation_date<=v_date and(a.voided_on is null or a.voided_on>v_date) order by a.allocation_date desc,a.id loop
 v_release:=least(v_excess,v_row.available);if v_release<=0 then continue;end if;
 insert into public.acc_supplier_credit_releases(credit_id,allocation_id,bill_id,release_date,amount_minor,created_by) values(p_credit,v_row.id,v_bill.id,v_date,v_release,auth.uid());
 v_excess:=v_excess-v_release;exit when v_excess=0;
 end loop;
 if v_excess>0 then raise exception 'Supplier credit exceeds the original bill on %',v_date;end if;
 end loop;
end $$;

-- Recheck future effective-date boundaries after backdated settlements or reversals.
-- A later reversal may free current funds while those funds remain committed at an earlier date.
create function public.acc_supplier_validate_timeline(p_supplier uuid,p_from date) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare v_date date;v_id uuid;
begin
 for v_date in select distinct d from (
 select p_from d union all select bill_date from public.acc_supplier_bills where supplier_id=p_supplier
 union all select opening_cutover_date from public.acc_supplier_bills where supplier_id=p_supplier
 union all select voided_on from public.acc_supplier_bills where supplier_id=p_supplier
 union all select payment_date from public.acc_supplier_payments where supplier_id=p_supplier
 union all select voided_on from public.acc_supplier_payments where supplier_id=p_supplier
 union all select credit_date from public.acc_supplier_credits where supplier_id=p_supplier
 union all select voided_on from public.acc_supplier_credits where supplier_id=p_supplier
 union all select refund_date from public.acc_supplier_refunds where supplier_id=p_supplier
 union all select voided_on from public.acc_supplier_refunds where supplier_id=p_supplier
 union all select a.allocation_date from public.acc_supplier_allocations a join public.acc_supplier_payments p on p.id=a.payment_id where p.supplier_id=p_supplier
 union all select a.voided_on from public.acc_supplier_allocations a join public.acc_supplier_payments p on p.id=a.payment_id where p.supplier_id=p_supplier
 ) dates where d>=p_from order by d loop
 select b.id into v_id from public.acc_supplier_bills b where b.supplier_id=p_supplier and
 public.acc_supplier_bill_paid(b.id,v_date)+public.acc_supplier_bill_credit(b.id,v_date)>
 case when b.bill_date<=v_date and (b.opening_cutover_date is null or b.opening_cutover_date<=v_date) and (b.voided_on is null or b.voided_on>v_date) then b.total_minor else 0 end limit 1;
 if found then raise exception 'Supplier bill % would be overallocated or settled while void on %',v_id,v_date;end if;
 select p.id into v_id from public.acc_supplier_payments p where p.supplier_id=p_supplier and
 p.amount_minor-public.acc_supplier_payment_available(p.id,v_date)>
 case when p.payment_date<=v_date and (p.voided_on is null or p.voided_on>v_date) then p.amount_minor else 0 end limit 1;
 if found then raise exception 'Supplier payment % would be overallocated or used while void on %',v_id,v_date;end if;
 select b.id into v_id from public.acc_supplier_bills b cross join lateral jsonb_array_elements(b.lines) with ordinality original(line,no)
 cross join lateral(select coalesce(sum((l->>'net_minor')::bigint),0) net,coalesce(sum((l->>'tax_minor')::bigint),0) tax
 from public.acc_supplier_credits c cross join lateral jsonb_array_elements(c.lines) l where c.bill_id=b.id and c.credit_date<=v_date and(c.voided_on is null or c.voided_on>v_date) and(l->>'line_no')::int=original.no) credited
 where b.supplier_id=p_supplier and(credited.net>(original.line->>'net_minor')::bigint or credited.tax>(original.line->>'tax_minor')::bigint) limit 1;
 if found then raise exception 'Supplier credit exceeds original line net or tax on %',v_date;end if;
 end loop;
end $$;

create function public.acc_void_supplier_record(p_kind text,p_id uuid,p_date date,p_reason text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v jsonb;v_table text;v_date date;v_supplier uuid;v_actor uuid;v_rev uuid;v_alloc record;
begin
 v_actor:=public.acc_supplier_lock();
 if p_id is null or p_date is null or not isfinite(p_date) or length(trim(coalesce(p_reason,''))) not between 5 and 300 then raise exception 'Record, valid date and reason (5–300 characters) are required';end if;
 v_table:=case p_kind when 'bill' then 'acc_supplier_bills' when 'payment' then 'acc_supplier_payments' when 'allocation' then 'acc_supplier_allocations' when 'credit' then 'acc_supplier_credits' when 'refund' then 'acc_supplier_refunds' end;
 if v_table is null then raise exception 'Unsupported supplier correction';end if;
 execute format('select to_jsonb(r) from public.%I r where id=$1',v_table) into v using p_id;
 if v is null then raise exception 'Supplier record not found';end if;
 if v->>'voided_on' is not null then
 if (v->>'voided_on')::date is distinct from p_date or v->>'void_reason' is distinct from trim(p_reason) then raise exception 'This correction was already posted with different details';end if;
 return public.acc_supplier_json(v);end if;
 if v->>'opening_import_id' is not null then raise exception 'Correct the opening schedule as a whole before any settlement';end if;
 perform public.acc_supplier_date(p_date);
 v_date:=(v->>(p_kind||'_date'))::date;
 if p_date<v_date then raise exception 'A correction cannot precede its original accounting date';end if;
 v_supplier:=(v->>'supplier_id')::uuid;
 if p_kind='allocation' then select supplier_id into v_supplier from public.acc_supplier_payments where id=(v->>'payment_id')::uuid;end if;
 if p_kind='bill' and (public.acc_supplier_bill_paid(p_id)>0 or public.acc_supplier_bill_credit(p_id)>0) then raise exception 'Void this bill payment allocations and supplier credits first';end if;
 if p_kind='payment' then
 if exists(select 1 from public.acc_supplier_refunds where payment_id=p_id and voided_on is null) then raise exception 'Void this payment refunds first';end if;
 for v_alloc in select id from public.acc_supplier_allocations where payment_id=p_id and voided_on is null order by id loop
 perform public.acc_void_supplier_record('allocation',v_alloc.id,p_date,p_reason);
 end loop;
 end if;
 if p_kind='credit' and exists(select 1 from jsonb_array_elements(v->'lines') l where l->>'stock_return_id' is not null) then
 if to_regprocedure('public.acc_void_supplier_stock_credit(uuid,date,text)') is null then raise exception 'Stock credit reversal requires the inventory return correction workflow';end if;
 execute 'select public.acc_void_supplier_stock_credit($1,$2,$3)' using p_id,p_date,trim(p_reason);
 end if;
 if v->>'journal_entry_id' is not null then
 v_rev:=gen_random_uuid();perform public.acc_reverse(v_rev,(v->>'journal_entry_id')::uuid,p_date,'Void supplier '||p_kind||': '||trim(p_reason));end if;
 execute format('update public.%I set voided_on=$2,voided_at=now(),voided_by=$3,void_reason=$4,void_entry_id=$5 where id=$1 returning to_jsonb(%I)',v_table,v_table)
 into v using p_id,p_date,v_actor,trim(p_reason),v_rev;
 perform public.acc_supplier_validate_timeline(v_supplier,p_date);
 return public.acc_supplier_json(v);
end $$;
create function public.void_supplier_bill(p_bill_id uuid,p_date date,p_reason text) returns jsonb language sql security definer set search_path=public,pg_temp as $$select public.acc_void_supplier_record('bill',p_bill_id,p_date,p_reason)$$;
create function public.void_supplier_payment(p_payment_id uuid,p_date date,p_reason text) returns jsonb language sql security definer set search_path=public,pg_temp as $$select public.acc_void_supplier_record('payment',p_payment_id,p_date,p_reason)$$;
create function public.void_supplier_allocation(p_allocation_id uuid,p_date date,p_reason text) returns jsonb language sql security definer set search_path=public,pg_temp as $$select public.acc_void_supplier_record('allocation',p_allocation_id,p_date,p_reason)$$;
create function public.void_supplier_refund(p_refund_id uuid,p_date date,p_reason text) returns jsonb language sql security definer set search_path=public,pg_temp as $$select public.acc_void_supplier_record('refund',p_refund_id,p_date,p_reason)$$;
create function public.void_supplier_credit(p_credit_id uuid,p_date date,p_reason text) returns jsonb language sql security definer set search_path=public,pg_temp as $$select public.acc_void_supplier_record('credit',p_credit_id,p_date,p_reason)$$;

create function public.get_supplier_books_page(p_as_of date default current_date,p_supplier_id uuid default null,p_bill_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_bills jsonb;v_payments jsonb;v_ageing jsonb;v_gl numeric;v_balance numeric;v_unapplied numeric;
begin
 perform public.acc_require_access();
 if p_as_of is null or not isfinite(p_as_of) then raise exception 'Choose a valid report date';end if;
 select coalesce(jsonb_agg(public.acc_supplier_json(to_jsonb(x)) order by x.bill_date desc,x.bill_number desc),'[]') into v_bills from (
 select b.*,s.name supplier,public.acc_supplier_bill_paid(b.id,p_as_of) paid_minor,public.acc_supplier_bill_credit(b.id,p_as_of) credited_minor,
 case when b.voided_on<=p_as_of then 0 else b.total_minor-public.acc_supplier_bill_paid(b.id,p_as_of)-public.acc_supplier_bill_credit(b.id,p_as_of) end outstanding_minor,
 case when b.voided_on<=p_as_of then 'void' when b.total_minor=public.acc_supplier_bill_paid(b.id,p_as_of)+public.acc_supplier_bill_credit(b.id,p_as_of) then 'paid' when b.due_date<p_as_of then 'overdue' when public.acc_supplier_bill_paid(b.id,p_as_of)+public.acc_supplier_bill_credit(b.id,p_as_of)>0 then 'part' else 'open' end status_key
 from public.acc_supplier_bills b join public.suppliers s on s.id=b.supplier_id where b.bill_date<=p_as_of and(b.opening_cutover_date is null or b.opening_cutover_date<=p_as_of) and(p_supplier_id is null or b.supplier_id=p_supplier_id) and(p_bill_id is null or b.id=p_bill_id)
 ) x;
 select coalesce(jsonb_agg(public.acc_supplier_json(to_jsonb(x)) order by x.payment_date desc,x.payment_number desc),'[]') into v_payments from (
 select p.*,s.name supplier,case when p.voided_on<=p_as_of then 0 else public.acc_supplier_payment_available(p.id,p_as_of) end unapplied_minor
 from public.acc_supplier_payments p join public.suppliers s on s.id=p.supplier_id where p.payment_date<=p_as_of and(p_supplier_id is null or p.supplier_id=p_supplier_id)
 ) x;
 with balances as(
 select b.supplier_id,b.due_date,b.total_minor-public.acc_supplier_bill_paid(b.id,p_as_of)-public.acc_supplier_bill_credit(b.id,p_as_of) amount
 from public.acc_supplier_bills b where b.bill_date<=p_as_of and(b.opening_cutover_date is null or b.opening_cutover_date<=p_as_of) and(b.voided_on is null or b.voided_on>p_as_of) and(p_supplier_id is null or b.supplier_id=p_supplier_id)
 ), bucket as(
 select supplier_id,sum(case when due_date>=p_as_of then amount else 0 end) current_minor,sum(case when p_as_of-due_date between 1 and 30 then amount else 0 end) days_1_30_minor,
 sum(case when p_as_of-due_date between 31 and 60 then amount else 0 end) days_31_60_minor,sum(case when p_as_of-due_date between 61 and 90 then amount else 0 end) days_61_90_minor,sum(case when p_as_of-due_date>90 then amount else 0 end) days_over_90_minor,sum(amount) outstanding_minor from balances group by supplier_id
 ), credits as(
 select supplier_id,sum(public.acc_supplier_payment_available(id,p_as_of)) unapplied_minor from public.acc_supplier_payments where payment_date<=p_as_of and(voided_on is null or voided_on>p_as_of) and(p_supplier_id is null or supplier_id=p_supplier_id) group by supplier_id
 ),rows as(
 select s.id supplier_id,s.name supplier,coalesce(b.current_minor,0)::text current_minor,coalesce(b.days_1_30_minor,0)::text days_1_30_minor,coalesce(b.days_31_60_minor,0)::text days_31_60_minor,coalesce(b.days_61_90_minor,0)::text days_61_90_minor,coalesce(b.days_over_90_minor,0)::text days_over_90_minor,coalesce(c.unapplied_minor,0)::text unapplied_credit_minor,(coalesce(b.outstanding_minor,0)-coalesce(c.unapplied_minor,0))::text balance_minor
 from public.suppliers s left join bucket b on b.supplier_id=s.id left join credits c on c.supplier_id=s.id where coalesce(b.outstanding_minor,0)<>0 or coalesce(c.unapplied_minor,0)<>0
 ) select coalesce(jsonb_agg(to_jsonb(r) order by r.balance_minor::numeric desc,r.supplier,r.supplier_id),'[]') into v_ageing from rows r;
 select coalesce(sum((r->>'balance_minor')::numeric),0),coalesce(sum((r->>'unapplied_credit_minor')::numeric),0) into v_balance,v_unapplied from jsonb_array_elements(v_ageing) r;
 select coalesce(sum(l.credit_minor-l.debit_minor),0) into v_gl from public.acc_journal_lines l join public.acc_journal_entries e on e.id=l.entry_id join public.acc_accounts a on a.id=l.account_id where a.system_key='payables' and e.entry_date<=p_as_of;
 return jsonb_build_object('as_of',p_as_of,'bills',v_bills,'payments',v_payments,'ageing',v_ageing,
 'suppliers',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'supplier_number',supplier_number,'active',active) order by name,id),'[]') from public.suppliers),
 'accounts',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'code',code,'name',name,'account_type',account_type,'system_key',system_key) order by code),'[]') from public.acc_accounts where active and(account_type='expense' or system_key='inventory' or(account_type='asset' and system_key is distinct from 'receivables' and code ~ '^1[12][0-9]{2}$'))),
 'credits',(select coalesce(jsonb_agg(public.acc_supplier_json(to_jsonb(c)) order by credit_date desc,credit_number desc),'[]') from public.acc_supplier_credits c where credit_date<=p_as_of and(p_supplier_id is null or supplier_id=p_supplier_id)),
 'refunds',(select coalesce(jsonb_agg(public.acc_supplier_json(to_jsonb(r)) order by refund_date desc,refund_number desc),'[]') from public.acc_supplier_refunds r where refund_date<=p_as_of and(p_supplier_id is null or supplier_id=p_supplier_id)),
 'allocations',(select coalesce(jsonb_agg(to_jsonb(a) order by allocation_date desc,a.id),'[]') from public.acc_supplier_allocations a join public.acc_supplier_payments p on p.id=a.payment_id where allocation_date<=p_as_of and(p_supplier_id is null or p.supplier_id=p_supplier_id)),
 'credit_releases',(select coalesce(jsonb_agg(public.acc_supplier_json(to_jsonb(r)) order by release_date,r.credit_id,r.allocation_id),'[]') from public.acc_supplier_credit_releases r join public.acc_supplier_bills b on b.id=r.bill_id where release_date<=p_as_of and(p_supplier_id is null or b.supplier_id=p_supplier_id)),
 'opening_imports',(select coalesce(jsonb_agg(public.acc_supplier_json(to_jsonb(o)) order by created_at desc),'[]') from public.acc_opening_payable_imports o),
 'opening_gl_imports',(select coalesce(jsonb_agg(jsonb_build_object('id',f.id,'source',f.source,'created_at',f.created_at) order by f.created_at desc),'[]') from public.acc_financial_imports f where import_kind='opening'),
 'summary',jsonb_build_object('balance_minor',v_balance::text,'unapplied_credit_minor',v_unapplied::text,'control_payables_minor',v_gl::text,'difference_minor',case when p_supplier_id is null then (v_gl-v_balance)::text else null end,'reconciled',case when p_supplier_id is null then v_gl=v_balance else null end));
end $$;

create function public.opening_payables_check(p_source text,p_cutover date,p_gl_import_id uuid,p_rows jsonb)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_source text:=lower(trim(coalesce(p_source,'')));v_prior public.acc_opening_payable_imports;v_row jsonb;v_total numeric:=0;v_imported numeric;v_gl numeric;v_sub numeric;v_amount bigint;v_refs text[]:='{}';v_key text;v_date date;v_due date;v_lock date;
begin
 perform public.acc_require_access();
 if length(v_source) not between 1 and 80 or p_cutover is null or not isfinite(p_cutover) or p_cutover>current_date then raise exception 'Source (1–80 characters) and valid cutover no later than today are required';end if;
 if p_rows is null or jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows) not between 1 and 1000 or octet_length(p_rows::text)>1048576 then raise exception 'Supply 1–1000 opening rows, at most 1 MB';end if;
 select * into v_prior from public.acc_opening_payable_imports where gl_import_id=p_gl_import_id and voided_on is null;
 if found and (v_prior.source is distinct from v_source or v_prior.cutover_date is distinct from p_cutover or v_prior.rows is distinct from p_rows) then raise exception 'This opening GL already has a different supplier schedule';end if;
 select locked_through into v_lock from public.acc_settings where id;
 if v_prior.id is null and p_cutover<=v_lock then raise exception 'The books are locked through %',v_lock;end if;
 if not exists(select 1 from public.acc_financial_imports where id=p_gl_import_id and import_kind='opening') or not exists(select 1 from public.acc_imported_journals where import_id=p_gl_import_id) or exists(select 1 from public.acc_imported_journals j join public.acc_journal_entries e on e.id=j.entry_id where j.import_id=p_gl_import_id and(e.entry_date<>p_cutover or exists(select 1 from public.acc_journal_entries r where r.reverses_entry_id=e.id))) then raise exception 'Choose unreversed opening GL journals dated exactly at cutover';end if;
 for v_row in select * from jsonb_array_elements(p_rows) loop
 if jsonb_typeof(v_row)<>'object' or v_row-array['reference','supplier_id','bill_date','due_date','amount_minor','currency']<>'{}' or not(v_row?&array['reference','supplier_id','bill_date','due_date','amount_minor','currency']) then raise exception 'Opening rows need reference,supplier_id,bill_date,due_date,amount_minor,currency only';end if;
 if length(trim(coalesce(v_row->>'reference',''))) not between 1 and 120 or v_row->>'currency' is distinct from 'TZS' or coalesce(v_row->>'amount_minor','')!~'^-?[0-9]+$' or coalesce(v_row->>'bill_date','')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or coalesce(v_row->>'due_date','')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception 'Use TZS, exact integer amounts, a reference and YYYY-MM-DD dates';end if;
 v_amount:=(v_row->>'amount_minor')::bigint;v_date:=(v_row->>'bill_date')::date;v_due:=(v_row->>'due_date')::date;
 if v_amount=0 or v_amount='-9223372036854775808'::bigint or v_date>p_cutover or v_due<v_date then raise exception 'Opening amount must be nonzero, bill date on/before cutover and due date on/after bill';end if;
 if not exists(select 1 from public.suppliers where id=(v_row->>'supplier_id')::uuid and active) then raise exception 'Choose an active supplier for every opening row';end if;
 v_key:=(v_row->>'supplier_id')::uuid::text||':'||lower(trim(v_row->>'reference'));
 if v_key=any(v_refs) then raise exception 'Opening supplier/reference rows must be unique';end if;v_refs:=v_refs||v_key;v_total:=v_total+v_amount;
 end loop;
 select coalesce(sum(l.credit_minor-l.debit_minor),0) into v_imported from public.acc_imported_journals j join public.acc_journal_lines l on l.entry_id=j.entry_id join public.acc_accounts a on a.id=l.account_id where j.import_id=p_gl_import_id and a.system_key='payables';
 if v_total<>v_imported then raise exception 'Opening schedule % differs from imported GL payables % (minor TZS)',v_total,v_imported;end if;
 select coalesce(sum(l.credit_minor-l.debit_minor),0) into v_gl from public.acc_journal_lines l join public.acc_journal_entries e on e.id=l.entry_id join public.acc_accounts a on a.id=l.account_id where e.entry_date<=p_cutover and a.system_key='payables';
 v_sub:=((public.get_supplier_books_page(p_cutover)->'summary'->>'balance_minor')::numeric)+case when v_prior.id is null then v_total else 0 end;
 if v_gl<>v_sub then raise exception 'Payables reconciliation failed: control %, supplier schedule after import % (minor TZS)',v_gl,v_sub;end if;
 return jsonb_build_object('gl_import_id',p_gl_import_id,'cutover_date',p_cutover,'imported_gl_payables_minor',v_imported::text,'opening_residual_minor',v_total::text,'control_payables_minor',v_gl::text,'supplier_subledger_minor',v_sub::text,'difference_minor',(v_gl-v_sub)::text,'reconciled',true,'already_imported',v_prior.id is not null,'row_count',jsonb_array_length(p_rows));
end $$;

create function public.import_opening_payables(p_id uuid,p_source text,p_cutover date,p_gl_import_id uuid,p_rows jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_actor uuid;v_prior public.acc_opening_payable_imports;v_check jsonb;v_row jsonb;v_id uuid;v_bills jsonb:='[]';v_payments jsonb:='[]';v_result jsonb;v_amount bigint;v_source text:=lower(trim(coalesce(p_source,'')));
begin
 v_actor:=public.acc_supplier_lock();if p_id is null then raise exception 'Opening import id is required';end if;
 select * into v_prior from public.acc_opening_payable_imports where id=p_id or(gl_import_id=p_gl_import_id and voided_on is null) order by(id=p_id) desc limit 1;
 if found then
 if v_prior.id is distinct from p_id or v_prior.source is distinct from v_source or v_prior.cutover_date is distinct from p_cutover or v_prior.gl_import_id is distinct from p_gl_import_id or v_prior.rows is distinct from p_rows then raise exception 'This opening identity was already used for different details';end if;
 return v_prior.result;end if;
 lock table public.acc_journal_entries in share mode;
 perform public.acc_supplier_date(p_cutover);
 v_check:=public.opening_payables_check(p_source,p_cutover,p_gl_import_id,p_rows);
 for v_row in select * from jsonb_array_elements(p_rows) loop
 v_id:=gen_random_uuid();v_amount:=(v_row->>'amount_minor')::bigint;
 if v_amount>0 then
 insert into public.acc_supplier_bills(id,bill_number,supplier_id,bill_date,due_date,reference,lines,net_minor,tax_minor,total_minor,opening_import_id,opening_cutover_date,created_by)
 values(v_id,'OPEN-BILL-'||lpad(nextval('public.acc_supplier_document_seq')::text,8,'0'),(v_row->>'supplier_id')::uuid,(v_row->>'bill_date')::date,(v_row->>'due_date')::date,trim(v_row->>'reference'),'[]',v_amount,0,v_amount,p_id,p_cutover,v_actor);
 v_bills:=v_bills||jsonb_build_array(jsonb_build_object('reference',trim(v_row->>'reference'),'bill_id',v_id));
 else
 insert into public.acc_supplier_payments(id,payment_number,supplier_id,payment_date,amount_minor,method,reference,opening_import_id,opening_cutover_date,created_by)
 values(v_id,'OPEN-ADV-'||lpad(nextval('public.acc_supplier_document_seq')::text,8,'0'),(v_row->>'supplier_id')::uuid,p_cutover,-v_amount,'opening',trim(v_row->>'reference'),p_id,p_cutover,v_actor);
 v_payments:=v_payments||jsonb_build_array(jsonb_build_object('reference',trim(v_row->>'reference'),'payment_id',v_id));end if;
 end loop;
 v_result:=v_check||jsonb_build_object('batch_id',p_id,'imported_count',jsonb_array_length(p_rows),'bills',v_bills,'payments',v_payments);
 insert into public.acc_opening_payable_imports(id,source,cutover_date,gl_import_id,rows,result,created_by) values(p_id,v_source,p_cutover,p_gl_import_id,p_rows,v_result,v_actor);
 return v_result;
end $$;

-- A same-net correction atomically replaces an unused schedule; the imported opening GL stays intact.
create function public.correct_opening_payables(p_id uuid,p_import_id uuid,p_rows jsonb,p_reason text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_actor uuid;v_old public.acc_opening_payable_imports;v_new public.acc_opening_payable_imports;v_result jsonb;
begin
 v_actor:=public.acc_supplier_lock();
 if p_id is null or p_id=p_import_id or length(trim(coalesce(p_reason,''))) not between 5 and 300 then raise exception 'New correction id and reason (5–300 characters) are required';end if;
 select * into v_old from public.acc_opening_payable_imports where id=p_import_id;
 if not found then raise exception 'Opening supplier schedule not found';end if;
 select * into v_new from public.acc_opening_payable_imports where id=p_id;
 if found then
 if v_old.voided_on is null or v_old.void_reason is distinct from trim(p_reason)||' [replacement '||p_id::text||']' or v_new.gl_import_id is distinct from v_old.gl_import_id or v_new.rows is distinct from p_rows then raise exception 'This opening correction id was already used for different details';end if;
 return v_new.result;end if;
 if v_old.voided_on is not null then raise exception 'This opening schedule has already been replaced';end if;
 perform public.acc_supplier_date(v_old.cutover_date);
 if exists(select 1 from public.acc_supplier_allocations a cross join lateral jsonb_array_elements(a.lines) l join public.acc_supplier_bills b on b.id=(l->>'bill_id')::uuid where b.opening_import_id=p_import_id)
 or exists(select 1 from public.acc_supplier_payments p where p.opening_import_id=p_import_id and(exists(select 1 from public.acc_supplier_allocations a where a.payment_id=p.id) or exists(select 1 from public.acc_supplier_refunds r where r.payment_id=p.id))) then raise exception 'Opening schedules with settlement history cannot be replaced; reconcile a dated accounting correction';end if;
 update public.acc_supplier_bills set voided_on=v_old.cutover_date,voided_at=now(),voided_by=v_actor,void_reason=trim(p_reason) where opening_import_id=p_import_id;
 update public.acc_supplier_payments set voided_on=v_old.cutover_date,voided_at=now(),voided_by=v_actor,void_reason=trim(p_reason) where opening_import_id=p_import_id;
 update public.acc_opening_payable_imports set voided_on=cutover_date,voided_at=now(),voided_by=v_actor,void_reason=trim(p_reason)||' [replacement '||p_id::text||']' where id=p_import_id;
 v_result:=public.import_opening_payables(p_id,v_old.source,v_old.cutover_date,v_old.gl_import_id,p_rows);
 return v_result;
end $$;

-- Prevent bypassing AP through ordinary journals and protect the imported GL behind the schedule.
do $$ declare v text;needle text;begin
 v:=pg_get_functiondef('public.post_manual_journal(uuid,date,text,jsonb)'::regprocedure);
 needle:=' return public.acc_post(p_id,p_date,p_memo,''manual'',null,null,p_lines);';
 if strpos(v,needle)=0 then raise exception 'Manual journal AP guard insertion point changed';end if;
 execute replace(v,needle,' if exists(select 1 from jsonb_array_elements(v_requested) l join public.acc_accounts a on a.id=(l->>''account_id'')::uuid where a.system_key=''payables'') then raise exception ''Use supplier bills, payments or opening payables for the payables control account'';end if;'||chr(10)||needle);
 v:=pg_get_functiondef('public.reverse_journal_entry(uuid,uuid,date,text)'::regprocedure);
 needle:=' return public.acc_reverse(p_id,p_entry_id,p_date,p_reason);';
 if strpos(v,needle)=0 then raise exception 'Opening AP reversal guard insertion point changed';end if;
 execute replace(v,needle,' if exists(select 1 from public.acc_imported_journals j join public.acc_opening_payable_imports o on o.gl_import_id=j.import_id where j.entry_id=p_entry_id and o.voided_on is null) then raise exception ''Opening journals with attached supplier schedules cannot be reversed'';end if;'||chr(10)||needle);
end $$;

-- Internal helpers never become public RPCs. Only the named authorized actions are exposed.
do $$ declare f record;begin
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and(p.proname like 'acc_supplier_%' or p.proname='acc_void_supplier_record' or p.proname in ('post_supplier_bill','post_supplier_payment','post_supplier_refund','post_supplier_credit','allocate_supplier_payment','void_supplier_bill','void_supplier_payment','void_supplier_allocation','void_supplier_refund','void_supplier_credit','get_supplier_books_page','opening_payables_check','import_opening_payables','correct_opening_payables')) loop
 execute format('revoke all on function %s from public,anon,authenticated',f.signature);
 end loop;
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('post_supplier_bill','post_supplier_payment','post_supplier_refund','post_supplier_credit','allocate_supplier_payment','void_supplier_bill','void_supplier_payment','void_supplier_allocation','void_supplier_refund','void_supplier_credit','get_supplier_books_page','opening_payables_check','import_opening_payables','correct_opening_payables') loop
 execute format('grant execute on function %s to authenticated',f.signature);
 end loop;
end $$;
commit;
