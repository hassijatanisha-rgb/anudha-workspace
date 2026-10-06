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

-- Milestone M2: invoices from ERP records. Additive to M1.
-- A sales invoice is built here from the accepted Pro forma's own lines, so nobody retypes amounts and the total must
-- equal the Pro forma's. Purchase bills are entered on the voucher form, pre-filled from the purchase order, because
-- the supplier's bill (not the order) fixes the price and VAT; post_voucher's source check stops a second bill.
begin;

-- One row: the ledgers a Pro forma invoice posts to, and how its lines without VAT are classed.
create table public.ledger_settings (
 id boolean primary key default true check (id),
 sales_ledger_id uuid references public.ledgers(id) on delete restrict,
 output_vat_ledger_id uuid references public.ledgers(id) on delete restrict,
 purchase_ledger_id uuid references public.ledgers(id) on delete restrict,
 input_vat_ledger_id uuid references public.ledgers(id) on delete restrict,
 untaxed_vat_class text not null default 'exempt' check (untaxed_vat_class in ('zero','exempt','out_of_scope')),
 version integer not null default 1 check (version > 0),
 updated_by uuid references auth.users(id),
 updated_at timestamptz not null default now()
);
insert into public.ledger_settings(id) values (true);
alter table public.accounting_events drop constraint accounting_events_entity_check;
alter table public.accounting_events add constraint accounting_events_entity_check check (entity in ('voucher','ledger','account_group','voucher_type','fiscal_year','period_lock','ledger_settings'));

create function public.save_ledger_settings(p_expected_version integer, p_settings jsonb)
returns public.ledger_settings language plpgsql security definer set search_path=public,pg_temp as $$
declare v_old public.ledger_settings; v_row public.ledger_settings;
 v_sales uuid := nullif(p_settings->>'sales_ledger_id','')::uuid; v_out uuid := nullif(p_settings->>'output_vat_ledger_id','')::uuid;
 v_purchase uuid := nullif(p_settings->>'purchase_ledger_id','')::uuid; v_in uuid := nullif(p_settings->>'input_vat_ledger_id','')::uuid;
begin
 if not public.ledger_staff() then raise exception 'Accounting access is required' using errcode='42501'; end if;
 select * into v_old from public.ledger_settings for update;
 if v_old.version <> p_expected_version then raise exception 'Default ledgers changed; refresh before saving'; end if;
 if v_sales is not null and not exists(select 1 from public.ledgers l where l.id=v_sales and public.group_is_under(l.group_id,'sales_accounts')) then raise exception 'The sales ledger must be under Sales Accounts'; end if;
 if v_purchase is not null and not exists(select 1 from public.ledgers l where l.id=v_purchase and public.group_is_under(l.group_id,'purchase_accounts')) then raise exception 'The purchase ledger must be under Purchase Accounts'; end if;
 if v_out is not null and not exists(select 1 from public.ledgers where id=v_out and vat_role='output') then raise exception 'Choose an output VAT ledger'; end if;
 if v_in is not null and not exists(select 1 from public.ledgers where id=v_in and vat_role='input') then raise exception 'Choose an input VAT ledger'; end if;
 update public.ledger_settings set sales_ledger_id=v_sales,output_vat_ledger_id=v_out,purchase_ledger_id=v_purchase,input_vat_ledger_id=v_in,
  untaxed_vat_class=coalesce(nullif(p_settings->>'untaxed_vat_class',''),untaxed_vat_class),version=version+1,updated_by=auth.uid(),updated_at=now()
 returning * into v_row;
 insert into public.accounting_events(entity,entity_id,action,before_data,after_data,actor_user_id)
 values('ledger_settings','00000000-0000-0000-0000-000000000000','changed',to_jsonb(v_old),to_jsonb(v_row),auth.uid());
 return v_row;
end $$;

-- Posts the tax invoice for an accepted TZS Pro forma: customer Dr (a new bill named after the Pro forma), one sales
-- line per Pro forma line, output VAT. Same arithmetic as save_sales_proforma; post_voucher repeats every check.
create function public.post_sales_invoice(p_id uuid, p_proforma_id uuid, p_date date)
returns public.vouchers language plpgsql security definer set search_path=public,pg_temp as $$
declare v_pf public.sales_proformas; v_set public.ledger_settings; v_party public.ledgers; v_line record; v_entries jsonb := '[]'; v_type uuid;
 v_gross bigint; v_discount bigint; v_net bigint; v_tax bigint := 0; v_total bigint := 0; v_rate integer; v_class text; v_n integer := 0;
