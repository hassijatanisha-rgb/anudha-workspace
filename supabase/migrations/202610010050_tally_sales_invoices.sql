-- Tax invoices are created in Tally. This register receives them (uploaded Tally XML export now, the in-house
-- connector later; both send the same normalised rows) and links each to its ERP Pro forma through the Pro forma
-- number typed in Tally's Order No. / Reference. Register only: it does not change stock, prices, delivery
-- status or any accounting record. Stock deduction at invoice stays with the stock-timing work, which can read
-- this table. Rollback: revoke the RPCs in a forward migration; keep rows as evidence.
begin;

create table public.tally_sales_invoices (
 id uuid primary key default gen_random_uuid(),
 tally_guid text unique check (tally_guid is null or length(tally_guid) between 1 and 200),
 voucher_number text not null check (length(trim(voucher_number)) between 1 and 100),
 voucher_date date not null check (voucher_date >= date '2000-01-01'),
 voucher_type text not null default 'Sales' check (length(voucher_type) <= 100),
 party_name text not null default '' check (length(party_name) <= 300),
 order_reference text not null default '' check (length(order_reference) <= 300),
 currency text not null default 'TZS' check (currency ~ '^[A-Z]{3}$'),
 net_minor bigint check (net_minor is null or net_minor >= 0),
 vat_minor bigint check (vat_minor is null or vat_minor >= 0),
 total_minor bigint check (total_minor is null or total_minor >= 0),
 lines jsonb not null default '[]' check (jsonb_typeof(lines) = 'array' and jsonb_array_length(lines) <= 500),
 narration text not null default '' check (length(narration) <= 2000),
 cancelled boolean not null default false,
 proforma_id uuid references public.sales_proformas(id),
 match_status text not null default 'unmatched' check (match_status in ('matched','unmatched','ignored')),
 match_note text not null default '' check (length(match_note) <= 500),
 source text not null check (source in ('upload','connector')),
 content_hash text not null check (length(content_hash) between 8 and 128),
 imported_by uuid references auth.users(id),
 imported_at timestamptz not null default now(),
 version integer not null default 1 check (version > 0),
 unique (voucher_type, voucher_number, voucher_date),
 check ((match_status = 'matched') = (proforma_id is not null))
);
create index tally_sales_invoices_proforma on public.tally_sales_invoices(proforma_id);
create index tally_sales_invoices_status on public.tally_sales_invoices(match_status, voucher_date desc);
create index tally_sales_invoices_imported_by on public.tally_sales_invoices(imported_by);

create table public.tally_sales_invoice_events (
 id uuid primary key default gen_random_uuid(),
 invoice_id uuid not null references public.tally_sales_invoices(id),
 action text not null check (action in ('imported','changed_in_tally','matched','unmatched','ignored')),
 note text not null default '' check (length(note) <= 500),
 before_data jsonb,
 actor_user_id uuid references auth.users(id),
 recorded_at timestamptz not null default now()
);
create index tally_sales_invoice_events_invoice on public.tally_sales_invoice_events(invoice_id, recorded_at);
create index tally_sales_invoice_events_actor on public.tally_sales_invoice_events(actor_user_id);
create function public.deny_tally_invoice_event_mutation() returns trigger
language plpgsql set search_path=public,pg_temp as $$ begin raise exception 'Tally invoice history is immutable'; end $$;
create trigger tally_sales_invoice_events_immutable before update or delete on public.tally_sales_invoice_events for each row execute function public.deny_tally_invoice_event_mutation();
create trigger tally_sales_invoice_events_no_truncate before truncate on public.tally_sales_invoice_events for each statement execute function public.deny_tally_invoice_event_mutation();
create function public.deny_tally_invoice_delete() returns trigger
language plpgsql set search_path=public,pg_temp as $$ begin raise exception 'Tally invoices are never deleted; mark them ignored with a reason'; end $$;
create trigger tally_sales_invoices_no_delete before delete on public.tally_sales_invoices for each row execute function public.deny_tally_invoice_delete();
create trigger tally_sales_invoices_no_truncate before truncate on public.tally_sales_invoices for each statement execute function public.deny_tally_invoice_delete();

alter table public.tally_sales_invoices enable row level security;
alter table public.tally_sales_invoice_events enable row level security;
create policy tally_sales_invoices_read on public.tally_sales_invoices for select to authenticated using ((select public.inventory_active_staff()));
create policy tally_sales_invoice_events_read on public.tally_sales_invoice_events for select to authenticated using ((select public.inventory_active_staff()));
revoke all on public.tally_sales_invoices, public.tally_sales_invoice_events from public, anon, authenticated;
grant select on public.tally_sales_invoices, public.tally_sales_invoice_events to authenticated;

