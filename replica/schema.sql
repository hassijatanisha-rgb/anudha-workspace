-- General ledger foundation: milestone M1 of replica/architecture.md (TallyPrime accounting rebuild).
-- Additive. Seeds only reference data: the 28 standard groups, the Cash ledger, the standard voucher types and the
-- VAT classes at 18% (rate confirmed by Anudha on 2026-10-06). No ledgers, balances, parties or vouchers are invented.
-- Every posted voucher is immutable and balanced (debits = credits, enforced at commit). Corrections are reversals.
-- Amounts are signed integer TZS minor units: debit positive, credit negative.
-- Status: design file, not yet a migration. It becomes supabase/migrations/<date>_general_ledger.sql after the
-- accountant confirms the groups against Anudha's TallyPrime company. Rollback: revoke the RPCs; keep rows as evidence.
begin;

-- Owner or enrolled accounts staff (accounting_memberships). Reads and writes both use it.
create function public.ledger_staff() returns boolean
language sql stable security definer set search_path=public,pg_temp as $$ select public.inventory_owner() or public.accounting_access() $$;

create table public.fiscal_years (
 id uuid primary key,
 name text not null unique check (length(trim(name)) between 4 and 40),
 starts_on date not null,
 ends_on date not null,
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(),
 check (ends_on > starts_on and ends_on < starts_on + 400),
 exclude using gist (daterange(starts_on, ends_on, '[]') with &&)
);

-- Append-only. The latest row is the lock in force: nothing on or before through_date can be posted.
create table public.ledger_period_locks (
 id uuid primary key default gen_random_uuid(),
 through_date date not null,
 reason text not null check (length(trim(reason)) between 5 and 500),
 locked_by uuid not null references auth.users(id),
 locked_at timestamptz not null default clock_timestamp()
);
create index ledger_period_locks_latest on public.ledger_period_locks(locked_at desc);

create table public.account_groups (
 id uuid primary key,
 code text unique,
 name text not null check (length(trim(name)) between 2 and 120),
 parent_id uuid references public.account_groups(id) on delete restrict,
 nature text not null check (nature in ('asset','liability','income','expense')),
 affects_gross_profit boolean not null default false,
 is_predefined boolean not null default false,
 sort integer not null default 1000,
 version integer not null default 1 check (version > 0),
 created_by uuid references auth.users(id),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 check (is_predefined = (code is not null)),
 check (is_predefined or created_by is not null),
 check (parent_id is distinct from id)
);
create unique index account_groups_name on public.account_groups(lower(name));
create index account_groups_parent on public.account_groups(parent_id);

create table public.ledgers (
 id uuid primary key,
 code text unique,
 name text not null check (length(trim(name)) between 2 and 200),
 group_id uuid not null references public.account_groups(id) on delete restrict,
 is_predefined boolean not null default false,
 bill_wise boolean not null default false,
 credit_days integer not null default 0 check (credit_days between 0 and 3650),
 credit_limit_minor bigint check (credit_limit_minor is null or credit_limit_minor >= 0),
 organization_id uuid references public.organizations(id) on delete restrict,
 supplier_id uuid references public.suppliers(id) on delete restrict,
 -- Sales/purchase ledgers carry the VAT class of what is sold or bought; Duties & Taxes ledgers carry a VAT role.
 vat_class text check (vat_class in ('standard','zero','exempt','out_of_scope')),
 vat_role text not null default '' check (vat_role in ('','output','input')),
 tin text not null default '' check (length(tin) <= 30),
 vrn text not null default '' check (length(vrn) <= 30),
 bank_details jsonb not null default '{}' check (jsonb_typeof(bank_details) = 'object'),
 active boolean not null default true,
 version integer not null default 1 check (version > 0),
 created_by uuid references auth.users(id),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 check (is_predefined = (code is not null)),
 check (is_predefined or created_by is not null),
 check (organization_id is null or supplier_id is null),
 check (vat_role = '' or vat_class is null)
);
create unique index ledgers_name on public.ledgers(lower(name));
create unique index ledgers_organization on public.ledgers(organization_id) where organization_id is not null;
create unique index ledgers_supplier on public.ledgers(supplier_id) where supplier_id is not null;
create index ledgers_group on public.ledgers(group_id);

create table public.voucher_types (
 id uuid primary key,
 code text unique,
 name text not null check (length(trim(name)) between 2 and 80),
 base_type text not null check (base_type in ('opening','sales','purchase','payment','receipt','contra','journal','credit_note','debit_note')),
 numbering text not null default 'auto' check (numbering in ('auto','manual')),
 prefix text not null default '' check (length(prefix) <= 20),
 is_predefined boolean not null default false,
 active boolean not null default true,
 version integer not null default 1 check (version > 0),
 created_by uuid references auth.users(id),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 check (is_predefined = (code is not null)),
 check (is_predefined or created_by is not null)
);
create unique index voucher_types_name on public.voucher_types(lower(name));

-- Gap-free numbering: the row is locked inside the posting transaction, so a failed post never burns a number.
create table public.voucher_number_counters (
 voucher_type_id uuid not null references public.voucher_types(id) on delete restrict,
 fiscal_year_id uuid not null references public.fiscal_years(id) on delete restrict,
 next_number integer not null default 1 check (next_number > 0),
 primary key (voucher_type_id, fiscal_year_id)
);
create index voucher_number_counters_year on public.voucher_number_counters(fiscal_year_id);

