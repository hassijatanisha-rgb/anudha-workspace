-- Dated customer-credit movements preserve immutable receipts and historical AR reconciliation.
begin;
create table public.acc_opening_customer_credits (
 id uuid primary key, organization_id uuid not null references public.organizations(id),
 import_id uuid not null references public.acc_opening_receivable_imports(id) deferrable initially deferred,
 reference text not null check(length(reference) between 1 and 80), cutover_date date not null,
 amount_minor bigint not null check(amount_minor>0), currency text not null default 'TZS' check(currency='TZS'),
 created_by uuid not null references auth.users(id), created_at timestamptz not null default now()
);
alter table public.acc_opening_receivable_refs alter column invoice_id drop not null;
alter table public.acc_opening_receivable_refs add column opening_credit_id uuid unique references public.acc_opening_customer_credits(id);
alter table public.acc_opening_receivable_refs add constraint acc_opening_ref_destination check(num_nonnulls(invoice_id,opening_credit_id)=1);
create table public.acc_customer_credit_applications (
 id uuid primary key, organization_id uuid not null references public.organizations(id),
 source_receipt_id uuid references public.acc_receipts(id), source_invoice_id uuid references public.acc_invoices(id),
 source_opening_credit_id uuid references public.acc_opening_customer_credits(id),
 invoice_id uuid not null references public.acc_invoices(id), application_date date not null,
 amount_minor bigint not null check(amount_minor>0), reverses_application_id uuid unique references public.acc_customer_credit_applications(id),
 reason text not null default '' check(length(reason)<=300), created_by uuid not null references auth.users(id), created_at timestamptz not null default now(),
 check(num_nonnulls(source_receipt_id,source_invoice_id,source_opening_credit_id)=1), check(source_invoice_id is distinct from invoice_id)
);
create sequence public.acc_customer_refund_number_seq;
create table public.acc_customer_refunds (
 id uuid primary key, refund_number text not null unique, organization_id uuid not null references public.organizations(id),
 source_receipt_id uuid references public.acc_receipts(id), source_invoice_id uuid references public.acc_invoices(id),
 source_opening_credit_id uuid references public.acc_opening_customer_credits(id), refund_date date not null,
 amount_minor bigint not null check(amount_minor>0), payout_account_id uuid not null references public.acc_accounts(id),
 method text not null check(method in ('bank','cash','mobile_money','cheque')), reference text not null check(length(reference)<=120),
 journal_entry_id uuid not null unique references public.acc_journal_entries(id), created_by uuid not null references auth.users(id), created_at timestamptz not null default now(),
 voided_at timestamptz,voided_by uuid references auth.users(id),void_reason text,void_entry_id uuid unique references public.acc_journal_entries(id),
 check(num_nonnulls(source_receipt_id,source_invoice_id,source_opening_credit_id)=1),
 check((voided_at is null)=(voided_by is null) and (voided_at is null)=(void_reason is null) and (voided_at is null)=(void_entry_id is null))
);
create index acc_credit_applications_customer_date on public.acc_customer_credit_applications(organization_id,application_date);
create index acc_credit_applications_target on public.acc_customer_credit_applications(invoice_id,application_date);
create index acc_refunds_customer_date on public.acc_customer_refunds(organization_id,refund_date);
create index acc_opening_credits_customer on public.acc_opening_customer_credits(organization_id);
create index acc_credit_applications_receipt on public.acc_customer_credit_applications(source_receipt_id,application_date) where source_receipt_id is not null;
create index acc_credit_applications_source_invoice on public.acc_customer_credit_applications(source_invoice_id,application_date) where source_invoice_id is not null;
create index acc_credit_applications_opening on public.acc_customer_credit_applications(source_opening_credit_id,application_date) where source_opening_credit_id is not null;
create index acc_refunds_receipt on public.acc_customer_refunds(source_receipt_id,refund_date) where source_receipt_id is not null;
create index acc_refunds_source_invoice on public.acc_customer_refunds(source_invoice_id,refund_date) where source_invoice_id is not null;
create index acc_refunds_opening on public.acc_customer_refunds(source_opening_credit_id,refund_date) where source_opening_credit_id is not null;
do $$ declare t text;v text;begin
 foreach t in array array['acc_opening_customer_credits','acc_customer_credit_applications','acc_customer_refunds'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('create policy %I on public.%I for select to authenticated using((select public.accounting_access()))',t||'_read',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('grant select on public.%I to authenticated',t);
 end loop;
 -- Preserve source types installed by supplier and inventory migrations.
 select pg_get_constraintdef(oid) into v from pg_constraint where conrelid='public.acc_journal_entries'::regclass and conname='acc_journal_entries_source_type_check';
 alter table public.acc_journal_entries drop constraint acc_journal_entries_source_type_check;
 execute 'alter table public.acc_journal_entries add constraint acc_journal_entries_source_type_check check (source_type=''refund'' or ('||substring(v from 7)||'))';
end $$;
revoke all on sequence public.acc_customer_refund_number_seq from public,anon,authenticated;
create trigger acc_opening_customer_credits_immutable before update or delete on public.acc_opening_customer_credits for each row execute function public.acc_deny_change();
create trigger acc_credit_applications_immutable before update or delete on public.acc_customer_credit_applications for each row execute function public.acc_deny_change();
create trigger acc_customer_refunds_void_only before update or delete on public.acc_customer_refunds for each row execute function public.acc_guard_void();

-- Opening corrections supersede an unused schedule; all original rows and request identities remain available for audit.
alter table public.acc_opening_receivable_imports add column superseded_by uuid references public.acc_opening_receivable_imports(id) deferrable initially deferred;
alter table public.acc_opening_receivable_refs add column superseded_by uuid references public.acc_opening_receivable_imports(id) deferrable initially deferred;
alter table public.acc_opening_receivable_imports drop constraint acc_opening_receivable_imports_gl_import_id_key;
create unique index acc_opening_receivable_active_gl on public.acc_opening_receivable_imports(gl_import_id) where superseded_by is null;
alter table public.acc_opening_receivable_refs drop constraint acc_opening_receivable_refs_pkey;
create unique index acc_opening_receivable_active_ref on public.acc_opening_receivable_refs(source,reference) where superseded_by is null;
create table public.acc_opening_receivable_corrections (
 id uuid primary key references public.acc_opening_receivable_imports(id) deferrable initially deferred,
 replaces_import_id uuid not null unique references public.acc_opening_receivable_imports(id),
 rows jsonb not null,reason text not null check(length(reason) between 5 and 300),
 created_by uuid not null references auth.users(id),created_at timestamptz not null default now()
);
alter table public.acc_opening_receivable_corrections enable row level security;
create policy acc_opening_receivable_corrections_read on public.acc_opening_receivable_corrections for select to authenticated using((select public.accounting_access()));
revoke all on public.acc_opening_receivable_corrections from public,anon,authenticated;
grant select on public.acc_opening_receivable_corrections to authenticated;
create trigger acc_opening_receivable_corrections_immutable before update or delete on public.acc_opening_receivable_corrections for each row execute function public.acc_deny_change();
create function public.acc_guard_opening_supersede() returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
 if tg_op='DELETE' then raise exception 'Opening history cannot be deleted';end if;
 if old.superseded_by is not null or new.superseded_by is null or to_jsonb(old)-'superseded_by' is distinct from to_jsonb(new)-'superseded_by' then raise exception 'Posted opening records cannot be changed except for a recorded replacement';end if;
 return new;
end $$;
revoke all on function public.acc_guard_opening_supersede() from public,anon,authenticated;
drop trigger opening_receivable_imports_immutable on public.acc_opening_receivable_imports;
drop trigger opening_receivable_refs_immutable on public.acc_opening_receivable_refs;
create trigger opening_receivable_imports_immutable before update or delete on public.acc_opening_receivable_imports for each row execute function public.acc_guard_opening_supersede();
create trigger opening_receivable_refs_immutable before update or delete on public.acc_opening_receivable_refs for each row execute function public.acc_guard_opening_supersede();

alter table public.acc_credit_notes add column voided_at timestamptz;
alter table public.acc_credit_notes add column voided_by uuid references auth.users(id);
alter table public.acc_credit_notes add column void_reason text;
alter table public.acc_credit_notes add column void_entry_id uuid unique references public.acc_journal_entries(id);
alter table public.acc_credit_notes add column replaces_credit_id uuid unique references public.acc_credit_notes(id);
alter table public.acc_credit_notes add constraint acc_credit_note_void_state check((voided_at is null)=(voided_by is null) and (voided_at is null)=(void_reason is null) and (voided_at is null)=(void_entry_id is null));
alter table public.acc_credit_notes drop constraint acc_credit_notes_return_id_key;
alter table public.acc_credit_notes drop constraint acc_credit_notes_draft_id_key;
create unique index acc_credit_note_active_return on public.acc_credit_notes(return_id) where voided_at is null;
create unique index acc_credit_note_active_draft on public.acc_credit_notes(draft_id) where voided_at is null;
drop trigger acc_credit_notes_immutable on public.acc_credit_notes;
create function public.acc_guard_credit_note_void() returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
 if tg_op='DELETE' then raise exception 'Posted accounting records cannot be changed or deleted; use the dated credit void';end if;
 if old.voided_at is not null or new.voided_at is null or (to_jsonb(new)-'voided_at'-'voided_by'-'void_reason'-'void_entry_id') is distinct from (to_jsonb(old)-'voided_at'-'voided_by'-'void_reason'-'void_entry_id') then raise exception 'Posted accounting records cannot be changed except by a dated credit void';end if;return new;
end $$;
revoke all on function public.acc_guard_credit_note_void() from public,anon,authenticated;
create trigger acc_credit_notes_immutable before update or delete on public.acc_credit_notes for each row execute function public.acc_guard_credit_note_void();

create function public.acc_credit_json(p_row jsonb) returns jsonb language sql immutable set search_path=public,pg_temp as $$
 select jsonb_object_agg(key,case when key like '%\_minor' escape '\' and jsonb_typeof(value)='number' then to_jsonb(value#>>'{}') else value end) from jsonb_each(p_row)
$$;
revoke all on function public.acc_credit_json(jsonb) from public,anon,authenticated;

create function public.acc_credit_date(p_date date) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare v_lock date;
begin
 if p_date is null or not isfinite(p_date) or p_date>current_date+31 then raise exception 'Choose a finite accounting date no more than 31 days ahead'; end if;
 select locked_through into v_lock from public.acc_settings where id for share;
 if p_date<=v_lock then raise exception 'The books are locked through %; choose a later date',v_lock; end if;
end $$;

create function public.acc_credit_used(p_receipt uuid,p_invoice uuid,p_opening uuid,p_date date)
returns table(applied bigint,refunded bigint) language sql stable security definer set search_path=public,pg_temp as $$
 select (select coalesce(sum(case when a.reverses_application_id is null then a.amount_minor else -a.amount_minor end),0)::bigint
  from public.acc_customer_credit_applications a where a.application_date<=p_date and
  ((p_receipt is not null and a.source_receipt_id=p_receipt) or (p_invoice is not null and a.source_invoice_id=p_invoice) or (p_opening is not null and a.source_opening_credit_id=p_opening))),
 (select coalesce(sum(r.amount_minor),0)::bigint from public.acc_customer_refunds r left join public.acc_journal_entries v on v.id=r.void_entry_id
  where r.refund_date<=p_date and (v.id is null or v.entry_date>p_date) and
  ((p_receipt is not null and r.source_receipt_id=p_receipt) or (p_invoice is not null and r.source_invoice_id=p_invoice) or (p_opening is not null and r.source_opening_credit_id=p_opening)))
$$;
create function public.acc_invoice_credit_position(p_invoice uuid,p_date date)
returns table(paid_minor bigint,credited_minor bigint,applied_credit_minor bigint,credit_used_minor bigint,refunded_minor bigint,residual_minor bigint)
language sql stable security definer set search_path=public,pg_temp as $$
 select p.paid,c.credited,a.applied,u.applied,u.refunded,(i.total_minor-p.paid-c.credited-a.applied+u.applied+u.refunded)::bigint
 from public.acc_invoices i cross join lateral(select public.acc_invoice_paid_minor(i.id,p_date) paid)p
 cross join lateral(select coalesce(sum(total_minor),0)::bigint credited from public.acc_credit_notes cn left join public.acc_journal_entries cv on cv.id=cn.void_entry_id where cn.invoice_id=i.id and cn.credit_date<=p_date and (cv.id is null or cv.entry_date>p_date))c
 cross join lateral(select coalesce(sum(case when reverses_application_id is null then amount_minor else -amount_minor end),0)::bigint applied from public.acc_customer_credit_applications where invoice_id=i.id and application_date<=p_date)a
 cross join lateral public.acc_credit_used(null,i.id,null,p_date)u where i.id=p_invoice
$$;
create function public.acc_credit_available(p_receipt uuid,p_invoice uuid,p_opening uuid,p_date date)
returns bigint language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v bigint;v_used record;
begin
 select * into v_used from public.acc_credit_used(p_receipt,p_invoice,p_opening,p_date);
 if p_receipt is not null then
  select case when r.receipt_date<=p_date and (v.id is null or v.entry_date>p_date) then r.amount_minor-coalesce((select sum(a.amount_minor) from public.acc_receipt_allocations a where a.receipt_id=r.id),0) else 0 end
   into v from public.acc_receipts r left join public.acc_journal_entries v on v.id=r.void_entry_id where r.id=p_receipt;
  return coalesce(v,0)-v_used.applied-v_used.refunded;
 elsif p_opening is not null then
  select case when c.cutover_date<=p_date then c.amount_minor else 0 end into v from public.acc_opening_customer_credits c join public.acc_opening_receivable_imports oi on oi.id=c.import_id and oi.superseded_by is null where c.id=p_opening;
  return coalesce(v,0)-v_used.applied-v_used.refunded;
 else
  select -p.residual_minor into v from public.acc_invoices i cross join lateral public.acc_invoice_credit_position(i.id,p_date)p
   left join public.acc_journal_entries v on v.id=i.void_entry_id
   where i.id=p_invoice and (i.opening_import_id is null or exists(select 1 from public.acc_opening_receivable_imports oi where oi.id=i.opening_import_id and oi.superseded_by is null)) and greatest(i.invoice_date,coalesce(i.opening_cutover_date,i.invoice_date))<=p_date and (v.id is null or v.entry_date>p_date);
  return coalesce(v,0);
 end if;
end $$;
create function public.acc_credit_customer(p_receipt uuid,p_invoice uuid,p_opening uuid) returns uuid
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v uuid;
begin
 if num_nonnulls(p_receipt,p_invoice,p_opening)<>1 then raise exception 'Choose exactly one credit source'; end if;
 if p_receipt is not null then select organization_id into v from public.acc_receipts where id=p_receipt;
 elsif p_invoice is not null then select organization_id into v from public.acc_invoices where id=p_invoice and currency='TZS';
 else select organization_id into v from public.acc_opening_customer_credits where id=p_opening and currency='TZS';end if;
 if v is null then raise exception 'Customer credit source not found'; end if; return v;
end $$;
create function public.acc_credit_event_dates(p_org uuid,p_from date) returns table(event_date date)
language sql stable security definer set search_path=public,pg_temp as $$
 select distinct d from (
 select p_from d union all select invoice_date from public.acc_invoices where organization_id=p_org
 union all select receipt_date from public.acc_receipts where organization_id=p_org
 union all select e.entry_date from public.acc_receipts r join public.acc_journal_entries e on e.id=r.void_entry_id where r.organization_id=p_org
 union all select e.entry_date from public.acc_invoices i join public.acc_journal_entries e on e.id=i.void_entry_id where i.organization_id=p_org
 union all select credit_date from public.acc_credit_notes where organization_id=p_org
 union all select e.entry_date from public.acc_credit_notes c join public.acc_journal_entries e on e.id=c.void_entry_id where c.organization_id=p_org
 union all select application_date from public.acc_customer_credit_applications where organization_id=p_org
 union all select refund_date from public.acc_customer_refunds where organization_id=p_org
 union all select e.entry_date from public.acc_customer_refunds r join public.acc_journal_entries e on e.id=r.void_entry_id where r.organization_id=p_org
 union all select cutover_date from public.acc_opening_customer_credits where organization_id=p_org
 )x where d>=p_from order by d
$$;
-- Check every later boundary, including dependencies created by a returned invoice settled with reused credit.
create function public.acc_validate_customer_credit(p_org uuid,p_from date) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare d date; s record;u record;v_active boolean;
begin
 for d in select event_date from public.acc_credit_event_dates(p_org,p_from) loop
  for s in select id from public.acc_receipts where organization_id=p_org loop
   if public.acc_credit_available(s.id,null,null,d)<0 then raise exception 'Insufficient customer credit at %; reverse dependent applications or refunds first',d; end if;
  end loop;
  for s in select id from public.acc_opening_customer_credits where organization_id=p_org loop
   if public.acc_credit_available(null,null,s.id,d)<0 then raise exception 'Insufficient opening customer credit at %',d;end if;
  end loop;
  for s in select i.* from public.acc_invoices i where i.organization_id=p_org loop
   select * into u from public.acc_credit_used(null,s.id,null,d);
   select s.invoice_date<=d and (s.opening_cutover_date is null or s.opening_cutover_date<=d) and (s.void_entry_id is null or (select entry_date from public.acc_journal_entries where id=s.void_entry_id)>d) into v_active;
   if u.applied+u.refunded>0 and (not v_active or public.acc_credit_available(null,s.id,null,d)<0) then raise exception 'Insufficient invoice customer credit at %; reverse dependent applications or refunds first',d; end if;
   if s.void_entry_id is not null and (select entry_date from public.acc_journal_entries where id=s.void_entry_id)<=d and public.acc_invoice_paid_minor(s.id,d)>0 then raise exception 'Void the receipts paid against this invoice first';end if;
   if not v_active and exists(select 1 from public.acc_invoice_credit_position(s.id,d) where applied_credit_minor>0) then raise exception 'Reverse credit applications before voiding their invoice'; end if;
  end loop;
 end loop;
end $$;
create function public.acc_check_credit_target(p_invoice uuid,p_date date,p_amount bigint) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare i public.acc_invoices;d date;v bigint;
begin
 select * into i from public.acc_invoices where id=p_invoice for update;
 if not found or i.voided_at is not null or i.currency<>'TZS' or (i.opening_import_id is not null and exists(select 1 from public.acc_opening_receivable_imports oi where oi.id=i.opening_import_id and oi.superseded_by is not null)) then raise exception 'Choose an active TZS invoice'; end if;
 if p_date<i.invoice_date then raise exception 'Settlement date cannot precede its invoice'; end if;
 if p_date<=i.opening_cutover_date then raise exception 'Settlements against an opening residual must be dated after its cutover date'; end if;
 for d in select p_date union select r.receipt_date from public.acc_receipts r join public.acc_receipt_allocations a on a.receipt_id=r.id where a.invoice_id=i.id and r.receipt_date>p_date
  union select application_date from public.acc_customer_credit_applications where invoice_id=i.id and reverses_application_id is null and application_date>p_date loop
  select residual_minor into v from public.acc_invoice_credit_position(i.id,d);
  if v<p_amount then raise exception 'Invoice has less left to pay after posted credits and settlements at %',d; end if;
 end loop;
end $$;

create function public.apply_customer_credit(p_id uuid,p_source_receipt_id uuid,p_source_invoice_id uuid,p_source_opening_credit_id uuid,p_invoice_id uuid,p_date date,p_amount_minor bigint)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v public.acc_customer_credit_applications;v_org uuid;v_actor uuid;
begin
 v_actor:=public.acc_require_access();if v_actor is null then raise exception 'Accounting access is required' using errcode='42501';end if;
 if p_id is null then raise exception 'Credit application request ID is required'; end if;
 perform pg_advisory_xact_lock(hashtextextended('acc-credit-request:'||p_id::text,0));
 select * into v from public.acc_customer_credit_applications where id=p_id;
 if found then
  if v.source_receipt_id is distinct from p_source_receipt_id or v.source_invoice_id is distinct from p_source_invoice_id or v.source_opening_credit_id is distinct from p_source_opening_credit_id or v.invoice_id is distinct from p_invoice_id or v.application_date is distinct from p_date or v.amount_minor is distinct from p_amount_minor or v.reverses_application_id is not null then raise exception 'Credit application identity was already used for different details';end if;return public.acc_credit_json(to_jsonb(v));
 end if;
 v_org:=public.acc_credit_customer(p_source_receipt_id,p_source_invoice_id,p_source_opening_credit_id);
 perform pg_advisory_xact_lock(hashtextextended('acc-receipt-org:'||v_org::text,0));
 perform public.acc_credit_date(p_date);
 if p_amount_minor is null or p_amount_minor<=0 then raise exception 'Enter an amount above zero';end if;
 if p_source_invoice_id=p_invoice_id then raise exception 'A credit cannot be applied to its source invoice';end if;
 perform 1 from public.acc_invoices where id in(p_invoice_id,p_source_invoice_id) order by id for update;
 if not exists(select 1 from public.acc_invoices where id=p_invoice_id and organization_id=v_org) then raise exception 'Credit and target invoice must belong to the same customer';end if;
 if public.acc_credit_available(p_source_receipt_id,p_source_invoice_id,p_source_opening_credit_id,p_date)<p_amount_minor then raise exception 'Insufficient customer credit on the application date';end if;
 perform public.acc_check_credit_target(p_invoice_id,p_date,p_amount_minor);
 insert into public.acc_customer_credit_applications(id,organization_id,source_receipt_id,source_invoice_id,source_opening_credit_id,invoice_id,application_date,amount_minor,created_by)
 values(p_id,v_org,p_source_receipt_id,p_source_invoice_id,p_source_opening_credit_id,p_invoice_id,p_date,p_amount_minor,v_actor) returning * into v;
 perform public.acc_validate_customer_credit(v_org,p_date);return public.acc_credit_json(to_jsonb(v));
end $$;
create function public.reverse_customer_credit_application(p_id uuid,p_application_id uuid,p_date date,p_reason text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v public.acc_customer_credit_applications;o public.acc_customer_credit_applications;v_actor uuid;
begin
 v_actor:=public.acc_require_access();if v_actor is null then raise exception 'Accounting access is required' using errcode='42501';end if;
 if p_id is null or p_application_id is null then raise exception 'Reversal and application IDs are required';end if;
 perform pg_advisory_xact_lock(hashtextextended('acc-credit-request:'||p_id::text,0));
 select * into v from public.acc_customer_credit_applications where id=p_id;
 if found then
  if v.reverses_application_id is distinct from p_application_id or v.application_date is distinct from p_date or v.reason is distinct from trim(p_reason) then raise exception 'Credit reversal identity was already used for different details';end if;return public.acc_credit_json(to_jsonb(v));
 end if;
 select * into o from public.acc_customer_credit_applications where id=p_application_id;
 if not found or o.reverses_application_id is not null then raise exception 'Choose an original credit application';end if;
 perform pg_advisory_xact_lock(hashtextextended('acc-receipt-org:'||o.organization_id::text,0));
 perform public.acc_credit_date(p_date);
 if p_date<o.application_date then raise exception 'Reversal cannot precede the original application';end if;
 if p_reason is null or length(trim(p_reason)) not between 5 and 300 then raise exception 'Give a reason of 5 to 300 characters';end if;
 if exists(select 1 from public.acc_customer_credit_applications where reverses_application_id=o.id) then raise exception 'This application has already been reversed';end if;
 insert into public.acc_customer_credit_applications(id,organization_id,source_receipt_id,source_invoice_id,source_opening_credit_id,invoice_id,application_date,amount_minor,reverses_application_id,reason,created_by)
 values(p_id,o.organization_id,o.source_receipt_id,o.source_invoice_id,o.source_opening_credit_id,o.invoice_id,p_date,o.amount_minor,o.id,trim(p_reason),v_actor) returning * into v;
 perform public.acc_validate_customer_credit(o.organization_id,p_date);return public.acc_credit_json(to_jsonb(v));
end $$;
create function public.refund_customer_credit(p_id uuid,p_source_receipt_id uuid,p_source_invoice_id uuid,p_source_opening_credit_id uuid,p_date date,p_amount_minor bigint,p_payout_account_id uuid,p_method text,p_reference text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v public.acc_customer_refunds;v_org uuid;v_actor uuid;v_entry uuid:=gen_random_uuid();
begin
 v_actor:=public.acc_require_access();if v_actor is null then raise exception 'Accounting access is required' using errcode='42501';end if;
 if p_id is null then raise exception 'Refund request ID is required';end if;
 perform pg_advisory_xact_lock(hashtextextended('acc-credit-request:'||p_id::text,0));
 select * into v from public.acc_customer_refunds where id=p_id;
 if found then
  if v.source_receipt_id is distinct from p_source_receipt_id or v.source_invoice_id is distinct from p_source_invoice_id or v.source_opening_credit_id is distinct from p_source_opening_credit_id or v.refund_date is distinct from p_date or v.amount_minor is distinct from p_amount_minor or v.payout_account_id is distinct from p_payout_account_id or v.method is distinct from p_method or v.reference is distinct from trim(coalesce(p_reference,'')) then raise exception 'Refund identity was already used for different details';end if;return public.acc_credit_json(to_jsonb(v));
 end if;
 v_org:=public.acc_credit_customer(p_source_receipt_id,p_source_invoice_id,p_source_opening_credit_id);
 perform pg_advisory_xact_lock(hashtextextended('acc-receipt-org:'||v_org::text,0));perform public.acc_credit_date(p_date);
 if p_amount_minor is null or p_amount_minor<=0 then raise exception 'Enter an amount above zero';end if;
 if p_method is null or p_method not in('bank','cash','mobile_money','cheque') or length(coalesce(p_reference,''))>120 then raise exception 'Choose a valid payout method and reference';end if;
 if not exists(select 1 from public.acc_accounts where id=p_payout_account_id and active and account_type='asset' and system_key is distinct from 'receivables' and code~'^1[12][0-9]{2}$') then raise exception 'Choose an active bank, cash or mobile money payout account';end if;
 if public.acc_credit_available(p_source_receipt_id,p_source_invoice_id,p_source_opening_credit_id,p_date)<p_amount_minor then raise exception 'Insufficient customer credit on the refund date';end if;
 perform public.acc_post(v_entry,p_date,'Customer refund'||case when trim(coalesce(p_reference,''))<>'' then ' '||trim(p_reference) else '' end,'refund',p_id,null,
 jsonb_build_array(jsonb_build_object('account_id',public.acc_account_by_key('receivables'),'debit_minor',p_amount_minor,'organization_id',v_org),jsonb_build_object('account_id',p_payout_account_id,'credit_minor',p_amount_minor)));
 insert into public.acc_customer_refunds(id,refund_number,organization_id,source_receipt_id,source_invoice_id,source_opening_credit_id,refund_date,amount_minor,payout_account_id,method,reference,journal_entry_id,created_by)
 values(p_id,'RF-'||to_char(p_date,'YYYY')||'-'||lpad(nextval('public.acc_customer_refund_number_seq')::text,6,'0'),v_org,p_source_receipt_id,p_source_invoice_id,p_source_opening_credit_id,p_date,p_amount_minor,p_payout_account_id,p_method,trim(coalesce(p_reference,'')),v_entry,v_actor) returning * into v;
 perform public.acc_validate_customer_credit(v_org,p_date);return public.acc_credit_json(to_jsonb(v));
end $$;
create function public.void_customer_refund(p_refund_id uuid,p_date date,p_reason text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v public.acc_customer_refunds;v_actor uuid;v_rev uuid:=gen_random_uuid();
begin
 v_actor:=public.acc_require_access();if v_actor is null then raise exception 'Accounting access is required' using errcode='42501';end if;
 select * into v from public.acc_customer_refunds where id=p_refund_id;
 if not found then raise exception 'Refund not found';end if;
 perform pg_advisory_xact_lock(hashtextextended('acc-receipt-org:'||v.organization_id::text,0));
 select * into v from public.acc_customer_refunds where id=p_refund_id for update;
 if v.voided_at is not null then
  if v.void_reason is distinct from trim(p_reason) or (select entry_date from public.acc_journal_entries where id=v.void_entry_id) is distinct from p_date then raise exception 'Refund void already saved with different details';end if;return public.acc_credit_json(to_jsonb(v))||jsonb_build_object('void_date',(select entry_date from public.acc_journal_entries where id=v.void_entry_id));
 end if;
 perform public.acc_credit_date(p_date);
 if p_reason is null or length(trim(p_reason)) not between 5 and 300 then raise exception 'Give a reason of 5 to 300 characters';end if;
 perform public.acc_reverse(v_rev,v.journal_entry_id,p_date,'Void '||v.refund_number||': '||trim(p_reason));
 update public.acc_customer_refunds set voided_at=now(),voided_by=v_actor,void_reason=trim(p_reason),void_entry_id=v_rev where id=p_refund_id returning * into v;
 perform public.acc_validate_customer_credit(v.organization_id,p_date);return public.acc_credit_json(to_jsonb(v))||jsonb_build_object('void_date',(select entry_date from public.acc_journal_entries where id=v.void_entry_id));
end $$;

-- Preserve current register columns; distinguish cash received from applied and refunded credit.
create or replace view public.acc_invoice_balances with (security_invoker=true) as
 select i.id,i.invoice_number,i.proforma_id,i.proforma_revision,i.organization_id,i.invoice_date,i.due_date,i.tax_invoice_reference,i.currency,i.subtotal_minor,i.discount_minor,i.tax_minor,i.total_minor,i.lines,i.journal_entry_id,i.created_by,i.created_at,i.voided_at,i.voided_by,i.void_reason,i.void_entry_id,i.buyer_tin,i.buyer_vrn,i.tra_receipt_number,i.tra_verification_code,i.fiscal_recorded_by,i.fiscal_recorded_at,pf.document_number as proforma_number,p.paid_minor,
 case when i.voided_at is not null then 0 else greatest(i.total_minor-p.paid_minor-c.credited_minor-a.applied_credit_minor+u.credit_used_minor+f.refunded_minor,0) end as outstanding_minor,
 case when i.voided_at is not null then 'void' when p.paid_minor+c.credited_minor+a.applied_credit_minor-u.credit_used_minor-f.refunded_minor>=i.total_minor then 'paid'
 when i.due_date<(now() at time zone 'Africa/Dar_es_Salaam')::date then 'overdue'
 when p.paid_minor+c.credited_minor+a.applied_credit_minor>0 then 'part' else 'open' end as status_key,
 case when i.voided_at is not null then 'Void' when c.credited_minor>=i.total_minor then 'Credited'
 when p.paid_minor+c.credited_minor+a.applied_credit_minor-u.credit_used_minor-f.refunded_minor>=i.total_minor then 'Paid'
 when i.due_date<(now() at time zone 'Africa/Dar_es_Salaam')::date then 'Overdue'
 when p.paid_minor+c.credited_minor+a.applied_credit_minor>0 then 'Part settled' else 'Unpaid' end as status_label,
 c.credited_minor,case when i.voided_at is not null then 0 else greatest(p.paid_minor+c.credited_minor+a.applied_credit_minor-u.credit_used_minor-f.refunded_minor-i.total_minor,0) end as customer_credit_minor,
 i.opening_import_id,i.opening_cutover_date,i.opening_reference,a.applied_credit_minor,u.credit_used_minor,f.refunded_minor
 from public.acc_invoices i left join public.sales_proformas pf on pf.id=i.proforma_id
 cross join lateral(select coalesce(sum(a.amount_minor),0)::bigint paid_minor from public.acc_receipt_allocations a join public.acc_receipts r on r.id=a.receipt_id where a.invoice_id=i.id and r.voided_at is null)p
 cross join lateral(select coalesce(sum(total_minor),0)::bigint credited_minor from public.acc_credit_notes where invoice_id=i.id and voided_at is null)c
 cross join lateral(select coalesce(sum(case when reverses_application_id is null then amount_minor else -amount_minor end),0)::bigint applied_credit_minor from public.acc_customer_credit_applications where invoice_id=i.id)a
 cross join lateral(select coalesce(sum(case when reverses_application_id is null then amount_minor else -amount_minor end),0)::bigint credit_used_minor from public.acc_customer_credit_applications where source_invoice_id=i.id)u
 cross join lateral(select coalesce(sum(amount_minor),0)::bigint refunded_minor from public.acc_customer_refunds where source_invoice_id=i.id and voided_at is null)f
 where i.opening_import_id is null or exists(select 1 from public.acc_opening_receivable_imports oi where oi.id=i.opening_import_id and oi.superseded_by is null);

create or replace function public.acc_receivables_ageing(p_as_of date)
returns table(organization_id uuid,customer text,current_minor bigint,days_1_30_minor bigint,days_31_60_minor bigint,days_61_90_minor bigint,days_over_90_minor bigint,unapplied_credit_minor bigint,balance_minor bigint)
language plpgsql stable security definer set search_path=public,pg_temp as $$
#variable_conflict use_column
begin
 perform public.acc_require_access();
 if p_as_of is null or not isfinite(p_as_of) then raise exception 'Choose a finite report date';end if;
 return query
 with active_invoices as (
 select i.* from public.acc_invoices i left join public.acc_journal_entries v on v.id=i.void_entry_id
 where (i.opening_import_id is null or exists(select 1 from public.acc_opening_receivable_imports oi where oi.id=i.opening_import_id and oi.superseded_by is null)) and i.invoice_date<=p_as_of and (i.opening_cutover_date is null or i.opening_cutover_date<=p_as_of) and (v.id is null or v.entry_date>p_as_of)
 ), positions as (
 select i.organization_id,i.due_date,p.residual_minor due from active_invoices i cross join lateral public.acc_invoice_credit_position(i.id,p_as_of)p
 ), credits as (
 select organization_id,sum(credit) credit from (
 select r.organization_id,r.amount_minor-coalesce((select sum(a.amount_minor) from public.acc_receipt_allocations a join active_invoices i on i.id=a.invoice_id where a.receipt_id=r.id),0)-u.applied-u.refunded credit
 from public.acc_receipts r left join public.acc_journal_entries v on v.id=r.void_entry_id cross join lateral public.acc_credit_used(r.id,null,null,p_as_of)u
 where r.receipt_date<=p_as_of and (v.id is null or v.entry_date>p_as_of)
 union all select c.organization_id,c.amount_minor-u.applied-u.refunded from public.acc_opening_customer_credits c cross join lateral public.acc_credit_used(null,null,c.id,p_as_of)u where c.cutover_date<=p_as_of and exists(select 1 from public.acc_opening_receivable_imports oi where oi.id=c.import_id and oi.superseded_by is null)
 union all select organization_id,-due from positions where due<0
 )x group by organization_id
 ), b as (
 select organization_id,sum(case when p_as_of-due_date<=0 then due else 0 end)c0,
 sum(case when p_as_of-due_date between 1 and 30 then due else 0 end)c1,
 sum(case when p_as_of-due_date between 31 and 60 then due else 0 end)c2,
 sum(case when p_as_of-due_date between 61 and 90 then due else 0 end)c3,
 sum(case when p_as_of-due_date>90 then due else 0 end)c4 from positions where due>0 group by organization_id)
 select k.organization_id,o.name,coalesce(b.c0,0)::bigint,coalesce(b.c1,0)::bigint,coalesce(b.c2,0)::bigint,coalesce(b.c3,0)::bigint,coalesce(b.c4,0)::bigint,
 coalesce(cr.credit,0)::bigint,(coalesce(b.c0,0)+coalesce(b.c1,0)+coalesce(b.c2,0)+coalesce(b.c3,0)+coalesce(b.c4,0)-coalesce(cr.credit,0))::bigint
 from (select organization_id from b union select organization_id from credits where credit<>0)k join public.organizations o on o.id=k.organization_id
 left join b on b.organization_id=k.organization_id left join credits cr on cr.organization_id=k.organization_id order by 9 desc,2;
end $$;

create function public.acc_customer_credit_sources(p_organization_id uuid,p_as_of date) returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v jsonb;
begin
 perform public.acc_require_access();if auth.uid() is null then raise exception 'Accounting access is required' using errcode='42501';end if;
 if p_as_of is null or not isfinite(p_as_of) then raise exception 'Choose a finite report date';end if;
 with sources as (
 select 'receipt' source_type,r.id source_id,r.receipt_number reference,r.receipt_date date,public.acc_credit_available(r.id,null,null,p_as_of) available from public.acc_receipts r where organization_id=p_organization_id
 union all select 'invoice',i.id,i.invoice_number,greatest(i.invoice_date,coalesce(i.opening_cutover_date,i.invoice_date)),public.acc_credit_available(null,i.id,null,p_as_of) from public.acc_invoices i where organization_id=p_organization_id
 union all select 'opening',c.id,c.reference,c.cutover_date,public.acc_credit_available(null,null,c.id,p_as_of) from public.acc_opening_customer_credits c where organization_id=p_organization_id
 ) select jsonb_build_object('as_of',p_as_of,'sources',coalesce((select jsonb_agg(jsonb_build_object('source_type',source_type,'source_id',source_id,'reference',reference,'date',date,'available_minor',available::text) order by date,source_id) from sources where available>0),'[]'::jsonb),
 'invoices',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'invoice_number',i.invoice_number,'outstanding_minor',p.residual_minor::text,'invoice_date',i.invoice_date,'opening_cutover_date',i.opening_cutover_date) order by i.invoice_date,i.id)
 from public.acc_invoices i cross join lateral public.acc_invoice_credit_position(i.id,p_as_of)p where i.organization_id=p_organization_id and (i.opening_import_id is null or exists(select 1 from public.acc_opening_receivable_imports oi where oi.id=i.opening_import_id and oi.superseded_by is null)) and i.voided_at is null and i.invoice_date<=p_as_of and (i.opening_cutover_date is null or i.opening_cutover_date<p_as_of) and p.residual_minor>0),'[]'::jsonb),
 'applications',coalesce((select jsonb_agg(to_jsonb(a)||jsonb_build_object('amount_minor',a.amount_minor::text,'invoice_number',(select invoice_number from public.acc_invoices where id=a.invoice_id)) order by a.application_date desc,a.id) from public.acc_customer_credit_applications a where a.organization_id=p_organization_id),'[]'::jsonb),
 'refunds',coalesce((select jsonb_agg(to_jsonb(r)||jsonb_build_object('amount_minor',r.amount_minor::text,'void_date',(select entry_date from public.acc_journal_entries where id=r.void_entry_id)) order by r.refund_date desc,r.id) from public.acc_customer_refunds r where r.organization_id=p_organization_id),'[]'::jsonb),
 'return_credits',coalesce((select jsonb_agg(public.acc_credit_json(to_jsonb(c))||jsonb_build_object('invoice_number',i.invoice_number,'void_date',v.entry_date) order by c.credit_date desc,c.id) from public.acc_credit_notes c join public.acc_invoices i on i.id=c.invoice_id left join public.acc_journal_entries v on v.id=c.void_entry_id where c.organization_id=p_organization_id),'[]'::jsonb)) into v;
 return v;
end $$;

-- Keep exact original receipt retries, then enforce the dated target cap for every new allocation.
create or replace function public.acc_guard_credit_allocation() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare d date;i public.acc_invoices;
begin
 select receipt_date into d from public.acc_receipts where id=new.receipt_id;
 select * into i from public.acc_invoices where id=new.invoice_id;
 -- Existing advance receipts may reserve a future invoice; they must remain reserved before it becomes effective.
 perform public.acc_check_credit_target(new.invoice_id,greatest(d,i.invoice_date),new.amount_minor);
 return new;
end $$;
do $patch$
declare v text;old_text text;new_text text;
begin
 v:=pg_get_functiondef('public.record_receipt(uuid,uuid,date,bigint,text,text,uuid,jsonb)'::regprocedure);
 old_text:=' if p_amount_minor is null or p_amount_minor<=0 then';
 if strpos(v,old_text)=0 then raise exception 'Unexpected receipt validation dependency';end if;
 v:=replace(v,' perform pg_advisory_xact_lock(hashtextextended(''acc-receipt-org:''',' perform pg_advisory_xact_lock(hashtextextended(''acc-receipt-id:''||p_id::text,0));'||chr(10)||' perform pg_advisory_xact_lock(hashtextextended(''acc-receipt-org:''');
 v:=replace(v,old_text,' perform public.acc_credit_date(p_date);'||chr(10)||old_text);
 old_text:='  if v_amt>v_inv.total_minor-public.acc_invoice_paid_minor(v_inv.id) then raise exception ''Invoice % has less than that left to pay'', v_inv.invoice_number; end if;';
 if strpos(v,old_text)=0 then raise exception 'Unexpected receipt allocation dependency';end if;
 v:=replace(v,old_text,'  -- The allocation trigger checks dated applications, returns and future committed settlements.');
 v:=replace(v,' if v_total>p_amount_minor then',' perform public.acc_validate_customer_credit(p_organization_id,p_date);'||chr(10)||' if v_total>p_amount_minor then');
 execute v;
 v:=pg_get_functiondef('public.void_receipt(uuid,date,text)'::regprocedure);
 old_text:=' select * into v from public.acc_receipts where id=p_receipt_id for update;';
 if strpos(v,old_text)=0 then raise exception 'Unexpected receipt void dependency';end if;
 v:=replace(v,old_text,' perform pg_advisory_xact_lock(hashtextextended(''acc-receipt-org:''||(select organization_id::text from public.acc_receipts where id=p_receipt_id),0));'||chr(10)||old_text);
 v:=replace(v,' if v.voided_at is not null then return v; end if;',' if v.voided_at is not null then if v.void_reason is distinct from trim(p_reason) or (select entry_date from public.acc_journal_entries where id=v.void_entry_id) is distinct from p_date then raise exception ''Receipt void already saved with different details'';end if;return v;end if; perform public.acc_credit_date(p_date);');
 v:=replace(v,' return v;'||chr(10)||'end',' perform public.acc_validate_customer_credit(v.organization_id,p_date);'||chr(10)||' return v;'||chr(10)||'end');
 execute v;
 v:=pg_get_functiondef('public.void_invoice(uuid,date,text)'::regprocedure);
 old_text:=' select proforma_id into v_pf from public.acc_invoices where id=p_invoice_id;';
 if strpos(v,old_text)=0 then raise exception 'Unexpected invoice void dependency';end if;
 v:=replace(v,old_text,' perform pg_advisory_xact_lock(hashtextextended(''acc-receipt-org:''||(select organization_id::text from public.acc_invoices where id=p_invoice_id),0));'||chr(10)||old_text);
 v:=replace(v,' perform public.acc_reverse(v_rev,v.journal_entry_id,p_date,',' perform public.acc_credit_date(p_date);'||chr(10)||' perform public.acc_reverse(v_rev,v.journal_entry_id,p_date,');
 v:=replace(v,' perform public.sync_order_pending(v.proforma_id);',' perform public.acc_validate_customer_credit(v.organization_id,p_date);'||chr(10)||' perform public.sync_order_pending(v.proforma_id);');execute v;
 v:=pg_get_functiondef('public.post_return_credit_note(uuid,uuid,integer,date)'::regprocedure);
 old_text:=' perform 1 from public.sales_proformas where id=v_pf for update;';
 if strpos(v,old_text)=0 then raise exception 'Unexpected return credit lock dependency';end if;
 v:=replace(v,old_text,' perform pg_advisory_xact_lock(hashtextextended(''acc-receipt-org:''||(select organization_id::text from public.sales_proformas where id=v_pf),0));'||chr(10)||old_text);
 v:=replace(v,' perform public.acc_post(v_entry,p_credit_date,',' perform public.acc_credit_date(p_credit_date);'||chr(10)||' perform public.acc_post(v_entry,p_credit_date,');execute v;
end $patch$;

create or replace function public.opening_receivables_check(p_source text,p_cutover date,p_gl_import_id uuid,p_rows jsonb)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_source text:=lower(trim(coalesce(p_source,'')));v_prior public.acc_opening_receivable_imports;
 v_row jsonb;v_ref text;v_refs text[]:='{}';v_org uuid;v_date date;v_due date;v_amount bigint;v_kind text;v_total bigint:=0;
 v_imported bigint;v_gl bigint;v_subledger bigint;v_expected bigint;v_replayed boolean:=false;v_lock date;
begin
 if public.accounting_access() is not true or auth.uid() is null then raise exception 'Accounting access is required' using errcode='42501'; end if;
 if length(v_source) not between 1 and 80 then raise exception 'Source must contain 1–80 characters'; end if;
 if p_cutover is null or p_cutover>(now() at time zone 'Africa/Dar_es_Salaam')::date then raise exception 'Choose a cutover date no later than today'; end if;
 if p_rows is null or jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows) not between 1 and 1000 or octet_length(p_rows::text)>1048576 then raise exception 'Supply 1–1000 opening residuals, at most 1 MB'; end if;
 select * into v_prior from public.acc_opening_receivable_imports where gl_import_id=p_gl_import_id and superseded_by is null;
 if found then
  if v_prior.source<>v_source or v_prior.cutover_date<>p_cutover or v_prior.rows<>p_rows then raise exception 'This GL opening import already has different receivable details'; end if;
  v_replayed:=true;
 end if;
 select locked_through into v_lock from public.acc_settings where id;
 if not v_replayed and p_cutover<=v_lock then raise exception 'Books are locked through %',v_lock; end if;
 if not exists(select 1 from public.acc_financial_imports where id=p_gl_import_id and import_kind='opening') then raise exception 'Choose an existing opening general-ledger import'; end if;
 if not exists(select 1 from public.acc_imported_journals where import_id=p_gl_import_id)
  or exists(select 1 from public.acc_imported_journals j join public.acc_journal_entries e on e.id=j.entry_id
    where j.import_id=p_gl_import_id and (e.entry_date<>p_cutover or exists(select 1 from public.acc_journal_entries r where r.reverses_entry_id=e.id))) then
  raise exception 'The selected GL batch must own unreversed opening journals dated exactly at cutover';
 end if;
 for v_row in select * from jsonb_array_elements(p_rows) loop
  if jsonb_typeof(v_row)<>'object' or v_row-array['reference','organization_id','invoice_date','due_date','amount_minor','currency','kind']<>'{}'::jsonb
   or not(v_row ?& array['reference','organization_id','invoice_date','due_date','amount_minor','currency']) then raise exception 'Each residual needs reference, organization_id, invoice_date, due_date, amount_minor and currency only'; end if;
  if jsonb_typeof(v_row->'reference') is distinct from 'string' or jsonb_typeof(v_row->'organization_id') is distinct from 'string'
   or jsonb_typeof(v_row->'invoice_date') is distinct from 'string' or jsonb_typeof(v_row->'due_date') is distinct from 'string' then raise exception 'References, customer UUIDs and dates must be text'; end if;
  if v_row ? 'kind' and jsonb_typeof(v_row->'kind') is distinct from 'string' then raise exception 'Opening row kind must be text';end if;
  v_kind:=coalesce(v_row->>'kind','invoice');
  if v_kind not in('invoice','credit') then raise exception 'Opening row kind must be invoice or credit';end if;
  v_ref:=trim(v_row->>'reference');
  if length(v_ref) not between 1 and 80 or v_ref=any(v_refs) then raise exception 'Invoice references must be unique and contain 1–80 characters'; end if;
  v_refs:=array_append(v_refs,v_ref);
  if not v_replayed and exists(select 1 from public.acc_opening_receivable_refs where source=v_source and reference=v_ref and superseded_by is null) then raise exception 'Source/reference % was already imported',v_ref; end if;
  if v_row->>'organization_id' !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then raise exception 'Use an exact customer UUID'; end if;
  v_org:=(v_row->>'organization_id')::uuid;
  if not exists(select 1 from public.organizations where id=v_org and deleted_at is null) then raise exception 'Customer % is unknown or archived',v_org; end if;
  if v_row->>'invoice_date' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or v_row->>'due_date' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception 'Use YYYY-MM-DD dates'; end if;
  v_date:=(v_row->>'invoice_date')::date;v_due:=(v_row->>'due_date')::date;
  if v_date>p_cutover or v_due<v_date then raise exception 'Invoice date must be on or before cutover; due date must be on or after invoice date'; end if;
  if v_row->>'currency' is distinct from 'TZS' then raise exception 'Opening residuals must be TZS'; end if;
  if jsonb_typeof(v_row->'amount_minor') is distinct from 'number' or v_row->>'amount_minor' !~ '^[0-9]+$' then raise exception 'Residual amounts must be positive integer minor amounts'; end if;
  v_amount:=(v_row->>'amount_minor')::bigint;
  if v_amount<=0 or v_amount>9007199254740991 then raise exception 'Residual amount is outside the supported range'; end if;
  v_total:=v_total+case when v_kind='credit' then -v_amount else v_amount end;if abs(v_total)>9007199254740991 then raise exception 'Residual total is too large'; end if;
 end loop;
 select coalesce(sum(l.debit_minor-l.credit_minor),0) into v_imported from public.acc_imported_journals j
  join public.acc_journal_lines l on l.entry_id=j.entry_id join public.acc_accounts a on a.id=l.account_id and a.system_key='receivables' where j.import_id=p_gl_import_id;
 if v_imported<>v_total then raise exception 'Imported GL AR % does not equal opening residuals % (minor TZS); reconcile the file first',v_imported,v_total; end if;
 select coalesce(sum(l.debit_minor-l.credit_minor),0) into v_gl from public.acc_journal_lines l
  join public.acc_journal_entries e on e.id=l.entry_id and e.entry_date<=p_cutover join public.acc_accounts a on a.id=l.account_id and a.system_key='receivables';
 select coalesce(sum(balance_minor),0) into v_subledger from public.acc_receivables_ageing(p_cutover);
 v_expected:=v_subledger+case when v_replayed then 0 else v_total end;
 if v_gl<>v_expected then raise exception 'AR reconciliation failed: control balance %, customer subledger after import % (minor TZS)',v_gl,v_expected; end if;
 return jsonb_build_object('gl_import_id',p_gl_import_id,'cutover_date',p_cutover,'imported_gl_ar_minor',v_imported,'opening_residual_minor',v_total,'control_ar_minor',v_gl,'customer_subledger_minor',v_expected,'difference_minor',v_gl-v_expected,'reconciled',true,'already_imported',v_replayed,'row_count',jsonb_array_length(p_rows));
end $$;


create or replace function public.import_opening_receivables(p_id uuid,p_source text,p_cutover date,p_gl_import_id uuid,p_rows jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_actor uuid;v_source text:=lower(trim(coalesce(p_source,'')));v_prior public.acc_opening_receivable_imports;
 v_row jsonb;v_id uuid;v_check jsonb;v_result jsonb;v_invoices jsonb:='[]';v_credits jsonb:='[]';
begin
 if public.accounting_access() is not true or auth.uid() is null then raise exception 'Accounting access is required' using errcode='42501'; end if;
 v_actor:=auth.uid();if p_id is null then raise exception 'Import request ID is required'; end if;
 perform pg_advisory_xact_lock(hashtextextended('acc-financial-import',0));
 select * into v_prior from public.acc_opening_receivable_imports where id=p_id or (gl_import_id=p_gl_import_id and superseded_by is null) order by (id=p_id) desc limit 1;
 if found then
  if v_prior.source is distinct from v_source or v_prior.cutover_date is distinct from p_cutover or v_prior.gl_import_id is distinct from p_gl_import_id or v_prior.rows is distinct from p_rows then raise exception 'Opening import identity was already used for different details'; end if;
  return v_prior.result||jsonb_build_object('already_imported',true,'superseded_by',v_prior.superseded_by);
 end if;
 -- Every posting creates its journal first. Hold a stable GL while checking the subledger and inserting residuals.
 lock table public.acc_journal_entries in share mode;
 perform 1 from public.acc_settings where id for share;
 v_check:=public.opening_receivables_check(p_source,p_cutover,p_gl_import_id,p_rows);
 for v_row in select * from jsonb_array_elements(p_rows) loop
  perform 1 from public.organizations where id=(v_row->>'organization_id')::uuid and deleted_at is null for share;
  if not found then raise exception 'Customer became unavailable; refresh the preview'; end if;
  v_id:=gen_random_uuid();
  if coalesce(v_row->>'kind','invoice')='credit' then
   insert into public.acc_opening_customer_credits(id,organization_id,import_id,reference,cutover_date,amount_minor,created_by) values(v_id,(v_row->>'organization_id')::uuid,p_id,trim(v_row->>'reference'),p_cutover,(v_row->>'amount_minor')::bigint,v_actor);
   insert into public.acc_opening_receivable_refs(source,reference,opening_credit_id,import_id) values(v_source,trim(v_row->>'reference'),v_id,p_id);
   v_credits:=v_credits||jsonb_build_array(jsonb_build_object('reference',trim(v_row->>'reference'),'credit_id',v_id));
  else
  insert into public.acc_invoices(id,invoice_number,organization_id,invoice_date,due_date,subtotal_minor,discount_minor,tax_minor,total_minor,lines,created_by,opening_import_id,opening_cutover_date,opening_reference)
  values(v_id,'OPEN-'||to_char(p_cutover,'YYYY')||'-'||lpad(nextval('public.acc_invoice_number_seq')::text,6,'0'),(v_row->>'organization_id')::uuid,(v_row->>'invoice_date')::date,(v_row->>'due_date')::date,(v_row->>'amount_minor')::bigint,0,0,(v_row->>'amount_minor')::bigint,'[]',v_actor,p_id,p_cutover,trim(v_row->>'reference'));
  insert into public.acc_opening_receivable_refs(source,reference,invoice_id,import_id) values(v_source,trim(v_row->>'reference'),v_id,p_id);
  v_invoices:=v_invoices||jsonb_build_array(jsonb_build_object('reference',trim(v_row->>'reference'),'invoice_id',v_id));
  end if;
 end loop;
 v_result:=v_check||jsonb_build_object('batch_id',p_id,'imported_count',jsonb_array_length(p_rows),'invoices',v_invoices,'credits',v_credits);
 insert into public.acc_opening_receivable_imports(id,source,cutover_date,gl_import_id,rows,result,created_by) values(p_id,v_source,p_cutover,p_gl_import_id,p_rows,v_result,v_actor);
 return v_result;
end $$;

create function public.acc_opening_receivables_unused(p_import_id uuid) returns boolean
language sql stable security definer set search_path=public,pg_temp as $$
 select not (exists(select 1 from public.acc_receipt_allocations a join public.acc_invoices i on i.id=a.invoice_id where i.opening_import_id=p_import_id)
  or exists(select 1 from public.acc_credit_notes cn join public.acc_invoices i on i.id=cn.invoice_id where i.opening_import_id=p_import_id)
  or exists(select 1 from public.acc_customer_credit_applications a where a.invoice_id in(select id from public.acc_invoices where opening_import_id=p_import_id) or a.source_invoice_id in(select id from public.acc_invoices where opening_import_id=p_import_id) or a.source_opening_credit_id in(select id from public.acc_opening_customer_credits where import_id=p_import_id))
  or exists(select 1 from public.acc_customer_refunds r where r.source_invoice_id in(select id from public.acc_invoices where opening_import_id=p_import_id) or r.source_opening_credit_id in(select id from public.acc_opening_customer_credits where import_id=p_import_id)))
$$;
revoke all on function public.acc_opening_receivables_unused(uuid) from public,anon,authenticated;

create function public.correct_opening_receivables(p_id uuid,p_import_id uuid,p_rows jsonb,p_reason text) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_actor uuid;o public.acc_opening_receivable_imports;c public.acc_opening_receivable_corrections;v_org uuid;v_result jsonb;
begin
 v_actor:=public.acc_require_access();if v_actor is null then raise exception 'Accounting access is required' using errcode='42501';end if;
 if p_id is null or p_import_id is null or p_id=p_import_id then raise exception 'New and original opening import IDs are required';end if;
 perform pg_advisory_xact_lock(hashtextextended('acc-credit-request:'||p_id::text,0));
 select * into c from public.acc_opening_receivable_corrections where id=p_id;
 if found then
  if c.replaces_import_id is distinct from p_import_id or c.rows is distinct from p_rows or c.reason is distinct from trim(p_reason) then raise exception 'Opening correction identity was already used for different details';end if;
  return public.acc_credit_json((select result from public.acc_opening_receivable_imports where id=p_id))||jsonb_build_object('already_imported',true,'replaces_import_id',p_import_id);
 end if;
 if p_rows is null or jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows) not between 1 and 1000 or octet_length(p_rows::text)>1048576 then raise exception 'Supply 1–1000 opening residuals, at most 1 MB';end if;
 if p_reason is null or length(trim(p_reason)) not between 5 and 300 then raise exception 'Give a reason of 5 to 300 characters';end if;
 select * into o from public.acc_opening_receivable_imports where id=p_import_id;
 if not found then raise exception 'Opening import not found';end if;
 -- Match settlement/customer-before-inventory order before taking the import serialization lock.
 for v_org in select organization_id from public.acc_invoices where opening_import_id=p_import_id
  union select organization_id from public.acc_opening_customer_credits where import_id=p_import_id
  union select (r->>'organization_id')::uuid from jsonb_array_elements(p_rows)r order by 1 loop
  perform pg_advisory_xact_lock(hashtextextended('acc-receipt-org:'||v_org::text,0));
 end loop;
 perform pg_advisory_xact_lock(hashtextextended('acc-financial-import',0));
 select * into o from public.acc_opening_receivable_imports where id=p_import_id for update;
 if o.superseded_by is not null then raise exception 'This opening schedule has already been replaced';end if;
 perform public.acc_credit_date(o.cutover_date);
 if not public.acc_opening_receivables_unused(o.id) then
  raise exception 'An opening schedule with settlement history cannot be replaced; preserve and reconcile its subsequent transactions';
 end if;
 insert into public.acc_opening_receivable_corrections(id,replaces_import_id,rows,reason,created_by) values(p_id,p_import_id,p_rows,trim(p_reason),v_actor);
 update public.acc_opening_receivable_refs set superseded_by=p_id where import_id=o.id;
 update public.acc_opening_receivable_imports set superseded_by=p_id where id=o.id;
 v_result:=public.import_opening_receivables(p_id,o.source,o.cutover_date,o.gl_import_id,p_rows);
 return public.acc_credit_json(v_result)||jsonb_build_object('replaces_import_id',p_import_id);
end $$;

-- Reuse the complete opening row validation for a read-only replacement preview.
do $opening_preview$
declare v text;
begin
 v:=pg_get_functiondef('public.opening_receivables_check(text,date,uuid,jsonb)'::regprocedure);
 v:=replace(v,'public.opening_receivables_check(p_source text, p_cutover date, p_gl_import_id uuid, p_rows jsonb)','public.acc_opening_schedule_check(p_source text, p_cutover date, p_gl_import_id uuid, p_rows jsonb, p_replace_id uuid)');
 if strpos(v,'acc_opening_schedule_check')=0 then raise exception 'Unexpected opening check signature';end if;
 v:=replace(v,' if found then',' if p_replace_id is not null then
  if not found or v_prior.id is distinct from p_replace_id then raise exception ''Choose the current opening schedule'';end if;
  if not public.acc_opening_receivables_unused(p_replace_id) then raise exception ''An opening schedule with settlement history cannot be replaced'';end if;
 elsif found then');
 v:=replace(v,'where source=v_source and reference=v_ref and superseded_by is null)','where source=v_source and reference=v_ref and superseded_by is null and (p_replace_id is null or import_id<>p_replace_id))');
 v:=replace(v,'v_expected:=v_subledger+case when v_replayed then 0 else v_total end;','v_expected:=v_subledger+case when v_replayed then 0 else v_total end-case when p_replace_id is null then 0 else v_imported end;');
 v:=replace(v,$old$'row_count',jsonb_array_length(p_rows)$old$,$new$'row_count',jsonb_array_length(p_rows),'replaces_import_id',p_replace_id$new$);
 execute v;
end $opening_preview$;
create or replace function public.opening_receivables_check(p_source text,p_cutover date,p_gl_import_id uuid,p_rows jsonb) returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
begin return public.acc_opening_schedule_check(p_source,p_cutover,p_gl_import_id,p_rows,null);end $$;
create function public.opening_receivables_correction_check(p_import_id uuid,p_rows jsonb) returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare o public.acc_opening_receivable_imports;
begin
 perform public.acc_require_access();if auth.uid() is null then raise exception 'Accounting access is required' using errcode='42501';end if;
 select * into o from public.acc_opening_receivable_imports where id=p_import_id and superseded_by is null;
 if not found then raise exception 'Choose the current opening schedule';end if;
 return public.acc_credit_json(public.acc_opening_schedule_check(o.source,o.cutover_date,o.gl_import_id,p_rows,o.id));
end $$;
create function public.acc_opening_receivable_schedules() returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_lock date;
begin
 perform public.acc_require_access();if auth.uid() is null then raise exception 'Accounting access is required' using errcode='42501';end if;
 select locked_through into v_lock from public.acc_settings where id;
 return coalesce((select jsonb_agg(to_jsonb(o)||jsonb_build_object('result',public.acc_credit_json(o.result),
 'can_correct',o.superseded_by is null and (v_lock is null or o.cutover_date>v_lock) and public.acc_opening_receivables_unused(o.id),
 'blocked_reason',case when o.superseded_by is not null then 'Replaced' when o.cutover_date<=v_lock then 'Cutover is locked' when not public.acc_opening_receivables_unused(o.id) then 'Has settlement history' else null end) order by o.created_at desc,o.id) from public.acc_opening_receivable_imports o),'[]');
end $$;
create or replace function public.opening_receivables_status(p_id uuid) returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
 perform public.acc_require_access();if auth.uid() is null then raise exception 'Accounting access is required' using errcode='42501';end if;
 return (select o.result||jsonb_build_object('superseded_by',o.superseded_by,'replaces_import_id',c.replaces_import_id) from public.acc_opening_receivable_imports o left join public.acc_opening_receivable_corrections c on c.id=o.id where o.id=p_id);
end $$;
revoke all on function public.acc_opening_schedule_check(text,date,uuid,jsonb,uuid),public.opening_receivables_correction_check(uuid,jsonb),public.acc_opening_receivable_schedules() from public,anon,authenticated;
grant execute on function public.opening_receivables_correction_check(uuid,jsonb),public.acc_opening_receivable_schedules() to authenticated;

-- Preserve the verified goods/rounding allocation, while requiring an explicit predecessor for reposts.
do $return_post$
declare v text;
begin
 v:=pg_get_functiondef('public.post_return_credit_note(uuid,uuid,integer,date)'::regprocedure);
 v:=replace(v,'public.post_return_credit_note(p_id uuid, p_draft_id uuid, p_expected_version integer, p_credit_date date)','public.acc_post_return_credit_replacement(p_id uuid, p_draft_id uuid, p_expected_version integer, p_credit_date date, p_replaces_credit_id uuid)');
 if strpos(v,'acc_post_return_credit_replacement')=0 then raise exception 'Unexpected return credit signature';end if;
 v:=replace(v,'v_credit.credit_date is distinct from p_credit_date then','v_credit.credit_date is distinct from p_credit_date or v_credit.replaces_credit_id is distinct from p_replaces_credit_id then');
 v:=replace(v,'where return_id=v_return.id;','where return_id=v_return.id and voided_at is null;');
 v:=replace(v,' select * into v_note from public.sales_delivery_notes where id=v_return.delivery_note_id;',
 ' if p_replaces_credit_id is null and exists(select 1 from public.acc_credit_notes where return_id=v_return.id) then raise exception ''Use the explicit return credit repost action for a voided credit'';end if;
 if p_replaces_credit_id is not null and not exists(select 1 from public.acc_credit_notes where id=p_replaces_credit_id and return_id=v_return.id and draft_id=p_draft_id and voided_at is not null and not exists(select 1 from public.acc_credit_notes where replaces_credit_id=p_replaces_credit_id)) then raise exception ''Choose the last voided credit for this return'';end if;
 if p_replaces_credit_id is not null and p_credit_date<(select e.entry_date from public.acc_credit_notes c join public.acc_journal_entries e on e.id=c.void_entry_id where c.id=p_replaces_credit_id) then raise exception ''Replacement credit cannot predate its predecessor reversal'';end if;
 select * into v_note from public.sales_delivery_notes where id=v_return.delivery_note_id;');
 v:=replace(v,'where invoice_id=v_invoice.id;','where invoice_id=v_invoice.id and voided_at is null;');
 v:=replace(v,'lines,journal_entry_id,created_by)','lines,journal_entry_id,created_by,replaces_credit_id)');
 v:=replace(v,$old$v_saved.body->'lines',v_entry,v_actor)$old$,$new$v_saved.body->'lines',v_entry,v_actor,p_replaces_credit_id)$new$);
 execute v;
end $return_post$;
create or replace function public.post_return_credit_note(p_id uuid,p_draft_id uuid,p_expected_version integer,p_credit_date date)
returns public.acc_credit_notes language plpgsql security definer set search_path=public,pg_temp as $$
begin return public.acc_post_return_credit_replacement(p_id,p_draft_id,p_expected_version,p_credit_date,null);end $$;
revoke all on function public.acc_post_return_credit_replacement(uuid,uuid,integer,date,uuid) from public,anon,authenticated;

create function public.void_return_credit_note(p_credit_id uuid,p_date date,p_reason text) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare c public.acc_credit_notes;v_actor uuid;v_entry uuid:=gen_random_uuid();
begin
 v_actor:=public.acc_require_access();if v_actor is null then raise exception 'Accounting access is required' using errcode='42501';end if;
 select * into c from public.acc_credit_notes where id=p_credit_id;
 if not found then raise exception 'Return credit not found';end if;
 perform pg_advisory_xact_lock(hashtextextended('acc-receipt-org:'||c.organization_id::text,0));
 if to_regprocedure('public.acc_inventory_lock()') is not null then perform public.acc_inventory_lock();end if;
 perform 1 from public.sales_proformas where id=(select proforma_id from public.acc_invoices where id=c.invoice_id) for update;
 select * into c from public.acc_credit_notes where id=p_credit_id for update;
 if c.voided_at is not null then
  if c.void_reason is distinct from trim(p_reason) or (select entry_date from public.acc_journal_entries where id=c.void_entry_id) is distinct from p_date then raise exception 'Return credit void already saved with different details';end if;return public.acc_credit_json(to_jsonb(c))||jsonb_build_object('void_date',(select entry_date from public.acc_journal_entries where id=c.void_entry_id));
 end if;
 perform public.acc_credit_date(p_date);
 if p_reason is null or length(trim(p_reason)) not between 5 and 300 then raise exception 'Give a reason of 5 to 300 characters';end if;
 if to_regprocedure('public.acc_void_return_credit_cost(uuid,date)') is not null then perform public.acc_void_return_credit_cost(c.id,p_date);end if;
 perform public.acc_reverse(v_entry,c.journal_entry_id,p_date,'Void '||c.credit_number||': '||trim(p_reason));
 update public.acc_credit_notes set voided_at=now(),voided_by=v_actor,void_reason=trim(p_reason),void_entry_id=v_entry where id=c.id returning * into c;
 perform public.acc_validate_customer_credit(c.organization_id,p_date);return public.acc_credit_json(to_jsonb(c))||jsonb_build_object('void_date',(select entry_date from public.acc_journal_entries where id=c.void_entry_id));
end $$;
create function public.repost_return_credit_note(p_id uuid,p_credit_id uuid,p_date date) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare c public.acc_credit_notes;v public.acc_credit_notes;
begin
 perform public.acc_require_access();if auth.uid() is null then raise exception 'Accounting access is required' using errcode='42501';end if;
 select * into c from public.acc_credit_notes where id=p_credit_id;
 if not found then raise exception 'Return credit not found';end if;
 v:=public.acc_post_return_credit_replacement(p_id,c.draft_id,c.draft_version,p_date,p_credit_id);
 return public.acc_credit_json(to_jsonb(v));
end $$;
revoke all on function public.correct_opening_receivables(uuid,uuid,jsonb,text),public.void_return_credit_note(uuid,date,text),public.repost_return_credit_note(uuid,uuid,date) from public,anon,authenticated;
grant execute on function public.correct_opening_receivables(uuid,uuid,jsonb,text),public.void_return_credit_note(uuid,date,text),public.repost_return_credit_note(uuid,uuid,date) to authenticated;

do $reports$
declare v text;
begin
 if to_regprocedure('public.acc_transaction_page(text,integer)') is not null then
  v:=pg_get_functiondef('public.acc_transaction_page(text,integer)'::regprocedure);
  v:=replace(v,'coalesce(a.applied_minor,0) as applied_minor','coalesce(a.applied_minor,0)+coalesce((select sum(case when x.reverses_application_id is null then x.amount_minor else -x.amount_minor end) from public.acc_customer_credit_applications x where x.source_receipt_id=r.id),0) as applied_minor, coalesce((select sum(f.amount_minor) from public.acc_customer_refunds f where f.source_receipt_id=r.id and f.voided_at is null),0) as refunded_minor');
  v:=replace(v,'sum(amount_minor-applied_minor)','sum(amount_minor-applied_minor-refunded_minor)');
  v:=replace(v,'''credit_minor'',coalesce(sum(amount_minor-applied_minor-refunded_minor) filter(where voided_at is null),0)', '''credit_minor'',coalesce(sum(amount_minor-applied_minor-refunded_minor) filter(where voided_at is null),0),''refunded_minor'',coalesce(sum(refunded_minor) filter(where voided_at is null),0)');
  execute v;
 end if;
 if to_regprocedure('public.acc_invoice_register(integer,integer)') is not null then
  v:=pg_get_functiondef('public.acc_invoice_register(integer,integer)'::regprocedure);
  v:=replace(v,'customer_credit_minor,','customer_credit_minor,applied_credit_minor,credit_used_minor,refunded_minor,');
  v:=replace(v,'''customer_credit_minor'',coalesce(sum(customer_credit_minor) filter(where voided_at is null),0)', '''customer_credit_minor'',coalesce(sum(customer_credit_minor) filter(where voided_at is null),0),''applied_credit_minor'',coalesce(sum(applied_credit_minor) filter(where voided_at is null),0),''credit_used_minor'',coalesce(sum(credit_used_minor) filter(where voided_at is null),0),''refunded_minor'',coalesce(sum(refunded_minor) filter(where voided_at is null),0)');
  execute v;
 end if;
end $reports$;
do $permissions$
declare f text;
begin
 foreach f in array array['acc_credit_date(date)','acc_credit_used(uuid,uuid,uuid,date)','acc_invoice_credit_position(uuid,date)','acc_credit_available(uuid,uuid,uuid,date)','acc_credit_customer(uuid,uuid,uuid)','acc_credit_event_dates(uuid,date)','acc_validate_customer_credit(uuid,date)','acc_check_credit_target(uuid,date,bigint)'] loop
 execute 'revoke all on function public.'||f||' from public,anon,authenticated';end loop;
 foreach f in array array['apply_customer_credit(uuid,uuid,uuid,uuid,uuid,date,bigint)','reverse_customer_credit_application(uuid,uuid,date,text)','refund_customer_credit(uuid,uuid,uuid,uuid,date,bigint,uuid,text,text)','void_customer_refund(uuid,date,text)','acc_customer_credit_sources(uuid,date)'] loop
 execute 'revoke all on function public.'||f||' from public,anon,authenticated';execute 'grant execute on function public.'||f||' to authenticated';end loop;
end $permissions$;
commit;
