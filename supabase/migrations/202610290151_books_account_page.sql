begin;

-- Page account identities only after computing complete caller-visible balances.
-- Posting and lock RPCs retain their existing authorization and version checks.
create function public.acc_account_page(p_as_of date,p_query text default '',p_type text default '',p_page integer default 0)
returns jsonb language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare v_result jsonb;
begin
 if not coalesce(public.accounting_access(),false) then raise exception 'Accounting access is required' using errcode='42501'; end if;
 if p_as_of is null or not isfinite(p_as_of) or p_query is null or length(p_query)>2000 or p_type is null or p_type not in ('','asset','liability','equity','income','expense') or p_page is null or p_page<0 or p_page>1000000 then raise exception 'Choose valid account filters and page'; end if;
 with balances as materialized (
  select a.id,a.code,a.name,a.account_type,a.system_key,a.active,a.version,
   coalesce(b.balance_minor,0) as balance_minor,
   case a.account_type when 'asset' then 0 when 'liability' then 1 when 'equity' then 2 when 'income' then 3 else 4 end as type_order
  from public.acc_accounts a
  left join (select l.account_id,sum(l.debit_minor-l.credit_minor) as balance_minor
   from public.acc_journal_lines l join public.acc_journal_entries e on e.id=l.entry_id where e.entry_date<=p_as_of group by l.account_id) b on b.account_id=a.id
 ), filtered as (
  select * from balances where (p_type='' or account_type=p_type)
   and (btrim(p_query)='' or strpos(lower(code||' '||name),lower(btrim(p_query)))>0)
 ), totals as (
  select count(*) as total,greatest(1,(count(*)+49)/50) as pages,least(p_page,greatest(0,(count(*)-1)/50)) as page from filtered
 ), page_rows as (
  select * from filtered order by type_order,code,id limit 50 offset (select page*50 from totals)
 )
 select jsonb_build_object('total',t.total,'page',t.page,'pages',t.pages,'today',p_as_of,
  'settings',coalesce((select jsonb_build_object('version',s.version,'locked_through',s.locked_through) from public.acc_settings s where s.id),'{}'::jsonb),
  'summary',(select jsonb_build_object('account_count',count(*),'debit_minor',coalesce(sum(greatest(balance_minor,0)),0),'credit_minor',coalesce(sum(greatest(-balance_minor,0)),0)) from balances),
  'accounts',coalesce((select jsonb_agg(to_jsonb(r)-'type_order' order by r.type_order,r.code,r.id) from page_rows r),'[]'::jsonb)) into v_result from totals t;
 return v_result;
end $$;

-- Opening balance and the running window precede paging. Every visible journal
-- line contributes, including repeated lines in the same entry and reversals.
create function public.acc_ledger_page(p_account_id uuid,p_from date,p_to date,p_page integer default 0)
returns jsonb language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare v_result jsonb;v_account public.acc_accounts;
begin
 if not coalesce(public.accounting_access(),false) then raise exception 'Accounting access is required' using errcode='42501'; end if;
 if p_from is null or p_to is null or not isfinite(p_from) or not isfinite(p_to) or p_page is null or p_page<0 or p_page>1000000 then raise exception 'Choose valid ledger dates and page'; end if;
 if p_account_id is null then select * into v_account from public.acc_accounts where system_key='bank';
 else select * into v_account from public.acc_accounts where id=p_account_id;
  if not found then raise exception 'This account is unavailable'; end if;
 end if;
 with opening as (
  select coalesce(sum(l.debit_minor-l.credit_minor),0) as amount from public.acc_journal_lines l join public.acc_journal_entries e on e.id=l.entry_id
  where l.account_id=v_account.id and e.entry_date<p_from
 ), period as materialized (
  select l.id as line_id,e.id as entry_id,e.entry_date,e.entry_number,e.memo,l.description,l.line_no,l.debit_minor,l.credit_minor,
   (select amount from opening)+sum(l.debit_minor-l.credit_minor) over(order by e.entry_date,e.entry_number,l.line_no,l.id) as balance_minor
  from public.acc_journal_lines l join public.acc_journal_entries e on e.id=l.entry_id
  where l.account_id=v_account.id and e.entry_date between p_from and p_to
 ), report_rows as (
  select null::uuid as line_id,null::uuid as entry_id,p_from as entry_date,''::text as entry_number,'Opening balance'::text as memo,''::text as description,0 as line_no,0::bigint as debit_minor,0::bigint as credit_minor,amount as balance_minor from opening where v_account.id is not null
  union all select * from period
 ), totals as (
  select count(*) as total,greatest(1,(count(*)+49)/50) as pages,least(p_page,greatest(0,(count(*)-1)/50)) as page from report_rows
 ), page_rows as (
  select * from report_rows order by entry_date,entry_number,line_no,line_id limit 50 offset (select page*50 from totals)
 )
 select jsonb_build_object('account',case when v_account.id is null then null else jsonb_build_object('id',v_account.id,'code',v_account.code,'name',v_account.name,'account_type',v_account.account_type,'active',v_account.active) end,
  'from',p_from,'to',p_to,'total',t.total,'page',t.page,'pages',t.pages,
  'settings',coalesce((select jsonb_build_object('version',s.version,'locked_through',s.locked_through) from public.acc_settings s where s.id),'{}'::jsonb),
  'summary',(select jsonb_build_object('opening_minor',o.amount,'debit_minor',coalesce(sum(p.debit_minor),0),'credit_minor',coalesce(sum(p.credit_minor),0),'closing_minor',o.amount+coalesce(sum(p.debit_minor-p.credit_minor),0)) from opening o left join period p on true group by o.amount),
  'rows',coalesce((select jsonb_agg(to_jsonb(r)-'line_no' order by r.entry_date,r.entry_number,r.line_no,r.line_id) from page_rows r),'[]'::jsonb)) into v_result from totals t;
 return v_result;
end $$;
revoke all on function public.acc_account_page(date,text,text,integer),public.acc_ledger_page(uuid,date,date,integer) from public,anon;
grant execute on function public.acc_account_page(date,text,text,integer),public.acc_ledger_page(uuid,date,date,integer) to authenticated;
commit;
