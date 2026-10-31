begin;

-- Keep complete posting prerequisites behind Open/New while the registers read
-- only caller-visible summaries. Totals cover the full register, not its page.
create function public.acc_transaction_page(p_section text,p_page integer default 0)
returns jsonb language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare v_result jsonb;
begin
 if not coalesce(public.accounting_access(),false) then raise exception 'Accounting access is required' using errcode='42501'; end if;
 if p_section is null or p_section not in ('receipts','journal') or p_page is null or p_page<0 or p_page>1000000 then raise exception 'Choose a valid transaction register page'; end if;
 if p_section='receipts' then
  with receipt_totals as materialized (
   select r.id,r.receipt_number,r.organization_id,r.receipt_date,r.amount_minor,r.method,r.reference,r.voided_at,
    coalesce(a.applied_minor,0) as applied_minor
   from public.acc_receipts r
   left join (select receipt_id,sum(amount_minor) as applied_minor from public.acc_receipt_allocations group by receipt_id) a on a.receipt_id=r.id
  ), totals as (
   select count(*) as total,greatest(1,(count(*)+24)/25) as pages,least(p_page,greatest(0,(count(*)-1)/25)) as page,
    jsonb_build_object('amount_minor',coalesce(sum(amount_minor) filter(where voided_at is null),0),
     'applied_minor',coalesce(sum(applied_minor) filter(where voided_at is null),0),
     'credit_minor',coalesce(sum(amount_minor-applied_minor) filter(where voided_at is null),0)) as summary from receipt_totals
  ), page_rows as (
   select * from receipt_totals order by receipt_date desc,receipt_number desc,id limit 25 offset (select page*25 from totals)
  )
  select jsonb_build_object('section',p_section,'total',t.total,'page',t.page,'pages',t.pages,'summary',t.summary,
   'today',(now() at time zone 'Africa/Dar_es_Salaam')::date,
   'settings',coalesce((select to_jsonb(s) from public.acc_settings s where s.id),'{}'::jsonb),
   'rows',coalesce((select jsonb_agg(to_jsonb(r)||jsonb_build_object('customer_name',o.name) order by r.receipt_date desc,r.receipt_number desc,r.id)
    from page_rows r left join public.organizations o on o.id=r.organization_id and o.deleted_at is null),'[]'::jsonb)) into v_result from totals t;
 else
  with entry_totals as materialized (
   select e.id,e.entry_number,e.entry_date,e.memo,e.source_type,e.created_by,e.reverses_entry_id,
    exists(select 1 from public.acc_journal_entries reversal where reversal.reverses_entry_id=e.id) as reversed,
    coalesce(l.debit_minor,0) as debit_minor,coalesce(l.credit_minor,0) as credit_minor
   from public.acc_journal_entries e
   left join (select entry_id,sum(debit_minor) as debit_minor,sum(credit_minor) as credit_minor from public.acc_journal_lines group by entry_id) l on l.entry_id=e.id
  ), totals as (
   select count(*) as total,greatest(1,(count(*)+24)/25) as pages,least(p_page,greatest(0,(count(*)-1)/25)) as page,
    jsonb_build_object('debit_minor',coalesce(sum(debit_minor),0),'credit_minor',coalesce(sum(credit_minor),0)) as summary from entry_totals
  ), page_rows as (
   select * from entry_totals order by entry_date desc,entry_number desc,id limit 25 offset (select page*25 from totals)
  )
  select jsonb_build_object('section',p_section,'total',t.total,'page',t.page,'pages',t.pages,'summary',t.summary,
   'today',(now() at time zone 'Africa/Dar_es_Salaam')::date,
   'settings',coalesce((select to_jsonb(s) from public.acc_settings s where s.id),'{}'::jsonb),
   'rows',coalesce((select jsonb_agg(to_jsonb(e) order by e.entry_date desc,e.entry_number desc,e.id) from page_rows e),'[]'::jsonb)) into v_result from totals t;
 end if;
 return v_result;
end $$;
revoke all on function public.acc_transaction_page(text,integer) from public,anon;
grant execute on function public.acc_transaction_page(text,integer) to authenticated;
commit;