create table public.vouchers (
 id uuid primary key,
 voucher_type_id uuid not null references public.voucher_types(id) on delete restrict,
 fiscal_year_id uuid not null references public.fiscal_years(id) on delete restrict,
 number text not null check (length(trim(number)) between 1 and 60),
 voucher_date date not null,
 narration text not null default '' check (length(narration) <= 2000),
 reference text not null default '' check (length(reference) <= 200),
 reverses_voucher_id uuid unique references public.vouchers(id) on delete restrict,
 source_kind text not null default '' check (source_kind in ('','proforma','delivery','purchase_order','tally_import')),
 source_id uuid,
 supplier_fiscal_code text not null default '' check (length(supplier_fiscal_code) <= 100),
 supplier_tin text not null default '' check (length(supplier_tin) <= 30),
 content_hash text not null check (length(content_hash) = 32),
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(),
 unique (voucher_type_id, fiscal_year_id, number),
 check ((source_kind = '') = (source_id is null)),
 check (reverses_voucher_id is distinct from id)
);
create index vouchers_date on public.vouchers(voucher_date, created_at);
create index vouchers_year on public.vouchers(fiscal_year_id);
create index vouchers_source on public.vouchers(source_kind, source_id) where source_id is not null;
create index vouchers_created_by on public.vouchers(created_by);

create table public.voucher_entries (
 id uuid primary key default gen_random_uuid(),
 voucher_id uuid not null references public.vouchers(id) on delete restrict,
 line_no integer not null check (line_no between 1 and 500),
 ledger_id uuid not null references public.ledgers(id) on delete restrict,
 amount_minor bigint not null check (amount_minor <> 0),
 vat_class text check (vat_class in ('standard','zero','exempt','out_of_scope')),
 vat_rate_bp integer check (vat_rate_bp between 0 and 10000),
 unique (voucher_id, line_no),
 check ((vat_class is null) = (vat_rate_bp is null))
);
create index voucher_entries_ledger on public.voucher_entries(ledger_id);

-- A bill is a receivable or payable reference on a bill-wise ledger (Tally: New Ref / Advance).
create table public.ledger_bills (
 id uuid primary key default gen_random_uuid(),
 ledger_id uuid not null references public.ledgers(id) on delete restrict,
 name text not null check (length(trim(name)) between 1 and 100),
 due_date date,
 created_at timestamptz not null default now()
);
create unique index ledger_bills_name on public.ledger_bills(ledger_id, lower(name));

create table public.bill_allocations (
 id uuid primary key default gen_random_uuid(),
 entry_id uuid not null references public.voucher_entries(id) on delete restrict,
 bill_id uuid references public.ledger_bills(id) on delete restrict,
 kind text not null check (kind in ('new','against','advance','on_account')),
 amount_minor bigint not null check (amount_minor <> 0),
 check ((kind = 'on_account') = (bill_id is null))
);
create index bill_allocations_entry on public.bill_allocations(entry_id);
create index bill_allocations_bill on public.bill_allocations(bill_id);

-- Effective-dated, so a future rate change is a new row, not a code change.
create table public.vat_rates (
 id uuid primary key default gen_random_uuid(),
 vat_class text not null check (vat_class in ('standard','zero','exempt','out_of_scope')),
 rate_bp integer not null check (rate_bp between 0 and 10000),
 effective_from date not null,
 note text not null default '' check (length(note) <= 300),
 created_at timestamptz not null default now(),
 unique (vat_class, effective_from)
);

create table public.accounting_events (
 id uuid primary key default gen_random_uuid(),
 entity text not null check (entity in ('voucher','ledger','account_group','voucher_type','fiscal_year','period_lock')),
 entity_id uuid not null,
 action text not null check (action in ('created','changed','posted','reversed','locked')),
 before_data jsonb,
 after_data jsonb,
 actor_user_id uuid references auth.users(id),
 recorded_at timestamptz not null default clock_timestamp()
);
create index accounting_events_entity on public.accounting_events(entity, entity_id, recorded_at);
create index accounting_events_actor on public.accounting_events(actor_user_id);

-- Posted books never change.
create function public.deny_ledger_mutation() returns trigger
language plpgsql set search_path=public,pg_temp as $$ begin raise exception 'Posted accounting records are never changed or deleted; post a reversal instead'; end $$;
do $$ declare t text; begin
 foreach t in array array['vouchers','voucher_entries','bill_allocations','accounting_events','ledger_period_locks','vat_rates'] loop
  execute format('create trigger %I before update or delete on public.%I for each row execute function public.deny_ledger_mutation()', t||'_immutable', t);
  execute format('create trigger %I before truncate on public.%I for each statement execute function public.deny_ledger_mutation()', t||'_no_truncate', t);
 end loop;
end $$;
create trigger ledger_bills_no_delete before delete on public.ledger_bills for each row execute function public.deny_ledger_mutation();

-- Checked at commit, so the RPC can insert the lines one by one.
create function public.check_voucher_balanced() returns trigger
language plpgsql set search_path=public,pg_temp as $$
declare v_id uuid := coalesce(to_jsonb(new)->>'voucher_id', to_jsonb(new)->>'id')::uuid; v_sum numeric; v_lines integer;
begin
 select coalesce(sum(amount_minor),0), count(*) into v_sum, v_lines from public.voucher_entries where voucher_id=v_id;
 if v_lines < 2 then raise exception 'A voucher needs at least two lines'; end if;
 if v_sum <> 0 then raise exception 'Debits and credits differ by % on this voucher', v_sum; end if;
 return null;
