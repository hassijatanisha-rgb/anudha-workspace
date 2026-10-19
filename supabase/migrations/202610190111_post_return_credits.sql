-- Post returned-goods credits from the immutable allocation saved by migration 110.
begin;
create sequence if not exists public.acc_credit_number_seq;
create table if not exists public.acc_credit_notes (
 id uuid primary key,
 credit_number text not null unique,
 return_id uuid not null unique references public.sales_returns(id),
 draft_id uuid not null unique references public.accounting_drafts(id),
 draft_version integer not null check(draft_version>0),
 invoice_id uuid not null references public.acc_invoices(id),
 organization_id uuid not null references public.organizations(id),
 credit_date date not null,
 currency text not null check(currency='TZS'),
 net_minor bigint not null check(net_minor>=0),
 tax_minor bigint not null check(tax_minor>=0),
 total_minor bigint not null check(total_minor>0 and total_minor=net_minor+tax_minor),
 lines jsonb not null check(jsonb_typeof(lines)='array'),
 journal_entry_id uuid not null unique references public.acc_journal_entries(id),
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now()
);
create index if not exists acc_credit_notes_invoice on public.acc_credit_notes(invoice_id,credit_date);
alter table public.acc_credit_notes enable row level security;
drop policy if exists acc_credit_notes_read on public.acc_credit_notes;
create policy acc_credit_notes_read on public.acc_credit_notes for select to authenticated using((select public.accounting_access()));
revoke all on public.acc_credit_notes from public,anon,authenticated;
grant select on public.acc_credit_notes to authenticated;
revoke all on sequence public.acc_credit_number_seq from public,anon,authenticated;
drop trigger if exists acc_credit_notes_immutable on public.acc_credit_notes;
create trigger acc_credit_notes_immutable before update or delete on public.acc_credit_notes for each row execute function public.acc_deny_change();
alter table public.acc_journal_entries drop constraint if exists acc_journal_entries_source_type_check;
alter table public.acc_journal_entries add constraint acc_journal_entries_source_type_check check(source_type in ('manual','invoice','receipt','reversal','credit_note'));

create or replace function public.post_return_credit_note(p_id uuid,p_draft_id uuid,p_expected_version integer,p_credit_date date)
returns public.acc_credit_notes language plpgsql security definer set search_path=public,pg_temp as $$
declare v_actor uuid; v_pf uuid; v_return public.sales_returns; v_note public.sales_delivery_notes; v_invoice public.acc_invoices;
 v_draft public.accounting_drafts; v_saved public.accounting_draft_history; v_credit public.acc_credit_notes;
 v_line jsonb; v_net bigint:=0; v_tax bigint:=0; v_prior_net bigint; v_prior_tax bigint; v_qty bigint;
 v_seen uuid[]:='{}'; v_line_id uuid; v_entry uuid:=gen_random_uuid(); v_post jsonb;
