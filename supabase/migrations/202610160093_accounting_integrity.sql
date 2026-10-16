-- Balances come from the whole ledger; page boundaries must never change what a customer owes.
-- Historical reports follow the accounting date of the reversal, not when someone clicked Void.
begin;

create or replace function public.acc_invoice_paid_minor(p_invoice_id uuid, p_as_of date default null)
returns bigint language sql stable security definer set search_path=public,pg_temp as $$
 select coalesce(sum(a.amount_minor),0)::bigint
 from public.acc_receipt_allocations a join public.acc_receipts r on r.id=a.receipt_id
 left join public.acc_journal_entries reversal on reversal.id=r.void_entry_id
 where a.invoice_id=p_invoice_id
  and ((p_as_of is null and r.voided_at is null)
   or (p_as_of is not null and r.receipt_date<=p_as_of and (r.void_entry_id is null or reversal.entry_date>p_as_of)))
$$;

-- Invoker views preserve the tables' accounting-access RLS and have no write privileges.
create or replace view public.acc_invoice_balances with (security_invoker=true) as
 select i.*,pf.document_number as proforma_number,p.paid_minor,
  case when i.voided_at is not null then 0 else i.total_minor-p.paid_minor end as outstanding_minor,
  case when i.voided_at is not null then 'void' when p.paid_minor>=i.total_minor then 'paid'
   when i.due_date<(now() at time zone 'Africa/Dar_es_Salaam')::date then 'overdue'
   when p.paid_minor>0 then 'part' else 'open' end as status_key,
  case when i.voided_at is not null then 'Void' when p.paid_minor>=i.total_minor then 'Paid'
   when i.due_date<(now() at time zone 'Africa/Dar_es_Salaam')::date then case when p.paid_minor>0 then 'Part paid · overdue' else 'Overdue' end
   when p.paid_minor>0 then 'Part paid' else 'Unpaid' end as status_label
 from public.acc_invoices i left join public.sales_proformas pf on pf.id=i.proforma_id
 cross join lateral (
  select coalesce(sum(a.amount_minor),0)::bigint as paid_minor
  from public.acc_receipt_allocations a join public.acc_receipts r on r.id=a.receipt_id
  where a.invoice_id=i.id and r.voided_at is null
 ) p;

create or replace view public.acc_waiting_proformas with (security_invoker=true) as
 select p.id,p.document_number,p.organization_id,p.currency,p.total_minor,p.accepted_at
 from public.sales_proformas p
 where (select public.accounting_access()) and p.status='accepted' and p.deleted_at is null
  and not exists(select 1 from public.acc_invoices i where i.proforma_id=p.id and i.voided_at is null);

revoke all on public.acc_invoice_balances,public.acc_waiting_proformas from public,anon,authenticated;
grant select on public.acc_invoice_balances,public.acc_waiting_proformas to authenticated;

create or replace function public.acc_receivables_ageing(p_as_of date)
returns table(organization_id uuid, customer text, current_minor bigint, days_1_30_minor bigint, days_31_60_minor bigint, days_61_90_minor bigint, days_over_90_minor bigint, unapplied_credit_minor bigint, balance_minor bigint)
language plpgsql stable security definer set search_path=public,pg_temp as $$
#variable_conflict use_column
begin
 perform public.acc_require_access();
 return query
 with active_invoices as (
  select i.* from public.acc_invoices i
  left join public.acc_journal_entries reversal on reversal.id=i.void_entry_id
  where i.invoice_date<=p_as_of and (i.void_entry_id is null or reversal.entry_date>p_as_of)
 ), open_inv as (
  select i.organization_id,i.due_date,i.total_minor-public.acc_invoice_paid_minor(i.id,p_as_of) as due
  from active_invoices i
 ), credits as (
  select r.organization_id,sum(r.amount_minor-coalesce((
   select sum(a.amount_minor) from public.acc_receipt_allocations a join active_invoices i on i.id=a.invoice_id where a.receipt_id=r.id
  ),0)) as unapplied
  from public.acc_receipts r left join public.acc_journal_entries reversal on reversal.id=r.void_entry_id
  where r.receipt_date<=p_as_of and (r.void_entry_id is null or reversal.entry_date>p_as_of)
  group by r.organization_id
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

revoke all on function public.acc_invoice_paid_minor(uuid,date) from public,anon,authenticated;
revoke all on function public.acc_receivables_ageing(date) from public,anon,authenticated;
grant execute on function public.acc_receivables_ageing(date) to authenticated;

commit;
