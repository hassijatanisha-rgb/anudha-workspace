-- Temporary physical stock count: a product list to count against, owner-run count sessions, per-godown counts
-- and owner review. Additive only. It never changes inventory lots, movements or Tally source rows; accepted
-- counts are the reviewed input for a later opening-stock import.
-- Rollback / retirement: close the session, hide the screen (config stockCountEnabled=false) and revoke the RPCs
-- in a reviewed forward migration; keep the rows as evidence.
begin;

create table public.count_catalogue (
 code text primary key check (code ~ '^AN-[0-9]{5}$'),
 product text not null check (length(trim(product)) between 1 and 300),
 company text not null default '' check (length(company) <= 200),
 specification text not null default '' check (length(specification) <= 300),
 category text not null check (category in ('Machine','Furniture','Spare','Consumable','Reagent','Not sure')),
 search_text text not null default '' check (length(search_text) <= 4000),
 erp_product_ids uuid[] not null default '{}',
 -- The app's paginated loader orders by id.
 id text generated always as (code) stored unique,
 loaded_by uuid not null references auth.users(id),
 loaded_at timestamptz not null default now()
);
create index count_catalogue_loaded_by on public.count_catalogue(loaded_by);

create table public.stock_count_sessions (
 id uuid primary key,
 name text not null check (length(trim(name)) between 3 and 120),
 status text not null check (status in ('open','closed')),
 opened_by uuid not null references auth.users(id),
 opened_at timestamptz not null default now(),
 closed_by uuid references auth.users(id),
 closed_at timestamptz,
 version integer not null default 1 check (version > 0),
 check ((status = 'closed') = (closed_by is not null and closed_at is not null))
);
create unique index stock_count_one_open on public.stock_count_sessions((true)) where status = 'open';
create index stock_count_sessions_opened_by on public.stock_count_sessions(opened_by);
create index stock_count_sessions_closed_by on public.stock_count_sessions(closed_by);

create table public.stock_count_entries (
 id uuid primary key,
 session_id uuid not null references public.stock_count_sessions(id),
 godown text not null check (godown in ('City Printer Godown','City Printer Godown 2','City Printer Godown 04','Keko Manga A','New Dakawa','New Dakawa Godown A','RK Chudasama No.7','RK Chudasama No.8','Other location')),
 code text references public.count_catalogue(code),
 unlisted text not null default '' check (length(unlisted) <= 300),
 quantity numeric(14,3) not null check (quantity >= 0 and quantity <= 10000000),
 unit text not null check (unit in ('PCS','BOX','PKT','DOZ','SET','KIT','BOTTLE','ROLL','PAIR','BAG','GALLON','SHEET','CARTON','LITRE','KG','TUBE')),
 batch text not null default '' check (length(batch) <= 80),
 expiry date,
 condition text not null check (condition in ('good','damaged','expired','quarantine')),
 notes text not null default '' check (length(notes) <= 1000),
 counted_by uuid not null references auth.users(id),
 counted_at timestamptz not null default now(),
 status text not null default 'recorded' check (status in ('recorded','void','accepted','rejected')),
 status_note text not null default '' check (length(status_note) <= 1000),
 status_by uuid references auth.users(id),
 status_at timestamptz,
 version integer not null default 1 check (version > 0),
 -- Either a listed product or a written description of something not on the list.
 check ((code is not null) <> (length(trim(unlisted)) >= 3)),
 check ((status = 'recorded') = (status_by is null and status_at is null)),
 check (status not in ('void','rejected') or length(trim(status_note)) >= 3)
);
create index stock_count_entries_session_godown on public.stock_count_entries(session_id, godown, counted_at desc);
create index stock_count_entries_code on public.stock_count_entries(code);
create index stock_count_entries_counted_by on public.stock_count_entries(counted_by);
create index stock_count_entries_status_by on public.stock_count_entries(status_by);

-- What was counted never changes after it is saved; only the review status moves forward once.
create function public.guard_stock_count_entry()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
 if tg_op = 'DELETE' then raise exception 'Counts are never deleted; void them with a reason'; end if;
 if old.status <> 'recorded' then raise exception 'This count has already been reviewed or voided'; end if;
 if (new.session_id,new.godown,new.code,new.unlisted,new.quantity,new.unit,new.batch,new.expiry,new.condition,new.notes,new.counted_by,new.counted_at)
    is distinct from (old.session_id,old.godown,old.code,old.unlisted,old.quantity,old.unit,old.batch,old.expiry,old.condition,old.notes,old.counted_by,old.counted_at) then
  raise exception 'A saved count cannot be edited; void it and count again';
 end if;
 return new;