end $$;
create constraint trigger vouchers_balanced after insert on public.vouchers deferrable initially deferred for each row execute function public.check_voucher_balanced();
create constraint trigger voucher_entries_balanced after insert on public.voucher_entries deferrable initially deferred for each row execute function public.check_voucher_balanced();

-- A child group shares its parent's nature and gross-profit placement.
create function public.inherit_group_nature() returns trigger
language plpgsql set search_path=public,pg_temp as $$
declare p public.account_groups;
begin
 if new.parent_id is not null then
  select * into p from public.account_groups where id=new.parent_id;
  if not found then raise exception 'Parent group not found'; end if;
  new.nature := p.nature; new.affects_gross_profit := p.affects_gross_profit;
 end if;
 return new;
end $$;
create trigger account_groups_inherit before insert or update on public.account_groups for each row execute function public.inherit_group_nature();

-- Reference data.
insert into public.account_groups(id,code,name,parent_id,nature,affects_gross_profit,is_predefined,sort) values
 ('a0000000-0000-4000-8000-000000000001','capital_account','Capital Account',null,'liability',false,true,10),
 ('a0000000-0000-4000-8000-000000000002','loans_liability','Loans (Liability)',null,'liability',false,true,20),
 ('a0000000-0000-4000-8000-000000000003','current_liabilities','Current Liabilities',null,'liability',false,true,30),
 ('a0000000-0000-4000-8000-000000000004','suspense','Suspense A/c',null,'liability',false,true,40),
 ('a0000000-0000-4000-8000-000000000005','branch_divisions','Branch / Divisions',null,'liability',false,true,50),
 ('a0000000-0000-4000-8000-000000000006','fixed_assets','Fixed Assets',null,'asset',false,true,60),
 ('a0000000-0000-4000-8000-000000000007','investments','Investments',null,'asset',false,true,70),
 ('a0000000-0000-4000-8000-000000000008','current_assets','Current Assets',null,'asset',false,true,80),
 ('a0000000-0000-4000-8000-000000000009','misc_expenses_asset','Misc. Expenses (ASSET)',null,'asset',false,true,90),
 ('a0000000-0000-4000-8000-000000000010','sales_accounts','Sales Accounts',null,'income',true,true,100),
 ('a0000000-0000-4000-8000-000000000011','direct_incomes','Direct Incomes',null,'income',true,true,110),
 ('a0000000-0000-4000-8000-000000000012','indirect_incomes','Indirect Incomes',null,'income',false,true,120),
 ('a0000000-0000-4000-8000-000000000013','purchase_accounts','Purchase Accounts',null,'expense',true,true,130),
 ('a0000000-0000-4000-8000-000000000014','direct_expenses','Direct Expenses',null,'expense',true,true,140),
 ('a0000000-0000-4000-8000-000000000015','indirect_expenses','Indirect Expenses',null,'expense',false,true,150),
 ('a0000000-0000-4000-8000-000000000016','reserves_surplus','Reserves & Surplus','a0000000-0000-4000-8000-000000000001','liability',false,true,11),
 ('a0000000-0000-4000-8000-000000000017','secured_loans','Secured Loans','a0000000-0000-4000-8000-000000000002','liability',false,true,21),
 ('a0000000-0000-4000-8000-000000000018','unsecured_loans','Unsecured Loans','a0000000-0000-4000-8000-000000000002','liability',false,true,22),
 ('a0000000-0000-4000-8000-000000000019','bank_od','Bank OD A/c','a0000000-0000-4000-8000-000000000002','liability',false,true,23),
 ('a0000000-0000-4000-8000-000000000020','duties_taxes','Duties & Taxes','a0000000-0000-4000-8000-000000000003','liability',false,true,31),
 ('a0000000-0000-4000-8000-000000000021','provisions','Provisions','a0000000-0000-4000-8000-000000000003','liability',false,true,32),
 ('a0000000-0000-4000-8000-000000000022','sundry_creditors','Sundry Creditors','a0000000-0000-4000-8000-000000000003','liability',false,true,33),
 ('a0000000-0000-4000-8000-000000000023','bank_accounts','Bank Accounts','a0000000-0000-4000-8000-000000000008','asset',false,true,81),
 ('a0000000-0000-4000-8000-000000000024','cash_in_hand','Cash-in-Hand','a0000000-0000-4000-8000-000000000008','asset',false,true,82),
 ('a0000000-0000-4000-8000-000000000025','deposits_asset','Deposits (Asset)','a0000000-0000-4000-8000-000000000008','asset',false,true,83),
 ('a0000000-0000-4000-8000-000000000026','loans_advances_asset','Loans & Advances (Asset)','a0000000-0000-4000-8000-000000000008','asset',false,true,84),
 ('a0000000-0000-4000-8000-000000000027','stock_in_hand','Stock-in-Hand','a0000000-0000-4000-8000-000000000008','asset',false,true,85),
 ('a0000000-0000-4000-8000-000000000028','sundry_debtors','Sundry Debtors','a0000000-0000-4000-8000-000000000008','asset',false,true,86);

insert into public.ledgers(id,code,name,group_id,is_predefined) values
 ('b0000000-0000-4000-8000-000000000001','cash','Cash','a0000000-0000-4000-8000-000000000024',true);

