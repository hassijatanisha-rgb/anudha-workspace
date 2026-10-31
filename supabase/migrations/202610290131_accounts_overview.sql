begin;

-- The overview reads the existing financial summaries and only the twenty
-- visible rows in each queue. Invoice/receipt editors keep their full datasets.
create function public.acc_overview(p_as_of date)
returns jsonb language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare v_result jsonb;
begin
 if not coalesce(public.accounting_access(),false) then raise exception 'Accounting access is required' using errcode='42501'; end if;
 if p_as_of is null then raise exception 'Choose an accounts overview date'; end if;
 with trial as materialized (
  select a.system_key,t.debit_minor-t.credit_minor as balance
  from public.acc_trial_balance(p_as_of) t join public.acc_accounts a on a.id=t.account_id
 ), overdue as materialized (
  select * from public.acc_invoice_balances where status_key='overdue'
 ), invoice_page as materialized (
  select * from overdue order by invoice_date desc,invoice_number desc,id limit 20
 ), unrecorded_tra as materialized (
  select id,organization_id,invoice_number,invoice_date,total_minor,tra_receipt_number,tra_verification_code,
   buyer_tin,buyer_vrn,voided_at,opening_import_id
  from public.acc_invoices
  where voided_at is null and opening_import_id is null and btrim(tra_receipt_number)=''
 ), tra_page as materialized (
  select * from unrecorded_tra order by invoice_date desc,invoice_number desc,id limit 20
 ), waiting as materialized (
  select * from public.acc_waiting_proformas
 ), waiting_page as materialized (
  select * from waiting order by accepted_at desc,id limit 20
 )
 select jsonb_build_object(
  'today',p_as_of,
  'settings',coalesce((select to_jsonb(s) from public.acc_settings s where s.id),'{}'::jsonb),
  'summary',jsonb_build_object(
   'money_minor',coalesce((select sum(balance) from trial where system_key in ('cash','bank','mobile_money')),0),
   'receivables_minor',coalesce((select sum(balance) from trial where system_key='receivables'),0),
   'vat_minor',-coalesce((select sum(balance) from trial where system_key='vat_output'),0),
   'profit_minor',(select coalesce(sum(case when p.account_type='income' then p.amount_minor when p.account_type='expense' then -p.amount_minor else 0 end),0) from public.acc_profit_and_loss(date_trunc('month',p_as_of)::date,p_as_of) p)
  ),
  'overdue_count',(select count(*) from overdue),
  'waiting_count',(select count(*) from waiting),
  'unrecorded_tra_count',(select count(*) from unrecorded_tra),
  'unrecorded_tra',coalesce((select jsonb_agg(to_jsonb(i)||jsonb_build_object('customer_name',o.name) order by i.invoice_date desc,i.invoice_number desc,i.id) from tra_page i left join public.organizations o on o.id=i.organization_id),'[]'::jsonb),
  'invoices',coalesce((select jsonb_agg(to_jsonb(i)||jsonb_build_object('customer_name',o.name) order by i.invoice_date desc,i.invoice_number desc,i.id) from invoice_page i left join public.organizations o on o.id=i.organization_id),'[]'::jsonb),
  'to_invoice',coalesce((select jsonb_agg(to_jsonb(p)||jsonb_build_object('customer_name',o.name) order by p.accepted_at desc,p.id) from waiting_page p left join public.organizations o on o.id=p.organization_id),'[]'::jsonb),
  'tax_ids',coalesce((select jsonb_agg(to_jsonb(t)) from public.acc_customer_tax_ids t where t.organization_id in (select organization_id from invoice_page union select organization_id from tra_page)),'[]'::jsonb)
 ) into v_result;
 return v_result;
end $$;
revoke all on function public.acc_overview(date) from public,anon;
grant execute on function public.acc_overview(date) to authenticated;
commit;
