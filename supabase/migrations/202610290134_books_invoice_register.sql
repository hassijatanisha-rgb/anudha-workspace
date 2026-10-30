begin;

-- Page the existing caller-visible balances and waiting-order view; do not
-- change their settlement, partial-invoice or opening-balance semantics.
create function public.acc_invoice_register(p_invoice_page integer default 0,p_waiting_page integer default 0)
returns jsonb language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare v_result jsonb;
begin
 if not coalesce(public.accounting_access(),false) then raise exception 'Accounting access is required' using errcode='42501'; end if;
 if p_invoice_page is null or p_invoice_page<0 or p_invoice_page>1000000 or p_waiting_page is null or p_waiting_page<0 or p_waiting_page>1000000 then raise exception 'Choose a valid invoice register page'; end if;
 with balances as materialized (
  select id,invoice_number,proforma_id,organization_id,invoice_date,due_date,currency,total_minor,paid_minor,outstanding_minor,status_key,status_label,
   credited_minor,customer_credit_minor,voided_at,opening_import_id,opening_reference,opening_cutover_date,proforma_number,
   tra_receipt_number,tra_verification_code,buyer_tin,buyer_vrn,fiscal_recorded_by,fiscal_recorded_at
  from public.acc_invoice_balances
 ), waiting as materialized (
  select id,document_number,organization_id,currency,total_minor,accepted_at from public.acc_waiting_proformas
 ), counts as (
  select (select count(*) from balances) invoice_count,(select count(*) from waiting) waiting_count
 ), pages as (
  select *,least(p_invoice_page,greatest((invoice_count-1)/50,0)) invoice_page,least(p_waiting_page,greatest((waiting_count-1)/20,0)) waiting_page from counts
 ), invoice_page as materialized (
  select * from balances order by invoice_date desc,invoice_number desc,id limit 50 offset (select invoice_page*50 from pages)
 ), waiting_page as materialized (
  select * from waiting order by accepted_at desc,id limit 20 offset (select waiting_page*20 from pages)
 )
 select jsonb_build_object(
  'today',(now() at time zone 'Africa/Dar_es_Salaam')::date,
  'settings',coalesce((select to_jsonb(s) from public.acc_settings s where s.id),'{}'::jsonb),
  'invoice_count',p.invoice_count,'waiting_count',p.waiting_count,'invoice_page',p.invoice_page,'waiting_page',p.waiting_page,
  'summary',(select jsonb_build_object('total_minor',coalesce(sum(total_minor) filter(where voided_at is null),0),'paid_minor',coalesce(sum(paid_minor) filter(where voided_at is null),0),'credited_minor',coalesce(sum(credited_minor) filter(where voided_at is null),0),'outstanding_minor',coalesce(sum(outstanding_minor) filter(where voided_at is null),0),'customer_credit_minor',coalesce(sum(customer_credit_minor) filter(where voided_at is null),0)) from balances),
  'invoices',coalesce((select jsonb_agg(to_jsonb(i)||jsonb_build_object('customer_name',o.name) order by i.invoice_date desc,i.invoice_number desc,i.id) from invoice_page i left join public.organizations o on o.id=i.organization_id),'[]'::jsonb),
  'to_invoice',coalesce((select jsonb_agg(to_jsonb(w)||jsonb_build_object('customer_name',o.name) order by w.accepted_at desc,w.id) from waiting_page w left join public.organizations o on o.id=w.organization_id),'[]'::jsonb),
  'tax_ids',coalesce((select jsonb_agg(to_jsonb(t)) from public.acc_customer_tax_ids t where t.organization_id in(select organization_id from invoice_page)),'[]'::jsonb)
 ) into v_result from pages p;
 return v_result;
end $$;
revoke all on function public.acc_invoice_register(integer,integer) from public,anon;
grant execute on function public.acc_invoice_register(integer,integer) to authenticated;
commit;