insert into public.voucher_types(id,code,name,base_type,is_predefined) values
 ('c0000000-0000-4000-8000-000000000001','opening','Opening Balance','opening',true),
 ('c0000000-0000-4000-8000-000000000002','sales','Sales','sales',true),
 ('c0000000-0000-4000-8000-000000000003','purchase','Purchase','purchase',true),
 ('c0000000-0000-4000-8000-000000000004','payment','Payment','payment',true),
 ('c0000000-0000-4000-8000-000000000005','receipt','Receipt','receipt',true),
 ('c0000000-0000-4000-8000-000000000006','contra','Contra','contra',true),
 ('c0000000-0000-4000-8000-000000000007','journal','Journal','journal',true),
 ('c0000000-0000-4000-8000-000000000008','credit_note','Credit Note','credit_note',true),
 ('c0000000-0000-4000-8000-000000000009','debit_note','Debit Note','debit_note',true);

-- 18% confirmed by Anudha on 2026-10-06; VAT Act 2014 in force from 1 July 2015.
insert into public.vat_rates(vat_class,rate_bp,effective_from,note) values
 ('standard',1800,date '2015-07-01','Standard rate, confirmed by Anudha 2026-10-06'),
 ('zero',0,date '2015-07-01','Zero-rated supplies'),
 ('exempt',0,date '2015-07-01','Exempt supplies'),
 ('out_of_scope',0,date '2015-07-01','Outside the scope of VAT');

-- Helpers.
create function public.ledger_locked_through() returns date
language sql stable security definer set search_path=public,pg_temp as $$
 select through_date from public.ledger_period_locks order by locked_at desc, id desc limit 1 $$;

create function public.vat_rate_on(p_class text, p_date date) returns integer
language sql stable security definer set search_path=public,pg_temp as $$
 select rate_bp from public.vat_rates where vat_class=p_class and effective_from<=p_date order by effective_from desc limit 1 $$;

create function public.group_is_under(p_group uuid, p_code text) returns boolean
language sql stable security definer set search_path=public,pg_temp as $$
 with recursive up as (select id,parent_id,code from public.account_groups where id=p_group
  union all select g.id,g.parent_id,g.code from public.account_groups g join up on g.id=up.parent_id)
 select exists(select 1 from up where code=p_code) $$;

create function public.save_fiscal_year(p_id uuid, p_name text, p_starts_on date, p_ends_on date)
returns public.fiscal_years language plpgsql security definer set search_path=public,pg_temp as $$
declare v_row public.fiscal_years;
begin
 if not public.inventory_owner() then raise exception 'Only the owner can open a financial year' using errcode='42501'; end if;
 insert into public.fiscal_years(id,name,starts_on,ends_on,created_by) values(p_id,trim(p_name),p_starts_on,p_ends_on,auth.uid()) returning * into v_row;
 insert into public.accounting_events(entity,entity_id,action,after_data,actor_user_id) values('fiscal_year',v_row.id,'created',to_jsonb(v_row),auth.uid());
 return v_row;
exception when exclusion_violation then raise exception 'This financial year overlaps another one';
end $$;

-- Accounts staff may lock forward; only the owner may move the lock back (reopen a period).
create function public.lock_ledger_period(p_through_date date, p_reason text)
returns public.ledger_period_locks language plpgsql security definer set search_path=public,pg_temp as $$
declare v_row public.ledger_period_locks; v_current date;
begin
 if not public.ledger_staff() then raise exception 'Accounting access is required' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended('ledger-period-lock',0));
 v_current := public.ledger_locked_through();
 if v_current is not null and p_through_date < v_current and not public.inventory_owner() then raise exception 'Only the owner can reopen a locked period'; end if;
 insert into public.ledger_period_locks(through_date,reason,locked_by) values(p_through_date,trim(p_reason),auth.uid()) returning * into v_row;
 insert into public.accounting_events(entity,entity_id,action,before_data,after_data,actor_user_id)
 values('period_lock',v_row.id,'locked',jsonb_build_object('through_date',v_current),to_jsonb(v_row),auth.uid());
 return v_row;
end $$;

-- User groups only, except that a predefined group may be renamed. Nature comes from the parent.
create function public.save_account_group(p_id uuid, p_expected_version integer, p_name text, p_parent_id uuid, p_nature text default null)
returns public.account_groups language plpgsql security definer set search_path=public,pg_temp as $$
declare v_old public.account_groups; v_row public.account_groups;
begin
 if not public.ledger_staff() then raise exception 'Accounting access is required' using errcode='42501'; end if;
 if p_parent_id is null and coalesce(p_nature,'') not in ('asset','liability','income','expense') then raise exception 'A top-level group needs asset, liability, income or expense'; end if;
 if p_expected_version = 0 then
  insert into public.account_groups(id,name,parent_id,nature,created_by) values(p_id,trim(p_name),p_parent_id,coalesce(p_nature,'asset'),auth.uid()) returning * into v_row;
  insert into public.accounting_events(entity,entity_id,action,after_data,actor_user_id) values('account_group',v_row.id,'created',to_jsonb(v_row),auth.uid());
  return v_row;
 end if;
 select * into v_old from public.account_groups where id=p_id for update;
 if not found or v_old.version <> p_expected_version then raise exception 'Group changed; refresh before saving'; end if;
 if v_old.is_predefined and (p_parent_id is distinct from v_old.parent_id) then raise exception 'Standard groups can be renamed but not moved'; end if;
 if p_parent_id is not null and exists(
  with recursive up as (select id,parent_id from public.account_groups where id=p_parent_id union all select g.id,g.parent_id from public.account_groups g join up on g.id=up.parent_id)
  select 1 from up where id=p_id) then raise exception 'A group cannot sit under itself'; end if;
 -- A top-level group keeps the nature it was created with; moving it under a parent takes the parent's.
 update public.account_groups set name=trim(p_name),parent_id=p_parent_id,version=version+1,updated_at=now() where id=p_id returning * into v_row;
 insert into public.accounting_events(entity,entity_id,action,before_data,after_data,actor_user_id) values('account_group',v_row.id,'changed',to_jsonb(v_old),to_jsonb(v_row),auth.uid());
 return v_row;
