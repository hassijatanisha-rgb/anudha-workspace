-- Send an accepted Pro forma to TallyPrime as a Sales Order import file, so accounts make the tax invoice from it
-- without retyping and Tally carries the Pro forma number into the invoice's Order No. The ERP remembers the Tally
-- names it needs (customer ledger, stock item, sales and VAT ledgers) once they are confirmed, and records who
-- sent which Pro forma to Tally and when. Nothing here changes stock, prices or the Pro forma itself.
-- Rollback: revoke the RPCs in a forward migration; keep the rows as history.
begin;

create table public.tally_export_settings (
 id uuid primary key default gen_random_uuid(),
 version integer not null unique check (version > 0),
 company_name text not null default '' check (length(company_name) <= 200),
 voucher_type text not null default 'Sales Order' check (length(trim(voucher_type)) between 1 and 100),
 sales_ledger text not null check (length(trim(sales_ledger)) between 1 and 200),
 vat_ledger text not null check (length(trim(vat_ledger)) between 1 and 200),
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now()
);
create index tally_export_settings_created_by on public.tally_export_settings(created_by);

create table public.tally_ledger_names (
 organization_id uuid primary key references public.organizations(id),
 -- audit_change() records changes under this id
 id uuid not null unique default gen_random_uuid(),
 ledger_name text not null check (length(trim(ledger_name)) between 1 and 200),
 updated_by uuid not null references auth.users(id),
 updated_at timestamptz not null default now()
);
create index tally_ledger_names_updated_by on public.tally_ledger_names(updated_by);

create table public.tally_item_names (
 product_id uuid primary key references public.products(id),
 id uuid not null unique default gen_random_uuid(),
 item_name text not null check (length(trim(item_name)) between 1 and 300),
 unit text not null default '' check (length(unit) <= 30),
 updated_by uuid not null references auth.users(id),
 updated_at timestamptz not null default now()
);
create index tally_item_names_updated_by on public.tally_item_names(updated_by);

create table public.tally_exports (
 id uuid primary key,
 proforma_id uuid not null references public.sales_proformas(id),
 proforma_version integer not null,
 voucher_type text not null,
 content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
 exported_by uuid not null references auth.users(id),
 exported_at timestamptz not null default now()
);
create index tally_exports_proforma on public.tally_exports(proforma_id, exported_at desc);
create index tally_exports_exported_by on public.tally_exports(exported_by);

-- Export rows and settings versions never change; saved names are corrected in place with every change audited.
create function public.deny_tally_export_mutation() returns trigger
language plpgsql set search_path=public,pg_temp as $$ begin raise exception 'Tally export history is immutable'; end $$;
create trigger tally_exports_immutable before update or delete on public.tally_exports for each row execute function public.deny_tally_export_mutation();
create trigger tally_exports_no_truncate before truncate on public.tally_exports for each statement execute function public.deny_tally_export_mutation();
create trigger tally_export_settings_immutable before update or delete on public.tally_export_settings for each row execute function public.deny_tally_export_mutation();
create trigger tally_export_settings_no_truncate before truncate on public.tally_export_settings for each statement execute function public.deny_tally_export_mutation();
create function public.deny_tally_name_delete() returns trigger
language plpgsql set search_path=public,pg_temp as $$ begin raise exception 'Saved Tally names are corrected, never deleted'; end $$;
create trigger tally_ledger_names_no_delete before delete on public.tally_ledger_names for each row execute function public.deny_tally_name_delete();
create trigger tally_item_names_no_delete before delete on public.tally_item_names for each row execute function public.deny_tally_name_delete();
-- Every change to a saved name is kept in the existing audit log.
create trigger tally_ledger_names_audit after insert or update on public.tally_ledger_names for each row execute function public.audit_change();
create trigger tally_item_names_audit after insert or update on public.tally_item_names for each row execute function public.audit_change();

alter table public.tally_export_settings enable row level security;
alter table public.tally_ledger_names enable row level security;
alter table public.tally_item_names enable row level security;
alter table public.tally_exports enable row level security;
create policy tally_export_settings_read on public.tally_export_settings for select to authenticated using ((select public.inventory_active_staff()));
create policy tally_ledger_names_read on public.tally_ledger_names for select to authenticated using ((select public.inventory_active_staff()));
create policy tally_item_names_read on public.tally_item_names for select to authenticated using ((select public.inventory_active_staff()));
create policy tally_exports_read on public.tally_exports for select to authenticated using ((select public.inventory_active_staff()));
revoke all on public.tally_export_settings, public.tally_ledger_names, public.tally_item_names, public.tally_exports from public, anon, authenticated;
grant select on public.tally_export_settings, public.tally_ledger_names, public.tally_item_names, public.tally_exports to authenticated;