begin
 if public.accounting_access() is not true or auth.uid() is null then raise exception 'Accounting access is required' using errcode='42501'; end if;
 v_actor:=auth.uid();
 if p_id is null or p_draft_id is null or p_expected_version is null or p_credit_date is null then raise exception 'Credit identity, saved draft revision and accounting date are required'; end if;
 perform pg_advisory_xact_lock(hashtextextended('acc-return-credit:'||p_id::text,0));
 select * into v_credit from public.acc_credit_notes where id=p_id;
 if found then
  if v_credit.draft_id is distinct from p_draft_id or v_credit.draft_version is distinct from p_expected_version or v_credit.credit_date is distinct from p_credit_date then raise exception 'Credit identity was already used for different details'; end if;
  return v_credit;
 end if;
 select n.proforma_id into v_pf from public.sales_returns r join public.sales_delivery_notes n on n.id=r.delivery_note_id where r.credit_note_draft_id=p_draft_id;
 perform 1 from public.sales_proformas where id=v_pf for update;
 select * into v_return from public.sales_returns where credit_note_draft_id=p_draft_id for update;
 if not found then raise exception 'Only a credit draft created from returned goods can be posted'; end if;
 select * into v_credit from public.acc_credit_notes where return_id=v_return.id;
 if found then
  if v_credit.draft_id is distinct from p_draft_id or v_credit.draft_version is distinct from p_expected_version or v_credit.credit_date is distinct from p_credit_date then raise exception 'This return already has a posted credit; reopen its posting'; end if;
  return v_credit;
 end if;
 select * into v_note from public.sales_delivery_notes where id=v_return.delivery_note_id;
 select * into v_saved from public.accounting_draft_history where draft_id=p_draft_id and version=1;
 if v_saved.body->'source'->>'returnId' is distinct from v_return.id::text or nullif(v_saved.body->'source'->>'invoiceId','') is null then
  raise exception 'This draft has no verified ERP invoice allocation; external or older credit drafts need Accounts review';
 end if;
 select * into v_invoice from public.acc_invoices where id=(v_saved.body->'source'->>'invoiceId')::uuid for update;
 if not found or v_invoice.voided_at is not null or v_invoice.proforma_id is distinct from v_note.proforma_id
  or v_invoice.organization_id is distinct from v_return.organization_id or v_invoice.invoice_number is distinct from v_note.tax_invoice_reference
  or (v_note.invoice_id is not null and v_note.invoice_id is distinct from v_invoice.id) then raise exception 'The returned delivery does not match an active ERP invoice'; end if;
 select * into v_draft from public.accounting_drafts where id=p_draft_id for update;
 if v_draft.version is distinct from p_expected_version then raise exception 'Draft changed; reopen before posting'; end if;
 if v_draft.kind<>'credit_note' or v_draft.organization_id is distinct from v_invoice.organization_id or v_saved.organization_id is distinct from v_invoice.organization_id then raise exception 'Credit draft customer does not match its invoice'; end if;
 if v_saved.body->>'currency' is distinct from 'TZS' or v_invoice.currency<>'TZS' then raise exception 'Only TZS ERP return credits can be posted'; end if;
 if p_credit_date<v_invoice.invoice_date or p_credit_date<(v_return.received_at at time zone 'Africa/Dar_es_Salaam')::date then raise exception 'Credit date cannot precede the invoice or receipt of returned goods'; end if;
 if jsonb_typeof(v_saved.body->'lines') is distinct from 'array' or jsonb_array_length(v_saved.body->'lines') not between 1 and 100 then raise exception 'Credit allocation lines are missing'; end if;
 for v_line in select * from jsonb_array_elements(v_saved.body->'lines') loop
  if coalesce(v_line->>'netMinor','')!~'^[0-9]+$' or coalesce(v_line->>'taxMinor','')!~'^[0-9]+$' or coalesce(v_line->>'quantityReturned','')!~'^[1-9][0-9]*$' or nullif(v_line->>'proformaLineId','') is null then raise exception 'Credit allocations need Accounts review'; end if;
  v_line_id:=(v_line->>'proformaLineId')::uuid;
  if v_line_id=any(v_seen) then raise exception 'Credit allocation line is duplicated'; end if;
  v_seen:=v_seen||v_line_id;
  select coalesce(sum(rl.quantity),0) into v_qty from public.sales_return_lines rl join public.sales_delivery_lines dl on dl.id=rl.delivery_line_id
   where rl.return_id=v_return.id and dl.proforma_line_id=v_line_id;
  if v_qty is distinct from (v_line->>'quantityReturned')::bigint then raise exception 'Credit quantities do not match the returned goods'; end if;
  v_net:=v_net+(v_line->>'netMinor')::bigint; v_tax:=v_tax+(v_line->>'taxMinor')::bigint;
 end loop;
 if exists(select 1 from public.sales_return_lines rl join public.sales_delivery_lines dl on dl.id=rl.delivery_line_id where rl.return_id=v_return.id and not(dl.proforma_line_id=any(v_seen))) then raise exception 'Credit allocation omits returned goods'; end if;
 if v_net+v_tax<=0 or v_net+v_tax is distinct from (v_saved.body->>'totalMinor')::bigint then raise exception 'Credit allocation total is invalid'; end if;
 select coalesce(sum(net_minor),0),coalesce(sum(tax_minor),0) into v_prior_net,v_prior_tax from public.acc_credit_notes where invoice_id=v_invoice.id;
 if v_net+v_prior_net>v_invoice.subtotal_minor-v_invoice.discount_minor or v_tax+v_prior_tax>v_invoice.tax_minor then raise exception 'Posted credits cannot exceed the invoice net or VAT amount'; end if;
 v_post:=jsonb_build_array(jsonb_build_object('account_id',public.acc_account_by_key('receivables'),'credit_minor',v_net+v_tax,'organization_id',v_invoice.organization_id,'description',v_invoice.invoice_number));
 if v_net>0 then v_post:=v_post||jsonb_build_array(jsonb_build_object('account_id',public.acc_account_by_key('sales'),'debit_minor',v_net,'description',v_return.return_number)); end if;
 if v_tax>0 then v_post:=v_post||jsonb_build_array(jsonb_build_object('account_id',public.acc_account_by_key('vat_output'),'debit_minor',v_tax,'description',v_return.return_number)); end if;
 perform public.acc_post(v_entry,p_credit_date,'Return credit for '||v_invoice.invoice_number||' / '||v_return.return_number,'credit_note',p_id,null,v_post);
 insert into public.acc_credit_notes(id,credit_number,return_id,draft_id,draft_version,invoice_id,organization_id,credit_date,currency,net_minor,tax_minor,total_minor,lines,journal_entry_id,created_by)
 values(p_id,'CN-'||to_char(p_credit_date,'YYYY')||'-'||lpad(nextval('public.acc_credit_number_seq')::text,6,'0'),v_return.id,p_draft_id,p_expected_version,v_invoice.id,v_invoice.organization_id,p_credit_date,'TZS',v_net,v_tax,v_net+v_tax,v_saved.body->'lines',v_entry,v_actor) returning * into v_credit;
 return v_credit;