-- "PF-2026-1", "pf 2026 000001" and "PF2026000001" all mean PF-2026-000001.
create function public.tally_proforma_number(p_text text) returns text
language sql immutable set search_path=public,pg_temp as $$
 select case when m is null then null else 'PF-'||m[1]||'-'||lpad(ltrim(m[2],'0'),6,'0') end
 from (select regexp_match(coalesce(p_text,''),'PF[[:space:]_/-]*([0-9]{4})[[:space:]_/-]*([0-9]{1,6})(?![0-9])','i') m) x
 where m is null or ltrim(m[2],'0') <> ''
$$;

create function public.tally_invoice_staff() returns boolean
language sql stable security definer set search_path=public,pg_temp as $$ select public.inventory_owner() or public.accounting_access() $$;

-- Owner or accounts staff import normalised Tally vouchers, up to 500 per call. A voucher is identified by its Tally
-- GUID, or by type + number + date. Unchanged re-imports do nothing; a voucher changed in Tally is updated and the
-- previous values kept in history. A manual match or ignore is never undone by a re-import.
create function public.import_tally_invoices(p_rows jsonb, p_source text default 'upload')
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
 v_row jsonb; v_n integer := 0; v_new integer := 0; v_changed integer := 0; v_same integer := 0; v_matched integer := 0;
 v_guid text; v_number text; v_date date; v_type text; v_ref text; v_hash text; v_existing public.tally_sales_invoices;
 v_pf text; v_proforma uuid; v_id uuid; v_lines jsonb;
begin
 if not public.tally_invoice_staff() then raise exception 'Only the owner or accounts staff can import Tally invoices'; end if;
 if p_source not in ('upload','connector') then raise exception 'Unknown source'; end if;
 if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) not between 1 and 500 then raise exception 'Send between 1 and 500 invoices at a time'; end if;
 perform pg_advisory_xact_lock(hashtextextended('tally-invoice-import',0));
 for v_row in select value from jsonb_array_elements(p_rows) loop
  v_n := v_n + 1;
  v_guid := nullif(trim(coalesce(v_row->>'tally_guid','')),'');
  v_number := trim(coalesce(v_row->>'voucher_number',''));
  v_type := coalesce(nullif(trim(coalesce(v_row->>'voucher_type','')),''),'Sales');
  v_ref := left(trim(coalesce(v_row->>'order_reference','')),300);
  v_lines := coalesce(v_row->'lines','[]'::jsonb);
  begin v_date := (v_row->>'voucher_date')::date; exception when others then raise exception 'Invoice % has an invalid date', v_n; end;
  if v_number = '' or v_date is null then raise exception 'Invoice % needs a voucher number and date', v_n; end if;
  if jsonb_typeof(v_lines) <> 'array' then raise exception 'Invoice % lines must be a list', v_number; end if;
  v_hash := md5(jsonb_build_array(v_number,v_date,v_type,v_row->>'party_name',v_ref,v_row->>'currency',v_row->'net_minor',v_row->'vat_minor',v_row->'total_minor',v_lines,v_row->>'narration',coalesce((v_row->>'cancelled')::boolean,false))::text);

  select * into v_existing from public.tally_sales_invoices
   where (v_guid is not null and tally_guid = v_guid) or (voucher_type = v_type and voucher_number = v_number and voucher_date = v_date)
   order by (tally_guid = v_guid) desc nulls last limit 1 for update;
  v_pf := public.tally_proforma_number(v_ref || ' ' || coalesce(v_row->>'narration',''));
  select id into v_proforma from public.sales_proformas where v_pf is not null and document_number = v_pf and deleted_at is null;

  if v_existing.id is null then
   insert into public.tally_sales_invoices(tally_guid,voucher_number,voucher_date,voucher_type,party_name,order_reference,currency,net_minor,vat_minor,total_minor,lines,narration,cancelled,proforma_id,match_status,match_note,source,content_hash,imported_by)
   values(v_guid,v_number,v_date,v_type,left(coalesce(v_row->>'party_name',''),300),v_ref,coalesce(nullif(v_row->>'currency',''),'TZS'),
    (v_row->>'net_minor')::bigint,(v_row->>'vat_minor')::bigint,(v_row->>'total_minor')::bigint,v_lines,left(coalesce(v_row->>'narration',''),2000),
    coalesce((v_row->>'cancelled')::boolean,false),v_proforma,case when v_proforma is null then 'unmatched' else 'matched' end,
    case when v_proforma is not null then 'Matched by Pro forma number '||v_pf when v_pf is not null then 'No Pro forma '||v_pf||' in the ERP' else 'No Pro forma number on the Tally invoice' end,
    p_source,v_hash,auth.uid()) returning id into v_id;
   insert into public.tally_sales_invoice_events(invoice_id,action,note,actor_user_id) values(v_id,'imported',p_source,auth.uid());
   v_new := v_new + 1; if v_proforma is not null then v_matched := v_matched + 1; end if;
  elsif v_existing.content_hash = v_hash then
   v_same := v_same + 1;
  else
   insert into public.tally_sales_invoice_events(invoice_id,action,note,before_data,actor_user_id)
   values(v_existing.id,'changed_in_tally',p_source,to_jsonb(v_existing)-'lines',auth.uid());
   update public.tally_sales_invoices set tally_guid=coalesce(v_guid,tally_guid),voucher_number=v_number,voucher_date=v_date,voucher_type=v_type,
    party_name=left(coalesce(v_row->>'party_name',''),300),order_reference=v_ref,currency=coalesce(nullif(v_row->>'currency',''),'TZS'),
    net_minor=(v_row->>'net_minor')::bigint,vat_minor=(v_row->>'vat_minor')::bigint,total_minor=(v_row->>'total_minor')::bigint,lines=v_lines,
    narration=left(coalesce(v_row->>'narration',''),2000),cancelled=coalesce((v_row->>'cancelled')::boolean,false),content_hash=v_hash,version=version+1,
    -- automatic results follow the new reference; a person's match, unlink or ignore stays
    proforma_id=case when (match_note like 'Matched by Pro forma number%' or match_note like 'No Pro forma%') then v_proforma else proforma_id end,
    match_status=case when (match_note like 'Matched by Pro forma number%' or match_note like 'No Pro forma%') then case when v_proforma is null then 'unmatched' else 'matched' end else match_status end,
    match_note=case when (match_note like 'Matched by Pro forma number%' or match_note like 'No Pro forma%') then
     case when v_proforma is not null then 'Matched by Pro forma number '||v_pf when v_pf is not null then 'No Pro forma '||v_pf||' in the ERP' else 'No Pro forma number on the Tally invoice' end else match_note end
    where id=v_existing.id;
   v_changed := v_changed + 1;
  end if;
 end loop;
 return jsonb_build_object('rows',v_n,'new',v_new,'changed',v_changed,'unchanged',v_same,'matched',v_matched);
