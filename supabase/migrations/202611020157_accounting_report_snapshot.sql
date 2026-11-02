-- One result row preserves complete reports through API row limits; money stays exact in JSON.
begin;

create or replace function public.acc_financial_report(p_kind text,p_from date default null,p_to date default null,p_as_of date default null)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_rows jsonb;
begin
 perform public.acc_require_access();
 if p_kind is null or p_kind not in ('trial','pl','bs','ageing') then raise exception 'Choose a supported financial report'; end if;
 if p_kind='pl' then
  if p_from is null or p_to is null or not isfinite(p_from) or not isfinite(p_to) or p_from>p_to then
   raise exception 'Choose a valid report period with the start on or before the end';
  end if;
 elsif p_as_of is null or not isfinite(p_as_of) then
  raise exception 'Choose a valid report date';
 end if;

 if p_kind='trial' then
  select coalesce(jsonb_agg(to_jsonb(r)-'ordinality' order by r.ordinality),'[]'::jsonb) into v_rows
  from (select t.account_id,t.code,t.name,t.account_type,t.debit_minor::text as debit_minor,t.credit_minor::text as credit_minor,t.ordinality
   from public.acc_trial_balance(p_as_of) with ordinality t) r;
 elsif p_kind='pl' then
  select coalesce(jsonb_agg(to_jsonb(r)-'ordinality' order by r.ordinality),'[]'::jsonb) into v_rows
  from (select t.account_id,t.code,t.name,t.account_type,t.amount_minor::text as amount_minor,t.ordinality
   from public.acc_profit_and_loss(p_from,p_to) with ordinality t) r;
 elsif p_kind='bs' then
  select coalesce(jsonb_agg(to_jsonb(r)-'ordinality' order by r.ordinality),'[]'::jsonb) into v_rows
  from (select t.account_id,t.code,t.name,t.account_type,t.amount_minor::text as amount_minor,t.ordinality
   from public.acc_balance_sheet(p_as_of) with ordinality t) r;
 else
  select coalesce(jsonb_agg(to_jsonb(r)-'ordinality' order by r.ordinality),'[]'::jsonb) into v_rows
  from (select t.organization_id,t.customer,t.current_minor::text as current_minor,t.days_1_30_minor::text as days_1_30_minor,
   t.days_31_60_minor::text as days_31_60_minor,t.days_61_90_minor::text as days_61_90_minor,
   t.days_over_90_minor::text as days_over_90_minor,t.unapplied_credit_minor::text as unapplied_credit_minor,
   t.balance_minor::text as balance_minor,t.ordinality
   from public.acc_receivables_ageing(p_as_of) with ordinality t) r;
 end if;
 return jsonb_build_object('kind',p_kind,'rows',v_rows,'row_count',jsonb_array_length(v_rows));
end $$;

revoke all on function public.acc_financial_report(text,date,date,date) from public,anon,authenticated;
grant execute on function public.acc_financial_report(text,date,date,date) to authenticated;
commit;