begin
 if not public.ledger_staff() then raise exception 'Accounting access is required' using errcode='42501'; end if;
 select * into v_pf from public.sales_proformas where id=p_proforma_id;
 if not found or v_pf.deleted_at is not null then raise exception 'Pro forma not found'; end if;
 if v_pf.status <> 'accepted' then raise exception 'Only an accepted Pro forma can be invoiced'; end if;
 if v_pf.currency <> 'TZS' then raise exception 'Only Pro formas in TZS can be invoiced here for now'; end if;
 select * into v_set from public.ledger_settings;
 if v_set.sales_ledger_id is null then raise exception 'Choose the default sales ledger under Years & locks first'; end if;
 select * into v_party from public.ledgers where organization_id=v_pf.organization_id and active;
 if not found then raise exception 'Create a customer ledger linked to this customer under Ledgers first'; end if;
 if not v_party.bill_wise then raise exception 'Turn on bills for the ledger %', v_party.name; end if;
 v_rate := public.vat_rate_on('standard',p_date);
 for v_line in select * from public.sales_proforma_lines where proforma_id=v_pf.id order by sort_order loop
  v_n := v_n + 1;
  v_gross := v_line.quantity::bigint * v_line.unit_price_minor;
  v_discount := round(v_line.quantity::numeric * v_line.unit_price_minor::numeric * v_line.discount_basis_points::numeric / 10000);
  v_net := v_gross - v_discount;
  if v_line.tax_basis_points = 0 then v_class := v_set.untaxed_vat_class;
  elsif v_line.tax_basis_points = v_rate then v_class := 'standard';
  else raise exception 'Line % has VAT at %, but the rate on % is %', v_n, trim_scale(v_line.tax_basis_points/100.0)||'%', p_date, trim_scale(v_rate/100.0)||'%'; end if;
  if v_net > 0 then
   v_entries := v_entries || jsonb_build_array(jsonb_build_object('ledger_id',v_set.sales_ledger_id,'amount_minor',-v_net,'vat_class',v_class));
   v_tax := v_tax + round(v_net::numeric * public.vat_rate_on(v_class,p_date) / 10000)::bigint;
   v_total := v_total + v_net;
  end if;
 end loop;
 if v_n = 0 or v_total = 0 then raise exception 'This Pro forma has nothing to invoice'; end if;
 if v_tax > 0 then
  if v_set.output_vat_ledger_id is null then raise exception 'Choose the default output VAT ledger under Years & locks first'; end if;
  v_entries := v_entries || jsonb_build_array(jsonb_build_object('ledger_id',v_set.output_vat_ledger_id,'amount_minor',-v_tax));
 end if;
 if v_total + v_tax <> v_pf.total_minor then raise exception 'Invoice total % does not match the Pro forma total %; check the Pro forma', v_total + v_tax, v_pf.total_minor; end if;
 v_entries := jsonb_build_array(jsonb_build_object('ledger_id',v_party.id,'amount_minor',v_total + v_tax,
  'bills',jsonb_build_array(jsonb_build_object('kind','new','name',v_pf.document_number,'amount_minor',v_total + v_tax)))) || v_entries;
 select id into v_type from public.voucher_types where code='sales';
 return public.post_voucher(p_id, v_type, p_date, v_entries, 'Pro forma '||v_pf.document_number, coalesce(v_pf.acceptance_reference,''),
  null, jsonb_build_object('kind','proforma','id',v_pf.id), '{}'::jsonb);
end $$;

alter table public.ledger_settings enable row level security;
create policy ledger_settings_read on public.ledger_settings for select to authenticated using ((select public.ledger_staff()));
revoke all on public.ledger_settings from public, anon, authenticated;
grant select on public.ledger_settings to authenticated;
revoke all on function public.save_ledger_settings(integer,jsonb), public.post_sales_invoice(uuid,uuid,date) from public, anon;
grant execute on function public.save_ledger_settings(integer,jsonb), public.post_sales_invoice(uuid,uuid,date) to authenticated;
commit;

-- Milestones M5 and M6: bank reconciliation and year-end close. Additive to M1 and M2.
begin;