end $$;

-- A person links an invoice to a Pro forma, removes a link, or marks the invoice as not an ERP order (ignored).
create function public.review_tally_invoice(p_id uuid, p_expected_version integer, p_action text, p_proforma_id uuid default null, p_note text default '')
returns public.tally_sales_invoices language plpgsql security definer set search_path=public,pg_temp as $$
declare v_row public.tally_sales_invoices; v_note text := left(trim(coalesce(p_note,'')),500);
begin
 if not public.tally_invoice_staff() then raise exception 'Only the owner or accounts staff can match Tally invoices'; end if;
 select * into v_row from public.tally_sales_invoices where id=p_id for update;
 if not found then raise exception 'Invoice not found'; end if;
 if v_row.version <> p_expected_version then raise exception 'Invoice changed; refresh'; end if;
 if p_action = 'match' then
  if not exists(select 1 from public.sales_proformas where id=p_proforma_id and deleted_at is null) then raise exception 'Choose an existing Pro forma'; end if;
  if length(v_note) < 3 then v_note := 'Matched by hand'; end if;
  update public.tally_sales_invoices set proforma_id=p_proforma_id,match_status='matched',match_note=v_note,version=version+1 where id=p_id returning * into v_row;
 elsif p_action = 'unmatch' then
  if length(v_note) < 3 then raise exception 'Enter why the link is removed'; end if;
  update public.tally_sales_invoices set proforma_id=null,match_status='unmatched',match_note=v_note,version=version+1 where id=p_id returning * into v_row;
 elsif p_action = 'ignore' then
  if length(v_note) < 3 then raise exception 'Enter why this invoice has no ERP order'; end if;
  update public.tally_sales_invoices set proforma_id=null,match_status='ignored',match_note=v_note,version=version+1 where id=p_id returning * into v_row;
 else raise exception 'Unknown action';
 end if;
 insert into public.tally_sales_invoice_events(invoice_id,action,note,actor_user_id)
 values(p_id,case p_action when 'match' then 'matched' when 'unmatch' then 'unmatched' else 'ignored' end,v_note,auth.uid());
 return v_row;
end $$;

revoke all on function public.tally_invoice_staff(), public.import_tally_invoices(jsonb,text), public.review_tally_invoice(uuid,integer,text,uuid,text) from public, anon;
grant execute on function public.tally_invoice_staff(), public.import_tally_invoices(jsonb,text), public.review_tally_invoice(uuid,integer,text,uuid,text) to authenticated;
revoke all on function public.deny_tally_invoice_event_mutation(), public.deny_tally_invoice_delete() from public, anon, authenticated;
commit;