exception when unique_violation then raise exception 'Another group already has this name';
end $$;

create function public.save_ledger(p_id uuid, p_expected_version integer, p_ledger jsonb)
returns public.ledgers language plpgsql security definer set search_path=public,pg_temp as $$
declare v_old public.ledgers; v_row public.ledgers; v_group uuid := (p_ledger->>'group_id')::uuid;
 v_bill_wise boolean := coalesce((p_ledger->>'bill_wise')::boolean,false);
begin
 if not public.ledger_staff() then raise exception 'Accounting access is required' using errcode='42501'; end if;
 if v_group is null or not exists(select 1 from public.account_groups where id=v_group) then raise exception 'Choose the group this ledger belongs to'; end if;
 if coalesce(p_ledger->>'vat_role','') <> '' and not public.group_is_under(v_group,'duties_taxes') then raise exception 'Only a Duties & Taxes ledger can hold VAT'; end if;
 if p_expected_version > 0 then
  select * into v_old from public.ledgers where id=p_id for update;
  if not found or v_old.version <> p_expected_version then raise exception 'Ledger changed; refresh before saving'; end if;
  if v_old.bill_wise and not v_bill_wise and exists(select 1 from public.bill_allocations a join public.voucher_entries e on e.id=a.entry_id where e.ledger_id=p_id)
   then raise exception 'Bill-wise tracking cannot be turned off once bills are recorded'; end if;
  if v_old.is_predefined and v_group <> v_old.group_id then raise exception 'The Cash ledger stays under Cash-in-Hand'; end if;
 end if;
 insert into public.ledgers as l(id,name,group_id,bill_wise,credit_days,credit_limit_minor,organization_id,supplier_id,vat_class,vat_role,tin,vrn,bank_details,active,created_by)
 values(p_id,trim(p_ledger->>'name'),v_group,v_bill_wise,coalesce((p_ledger->>'credit_days')::integer,0),(p_ledger->>'credit_limit_minor')::bigint,
  (p_ledger->>'organization_id')::uuid,(p_ledger->>'supplier_id')::uuid,nullif(p_ledger->>'vat_class',''),coalesce(p_ledger->>'vat_role',''),
  trim(coalesce(p_ledger->>'tin','')),trim(coalesce(p_ledger->>'vrn','')),coalesce(p_ledger->'bank_details','{}'),coalesce((p_ledger->>'active')::boolean,true),auth.uid())
 on conflict (id) do update set name=excluded.name,group_id=excluded.group_id,bill_wise=excluded.bill_wise,credit_days=excluded.credit_days,
  credit_limit_minor=excluded.credit_limit_minor,organization_id=excluded.organization_id,supplier_id=excluded.supplier_id,vat_class=excluded.vat_class,
  vat_role=excluded.vat_role,tin=excluded.tin,vrn=excluded.vrn,bank_details=excluded.bank_details,active=excluded.active,version=l.version+1,updated_at=now()
  where p_expected_version > 0
 returning * into v_row;
 if v_row.id is null then raise exception 'Ledger changed; refresh before saving'; end if;
 insert into public.accounting_events(entity,entity_id,action,before_data,after_data,actor_user_id)
 values('ledger',v_row.id,case when v_old.id is null then 'created' else 'changed' end,to_jsonb(v_old),to_jsonb(v_row),auth.uid());
 return v_row;
exception when unique_violation then raise exception 'Another ledger already has this name, customer or supplier';
end $$;

-- Posts one voucher. p_id is the caller's idempotency key: resending the same voucher returns it, a different voucher
-- under the same id is refused. p_entries: [{ledger_id, amount_minor (Dr +, Cr -), vat_class?, bills:[{kind, name, due_date?, amount_minor}]}]
create function public.post_voucher(p_id uuid, p_voucher_type_id uuid, p_date date, p_entries jsonb,
 p_narration text default '', p_reference text default '', p_number text default null, p_source jsonb default '{}', p_supplier jsonb default '{}')
returns public.vouchers language plpgsql security definer set search_path=public,pg_temp as $$
declare
 v_hash text := md5(jsonb_build_array(p_voucher_type_id,p_date,p_entries,coalesce(p_narration,''),coalesce(p_reference,''),p_number,p_source,p_supplier)::text);
 v_existing public.vouchers; v_type public.voucher_types; v_year public.fiscal_years; v_row public.vouchers; v_ledger public.ledgers;
 v_entry jsonb; v_bill jsonb; v_line integer := 0; v_entry_id uuid; v_amount bigint; v_bill_sum bigint; v_bill_id uuid; v_number text;
 v_source_kind text := coalesce(p_source->>'kind',''); v_source_id uuid := (p_source->>'id')::uuid;
 v_class text; v_rate integer; v_vat_expected bigint := 0; v_vat_posted bigint := 0; v_vat_lines integer := 0; v_kind text;
