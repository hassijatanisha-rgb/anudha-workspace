begin;

create table public.inventory_locations (
 id uuid primary key,
 name text not null check (length(trim(name)) between 2 and 120),
 code text not null check (length(trim(code)) between 1 and 30),
 location_type text not null default 'godown' check (location_type in ('godown','dispatch_hub')),
 is_dispatch_hub boolean not null default false,
 active boolean not null default true,
 version integer not null default 1 check (version > 0),
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique (name),
 unique (code),
 check (is_dispatch_hub = (location_type = 'dispatch_hub'))
);
create unique index inventory_one_dispatch_hub on public.inventory_locations (is_dispatch_hub) where is_dispatch_hub = true;

create table public.product_pack_definitions (
 id uuid primary key,
 product_id uuid not null references public.products(id),
 version integer not null check (version > 0),
 base_unit text not null check (length(trim(base_unit)) between 1 and 40),
 units_per_carton integer not null check (units_per_carton between 1 and 1000000),
 reason text not null check (length(trim(reason)) between 5 and 1000),
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(),
 unique (product_id,version)
);

create table public.inventory_lots (
 id uuid primary key,
 product_id uuid not null references public.products(id),
 location_id uuid not null references public.inventory_locations(id),
 pack_definition_id uuid not null references public.product_pack_definitions(id),
 batch_number text not null default '',
 expiry_date date,
 sealed_cartons integer not null default 0 check (sealed_cartons >= 0),
 loose_units integer not null default 0 check (loose_units >= 0),
 reserved_units integer not null default 0 check (reserved_units >= 0),
 stock_status text not null default 'available' check (stock_status in ('available','quarantine')),
 version integer not null default 1 check (version > 0),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create unique index inventory_lot_identity on public.inventory_lots(product_id,location_id,pack_definition_id,batch_number,coalesce(expiry_date,'infinity'::date),stock_status);

create table public.inventory_transfers (
 id uuid primary key,
 source_lot_id uuid not null references public.inventory_lots(id),
 from_location_id uuid not null references public.inventory_locations(id),
 to_location_id uuid not null references public.inventory_locations(id),
 product_id uuid not null references public.products(id),
 pack_definition_id uuid not null references public.product_pack_definitions(id),
 cartons integer not null check (cartons between 1 and 1000000),
 expected_units integer not null check (expected_units between 1 and 2147483647),
 actual_units integer check (actual_units between 0 and 2147483647),
 status text not null default 'requested' check (status in ('requested','in_transit','received','quarantine','cancelled')),
 expected_at date not null,
 reason text not null check (length(trim(reason)) between 5 and 1000),
 inspection_note text,
 created_by uuid not null references auth.users(id),
 dispatched_by uuid references auth.users(id),
 received_by uuid references auth.users(id),
 version integer not null default 1 check (version > 0),
 created_at timestamptz not null default now(),
 dispatched_at timestamptz,
 received_at timestamptz,
 check (from_location_id <> to_location_id)
);

create table public.inventory_movements (
 id uuid primary key,
 lot_id uuid not null references public.inventory_lots(id),
 transfer_id uuid references public.inventory_transfers(id),
 movement_type text not null check (movement_type in ('opening_balance','opening_adjustment','transfer_dispatch','transfer_receipt','quarantine_receipt','break_pack','consumer_issue','consumer_return')),
 sealed_carton_change integer not null default 0,
 loose_unit_change integer not null default 0,
 base_unit_change integer not null,
 reason text not null check (length(trim(reason)) between 3 and 1000),
 actor_user_id uuid not null references auth.users(id),
 created_at timestamptz not null default now(),
 check (sealed_carton_change <> 0 or loose_unit_change <> 0 or movement_type = 'break_pack')
);

create table public.inventory_issues (
 id uuid primary key,
 lot_id uuid not null references public.inventory_lots(id),
 organization_id uuid not null references public.organizations(id),
 product_id uuid not null references public.products(id),
 quantity integer not null check (quantity > 0),
 issued_on date not null default current_date,
 reference text not null check (length(trim(reference)) between 2 and 120),
 reason text not null check (length(trim(reason)) between 3 and 1000),
 issued_by uuid not null references auth.users(id),
 created_at timestamptz not null default now()
);

create or replace function public.inventory_active_staff()
returns boolean language sql stable security definer set search_path=public,pg_temp
as $$ select exists(select 1 from public.staff where user_id=auth.uid() and active=true) $$;

create or replace function public.inventory_owner()
returns boolean language sql stable security definer set search_path=public,pg_temp
as $$ select exists(select 1 from public.staff where user_id=auth.uid() and active=true and role='owner') $$;

create or replace function public.deny_inventory_mutation()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
 raise exception '%',case when tg_table_name='product_pack_definitions' then 'Pack definitions are immutable' else 'Inventory movements are immutable' end;
end $$;
create trigger product_pack_definitions_immutable before update or delete on public.product_pack_definitions for each row execute function public.deny_inventory_mutation();
create trigger inventory_movements_immutable before update or delete on public.inventory_movements for each row execute function public.deny_inventory_mutation();

create or replace function public.save_inventory_location(p_id uuid,p_expected_version integer,p_name text,p_code text,p_location_type text,p_active boolean default true)
returns public.inventory_locations language plpgsql security definer set search_path=public,pg_temp as $$
declare v_row public.inventory_locations;
begin
 if not public.inventory_owner() then raise exception 'Owner access is required'; end if;
 if p_location_type not in ('godown','dispatch_hub') then raise exception 'Choose godown or dispatch hub'; end if;
 if p_expected_version=0 then
  insert into public.inventory_locations(id,name,code,location_type,is_dispatch_hub,active,created_by)
  values(p_id,trim(p_name),upper(trim(p_code)),p_location_type,p_location_type='dispatch_hub',p_active,auth.uid()) returning * into v_row;
 else
  update public.inventory_locations set name=trim(p_name),code=upper(trim(p_code)),location_type=p_location_type,is_dispatch_hub=p_location_type='dispatch_hub',active=p_active,version=version+1,updated_at=now()
  where id=p_id and version=p_expected_version returning * into v_row;
  if not found then raise exception 'Location changed; refresh before saving'; end if;
 end if;
 return v_row;
end $$;

create or replace function public.save_pack_definition(p_id uuid,p_product_id uuid,p_expected_version integer,p_base_unit text,p_units_per_carton integer,p_reason text)
returns public.product_pack_definitions language plpgsql security definer set search_path=public,pg_temp as $$
declare v_row public.product_pack_definitions; v_next integer;
begin
 if not public.inventory_owner() then raise exception 'Owner access is required'; end if;
 select coalesce(max(version),0)+1 into v_next from public.product_pack_definitions where product_id=p_product_id;
 if p_expected_version<>v_next-1 then raise exception 'Pack definition changed; refresh before saving'; end if;
 insert into public.product_pack_definitions(id,product_id,version,base_unit,units_per_carton,reason,created_by)
 values(p_id,p_product_id,v_next,trim(p_base_unit),p_units_per_carton,trim(p_reason),auth.uid()) returning * into v_row;
 return v_row;
end $$;

create or replace function public.set_inventory_opening_balance(p_lot_id uuid,p_expected_version integer,p_product_id uuid,p_location_id uuid,p_pack_definition_id uuid,p_batch_number text,p_expiry_date date,p_sealed_cartons integer,p_loose_units integer,p_reason text)
returns public.inventory_lots language plpgsql security definer set search_path=public,pg_temp as $$
declare v_row public.inventory_lots; v_existing public.inventory_lots; v_old_cartons integer:=0; v_old_units integer:=0; v_per_carton integer;
begin
 if not public.inventory_owner() then raise exception 'Owner access is required'; end if;
 if p_sealed_cartons<0 or p_loose_units<0 then raise exception 'Stock counts cannot be negative'; end if;
 if p_expected_version=0 then
  select units_per_carton into v_per_carton from public.product_pack_definitions where id=p_pack_definition_id and product_id=p_product_id;
  if not found then raise exception 'Choose a saved pack definition for this product'; end if;
  insert into public.inventory_lots(id,product_id,location_id,pack_definition_id,batch_number,expiry_date,sealed_cartons,loose_units)
  values(p_lot_id,p_product_id,p_location_id,p_pack_definition_id,coalesce(trim(p_batch_number),''),p_expiry_date,p_sealed_cartons,p_loose_units) returning * into v_row;
 else
  select * into v_existing from public.inventory_lots where id=p_lot_id and version=p_expected_version and stock_status='available' for update;
  if not found then raise exception 'Stock changed; refresh before saving'; end if;
  v_old_cartons:=v_existing.sealed_cartons;v_old_units:=v_existing.loose_units;
  select units_per_carton into v_per_carton from public.product_pack_definitions where id=v_existing.pack_definition_id;
  update public.inventory_lots set sealed_cartons=p_sealed_cartons,loose_units=p_loose_units,version=version+1,updated_at=now() where id=p_lot_id returning * into v_row;
 end if;
 insert into public.inventory_movements(id,lot_id,movement_type,sealed_carton_change,loose_unit_change,base_unit_change,reason,actor_user_id)
 values(gen_random_uuid(),v_row.id,case when p_expected_version=0 then 'opening_balance' else 'opening_adjustment' end,p_sealed_cartons-v_old_cartons,p_loose_units-v_old_units,(p_sealed_cartons-v_old_cartons)*v_per_carton+(p_loose_units-v_old_units),trim(p_reason),auth.uid());
 return v_row;
end $$;

create or replace function public.request_inventory_transfer(p_id uuid,p_source_lot_id uuid,p_to_location_id uuid,p_cartons integer,p_expected_at date,p_reason text)
returns public.inventory_transfers language plpgsql security definer set search_path=public,pg_temp as $$
declare v_lot public.inventory_lots; v_units integer; v_row public.inventory_transfers;
begin
 if not public.inventory_active_staff() then raise exception 'Active staff access is required'; end if;
 select * into v_lot from public.inventory_lots where id=p_source_lot_id and stock_status='available';
 if not found then raise exception 'Choose available source stock'; end if;
 if p_cartons<1 or p_cartons>v_lot.sealed_cartons then raise exception 'Not enough sealed cartons'; end if;
 select units_per_carton into v_units from public.product_pack_definitions where id=v_lot.pack_definition_id;
 insert into public.inventory_transfers(id,source_lot_id,from_location_id,to_location_id,product_id,pack_definition_id,cartons,expected_units,expected_at,reason,created_by)
 values(p_id,v_lot.id,v_lot.location_id,p_to_location_id,v_lot.product_id,v_lot.pack_definition_id,p_cartons,p_cartons*v_units,p_expected_at,trim(p_reason),auth.uid()) returning * into v_row;
 return v_row;
end $$;

create or replace function public.dispatch_inventory_transfer(p_id uuid,p_expected_version integer,p_expected_lot_version integer,p_reason text)
returns public.inventory_transfers language plpgsql security definer set search_path=public,pg_temp as $$
declare v_transfer public.inventory_transfers; v_lot public.inventory_lots;
begin
 if not public.inventory_active_staff() then raise exception 'Active staff access is required'; end if;
 select * into v_transfer from public.inventory_transfers where id=p_id and version=p_expected_version and status='requested' for update;
 if not found then raise exception 'Transfer changed; refresh before dispatch'; end if;
 select * into v_lot from public.inventory_lots where id=v_transfer.source_lot_id and version=p_expected_lot_version and stock_status='available' for update;
 if not found or v_lot.sealed_cartons<v_transfer.cartons then raise exception 'Source stock changed; refresh before dispatch'; end if;
 update public.inventory_lots set sealed_cartons=sealed_cartons-v_transfer.cartons,version=version+1,updated_at=now() where id=v_lot.id;
 insert into public.inventory_movements(id,lot_id,transfer_id,movement_type,sealed_carton_change,base_unit_change,reason,actor_user_id)
 values(gen_random_uuid(),v_lot.id,v_transfer.id,'transfer_dispatch',-v_transfer.cartons,-v_transfer.expected_units,trim(p_reason),auth.uid());
 update public.inventory_transfers set status='in_transit',dispatched_by=auth.uid(),dispatched_at=now(),version=version+1 where id=v_transfer.id returning * into v_transfer;
 return v_transfer;
end $$;

create or replace function public.receive_inventory_transfer(p_id uuid,p_expected_version integer,p_actual_units integer,p_inspection text,p_note text)
returns public.inventory_transfers language plpgsql security definer set search_path=public,pg_temp as $$
declare v_transfer public.inventory_transfers; v_lot public.inventory_lots; v_status text; v_batch text; v_expiry date;
begin
 if not public.inventory_active_staff() then raise exception 'Active staff access is required'; end if;
 if p_actual_units<0 then raise exception 'Counted units cannot be negative'; end if;
 select * into v_transfer from public.inventory_transfers where id=p_id and version=p_expected_version and status='in_transit' for update;
 if not found then raise exception 'Transfer changed; refresh before receiving'; end if;
 select batch_number,expiry_date into v_batch,v_expiry from public.inventory_lots where id=v_transfer.source_lot_id;
 if p_actual_units<>v_transfer.expected_units or p_inspection<>'pass' or (v_expiry is not null and v_expiry<current_date) then
  v_status:='quarantine';
 else
  v_status:='received';
 end if;
 insert into public.inventory_lots(id,product_id,location_id,pack_definition_id,batch_number,expiry_date,sealed_cartons,loose_units,stock_status)
 values(gen_random_uuid(),v_transfer.product_id,v_transfer.to_location_id,v_transfer.pack_definition_id,v_batch,v_expiry,case when v_status='received' then v_transfer.cartons else 0 end,case when v_status='quarantine' then p_actual_units else 0 end,v_status)
 on conflict (product_id,location_id,pack_definition_id,batch_number,(coalesce(expiry_date,'infinity'::date)),stock_status)
 do update set sealed_cartons=public.inventory_lots.sealed_cartons+excluded.sealed_cartons,loose_units=public.inventory_lots.loose_units+excluded.loose_units,version=public.inventory_lots.version+1,updated_at=now()
 returning * into v_lot;
 insert into public.inventory_movements(id,lot_id,transfer_id,movement_type,sealed_carton_change,loose_unit_change,base_unit_change,reason,actor_user_id)
 values(gen_random_uuid(),v_lot.id,v_transfer.id,case when v_status='received' then 'transfer_receipt' else 'quarantine_receipt' end,case when v_status='received' then v_transfer.cartons else 0 end,case when v_status='quarantine' then p_actual_units else 0 end,p_actual_units,trim(p_note),auth.uid());
 update public.inventory_transfers set status=v_status,actual_units=p_actual_units,inspection_note=trim(p_note),received_by=auth.uid(),received_at=now(),version=version+1 where id=v_transfer.id returning * into v_transfer;
 return v_transfer;
end $$;

create or replace function public.open_inventory_cartons(p_lot_id uuid,p_expected_version integer,p_cartons integer,p_reason text)
returns public.inventory_lots language plpgsql security definer set search_path=public,pg_temp as $$
declare v_lot public.inventory_lots; v_units integer;
begin
 if not public.inventory_active_staff() then raise exception 'Active staff access is required'; end if;
 select l.* into v_lot from public.inventory_lots l join public.inventory_locations w on w.id=l.location_id
 where l.id=p_lot_id and l.version=p_expected_version and l.stock_status='available' and w.active=true and w.is_dispatch_hub = true for update of l;
 if not found then raise exception 'Cartons may only be opened from available stock at the dispatch hub'; end if;
 if p_cartons<1 or p_cartons>v_lot.sealed_cartons then raise exception 'Not enough sealed cartons'; end if;
 select p_cartons*units_per_carton into v_units from public.product_pack_definitions where id=v_lot.pack_definition_id;
 update public.inventory_lots set sealed_cartons=sealed_cartons-p_cartons,loose_units=loose_units+v_units,version=version+1,updated_at=now() where id=v_lot.id returning * into v_lot;
 insert into public.inventory_movements(id,lot_id,movement_type,sealed_carton_change,loose_unit_change,base_unit_change,reason,actor_user_id)
 values(gen_random_uuid(),v_lot.id,'break_pack',-p_cartons,v_units,0,trim(p_reason),auth.uid());
 return v_lot;
end $$;

create or replace function public.issue_consumer_units(p_id uuid,p_lot_id uuid,p_expected_version integer,p_organization_id uuid,p_quantity integer,p_issued_on date,p_reference text,p_reason text)
returns public.inventory_issues language plpgsql security definer set search_path=public,pg_temp as $$
declare v_lot public.inventory_lots; v_issue public.inventory_issues;
begin
 if not public.inventory_active_staff() then raise exception 'Active staff access is required'; end if;
 select * into v_lot from public.inventory_lots where id=p_lot_id and version=p_expected_version and stock_status='available' for update;
 if not found then raise exception 'Stock changed; refresh before issuing'; end if;
 if not exists(select 1 from public.organizations where id=p_organization_id and deleted_at is null) then raise exception 'Choose an active client or branch'; end if;
 if p_quantity<1 or p_quantity>v_lot.loose_units-v_lot.reserved_units then raise exception 'Not enough loose consumer units'; end if;
 update public.inventory_lots set loose_units=loose_units-p_quantity,version=version+1,updated_at=now() where id=v_lot.id;
 insert into public.inventory_issues(id,lot_id,organization_id,product_id,quantity,issued_on,reference,reason,issued_by)
 values(p_id,v_lot.id,p_organization_id,v_lot.product_id,p_quantity,p_issued_on,trim(p_reference),trim(p_reason),auth.uid()) returning * into v_issue;
 insert into public.inventory_movements(id,lot_id,movement_type,loose_unit_change,base_unit_change,reason,actor_user_id)
 values(gen_random_uuid(),v_lot.id,'consumer_issue',-p_quantity,-p_quantity,trim(p_reason),auth.uid());
 return v_issue;
end $$;

alter table public.inventory_locations enable row level security;
alter table public.product_pack_definitions enable row level security;
alter table public.inventory_lots enable row level security;
alter table public.inventory_transfers enable row level security;
alter table public.inventory_movements enable row level security;
alter table public.inventory_issues enable row level security;

create policy inventory_locations_read on public.inventory_locations for select to authenticated using (public.inventory_active_staff());
create policy product_pack_definitions_read on public.product_pack_definitions for select to authenticated using (public.inventory_active_staff());
create policy inventory_lots_read on public.inventory_lots for select to authenticated using (public.inventory_active_staff());
create policy inventory_transfers_read on public.inventory_transfers for select to authenticated using (public.inventory_active_staff());
create policy inventory_movements_read on public.inventory_movements for select to authenticated using (public.inventory_active_staff());
create policy inventory_issues_read on public.inventory_issues for select to authenticated using (public.inventory_active_staff());

revoke all on public.inventory_locations,public.product_pack_definitions,public.inventory_lots,public.inventory_transfers,public.inventory_movements,public.inventory_issues from anon;
grant select on public.inventory_locations,public.product_pack_definitions,public.inventory_lots,public.inventory_transfers,public.inventory_movements,public.inventory_issues to authenticated;
grant execute on function public.save_inventory_location(uuid,integer,text,text,text,boolean),public.save_pack_definition(uuid,uuid,integer,text,integer,text),public.set_inventory_opening_balance(uuid,integer,uuid,uuid,uuid,text,date,integer,integer,text),public.request_inventory_transfer(uuid,uuid,uuid,integer,date,text),public.dispatch_inventory_transfer(uuid,integer,integer,text),public.receive_inventory_transfer(uuid,integer,integer,text,text),public.open_inventory_cartons(uuid,integer,integer,text),public.issue_consumer_units(uuid,uuid,integer,uuid,integer,date,text,text) to authenticated;

commit;