end $$;
create trigger stock_count_entries_guard before update or delete on public.stock_count_entries for each row execute function public.guard_stock_count_entry();
create function public.deny_stock_count_truncate()
returns trigger language plpgsql set search_path=public,pg_temp as $$ begin raise exception 'Stock count records are never deleted'; end $$;
create trigger stock_count_entries_no_truncate before truncate on public.stock_count_entries for each statement execute function public.deny_stock_count_truncate();
create trigger stock_count_sessions_no_truncate before truncate on public.stock_count_sessions for each statement execute function public.deny_stock_count_truncate();
create trigger stock_count_sessions_no_delete before delete on public.stock_count_sessions for each row execute function public.deny_stock_count_truncate();

alter table public.count_catalogue enable row level security;
alter table public.stock_count_sessions enable row level security;
alter table public.stock_count_entries enable row level security;
create policy count_catalogue_read on public.count_catalogue for select to authenticated using ((select public.inventory_active_staff()));
create policy stock_count_sessions_read on public.stock_count_sessions for select to authenticated using ((select public.inventory_active_staff()));
create policy stock_count_entries_read on public.stock_count_entries for select to authenticated using ((select public.inventory_active_staff()));
revoke all on public.count_catalogue, public.stock_count_sessions, public.stock_count_entries from public, anon, authenticated;
grant select on public.count_catalogue, public.stock_count_sessions, public.stock_count_entries to authenticated;

-- Owner loads or refreshes the product list in batches of up to 1,000. Existing codes are updated in place.
create function public.load_count_catalogue(p_rows jsonb)
returns integer language plpgsql security definer set search_path=public,pg_temp as $$
declare v_row jsonb; v_n integer := 0; v_ids uuid[];
begin
 if not public.inventory_owner() then raise exception 'Only the owner can load the product list'; end if;
 if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) not between 1 and 1000 then raise exception 'Send between 1 and 1,000 products at a time'; end if;
 for v_row in select value from jsonb_array_elements(p_rows) loop
  v_n := v_n + 1;
  begin
   select coalesce(array_agg(x::uuid),'{}') into v_ids from jsonb_array_elements_text(coalesce(v_row->'erp_product_ids','[]'::jsonb)) x;
  exception when others then raise exception 'Product % has an invalid ERP id', v_n;
  end;
  insert into public.count_catalogue(code,product,company,specification,category,search_text,erp_product_ids,loaded_by)
  values(v_row->>'code',trim(coalesce(v_row->>'product','')),trim(coalesce(v_row->>'company','')),trim(coalesce(v_row->>'specification','')),
   coalesce(v_row->>'category','Not sure'),left(coalesce(v_row->>'search_text',''),4000),v_ids,auth.uid())
  on conflict (code) do update set product=excluded.product,company=excluded.company,specification=excluded.specification,category=excluded.category,
   search_text=excluded.search_text,erp_product_ids=excluded.erp_product_ids,loaded_by=excluded.loaded_by,loaded_at=now();
 end loop;
 return v_n;
end $$;

create function public.open_stock_count(p_id uuid, p_name text)
returns public.stock_count_sessions language plpgsql security definer set search_path=public,pg_temp as $$
declare v_row public.stock_count_sessions;
begin
 if not public.inventory_owner() then raise exception 'Only the owner can start a count'; end if;
 select * into v_row from public.stock_count_sessions where id=p_id;
 if found then return v_row; end if;
 if exists(select 1 from public.stock_count_sessions where status='open') then raise exception 'A count is already running; close it first'; end if;
 insert into public.stock_count_sessions(id,name,status,opened_by) values(p_id,trim(coalesce(p_name,'')),'open',auth.uid()) returning * into v_row;
 return v_row;
end $$;

create function public.close_stock_count(p_id uuid, p_expected_version integer)
returns public.stock_count_sessions language plpgsql security definer set search_path=public,pg_temp as $$
declare v_row public.stock_count_sessions;
begin
 if not public.inventory_owner() then raise exception 'Only the owner can close a count'; end if;
 select * into v_row from public.stock_count_sessions where id=p_id for update;
 if not found then raise exception 'Count not found'; end if;
 if v_row.version <> p_expected_version then raise exception 'Count changed; refresh'; end if;
 if v_row.status <> 'open' then raise exception 'This count is already closed'; end if;
 update public.stock_count_sessions set status='closed',closed_by=auth.uid(),closed_at=now(),version=version+1 where id=p_id returning * into v_row;
 return v_row;