begin
 if not public.ledger_staff() then raise exception 'Accounting access is required' using errcode='42501'; end if;
 select * into v_existing from public.vouchers where id=p_id;
 if found then
  if v_existing.content_hash = v_hash then return v_existing; end if;
  raise exception 'This voucher was already saved with different details; refresh before posting again';
 end if;
 select * into v_type from public.voucher_types where id=p_voucher_type_id and active;
 if not found then raise exception 'Choose an active voucher type'; end if;
 if p_entries is null or jsonb_typeof(p_entries) <> 'array' or jsonb_array_length(p_entries) not between 2 and 500 then raise exception 'A voucher needs between 2 and 500 lines'; end if;
 select * into v_year from public.fiscal_years where p_date between starts_on and ends_on;
 if not found then raise exception 'No financial year covers %; ask the owner to open it', p_date; end if;
 if p_date <= public.ledger_locked_through() then raise exception 'Books are locked through %; choose a later date', public.ledger_locked_through(); end if;
 if v_type.base_type = 'opening' and p_date <> v_year.starts_on then raise exception 'Opening balances are dated on the first day of the financial year'; end if;
 if v_type.base_type = 'purchase' and (trim(coalesce(p_supplier->>'fiscal_code','')) = '') <> (trim(coalesce(p_supplier->>'tin','')) = '') then
  raise exception 'Enter both the supplier TIN and the fiscal receipt verification code, or neither'; end if;
 if v_source_kind <> '' then
  perform pg_advisory_xact_lock(hashtextextended('ledger-source:'||v_source_kind||':'||v_source_id::text,0));
  if exists(select 1 from public.vouchers v join public.voucher_types t on t.id=v.voucher_type_id
   where v.source_kind=v_source_kind and v.source_id=v_source_id and t.base_type=v_type.base_type and v.reverses_voucher_id is null
    and not exists(select 1 from public.vouchers r where r.reverses_voucher_id=v.id)) then
   raise exception 'This % already has a posted voucher; reverse it before posting again', replace(v_source_kind,'_',' '); end if;
 end if;
 if v_type.numbering = 'manual' then
  v_number := trim(coalesce(p_number,''));
  if v_number = '' then raise exception 'Enter the voucher number'; end if;
 else
  insert into public.voucher_number_counters(voucher_type_id,fiscal_year_id) values(v_type.id,v_year.id) on conflict do nothing;
  update public.voucher_number_counters set next_number=next_number+1 where voucher_type_id=v_type.id and fiscal_year_id=v_year.id
  returning v_type.prefix||(next_number-1)::text into v_number;
 end if;
 insert into public.vouchers(id,voucher_type_id,fiscal_year_id,number,voucher_date,narration,reference,source_kind,source_id,supplier_fiscal_code,supplier_tin,content_hash,created_by)
 values(p_id,v_type.id,v_year.id,v_number,p_date,trim(coalesce(p_narration,'')),trim(coalesce(p_reference,'')),v_source_kind,v_source_id,
  trim(coalesce(p_supplier->>'fiscal_code','')),trim(coalesce(p_supplier->>'tin','')),v_hash,auth.uid()) returning * into v_row;
 for v_entry in select value from jsonb_array_elements(p_entries) loop
  v_line := v_line + 1;
  v_amount := (v_entry->>'amount_minor')::bigint;
  if v_amount is null or v_amount = 0 then raise exception 'Line % needs a non-zero amount', v_line; end if;
  select * into v_ledger from public.ledgers where id=(v_entry->>'ledger_id')::uuid;
  if not found or not v_ledger.active then raise exception 'Line % needs an active ledger', v_line; end if;
  v_class := nullif(v_entry->>'vat_class',''); v_rate := null;
  if v_class is not null then
   if v_type.base_type not in ('sales','purchase','credit_note','debit_note') then raise exception 'VAT lines belong on sales, purchase, credit note and debit note vouchers'; end if;
   v_rate := public.vat_rate_on(v_class,p_date);
   if v_rate is null then raise exception 'No VAT rate for % on %', v_class, p_date; end if;
   v_vat_expected := v_vat_expected + sign(v_amount)::bigint * round(abs(v_amount) * v_rate / 10000.0)::bigint;
  end if;
  if v_ledger.vat_role <> '' then
   if v_type.base_type in ('sales','credit_note') and v_ledger.vat_role <> 'output' then raise exception 'Use the output VAT ledger on sales'; end if;
   if v_type.base_type in ('purchase','debit_note') and v_ledger.vat_role <> 'input' then raise exception 'Use the input VAT ledger on purchases'; end if;
   if v_type.base_type = 'purchase' and trim(coalesce(p_supplier->>'fiscal_code','')) = '' then
    raise exception 'Input VAT needs the supplier''s fiscal receipt verification code and TIN; without them post the VAT to the cost'; end if;
   if v_type.base_type in ('sales','purchase','credit_note','debit_note') then v_vat_posted := v_vat_posted + v_amount; v_vat_lines := v_vat_lines + 1; end if;
  end if;
  insert into public.voucher_entries(voucher_id,line_no,ledger_id,amount_minor,vat_class,vat_rate_bp)
  values(v_row.id,v_line,v_ledger.id,v_amount,v_class,v_rate) returning id into v_entry_id;
  if v_ledger.bill_wise then
   if jsonb_typeof(v_entry->'bills') is distinct from 'array' or jsonb_array_length(v_entry->'bills') = 0 then raise exception 'Line % (%): allocate the amount to bills', v_line, v_ledger.name; end if;
   v_bill_sum := 0;
   perform pg_advisory_xact_lock(hashtextextended('ledger-bills:'||v_ledger.id::text,0));
   for v_bill in select value from jsonb_array_elements(v_entry->'bills') loop
    v_kind := v_bill->>'kind'; v_bill_id := null;
    if v_kind not in ('new','against','advance','on_account') then raise exception 'Line %: bill type must be new, against, advance or on account', v_line; end if;
    if (v_bill->>'amount_minor')::bigint is null or (v_bill->>'amount_minor')::bigint = 0 or sign((v_bill->>'amount_minor')::bigint) <> sign(v_amount) then
     raise exception 'Line %: each bill amount must be non-zero and on the same side as the line', v_line; end if;
    if v_kind <> 'on_account' and trim(coalesce(v_bill->>'name','')) = '' then raise exception 'Line %: enter the bill name', v_line; end if;
    if v_kind in ('new','advance') then
     insert into public.ledger_bills(ledger_id,name,due_date)
     values(v_ledger.id,trim(v_bill->>'name'),coalesce((v_bill->>'due_date')::date,p_date + v_ledger.credit_days)) returning id into v_bill_id;
    elsif v_kind = 'against' then
     select id into v_bill_id from public.ledger_bills where ledger_id=v_ledger.id and lower(name)=lower(trim(v_bill->>'name'));
     if v_bill_id is null then raise exception 'Line %: no bill named % on %', v_line, v_bill->>'name', v_ledger.name; end if;
    end if;
    insert into public.bill_allocations(entry_id,bill_id,kind,amount_minor) values(v_entry_id,v_bill_id,v_kind,(v_bill->>'amount_minor')::bigint);
    v_bill_sum := v_bill_sum + (v_bill->>'amount_minor')::bigint;
   end loop;
   if v_bill_sum <> v_amount then raise exception 'Line % (%): bill allocations total % but the line is %', v_line, v_ledger.name, v_bill_sum, v_amount; end if;
  elsif jsonb_typeof(v_entry->'bills') = 'array' and jsonb_array_length(v_entry->'bills') > 0 then
   raise exception 'Line % (%): this ledger does not keep bills', v_line, v_ledger.name;
  end if;
 end loop;
 if v_vat_posted <> v_vat_expected then raise exception 'VAT should be % but the VAT lines total %', v_vat_expected, v_vat_posted; end if;
 if v_vat_expected <> 0 and v_vat_lines = 0 then raise exception 'Add the VAT ledger line'; end if;
 perform public.check_ledger_bills(v_row.id);
 insert into public.accounting_events(entity,entity_id,action,after_data,actor_user_id) values('voucher',v_row.id,'posted',to_jsonb(v_row),auth.uid());
 return v_row;
