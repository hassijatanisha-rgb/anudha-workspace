-- Customer residuals at cutover reuse receipts/ageing without posting the imported GL a second time.
begin;
create table public.acc_opening_receivable_imports (
 id uuid primary key, source text not null, cutover_date date not null,
 gl_import_id uuid not null unique references public.acc_financial_imports(id),
 rows jsonb not null, result jsonb not null, created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now()
);
alter table public.acc_invoices add column opening_import_id uuid references public.acc_opening_receivable_imports(id) deferrable initially deferred;
alter table public.acc_invoices add column opening_cutover_date date;
alter table public.acc_invoices add column opening_reference text;
alter table public.acc_invoices alter column proforma_id drop not null;
alter table public.acc_invoices alter column proforma_revision drop not null;
alter table public.acc_invoices alter column journal_entry_id drop not null;
alter table public.acc_invoices add constraint acc_invoice_origin check (
 (opening_import_id is null and opening_cutover_date is null and opening_reference is null and proforma_id is not null and proforma_revision is not null and journal_entry_id is not null)
 or (opening_import_id is not null and opening_cutover_date is not null and opening_reference is not null and length(opening_reference) between 1 and 80
 and proforma_id is null and proforma_revision is null and journal_entry_id is null and invoice_date<=opening_cutover_date
 and discount_minor=0 and tax_minor=0 and lines='[]'::jsonb and voided_at is null));
create table public.acc_opening_receivable_refs (
 source text not null, reference text not null, invoice_id uuid not null unique references public.acc_invoices(id),
 import_id uuid not null references public.acc_opening_receivable_imports(id) deferrable initially deferred,
 primary key(source,reference)
);
alter table public.acc_opening_receivable_imports enable row level security;
alter table public.acc_opening_receivable_refs enable row level security;
create policy acc_opening_receivable_imports_read on public.acc_opening_receivable_imports for select to authenticated using((select public.accounting_access()));
create policy acc_opening_receivable_refs_read on public.acc_opening_receivable_refs for select to authenticated using((select public.accounting_access()));
revoke all on public.acc_opening_receivable_imports,public.acc_opening_receivable_refs from public,anon,authenticated;
grant select on public.acc_opening_receivable_imports,public.acc_opening_receivable_refs to authenticated;
create trigger opening_receivable_imports_immutable before update or delete on public.acc_opening_receivable_imports for each row execute function public.acc_deny_change();
create trigger opening_receivable_refs_immutable before update or delete on public.acc_opening_receivable_refs for each row execute function public.acc_deny_change();
create function public.guard_opening_receivable_invoice() returns trigger language plpgsql set search_path=public,pg_temp as $$
begin if old.opening_import_id is not null then raise exception 'Opening residuals are immutable; reconcile corrections with Accounts'; end if;return new;end $$;
revoke all on function public.guard_opening_receivable_invoice() from public,anon,authenticated;
create trigger opening_receivable_invoice_immutable before update on public.acc_invoices for each row execute function public.guard_opening_receivable_invoice();

-- Preserve the latest credit-note report columns and logic; append only origin metadata.
do $$ declare v text; begin
 v:=rtrim(pg_get_viewdef('public.acc_invoice_balances'::regclass,true),E';\n ');
 execute 'create or replace view public.acc_invoice_balances with(security_invoker=true) as select prior.*,origin.opening_import_id,origin.opening_cutover_date,origin.opening_reference from ('||v||') prior join public.acc_invoices origin on origin.id=prior.id';
 v:=pg_get_functiondef('public.acc_receivables_ageing(date)'::regprocedure);
 if position('i.invoice_date<=p_as_of' in v)=0 then raise exception 'Ageing cutover insertion point changed'; end if;
 execute replace(v,'i.invoice_date<=p_as_of','i.invoice_date<=p_as_of and (i.opening_cutover_date is null or i.opening_cutover_date<=p_as_of)');
 v:=pg_get_functiondef('public.void_invoice(uuid,date,text)'::regprocedure);
 if position('if not found then raise exception ''Invoice not found''; end if;' in v)=0 then raise exception 'Invoice void guard insertion point changed'; end if;
 execute replace(v,'if not found then raise exception ''Invoice not found''; end if;', 'if not found then raise exception ''Invoice not found''; end if; if v.opening_import_id is not null then raise exception ''Opening receivables cannot use ordinary invoice void; reconcile the opening import with Accounts''; end if;');
end $$;

-- Receipts before cutover would count historic settlement twice against the imported residual.
create function public.guard_opening_receivable_allocation() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if exists(select 1 from public.acc_invoices i join public.acc_receipts r on r.id=new.receipt_id
  where i.id=new.invoice_id and i.opening_import_id is not null and r.receipt_date<=i.opening_cutover_date) then
  raise exception 'Receipts against an opening residual must be dated after its cutover date';
 end if;return new;
end $$;
revoke all on function public.guard_opening_receivable_allocation() from public,anon,authenticated;
create trigger opening_receivable_allocation before insert on public.acc_receipt_allocations for each row execute function public.guard_opening_receivable_allocation();

create function public.opening_receivables_check(p_source text,p_cutover date,p_gl_import_id uuid,p_rows jsonb)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_source text:=lower(trim(coalesce(p_source,'')));v_prior public.acc_opening_receivable_imports;
 v_row jsonb;v_ref text;v_refs text[]:='{}';v_org uuid;v_date date;v_due date;v_amount bigint;v_total bigint:=0;
 v_imported bigint;v_gl bigint;v_subledger bigint;v_expected bigint;v_replayed boolean:=false;v_lock date;
