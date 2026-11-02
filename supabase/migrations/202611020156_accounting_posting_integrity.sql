-- Keep customer subledgers aligned and verify every persisted value on posting retries.
begin;

create or replace function public.post_manual_journal(p_id uuid, p_date date, p_memo text, p_lines jsonb)
returns public.acc_journal_entries language plpgsql security definer set search_path=public,pg_temp as $$
declare v public.acc_journal_entries; v_requested jsonb; v_saved jsonb;
begin
 perform public.acc_require_access();
 if p_id is null or p_date is null or p_memo is null then raise exception 'Entry id, date and description are required'; end if;
 if jsonb_typeof(p_lines) is distinct from 'array' then raise exception 'An entry needs between 2 and 200 lines'; end if;
 if jsonb_array_length(p_lines) not between 2 and 200 then raise exception 'An entry needs between 2 and 200 lines'; end if;
 if exists(select 1 from jsonb_array_elements(p_lines) l where jsonb_typeof(l)<>'object' or length(coalesce(l->>'description',''))>300) then
  raise exception 'Journal lines must be objects with descriptions of at most 300 characters';
 end if;
 select jsonb_agg(jsonb_build_object('account_id',(l->>'account_id')::uuid,
  'debit_minor',coalesce((l->>'debit_minor')::bigint,0),'credit_minor',coalesce((l->>'credit_minor')::bigint,0),
  'organization_id',nullif(l->>'organization_id','')::uuid,'description',coalesce(l->>'description','')) order by ordinality)
 into v_requested from jsonb_array_elements(p_lines) with ordinality as x(l,ordinality);
 perform pg_advisory_xact_lock(hashtextextended('acc-entry:'||p_id::text,0));
 select * into v from public.acc_journal_entries where id=p_id;
 if found then
  select jsonb_agg(jsonb_build_object('account_id',account_id,'debit_minor',debit_minor,'credit_minor',credit_minor,
   'organization_id',organization_id,'description',description) order by line_no) into v_saved
  from public.acc_journal_lines where entry_id=p_id;
  if v.source_type is distinct from 'manual' or v.entry_date is distinct from p_date or v.memo is distinct from trim(p_memo)
   or v_saved is distinct from v_requested then raise exception 'This entry id was already used for different details; refresh'; end if;
  return v;
 end if;
 if exists(select 1 from jsonb_array_elements(v_requested) l join public.acc_accounts a on a.id=(l->>'account_id')::uuid where a.system_key='receivables') then
  raise exception 'Use customer invoices, receipts or opening receivables for the receivables control account';
 end if;
 return public.acc_post(p_id,p_date,p_memo,'manual',null,null,p_lines);
end $$;

create or replace function public.record_receipt(p_id uuid, p_organization_id uuid, p_date date, p_amount_minor bigint, p_method text, p_reference text, p_deposit_account_id uuid, p_allocations jsonb default '[]'::jsonb)
returns public.acc_receipts language plpgsql security definer set search_path=public,pg_temp as $$
declare v public.acc_receipts; v_actor uuid; v_entry uuid:=gen_random_uuid(); v_a jsonb; v_inv public.acc_invoices; v_amt bigint; v_total bigint:=0; v_seen uuid[]:='{}'; v_requested jsonb; v_saved jsonb;
begin
 v_actor:=public.acc_require_access();
 if p_id is null then raise exception 'Receipt request id is required'; end if;
 if jsonb_typeof(coalesce(p_allocations,'[]'::jsonb))<>'array' then raise exception 'Allocations are not valid'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('invoice_id',(a->>'invoice_id')::uuid,'amount_minor',(a->>'amount_minor')::bigint)
  order by (a->>'invoice_id')::uuid),'[]'::jsonb) into v_requested from jsonb_array_elements(coalesce(p_allocations,'[]'::jsonb)) a;
 perform pg_advisory_xact_lock(hashtextextended('acc-receipt-org:'||coalesce(p_organization_id::text,''),0));
 select * into v from public.acc_receipts where id=p_id;
 if found then
  select coalesce(jsonb_agg(jsonb_build_object('invoice_id',invoice_id,'amount_minor',amount_minor) order by invoice_id),'[]'::jsonb)
  into v_saved from public.acc_receipt_allocations where receipt_id=p_id;
  if v.organization_id is distinct from p_organization_id or v.amount_minor is distinct from p_amount_minor or v.receipt_date is distinct from p_date
   or v.method is distinct from p_method or v.reference is distinct from trim(coalesce(p_reference,''))
   or v.deposit_account_id is distinct from p_deposit_account_id or v_saved is distinct from v_requested then
   raise exception 'This receipt id was already used for different details; refresh';
  end if;
  return v;
 end if;
 if p_amount_minor is null or p_amount_minor<=0 then raise exception 'Enter an amount above zero'; end if;
 if p_method not in ('bank','cash','mobile_money','cheque') then raise exception 'Choose how the money was received'; end if;
 if length(coalesce(p_reference,''))>120 then raise exception 'The reference is too long'; end if;
 if not exists(select 1 from public.organizations where id=p_organization_id) then raise exception 'Customer not found'; end if;
 if not exists(select 1 from public.acc_accounts where id=p_deposit_account_id and active and account_type='asset' and system_key is distinct from 'receivables') then raise exception 'Choose the bank, cash or mobile money account the money went into'; end if;
 perform public.acc_post(v_entry,p_date,'Customer receipt'||case when length(trim(coalesce(p_reference,'')))>0 then ' '||trim(p_reference) else '' end,'receipt',p_id,null,
  jsonb_build_array(
   jsonb_build_object('account_id',p_deposit_account_id,'debit_minor',p_amount_minor,'description',p_method),
   jsonb_build_object('account_id',public.acc_account_by_key('receivables'),'credit_minor',p_amount_minor,'organization_id',p_organization_id,'description',p_method)));
 insert into public.acc_receipts(id,receipt_number,organization_id,receipt_date,amount_minor,method,reference,deposit_account_id,journal_entry_id,created_by)
 values(p_id,'RCT-'||to_char(p_date,'YYYY')||'-'||lpad(nextval('public.acc_receipt_number_seq')::text,6,'0'),p_organization_id,p_date,p_amount_minor,p_method,trim(coalesce(p_reference,'')),p_deposit_account_id,v_entry,v_actor)
 returning * into v;
 for v_a in select * from jsonb_array_elements(coalesce(p_allocations,'[]'::jsonb)) loop
  begin v_amt:=(v_a->>'amount_minor')::bigint; exception when others then raise exception 'An allocation amount is not valid'; end;
  if v_amt is null or v_amt<=0 then raise exception 'Allocation amounts must be above zero'; end if;
  select * into v_inv from public.acc_invoices where id=(v_a->>'invoice_id')::uuid for update;
  if not found or v_inv.voided_at is not null then raise exception 'An allocated invoice is missing or void'; end if;
  if v_inv.organization_id<>p_organization_id then raise exception 'Invoice % belongs to another customer', v_inv.invoice_number; end if;
  if v_inv.id=any(v_seen) then raise exception 'Invoice % is listed twice', v_inv.invoice_number; end if;
  v_seen:=v_seen||v_inv.id;
  if v_amt>v_inv.total_minor-public.acc_invoice_paid_minor(v_inv.id) then raise exception 'Invoice % has less than that left to pay', v_inv.invoice_number; end if;
  insert into public.acc_receipt_allocations(receipt_id,invoice_id,amount_minor) values(p_id,v_inv.id,v_amt);
  v_total:=v_total+v_amt;
 end loop;
 if v_total>p_amount_minor then raise exception 'Allocations add up to more than the amount received'; end if;
 return v;