end $$;
revoke all on function public.post_return_credit_note(uuid,uuid,integer,date) from public,anon,authenticated;
grant execute on function public.post_return_credit_note(uuid,uuid,integer,date) to authenticated;

-- Keep receipt allocations immutable. A later return may turn the already-paid amount into customer credit.
create or replace function public.acc_guard_credit_allocation() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_invoice public.acc_invoices; v_credits bigint;
begin
 select * into v_invoice from public.acc_invoices where id=new.invoice_id for update;
 select coalesce(sum(total_minor),0) into v_credits from public.acc_credit_notes where invoice_id=new.invoice_id;
 if new.amount_minor>greatest(v_invoice.total_minor-public.acc_invoice_paid_minor(new.invoice_id)-v_credits,0) then raise exception 'Invoice has less left to pay after posted credits'; end if;
 return new;
end $$;
drop trigger if exists acc_receipt_credit_limit on public.acc_receipt_allocations;
create trigger acc_receipt_credit_limit before insert on public.acc_receipt_allocations for each row execute function public.acc_guard_credit_allocation();
create or replace function public.acc_guard_credited_invoice() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if new.voided_at is not null and exists(select 1 from public.acc_credit_notes where invoice_id=old.id) then raise exception 'An invoice with posted return credits cannot be voided'; end if;
 return new;
end $$;
drop trigger if exists acc_invoice_credit_void_guard on public.acc_invoices;
create trigger acc_invoice_credit_void_guard before update on public.acc_invoices for each row execute function public.acc_guard_credited_invoice();
revoke all on function public.acc_guard_credit_allocation(),public.acc_guard_credited_invoice() from public,anon,authenticated;

create or replace view public.acc_invoice_balances with (security_invoker=true) as
 select i.id,i.invoice_number,i.proforma_id,i.proforma_revision,i.organization_id,i.invoice_date,i.due_date,i.tax_invoice_reference,i.currency,i.subtotal_minor,i.discount_minor,i.tax_minor,i.total_minor,i.lines,i.journal_entry_id,i.created_by,i.created_at,i.voided_at,i.voided_by,i.void_reason,i.void_entry_id,i.buyer_tin,i.buyer_vrn,i.tra_receipt_number,i.tra_verification_code,i.fiscal_recorded_by,i.fiscal_recorded_at,pf.document_number as proforma_number,p.paid_minor,
  case when i.voided_at is not null then 0 else greatest(i.total_minor-p.paid_minor-c.credited_minor,0) end as outstanding_minor,
  case when i.voided_at is not null then 'void' when p.paid_minor+c.credited_minor>=i.total_minor then 'paid'
   when i.due_date<(now() at time zone 'Africa/Dar_es_Salaam')::date then 'overdue'
   when p.paid_minor+c.credited_minor>0 then 'part' else 'open' end as status_key,
  case when i.voided_at is not null then 'Void' when c.credited_minor>=i.total_minor then 'Credited'
   when p.paid_minor+c.credited_minor>=i.total_minor then 'Paid'
   when i.due_date<(now() at time zone 'Africa/Dar_es_Salaam')::date then case when p.paid_minor+c.credited_minor>0 then 'Part settled · overdue' else 'Overdue' end
   when p.paid_minor+c.credited_minor>0 then 'Part settled' else 'Unpaid' end as status_label,
  c.credited_minor,greatest(p.paid_minor+c.credited_minor-i.total_minor,0) as customer_credit_minor
 from public.acc_invoices i left join public.sales_proformas pf on pf.id=i.proforma_id
 cross join lateral(select coalesce(sum(a.amount_minor),0)::bigint paid_minor from public.acc_receipt_allocations a join public.acc_receipts r on r.id=a.receipt_id where a.invoice_id=i.id and r.voided_at is null) p
 cross join lateral(select coalesce(sum(cn.total_minor),0)::bigint credited_minor from public.acc_credit_notes cn where cn.invoice_id=i.id) c;

