-- Reviewed Excel/CSV opening balances and transaction journals: one atomic, retry-safe posting.
-- Customer invoice/receipt subledgers are deliberately outside this general-ledger import.
begin;

create table if not exists public.acc_financial_imports (
 id uuid primary key,
 source text not null,
 import_kind text not null check(import_kind in ('opening','journal')),
 entries jsonb not null,
 result jsonb not null,
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now()
);
create table if not exists public.acc_imported_journals (
 source text not null,
 reference text not null,
 import_kind text not null check(import_kind in ('opening','journal')),
 entry_id uuid not null unique references public.acc_journal_entries(id),
 content jsonb not null,
 import_id uuid not null references public.acc_financial_imports(id) deferrable initially deferred,
 primary key(source,reference)
);
alter table public.acc_financial_imports enable row level security;
alter table public.acc_imported_journals enable row level security;
drop policy if exists acc_financial_imports_read on public.acc_financial_imports;
create policy acc_financial_imports_read on public.acc_financial_imports for select to authenticated using((select public.accounting_access()));
drop policy if exists acc_imported_journals_read on public.acc_imported_journals;
create policy acc_imported_journals_read on public.acc_imported_journals for select to authenticated using((select public.accounting_access()));
revoke all on public.acc_financial_imports,public.acc_imported_journals from public,anon,authenticated;
grant select on public.acc_financial_imports,public.acc_imported_journals to authenticated;
drop trigger if exists acc_financial_imports_immutable on public.acc_financial_imports;
create trigger acc_financial_imports_immutable before update or delete on public.acc_financial_imports for each row execute function public.acc_deny_change();
drop trigger if exists acc_imported_journals_immutable on public.acc_imported_journals;
create trigger acc_imported_journals_immutable before update or delete on public.acc_imported_journals for each row execute function public.acc_deny_change();