end $$;

create or replace function public.reverse_journal_entry(p_id uuid, p_entry_id uuid, p_date date, p_reason text)
returns public.acc_journal_entries language plpgsql security definer set search_path=public,pg_temp as $$
declare v public.acc_journal_entries; v_src text;
begin
 perform public.acc_require_access();
 if p_id is null or p_entry_id is null or p_date is null then raise exception 'Reversal id, original entry and date are required'; end if;
 -- Match opening import serialization before examining or reversing its GL journals.
 perform pg_advisory_xact_lock(hashtextextended('acc-financial-import',0));
 perform pg_advisory_xact_lock(hashtextextended('acc-entry:'||p_id::text,0));
 if p_reason is null or length(trim(p_reason))<5 then raise exception 'Give a reason of at least 5 characters'; end if;
 select * into v from public.acc_journal_entries where id=p_id;
 if found then
  if v.reverses_entry_id is distinct from p_entry_id or v.entry_date is distinct from p_date
   or v.memo is distinct from 'Reversal of '||(select entry_number from public.acc_journal_entries where id=p_entry_id)||': '||trim(p_reason) then
   raise exception 'This entry id was already used for different details; refresh';
  end if;
  return v;
 end if;
 select source_type into v_src from public.acc_journal_entries where id=p_entry_id;
 if v_src is null then raise exception 'Journal entry not found'; end if;
 if v_src='reversal' then raise exception 'A reversal cannot itself be reversed; post a new entry'; end if;
 if v_src<>'manual' then raise exception 'Invoices and receipts are corrected by voiding them, not by reversing their entry'; end if;
 if exists(select 1 from public.acc_imported_journals j join public.acc_opening_receivable_imports o on o.gl_import_id=j.import_id where j.entry_id=p_entry_id) then
  raise exception 'Opening journals with attached customer residuals cannot be reversed; reconcile corrections with Accounts';
 end if;
 return public.acc_reverse(p_id,p_entry_id,p_date,p_reason);
end $$;

-- Only the authorized opening importer may post AR without an invoice. Internal acc_post remains revoked.
do $migration$
declare v_definition text; v_old text:=$old$   v_posted:=public.post_manual_journal(gen_random_uuid(),v_date,v_memo,v_entry->'lines');$old$;
 v_new text:=$new$   if p_kind='opening' then
    v_posted:=public.acc_post(gen_random_uuid(),v_date,v_memo,'manual',null,null,v_entry->'lines');
   else
    v_posted:=public.post_manual_journal(gen_random_uuid(),v_date,v_memo,v_entry->'lines');
   end if;$new$;
begin
 v_definition:=pg_get_functiondef('public.import_financial_journals(uuid,text,text,jsonb)'::regprocedure);
 if strpos(v_definition,v_new)>0 then return; end if;
 if (length(v_definition)-length(replace(v_definition,v_old,'')))/length(v_old)<>1 then raise exception 'Unexpected financial import posting dependency'; end if;
 execute replace(v_definition,v_old,v_new);
end $migration$;

revoke all on function public.post_manual_journal(uuid,date,text,jsonb),public.record_receipt(uuid,uuid,date,bigint,text,text,uuid,jsonb),public.reverse_journal_entry(uuid,uuid,date,text) from public,anon,authenticated;
grant execute on function public.post_manual_journal(uuid,date,text,jsonb),public.record_receipt(uuid,uuid,date,bigint,text,text,uuid,jsonb),public.reverse_journal_entry(uuid,uuid,date,text) to authenticated;
commit;
