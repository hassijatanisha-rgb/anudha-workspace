-- Reversible soft deletion: restore through the same RPCs with p_archived=false.
-- Forward rollback: restore archived rows through the RPCs before removing guards.
-- Existing financial, inventory and revision records are retained. No data backfill.
begin;
alter table public.products add column if not exists deleted_at timestamptz;
alter table public.products add column if not exists deleted_by uuid references auth.users(id);
alter table public.sales_proformas add column if not exists deleted_at timestamptz;
alter table public.sales_proformas add column if not exists deleted_by uuid references auth.users(id);

create function public.guard_record_soft_delete()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if tg_op='DELETE' then raise exception 'Use archive instead of permanently deleting records'; end if;
 if tg_op='INSERT' then
  if new.deleted_at is not null or new.deleted_by is not null then raise exception 'Create the record before archiving it'; end if;
  return new;
 end if;
 if new.deleted_at is distinct from old.deleted_at or new.deleted_by is distinct from old.deleted_by then
  if not public.inventory_owner() then raise exception 'Owner access is required to archive or restore records'; end if;
  if (new.deleted_at is null)<>(new.deleted_by is null) or (new.deleted_at is not null and new.deleted_by is distinct from auth.uid()) then
   raise exception 'Invalid archive attribution';
  end if;
  if (to_jsonb(new)-array['deleted_at','deleted_by','version','updated_at']) is distinct from (to_jsonb(old)-array['deleted_at','deleted_by','version','updated_at']) then
   raise exception 'Archive or restore separately from editing';
  end if;
  if tg_table_name='sales_proformas' then
   if old.status<>'draft' then raise exception 'Only a draft Pro forma can be archived or restored'; end if;
   if exists(select 1 from public.sales_delivery_notes where proforma_id=old.id) then raise exception 'A delivery-linked Pro forma cannot be archived or restored'; end if;
  elsif new.deleted_at is not null then
   if exists(select 1 from public.inventory_lots where product_id=old.id and (sealed_cartons<>0 or loose_units<>0 or reserved_units<>0)) then
    raise exception 'This product still has stock. Resolve its stock before deleting it';
   end if;
   if exists(select 1 from public.inventory_transfers where product_id=old.id and status in ('requested','in_transit')) then
    raise exception 'This product has an open transfer. Complete or cancel the transfer first';
   end if;
  end if;
 elsif old.deleted_at is not null then
  raise exception 'Restore the archived record before editing or advancing it';
 end if;
 return new;
end $$;
create trigger products_soft_delete_guard before insert or update or delete on public.products for each row execute function public.guard_record_soft_delete();
create trigger proformas_soft_delete_guard before insert or update or delete on public.sales_proformas for each row execute function public.guard_record_soft_delete();

-- Protect legacy CRM table writes as well as their RPC entry points.
create function public.guard_client_archive_owner()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if tg_op='DELETE' then raise exception 'Use archive instead of permanently deleting clients or contacts'; end if;
 if tg_op='INSERT' then
  if new.deleted_at is not null and not public.inventory_owner() then raise exception 'Owner access is required to archive clients or contacts'; end if;
 elsif new.deleted_at is distinct from old.deleted_at then
  if not public.inventory_owner() then raise exception 'Owner access is required to archive or restore clients or contacts'; end if;
 end if;
 return new;
end $$;
create trigger organizations_archive_owner before insert or update or delete on public.organizations for each row execute function public.guard_client_archive_owner();
create trigger contacts_archive_owner before insert or update or delete on public.contacts for each row execute function public.guard_client_archive_owner();

create function public.set_product_archived(p_id uuid,p_archived boolean)
returns public.products language plpgsql security definer set search_path=public,pg_temp as $$
declare v_row public.products;
begin
 if not public.inventory_owner() then raise exception 'Owner access is required to archive or restore products'; end if;
 if p_archived is null then raise exception 'Choose archive or restore'; end if;
 select * into v_row from public.products where id=p_id for update;
 if not found then raise exception 'Product not found'; end if;
 if (v_row.deleted_at is not null)=p_archived then return v_row; end if;
 update public.products set deleted_at=case when p_archived then now() end,deleted_by=case when p_archived then auth.uid() end where id=p_id returning * into v_row;
 return v_row;