end $$;

-- Any active staff member records a count in the open session. A retry with the same id returns the saved count.
create function public.record_stock_count(p_id uuid, p_session_id uuid, p_godown text, p_code text, p_unlisted text, p_quantity numeric,
 p_unit text, p_batch text default '', p_expiry date default null, p_condition text default 'good', p_notes text default '')
returns public.stock_count_entries language plpgsql security definer set search_path=public,pg_temp as $$
declare v_row public.stock_count_entries;
begin
 if not public.inventory_active_staff() then raise exception 'Active staff access is required'; end if;
 if p_id is null or p_session_id is null then raise exception 'Count and session are required'; end if;
 perform pg_advisory_xact_lock(hashtextextended('stock-count:'||p_id::text,0));
 select * into v_row from public.stock_count_entries where id=p_id;
 if found then
  if v_row.counted_by=auth.uid() and v_row.session_id=p_session_id and v_row.godown=p_godown and v_row.code is not distinct from nullif(p_code,'')
   and v_row.quantity=p_quantity and v_row.unit=p_unit then return v_row; end if;
  raise exception 'Count already saved with different details; refresh';
 end if;
 if not exists(select 1 from public.stock_count_sessions where id=p_session_id and status='open') then raise exception 'This count is closed; ask the owner to start one'; end if;
 if nullif(p_code,'') is not null and not exists(select 1 from public.count_catalogue where code=p_code) then raise exception 'Choose a product from the list, or describe it as not on the list'; end if;
 if p_expiry is not null and p_expiry < date '2000-01-01' then raise exception 'Check the expiry date'; end if;
 insert into public.stock_count_entries(id,session_id,godown,code,unlisted,quantity,unit,batch,expiry,condition,notes,counted_by)
 values(p_id,p_session_id,p_godown,nullif(p_code,''),case when nullif(p_code,'') is null then trim(coalesce(p_unlisted,'')) else '' end,p_quantity,p_unit,
  trim(coalesce(p_batch,'')),p_expiry,coalesce(p_condition,'good'),trim(coalesce(p_notes,'')),auth.uid())
 returning * into v_row;
 return v_row;
end $$;

-- void: the counter (own count) or the owner, with a reason. accept / reject: owner only.
create function public.review_stock_count(p_id uuid, p_expected_version integer, p_action text, p_note text default '')
returns public.stock_count_entries language plpgsql security definer set search_path=public,pg_temp as $$
declare v_row public.stock_count_entries; v_note text := trim(coalesce(p_note,''));
begin
 if not public.inventory_active_staff() then raise exception 'Active staff access is required'; end if;
 select * into v_row from public.stock_count_entries where id=p_id for update;
 if not found then raise exception 'Count not found'; end if;
 if v_row.version <> p_expected_version then raise exception 'Count changed; refresh'; end if;
 if v_row.status <> 'recorded' then raise exception 'This count has already been reviewed or voided'; end if;
 if p_action='void' then
  if v_row.counted_by <> auth.uid() and not public.inventory_owner() then raise exception 'Only the person who counted or the owner can void this'; end if;
  if length(v_note) < 3 then raise exception 'Enter why this count is being voided'; end if;
 elsif p_action in ('accept','reject') then
  if not public.inventory_owner() then raise exception 'Only the owner can accept or reject counts'; end if;
  if p_action='reject' and length(v_note) < 3 then raise exception 'Enter why the count is rejected'; end if;
 else raise exception 'Unknown review action';
 end if;
 update public.stock_count_entries set status=case p_action when 'void' then 'void' when 'accept' then 'accepted' else 'rejected' end,
  status_note=v_note,status_by=auth.uid(),status_at=now(),version=version+1 where id=p_id returning * into v_row;
 return v_row;
end $$;

revoke all on function public.load_count_catalogue(jsonb), public.open_stock_count(uuid,text), public.close_stock_count(uuid,integer),
 public.record_stock_count(uuid,uuid,text,text,text,numeric,text,text,date,text,text), public.review_stock_count(uuid,integer,text,text) from public, anon;
grant execute on function public.load_count_catalogue(jsonb), public.open_stock_count(uuid,text), public.close_stock_count(uuid,integer),
 public.record_stock_count(uuid,uuid,text,text,text,numeric,text,text,date,text,text), public.review_stock_count(uuid,integer,text,text) to authenticated;
commit;