exception when unique_violation then raise exception 'Voucher number or bill name is already in use; refresh and try again';
end $$;

-- A bill can be settled down to zero but never past it.
create function public.check_ledger_bills(p_voucher_id uuid) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare r record;
begin
 for r in
  select b.name, l.name ledger_name,
   sum(a.amount_minor) balance,
   sum(a.amount_minor) filter (where a.kind in ('new','advance')) opened
  from public.ledger_bills b join public.ledgers l on l.id=b.ledger_id join public.bill_allocations a on a.bill_id=b.id
  where b.id in (select a2.bill_id from public.bill_allocations a2 join public.voucher_entries e on e.id=a2.entry_id where e.voucher_id=p_voucher_id and a2.bill_id is not null)
  group by b.id, b.name, l.name
 loop
  if r.balance <> 0 and (coalesce(r.opened,0) = 0 or sign(r.balance) <> sign(r.opened)) then
   raise exception 'Bill % on % would be over-settled', r.name, r.ledger_name; end if;
 end loop;
end $$;

-- Posts the exact opposite of a voucher, dated p_date, with the bills it touched mirrored.
create function public.reverse_voucher(p_id uuid, p_original_id uuid, p_date date, p_reason text)
returns public.vouchers language plpgsql security definer set search_path=public,pg_temp as $$
declare v_orig public.vouchers; v_type public.voucher_types; v_year public.fiscal_years; v_row public.vouchers; v_number text; e record; v_new uuid;
 v_hash text := md5(jsonb_build_array('reverse',p_original_id,p_date,coalesce(p_reason,''))::text);