create or replace function public.acc_receivables_ageing(p_as_of date)
returns table(organization_id uuid,customer text,current_minor bigint,days_1_30_minor bigint,days_31_60_minor bigint,days_61_90_minor bigint,days_over_90_minor bigint,unapplied_credit_minor bigint,balance_minor bigint)
language plpgsql stable security definer set search_path=public,pg_temp as $$
#variable_conflict use_column
begin
 perform public.acc_require_access();
 return query
 with active_invoices as (
  select i.* from public.acc_invoices i left join public.acc_journal_entries reversal on reversal.id=i.void_entry_id
  where i.invoice_date<=p_as_of and (i.void_entry_id is null or reversal.entry_date>p_as_of)
 ), invoice_balances as (
  select i.organization_id,i.due_date,i.total_minor-public.acc_invoice_paid_minor(i.id,p_as_of)
   -coalesce((select sum(c.total_minor) from public.acc_credit_notes c where c.invoice_id=i.id and c.credit_date<=p_as_of),0) as due from active_invoices i
 ), receipt_credits as (
  select r.organization_id,sum(r.amount_minor-coalesce((select sum(a.amount_minor) from public.acc_receipt_allocations a join active_invoices i on i.id=a.invoice_id where a.receipt_id=r.id),0)) as unapplied
  from public.acc_receipts r left join public.acc_journal_entries reversal on reversal.id=r.void_entry_id
  where r.receipt_date<=p_as_of and (r.void_entry_id is null or reversal.entry_date>p_as_of) group by r.organization_id
 ), credits as (
  select organization_id,sum(unapplied) unapplied from (
   select * from receipt_credits union all select organization_id,sum(-due) from invoice_balances where due<0 group by organization_id
  ) x group by organization_id
 ), b as (
  select organization_id,sum(case when p_as_of-due_date<=0 then due else 0 end) c0,
   sum(case when p_as_of-due_date between 1 and 30 then due else 0 end) c1,
   sum(case when p_as_of-due_date between 31 and 60 then due else 0 end) c2,
   sum(case when p_as_of-due_date between 61 and 90 then due else 0 end) c3,
   sum(case when p_as_of-due_date>90 then due else 0 end) c4
  from invoice_balances where due>0 group by organization_id
 )
 select k.organization_id,org.name,coalesce(b.c0,0)::bigint,coalesce(b.c1,0)::bigint,coalesce(b.c2,0)::bigint,coalesce(b.c3,0)::bigint,coalesce(b.c4,0)::bigint,
  coalesce(cr.unapplied,0)::bigint,(coalesce(b.c0,0)+coalesce(b.c1,0)+coalesce(b.c2,0)+coalesce(b.c3,0)+coalesce(b.c4,0)-coalesce(cr.unapplied,0))::bigint
 from (select organization_id from b union select organization_id from credits where unapplied<>0) k join public.organizations org on org.id=k.organization_id
 left join b on b.organization_id=k.organization_id left join credits cr on cr.organization_id=k.organization_id order by 9 desc,2;
end $$;
revoke all on public.acc_invoice_balances from public,anon,authenticated;
grant select on public.acc_invoice_balances to authenticated;
revoke all on function public.acc_receivables_ageing(date) from public,anon,authenticated;
grant execute on function public.acc_receivables_ageing(date) to authenticated;
commit;