create or replace function public.financial_import_status(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
 perform public.acc_require_access();
 return (select result from public.acc_financial_imports where id=p_id);
end $$;

create or replace function public.import_financial_journals(p_id uuid,p_source text,p_kind text,p_entries jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_actor uuid;v_source text:=lower(trim(coalesce(p_source,'')));v_prior public.acc_financial_imports;
 v_entry jsonb;v_line jsonb;v_ref text;v_date date;v_memo text;v_saved public.acc_imported_journals;v_posted public.acc_journal_entries;
 v_refs text[]:='{}';v_lines integer:=0;v_debit bigint;v_credit bigint;v_debits bigint;v_credits bigint;
 v_imported integer:=0;v_skipped integer:=0;v_results jsonb:='[]';v_result jsonb;
begin
 v_actor:=public.acc_require_access();
 if p_id is null then raise exception 'Import request id is required';end if;
 if length(v_source) not between 1 and 80 then raise exception 'Source name must contain 1–80 characters';end if;
 if p_kind is null or p_kind not in ('opening','journal') then raise exception 'Choose opening balances or journal transactions';end if;
 if p_entries is null or jsonb_typeof(p_entries)<>'array' then raise exception 'Supply a list of journal entries';end if;
 if jsonb_array_length(p_entries) not between 1 and 100 or octet_length(p_entries::text)>1048576 then raise exception 'Import at most 100 entries and 1 MB of journal data';end if;
 -- Serialize overlapping batches so a source/reference can never be posted by two concurrent imports.
 perform pg_advisory_xact_lock(hashtextextended('acc-financial-import',0));
 select * into v_prior from public.acc_financial_imports where id=p_id;
 if found then
  if v_prior.source<>v_source or v_prior.import_kind<>p_kind or v_prior.entries<>p_entries then raise exception 'This import request id was already used for different details';end if;
  return v_prior.result;
 end if;
 for v_entry in select * from jsonb_array_elements(p_entries) loop
  if jsonb_typeof(v_entry)<>'object' or v_entry-array['reference','date','memo','lines']<>'{}'::jsonb then raise exception 'Each journal needs only reference, date, memo and lines';end if;
  if jsonb_typeof(v_entry->'reference') is distinct from 'string' or jsonb_typeof(v_entry->'date') is distinct from 'string' or jsonb_typeof(v_entry->'memo') is distinct from 'string' then raise exception 'Reference, date and memo must be text';end if;
  v_ref:=trim(v_entry->>'reference');v_memo:=trim(v_entry->>'memo');
  if length(v_ref) not between 1 and 80 or v_ref=any(v_refs) then raise exception 'Entry references must be unique within the file and contain 1–80 characters';end if;
  v_refs:=array_append(v_refs,v_ref);
  if length(v_memo) not between 3 and 500 then raise exception 'Entry % needs a memo of 3–500 characters',v_ref;end if;
  if v_entry->>'date' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception 'Entry % needs a YYYY-MM-DD date',v_ref;end if;
  v_date:=(v_entry->>'date')::date;
  if jsonb_typeof(v_entry->'lines') is distinct from 'array' then raise exception 'Entry % needs a list of lines',v_ref;end if;
  if jsonb_array_length(v_entry->'lines') not between 2 and 200 then raise exception 'Entry % needs between 2 and 200 lines',v_ref;end if;
  v_lines:=v_lines+jsonb_array_length(v_entry->'lines');
  if v_lines>1000 then raise exception 'Import at most 1000 journal lines';end if;
  v_debits:=0;v_credits:=0;
  for v_line in select * from jsonb_array_elements(v_entry->'lines') loop
   if jsonb_typeof(v_line)<>'object' or v_line-array['account_id','debit_minor','credit_minor','description']<>'{}'::jsonb then raise exception 'Import lines support only account_id, debit_minor, credit_minor and description';end if;
   if jsonb_typeof(v_line->'debit_minor') is distinct from 'number' or jsonb_typeof(v_line->'credit_minor') is distinct from 'number'
    or v_line->>'debit_minor' !~ '^[0-9]+$' or v_line->>'credit_minor' !~ '^[0-9]+$' then raise exception 'Debit and credit must be non-negative integer minor amounts';end if;
   v_debit:=(v_line->>'debit_minor')::bigint;v_credit:=(v_line->>'credit_minor')::bigint;
   if v_debit>9007199254740991 or v_credit>9007199254740991 or (v_debit>0)=(v_credit>0) then raise exception 'Each line needs one positive, safely representable debit or credit';end if;
   v_debits:=v_debits+v_debit;v_credits:=v_credits+v_credit;
   if v_debits>9007199254740991 or v_credits>9007199254740991 then raise exception 'The journal total is too large';end if;
   if jsonb_typeof(v_line->'description') is distinct from 'string' or length(v_line->>'description')>300 then raise exception 'Line description must be text of at most 300 characters';end if;
   if jsonb_typeof(v_line->'account_id') is distinct from 'string' then raise exception 'Choose an account for each line';end if;
  end loop;
  if v_debits<>v_credits then raise exception 'Entry % does not balance',v_ref;end if;
  select * into v_saved from public.acc_imported_journals where source=v_source and reference=v_ref;
  if found then
   if v_saved.import_kind<>p_kind or v_saved.content<>v_entry then raise exception 'Source % reference % was already imported with different details; reverse the original journal before correcting it with a new reference',v_source,v_ref;end if;
   select * into v_posted from public.acc_journal_entries where id=v_saved.entry_id;
   v_skipped:=v_skipped+1;
  else
   v_posted:=public.post_manual_journal(gen_random_uuid(),v_date,v_memo,v_entry->'lines');
   insert into public.acc_imported_journals(source,reference,import_kind,entry_id,content,import_id) values(v_source,v_ref,p_kind,v_posted.id,v_entry,p_id);
   v_imported:=v_imported+1;
  end if;
  v_results:=v_results||jsonb_build_array(jsonb_build_object('reference',v_ref,'entry_id',v_posted.id,'entry_number',v_posted.entry_number));
 end loop;
 v_result:=jsonb_build_object('batch_id',p_id,'imported_count',v_imported,'skipped_count',v_skipped,'entries',v_results);
 insert into public.acc_financial_imports(id,source,import_kind,entries,result,created_by) values(p_id,v_source,p_kind,p_entries,v_result,v_actor);
 return v_result;
end $$;

revoke all on function public.financial_import_status(uuid),public.import_financial_journals(uuid,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.financial_import_status(uuid),public.import_financial_journals(uuid,text,text,jsonb) to authenticated;
commit;