end $$;
create function public.set_draft_proforma_archived(p_id uuid,p_expected_version integer,p_archived boolean)
returns public.sales_proformas language plpgsql security definer set search_path=public,pg_temp as $$
declare v_row public.sales_proformas;
begin
 if not public.inventory_owner() then raise exception 'Owner access is required to archive or restore Pro formas'; end if;
 if p_archived is null then raise exception 'Choose archive or restore'; end if;
 select * into v_row from public.sales_proformas where id=p_id for update;
 if not found then raise exception 'Pro forma not found'; end if;
 if p_expected_version is null or v_row.version<>p_expected_version then raise exception 'Pro forma changed; refresh before continuing'; end if;
 if v_row.status<>'draft' then raise exception 'Only a draft Pro forma can be archived or restored'; end if;
 if exists(select 1 from public.sales_delivery_notes where proforma_id=p_id) then raise exception 'A delivery-linked Pro forma cannot be archived or restored'; end if;
 if (v_row.deleted_at is not null)=p_archived then return v_row; end if;
 update public.sales_proformas set deleted_at=case when p_archived then now() end,deleted_by=case when p_archived then auth.uid() end,version=version+1,updated_at=now() where id=p_id returning * into v_row;
 return v_row;
end $$;

-- Product row locks serialize new uses with archival. Historical rows remain intact.
create function public.guard_archived_product_use()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_deleted timestamptz; v_proforma public.sales_proformas;
begin
 select deleted_at into v_deleted from public.products where id=new.product_id for share;
 if v_deleted is not null then raise exception 'Restore the archived product before using it'; end if;
 if tg_table_name='sales_proforma_lines' then
  select * into v_proforma from public.sales_proformas where id=new.proforma_id for share;
  if v_proforma.deleted_at is not null then raise exception 'Restore the archived Pro forma before editing it'; end if;
 end if;
 return new;
end $$;
create trigger proforma_line_active_product before insert or update on public.sales_proforma_lines for each row execute function public.guard_archived_product_use();
create trigger inventory_lot_active_product before insert or update on public.inventory_lots for each row execute function public.guard_archived_product_use();
create trigger inventory_transfer_active_product before insert or update on public.inventory_transfers for each row execute function public.guard_archived_product_use();
create trigger product_pack_active_product before insert on public.product_pack_definitions for each row execute function public.guard_archived_product_use();
create function public.guard_proforma_active_products()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_product record;
begin
 if new.status is distinct from old.status and new.status in ('sent','accepted') then
  for v_product in select p.id,p.deleted_at from public.products p join public.sales_proforma_lines l on l.product_id=p.id where l.proforma_id=new.id order by p.id for share of p loop
   if v_product.deleted_at is not null then raise exception 'Restore or replace archived products before sending or accepting this Pro forma'; end if;
  end loop;
 end if;
 return new;
end $$;
create trigger proforma_active_products before update of status on public.sales_proformas for each row execute function public.guard_proforma_active_products();

-- Legacy client/contact archive bodies are retained verbatim except their role gate.
do $migration$
declare v_name text; v_oid oid; v_definition text; v_anchor constant text := 'if p_kind=''organization'' and not public.is_owner()';
begin
 foreach v_name in array array['archive_record','restore_record'] loop
  v_oid:=to_regprocedure('public.'||v_name||'(text,uuid)');
  if v_oid is null then continue; end if; -- Fresh installations have no legacy CRM RPCs.
  select pg_get_functiondef(v_oid) into v_definition;
  if (length(v_definition)-length(replace(v_definition,v_anchor,'')))/length(v_anchor)<>1 then
   raise exception 'Unexpected legacy % implementation; review owner gate before applying',v_name;
  end if;
  execute replace(v_definition,v_anchor,'if not public.is_owner()');
 end loop;
end $migration$;
revoke all on function public.set_product_archived(uuid,boolean),public.set_draft_proforma_archived(uuid,integer,boolean) from public,anon;
grant execute on function public.set_product_archived(uuid,boolean),public.set_draft_proforma_archived(uuid,integer,boolean) to authenticated;
revoke all on function public.guard_record_soft_delete(),public.guard_archived_product_use(),public.guard_proforma_active_products(),public.guard_client_archive_owner() from public,anon,authenticated;
commit;