-- Bank statement lines as the bank sent them. Deposits are positive (our debit on the bank ledger), withdrawals negative.
create table public.bank_statement_imports (
 id uuid primary key,
 ledger_id uuid not null references public.ledgers(id) on delete restrict,
 file_name text not null default '' check (length(file_name) <= 200),
 line_count integer not null check (line_count between 0 and 5000),
 imported_by uuid not null references auth.users(id),
 imported_at timestamptz not null default now()
);
create index bank_statement_imports_ledger on public.bank_statement_imports(ledger_id, imported_at desc);
create table public.bank_statement_lines (
 id uuid primary key default gen_random_uuid(),
 import_id uuid not null references public.bank_statement_imports(id) on delete restrict,
 ledger_id uuid not null references public.ledgers(id) on delete restrict,
 line_date date not null,
 amount_minor bigint not null check (amount_minor <> 0),
 description text not null default '' check (length(description) <= 500),
 bank_ref text not null default '' check (length(bank_ref) <= 120),
 line_key text not null check (length(line_key) = 32),
 unique (ledger_id, line_key)
);
create index bank_statement_lines_ledger on public.bank_statement_lines(ledger_id, line_date);
create index bank_statement_lines_import on public.bank_statement_lines(import_id);

-- Append-only: the latest row for an entry is its state. A row with no bank date clears an earlier reconciliation.
create table public.bank_reconciliations (
 id uuid primary key default gen_random_uuid(),
 entry_id uuid not null references public.voucher_entries(id) on delete restrict,
 bank_date date,
 statement_line_id uuid references public.bank_statement_lines(id) on delete restrict,
 recorded_by uuid not null references auth.users(id),
 recorded_at timestamptz not null default clock_timestamp(),
 check (bank_date is not null or statement_line_id is null)
);
create index bank_reconciliations_entry on public.bank_reconciliations(entry_id, recorded_at desc);
create index bank_reconciliations_line on public.bank_reconciliations(statement_line_id);
do $$ declare t text; begin
 foreach t in array array['bank_statement_imports','bank_statement_lines','bank_reconciliations'] loop
  execute format('create trigger %I before update or delete on public.%I for each row execute function public.deny_ledger_mutation()', t||'_immutable', t);
  execute format('create trigger %I before truncate on public.%I for each statement execute function public.deny_ledger_mutation()', t||'_no_truncate', t);
  execute format('alter table public.%I enable row level security', t);
  execute format('create policy %I on public.%I for select to authenticated using ((select public.ledger_staff()))', t||'_read', t);
  execute format('revoke all on public.%I from public, anon, authenticated', t);
  execute format('grant select on public.%I to authenticated', t);
 end loop;
end $$;

create function public.is_bank_ledger(p_ledger_id uuid) returns boolean
language sql stable security definer set search_path=public,pg_temp as $$
 select exists(select 1 from public.ledgers l where l.id=p_ledger_id and (public.group_is_under(l.group_id,'bank_accounts') or public.group_is_under(l.group_id,'bank_od'))) $$;

-- Up to 2,000 lines per call. A line already imported for this bank (same date, amount, text, reference and position
-- among identical lines) is skipped, so the same statement can be uploaded twice safely.
create function public.import_bank_statement(p_import_id uuid, p_ledger_id uuid, p_file_name text, p_lines jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_line jsonb; v_new integer := 0; v_seen integer := 0; v_key text; v_n integer; v_counts jsonb := '{}'; v_base text;
begin
 if not public.ledger_staff() then raise exception 'Accounting access is required' using errcode='42501'; end if;
 if not public.is_bank_ledger(p_ledger_id) then raise exception 'Choose a ledger under Bank Accounts or Bank OD A/c'; end if;
 if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) not between 1 and 2000 then raise exception 'Send between 1 and 2,000 statement lines at a time'; end if;
 if exists(select 1 from public.bank_statement_imports where id=p_import_id) then
  return jsonb_build_object('new',0,'already',jsonb_array_length(p_lines),'repeated',true); end if;
 perform pg_advisory_xact_lock(hashtextextended('bank-import:'||p_ledger_id::text,0));
 insert into public.bank_statement_imports(id,ledger_id,file_name,line_count,imported_by) values(p_import_id,p_ledger_id,left(coalesce(p_file_name,''),200),jsonb_array_length(p_lines),auth.uid());
 for v_line in select value from jsonb_array_elements(p_lines) loop
  if (v_line->>'line_date') is null or coalesce((v_line->>'amount_minor')::bigint,0) = 0 then raise exception 'Every statement line needs a date and a non-zero amount'; end if;
  v_base := md5(jsonb_build_array(v_line->>'line_date',(v_line->>'amount_minor')::bigint,trim(coalesce(v_line->>'description','')),trim(coalesce(v_line->>'bank_ref','')))::text);
  v_n := coalesce((v_counts->>v_base)::integer,0) + 1; v_counts := v_counts || jsonb_build_object(v_base,v_n);
  v_key := md5(v_base||':'||v_n);
  insert into public.bank_statement_lines(import_id,ledger_id,line_date,amount_minor,description,bank_ref,line_key)
  values(p_import_id,p_ledger_id,(v_line->>'line_date')::date,(v_line->>'amount_minor')::bigint,left(trim(coalesce(v_line->>'description','')),500),left(trim(coalesce(v_line->>'bank_ref','')),120),v_key)
  on conflict (ledger_id,line_key) do nothing;
  if found then v_new := v_new + 1; else v_seen := v_seen + 1; end if;
 end loop;
 return jsonb_build_object('new',v_new,'already',v_seen,'repeated',false);