begin
 if not public.ledger_staff() then raise exception 'Accounting access is required' using errcode='42501'; end if;
 select * into v_row from public.vouchers where id=p_id;
 if found then
  if v_row.content_hash = v_hash then return v_row; end if;
  raise exception 'This voucher was already saved with different details; refresh before posting again';
 end if;
 if length(trim(coalesce(p_reason,''))) < 5 then raise exception 'Give the reason for the reversal'; end if;
 select * into v_orig from public.vouchers where id=p_original_id for update;
 if not found then raise exception 'Voucher not found'; end if;
 if v_orig.reverses_voucher_id is not null then raise exception 'A reversal cannot itself be reversed; post a new voucher instead'; end if;
 if exists(select 1 from public.vouchers where reverses_voucher_id=p_original_id) then raise exception 'This voucher is already reversed'; end if;
 if p_date < v_orig.voucher_date then raise exception 'The reversal cannot be dated before the original voucher'; end if;
 if p_date <= public.ledger_locked_through() then raise exception 'Books are locked through %; choose a later date', public.ledger_locked_through(); end if;
 select * into v_year from public.fiscal_years where p_date between starts_on and ends_on;
 if not found then raise exception 'No financial year covers %; ask the owner to open it', p_date; end if;
 select * into v_type from public.voucher_types where id=v_orig.voucher_type_id;
 insert into public.voucher_number_counters(voucher_type_id,fiscal_year_id) values(v_type.id,v_year.id) on conflict do nothing;
 update public.voucher_number_counters set next_number=next_number+1 where voucher_type_id=v_type.id and fiscal_year_id=v_year.id
 returning v_type.prefix||(next_number-1)::text into v_number;
 insert into public.vouchers(id,voucher_type_id,fiscal_year_id,number,voucher_date,narration,reference,reverses_voucher_id,source_kind,source_id,content_hash,created_by)
 values(p_id,v_type.id,v_year.id,v_number,p_date,'Reversal of '||v_orig.number||': '||trim(p_reason),v_orig.reference,v_orig.id,v_orig.source_kind,v_orig.source_id,v_hash,auth.uid())
 returning * into v_row;
 for e in select * from public.voucher_entries where voucher_id=v_orig.id order by line_no loop
  if exists(select 1 from public.ledgers where id=e.ledger_id and bill_wise) then perform pg_advisory_xact_lock(hashtextextended('ledger-bills:'||e.ledger_id::text,0)); end if;
  insert into public.voucher_entries(voucher_id,line_no,ledger_id,amount_minor,vat_class,vat_rate_bp)
  values(v_row.id,e.line_no,e.ledger_id,-e.amount_minor,e.vat_class,e.vat_rate_bp) returning id into v_new;
  insert into public.bill_allocations(entry_id,bill_id,kind,amount_minor)
  select v_new,a.bill_id,a.kind,-a.amount_minor from public.bill_allocations a where a.entry_id=e.id;
 end loop;
 perform public.check_ledger_bills(v_row.id);
 insert into public.accounting_events(entity,entity_id,action,after_data,actor_user_id) values('voucher',v_orig.id,'reversed',to_jsonb(v_row),auth.uid());
 return v_row;
end $$;

-- Reports read the same rows; RLS limits them to accounting staff.
create view public.ledger_bill_balances with (security_invoker = true) as
 select b.id bill_id, b.ledger_id, b.name, b.due_date,
  min(v.voucher_date) bill_date, sum(a.amount_minor) balance_minor
 from public.ledger_bills b join public.bill_allocations a on a.bill_id=b.id
 join public.voucher_entries e on e.id=a.entry_id join public.vouchers v on v.id=e.voucher_id
 group by b.id, b.ledger_id, b.name, b.due_date;

create function public.trial_balance(p_from date, p_to date)
returns table(ledger_id uuid, ledger_name text, group_id uuid, opening_minor bigint, debit_minor bigint, credit_minor bigint, closing_minor bigint)
language sql stable security invoker set search_path=public,pg_temp as $$
 select l.id, l.name, l.group_id,
  coalesce(sum(e.amount_minor) filter (where v.voucher_date < p_from),0)::bigint,
  coalesce(sum(e.amount_minor) filter (where v.voucher_date between p_from and p_to and e.amount_minor > 0),0)::bigint,
  coalesce(-sum(e.amount_minor) filter (where v.voucher_date between p_from and p_to and e.amount_minor < 0),0)::bigint,
  coalesce(sum(e.amount_minor) filter (where v.voucher_date <= p_to),0)::bigint
 from public.ledgers l
 left join public.voucher_entries e on e.ledger_id=l.id
 left join public.vouchers v on v.id=e.voucher_id
 group by l.id, l.name, l.group_id
 having coalesce(sum(e.amount_minor) filter (where v.voucher_date <= p_to),0) <> 0
  or count(e.id) filter (where v.voucher_date between p_from and p_to) > 0
$$;

do $$ declare t text; begin
 foreach t in array array['fiscal_years','ledger_period_locks','account_groups','ledgers','voucher_types','voucher_number_counters','vouchers','voucher_entries','ledger_bills','bill_allocations','vat_rates','accounting_events'] loop
  execute format('alter table public.%I enable row level security', t);
  execute format('create policy %I on public.%I for select to authenticated using ((select public.ledger_staff()))', t||'_read', t);
  execute format('revoke all on public.%I from public, anon, authenticated', t);
  execute format('grant select on public.%I to authenticated', t);
 end loop;
end $$;
revoke all on public.ledger_bill_balances from public, anon, authenticated;
grant select on public.ledger_bill_balances to authenticated;

revoke all on function public.deny_ledger_mutation(), public.check_voucher_balanced(), public.inherit_group_nature(), public.check_ledger_bills(uuid) from public, anon, authenticated;
revoke all on function public.ledger_staff(), public.ledger_locked_through(), public.vat_rate_on(text,date), public.group_is_under(uuid,text),
 public.save_fiscal_year(uuid,text,date,date), public.lock_ledger_period(date,text), public.save_account_group(uuid,integer,text,uuid,text),
 public.save_ledger(uuid,integer,jsonb), public.post_voucher(uuid,uuid,date,jsonb,text,text,text,jsonb,jsonb),
 public.reverse_voucher(uuid,uuid,date,text), public.trial_balance(date,date) from public, anon;
grant execute on function public.ledger_staff(), public.ledger_locked_through(), public.vat_rate_on(text,date), public.group_is_under(uuid,text),
 public.save_fiscal_year(uuid,text,date,date), public.lock_ledger_period(date,text), public.save_account_group(uuid,integer,text,uuid,text),
 public.save_ledger(uuid,integer,jsonb), public.post_voucher(uuid,uuid,date,jsonb,text,text,text,jsonb,jsonb),
 public.reverse_voucher(uuid,uuid,date,text), public.trial_balance(date,date) to authenticated;
commit;