create function public.save_tally_export_settings(p_expected_version integer, p_company_name text, p_voucher_type text, p_sales_ledger text, p_vat_ledger text)
returns public.tally_export_settings language plpgsql security definer set search_path=public,pg_temp as $$
declare v_next integer; v_row public.tally_export_settings;
begin
 if not public.tally_invoice_staff() then raise exception 'Only the owner or accounts staff can change Tally settings'; end if;
 perform pg_advisory_xact_lock(hashtextextended('tally-export-settings',0));
 select coalesce(max(version),0)+1 into v_next from public.tally_export_settings;
 if p_expected_version is null or p_expected_version <> v_next-1 then raise exception 'Tally settings changed; refresh'; end if;
 insert into public.tally_export_settings(version,company_name,voucher_type,sales_ledger,vat_ledger,created_by)
 values(v_next,trim(coalesce(p_company_name,'')),trim(coalesce(nullif(p_voucher_type,''),'Sales Order')),trim(p_sales_ledger),trim(p_vat_ledger),auth.uid()) returning * into v_row;
 return v_row;
end $$;

-- Records that a Pro forma was sent to Tally and remembers the confirmed names. Only an accepted Pro forma can be sent.
create function public.record_tally_export(p_id uuid, p_proforma_id uuid, p_expected_version integer, p_voucher_type text, p_content_sha256 text,
 p_ledger_name text, p_items jsonb)
returns public.tally_exports language plpgsql security definer set search_path=public,pg_temp as $$
declare v_pf public.sales_proformas; v_row public.tally_exports; v_item jsonb; v_product uuid;
begin
 if not public.tally_invoice_staff() then raise exception 'Only the owner or accounts staff can send Pro formas to Tally'; end if;
 select * into v_row from public.tally_exports where id=p_id;
 if found then
  if v_row.proforma_id=p_proforma_id and v_row.content_sha256=p_content_sha256 and v_row.exported_by=auth.uid() then return v_row; end if;
  raise exception 'Export request already used; refresh';
 end if;
 select * into v_pf from public.sales_proformas where id=p_proforma_id and deleted_at is null;
 if not found then raise exception 'Pro forma not found'; end if;
 if v_pf.status <> 'accepted' then raise exception 'Only an accepted Pro forma can be sent to Tally'; end if;
 if v_pf.version <> p_expected_version then raise exception 'Pro forma changed; refresh before sending'; end if;
 if length(trim(coalesce(p_ledger_name,''))) not between 1 and 200 then raise exception 'Enter the customer''s ledger name in Tally'; end if;
 if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 500 then raise exception 'Item names are required'; end if;
 insert into public.tally_ledger_names(organization_id,ledger_name,updated_by) values(v_pf.organization_id,trim(p_ledger_name),auth.uid())
 on conflict (organization_id) do update set ledger_name=excluded.ledger_name,updated_by=excluded.updated_by,updated_at=now()
 where public.tally_ledger_names.ledger_name is distinct from excluded.ledger_name;
 for v_item in select value from jsonb_array_elements(p_items) loop
  begin v_product := (v_item->>'product_id')::uuid; exception when others then raise exception 'Invalid product in item names'; end;
  if not exists(select 1 from public.sales_proforma_lines where proforma_id=p_proforma_id and product_id=v_product) then raise exception 'Item names must belong to this Pro forma'; end if;
  if length(trim(coalesce(v_item->>'item_name',''))) not between 1 and 300 then raise exception 'Every item needs its Tally stock item name'; end if;
  insert into public.tally_item_names(product_id,item_name,unit,updated_by) values(v_product,trim(v_item->>'item_name'),left(trim(coalesce(v_item->>'unit','')),30),auth.uid())
  on conflict (product_id) do update set item_name=excluded.item_name,unit=excluded.unit,updated_by=excluded.updated_by,updated_at=now()
  where (public.tally_item_names.item_name,public.tally_item_names.unit) is distinct from (excluded.item_name,excluded.unit);
 end loop;
 insert into public.tally_exports(id,proforma_id,proforma_version,voucher_type,content_sha256,exported_by)
 values(p_id,p_proforma_id,v_pf.version,left(trim(coalesce(p_voucher_type,'Sales Order')),100),p_content_sha256,auth.uid()) returning * into v_row;
 return v_row;
end $$;

revoke all on function public.save_tally_export_settings(integer,text,text,text,text), public.record_tally_export(uuid,uuid,integer,text,text,text,jsonb) from public, anon;
grant execute on function public.save_tally_export_settings(integer,text,text,text,text), public.record_tally_export(uuid,uuid,integer,text,text,text,jsonb) to authenticated;
revoke all on function public.deny_tally_export_mutation(), public.deny_tally_name_delete() from public, anon, authenticated;
commit;