end $$;

-- p_rows: [{entry_id, bank_date (null clears), statement_line_id?}]. A statement line clears one book entry at most,
-- with the same amount on the same bank ledger.
create function public.record_bank_dates(p_rows jsonb)
returns integer language plpgsql security definer set search_path=public,pg_temp as $$
declare v_row jsonb; v_entry public.voucher_entries; v_line public.bank_statement_lines; v_line_id uuid; v_n integer := 0;
begin
 if not public.ledger_staff() then raise exception 'Accounting access is required' using errcode='42501'; end if;
 if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) not between 1 and 1000 then raise exception 'Send between 1 and 1,000 bank dates at a time'; end if;
 for v_row in select value from jsonb_array_elements(p_rows) loop
  select * into v_entry from public.voucher_entries where id=(v_row->>'entry_id')::uuid;
  if not found or not public.is_bank_ledger(v_entry.ledger_id) then raise exception 'Bank dates can only be set on bank ledger entries'; end if;
  perform pg_advisory_xact_lock(hashtextextended('bank-rec:'||v_entry.ledger_id::text,0));
  v_line_id := nullif(v_row->>'statement_line_id','')::uuid;
  if v_line_id is not null then
   select * into v_line from public.bank_statement_lines where id=v_line_id;
   if not found or v_line.ledger_id <> v_entry.ledger_id or v_line.amount_minor <> v_entry.amount_minor then raise exception 'That statement line is for a different bank or amount'; end if;
   if exists(select 1 from (select distinct on (r.entry_id) r.entry_id, r.statement_line_id from public.bank_reconciliations r
     join public.voucher_entries e on e.id=r.entry_id where e.ledger_id=v_entry.ledger_id order by r.entry_id, r.recorded_at desc, r.id desc) cur
     where cur.statement_line_id=v_line_id and cur.entry_id<>v_entry.id) then raise exception 'That statement line already clears another entry'; end if;
  end if;
  insert into public.bank_reconciliations(entry_id,bank_date,statement_line_id,recorded_by)
  values(v_entry.id,nullif(v_row->>'bank_date','')::date,v_line_id,auth.uid());
  v_n := v_n + 1;
 end loop;
 return v_n;
end $$;

-- Every entry on a bank ledger up to a date, with its current bank date. Read by the reconciliation screen.
create function public.bank_book(p_ledger_id uuid, p_to date)
returns table(entry_id uuid, voucher_id uuid, voucher_date date, number text, voucher_type_id uuid, narration text, reference text,
 amount_minor bigint, bank_date date, statement_line_id uuid)
language sql stable security invoker set search_path=public,pg_temp as $$
 select e.id, v.id, v.voucher_date, v.number, v.voucher_type_id, v.narration, v.reference, e.amount_minor, cur.bank_date, cur.statement_line_id
 from public.voucher_entries e join public.vouchers v on v.id=e.voucher_id
 left join lateral (select r.bank_date, r.statement_line_id from public.bank_reconciliations r where r.entry_id=e.id order by r.recorded_at desc, r.id desc limit 1) cur on true
 where e.ledger_id=p_ledger_id and v.voucher_date<=p_to
 order by v.voucher_date, v.created_at, e.line_no $$;