begin
 if public.accounting_access() is not true or auth.uid() is null then raise exception 'Accounting access is required' using errcode='42501'; end if;
 if length(v_source) not between 1 and 80 then raise exception 'Source must contain 1–80 characters'; end if;
 if p_cutover is null or p_cutover>(now() at time zone 'Africa/Dar_es_Salaam')::date then raise exception 'Choose a cutover date no later than today'; end if;
 if p_rows is null or jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows) not between 1 and 1000 or octet_length(p_rows::text)>1048576 then raise exception 'Supply 1–1000 opening residuals, at most 1 MB'; end if;
 select * into v_prior from public.acc_opening_receivable_imports where gl_import_id=p_gl_import_id;
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
  if jsonb_typeof(v_row)<>'object' or v_row-array['reference','organization_id','invoice_date','due_date','amount_minor','currency']<>'{}'::jsonb
   or not(v_row ?& array['reference','organization_id','invoice_date','due_date','amount_minor','currency']) then raise exception 'Each residual needs reference, organization_id, invoice_date, due_date, amount_minor and currency only'; end if;
  if jsonb_typeof(v_row->'reference') is distinct from 'string' or jsonb_typeof(v_row->'organization_id') is distinct from 'string'
   or jsonb_typeof(v_row->'invoice_date') is distinct from 'string' or jsonb_typeof(v_row->'due_date') is distinct from 'string' then raise exception 'References, customer UUIDs and dates must be text'; end if;
  v_ref:=trim(v_row->>'reference');
  if length(v_ref) not between 1 and 80 or v_ref=any(v_refs) then raise exception 'Invoice references must be unique and contain 1–80 characters'; end if;
  v_refs:=array_append(v_refs,v_ref);
  if not v_replayed and exists(select 1 from public.acc_opening_receivable_refs where source=v_source and reference=v_ref) then raise exception 'Source/reference % was already imported',v_ref; end if;
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
  v_total:=v_total+v_amount;if v_total>9007199254740991 then raise exception 'Residual total is too large'; end if;
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

create function public.opening_receivables_status(p_id uuid) returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
begin if public.accounting_access() is not true or auth.uid() is null then raise exception 'Accounting access is required' using errcode='42501'; end if;return (select result from public.acc_opening_receivable_imports where id=p_id);end $$;

create function public.import_opening_receivables(p_id uuid,p_source text,p_cutover date,p_gl_import_id uuid,p_rows jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_actor uuid;v_source text:=lower(trim(coalesce(p_source,'')));v_prior public.acc_opening_receivable_imports;
 v_row jsonb;v_id uuid;v_check jsonb;v_result jsonb;v_invoices jsonb:='[]';
begin
 if public.accounting_access() is not true or auth.uid() is null then raise exception 'Accounting access is required' using errcode='42501'; end if;
 v_actor:=auth.uid();if p_id is null then raise exception 'Import request ID is required'; end if;
 perform pg_advisory_xact_lock(hashtextextended('acc-financial-import',0));
 select * into v_prior from public.acc_opening_receivable_imports where id=p_id or gl_import_id=p_gl_import_id order by (id=p_id) desc limit 1;
 if found then
  if v_prior.source is distinct from v_source or v_prior.cutover_date is distinct from p_cutover or v_prior.gl_import_id is distinct from p_gl_import_id or v_prior.rows is distinct from p_rows then raise exception 'Opening import identity was already used for different details'; end if;
  return v_prior.result||jsonb_build_object('already_imported',true);
 end if;
 -- Every posting creates its journal first. Hold a stable GL while checking the subledger and inserting residuals.
 lock table public.acc_journal_entries in share mode;
 perform 1 from public.acc_settings where id for share;
 v_check:=public.opening_receivables_check(p_source,p_cutover,p_gl_import_id,p_rows);
 for v_row in select * from jsonb_array_elements(p_rows) loop
  perform 1 from public.organizations where id=(v_row->>'organization_id')::uuid and deleted_at is null for share;
  if not found then raise exception 'Customer became unavailable; refresh the preview'; end if;
  v_id:=gen_random_uuid();
  insert into public.acc_invoices(id,invoice_number,organization_id,invoice_date,due_date,subtotal_minor,discount_minor,tax_minor,total_minor,lines,created_by,opening_import_id,opening_cutover_date,opening_reference)
  values(v_id,'OPEN-'||to_char(p_cutover,'YYYY')||'-'||lpad(nextval('public.acc_invoice_number_seq')::text,6,'0'),(v_row->>'organization_id')::uuid,(v_row->>'invoice_date')::date,(v_row->>'due_date')::date,(v_row->>'amount_minor')::bigint,0,0,(v_row->>'amount_minor')::bigint,'[]',v_actor,p_id,p_cutover,trim(v_row->>'reference'));
  insert into public.acc_opening_receivable_refs(source,reference,invoice_id,import_id) values(v_source,trim(v_row->>'reference'),v_id,p_id);
  v_invoices:=v_invoices||jsonb_build_array(jsonb_build_object('reference',trim(v_row->>'reference'),'invoice_id',v_id));
 end loop;
 v_result:=v_check||jsonb_build_object('batch_id',p_id,'imported_count',jsonb_array_length(p_rows),'invoices',v_invoices);
 insert into public.acc_opening_receivable_imports(id,source,cutover_date,gl_import_id,rows,result,created_by) values(p_id,v_source,p_cutover,p_gl_import_id,p_rows,v_result,v_actor);
 return v_result;
end $$;
revoke all on function public.opening_receivables_check(text,date,uuid,jsonb),public.opening_receivables_status(uuid),public.import_opening_receivables(uuid,text,date,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.opening_receivables_check(text,date,uuid,jsonb),public.opening_receivables_status(uuid),public.import_opening_receivables(uuid,text,date,uuid,jsonb) to authenticated;
commit;