-- Year-end close (owner): one Journal dated the last day of the year moves every income and expense balance to the
-- chosen capital or reserves ledger, then the books are locked through that day. Run once per year.
alter table public.fiscal_years add column closed_at timestamptz, add column closed_by uuid references auth.users(id),
 add column closing_voucher_id uuid references public.vouchers(id);
create function public.close_fiscal_year(p_voucher_id uuid, p_year_id uuid, p_retained_ledger_id uuid)
returns public.fiscal_years language plpgsql security definer set search_path=public,pg_temp as $$
declare v_year public.fiscal_years; v_lock date; v_entries jsonb; v_total bigint; v_voucher public.vouchers; v_row public.fiscal_years;
begin
 if not public.inventory_owner() then raise exception 'Only the owner can close a financial year' using errcode='42501'; end if;
 select * into v_year from public.fiscal_years where id=p_year_id for update;
 if not found then raise exception 'Financial year not found'; end if;
 if v_year.closed_at is not null then raise exception '% is already closed', v_year.name; end if;
 if not exists(select 1 from public.ledgers l where l.id=p_retained_ledger_id and (public.group_is_under(l.group_id,'capital_account'))) then
  raise exception 'Choose a ledger under Capital Account (for example Reserves & Surplus) for the year''s profit'; end if;
 if exists(select 1 from public.fiscal_years where ends_on < v_year.starts_on and closed_at is null) then raise exception 'Close the earlier financial year first'; end if;
 perform pg_advisory_xact_lock(hashtextextended('ledger-period-lock',0));
 v_lock := public.ledger_locked_through();
 select coalesce(jsonb_agg(jsonb_build_object('ledger_id',b.ledger_id,'amount_minor',-b.balance) order by b.ledger_id),'[]'), coalesce(sum(b.balance),0)
 into v_entries, v_total
 from (select e.ledger_id, sum(e.amount_minor)::bigint balance from public.voucher_entries e join public.vouchers v on v.id=e.voucher_id
       join public.ledgers l on l.id=e.ledger_id join public.account_groups g on g.id=l.group_id
       where v.voucher_date<=v_year.ends_on and g.nature in ('income','expense') group by e.ledger_id having sum(e.amount_minor)<>0) b;
 if jsonb_array_length(v_entries) > 0 then
  -- The closing journal is dated inside the year; reopen just that day if needed, then restore the later lock.
  if v_lock is not null and v_lock >= v_year.ends_on then
   insert into public.ledger_period_locks(through_date,reason,locked_by) values(v_year.ends_on - 1,'Year-end close of '||v_year.name,auth.uid()); end if;
  v_entries := v_entries || jsonb_build_array(jsonb_build_object('ledger_id',p_retained_ledger_id,'amount_minor',v_total));
  if jsonb_array_length(v_entries) > 500 then raise exception 'More than 499 income and expense ledgers; close in parts'; end if;
  v_voucher := public.post_voucher(p_voucher_id,(select id from public.voucher_types where code='journal'),v_year.ends_on,v_entries,'Year-end close of '||v_year.name,'',null,'{}'::jsonb,'{}'::jsonb);
 end if;
 insert into public.ledger_period_locks(through_date,reason,locked_by) values(greatest(v_year.ends_on,coalesce(v_lock,v_year.ends_on)),'Year-end close of '||v_year.name,auth.uid());
 update public.fiscal_years set closed_at=now(),closed_by=auth.uid(),closing_voucher_id=v_voucher.id where id=v_year.id returning * into v_row;
 insert into public.accounting_events(entity,entity_id,action,before_data,after_data,actor_user_id) values('fiscal_year',v_row.id,'changed',to_jsonb(v_year),to_jsonb(v_row),auth.uid());
 return v_row;
end $$;

revoke all on function public.is_bank_ledger(uuid), public.import_bank_statement(uuid,uuid,text,jsonb), public.record_bank_dates(jsonb),
 public.bank_book(uuid,date), public.close_fiscal_year(uuid,uuid,uuid) from public, anon;
grant execute on function public.is_bank_ledger(uuid), public.import_bank_statement(uuid,uuid,text,jsonb), public.record_bank_dates(jsonb),
 public.bank_book(uuid,date), public.close_fiscal_year(uuid,uuid,uuid) to authenticated;
commit;
