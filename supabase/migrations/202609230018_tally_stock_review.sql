begin;
-- Source balances are review evidence, never live inventory lots.
create table public.tally_stock_sources (
 id text primary key,
 source_file text not null,
 source_row integer not null check(source_row>0),
 godown text not null,
 product_name text not null,
 quantity numeric,
 unit text,
 balance_date date not null,
 raw jsonb not null,
 imported_by uuid not null references auth.users(id),
 imported_at timestamptz not null default now()
);
create table public.tally_stock_corrections (
 id uuid primary key,
 source_id text not null references public.tally_stock_sources(id),
 version integer not null check(version>0),
 product_id uuid references public.products(id),
 pieces bigint check(pieces between 0 and 9007199254740991),
 batch text not null default '',
 expiry date,
 reason text not null check(length(trim(reason)) between 5 and 1000),
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(),
 unique(source_id,version)
);
create trigger tally_stock_sources_immutable before update or delete on public.tally_stock_sources for each row execute function public.deny_product_classification_mutation();
create trigger tally_stock_corrections_immutable before update or delete on public.tally_stock_corrections for each row execute function public.deny_product_classification_mutation();
alter table public.tally_stock_sources enable row level security;
alter table public.tally_stock_corrections enable row level security;
revoke all on public.tally_stock_sources,public.tally_stock_corrections from public,anon,authenticated;
-- Do not expose raw rates/values from Tally to general staff.
grant select(id,source_file,source_row,godown,product_name,quantity,unit,balance_date,imported_at) on public.tally_stock_sources to authenticated;
grant select on public.tally_stock_corrections to authenticated;
create policy tally_sources_read on public.tally_stock_sources for select to authenticated using(public.inventory_active_staff());
create policy tally_corrections_read on public.tally_stock_corrections for select to authenticated using(public.inventory_active_staff());

create function public.import_tally_stock_review(p_rows jsonb) returns integer
language plpgsql security definer set search_path=public,pg_temp as $$
declare r jsonb; n integer:=0; previous jsonb;
begin
 if not public.inventory_owner() then raise exception 'Owner access required'; end if;
 if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows)>100 then raise exception 'Submit at most 100 source rows'; end if;
 for r in select value from jsonb_array_elements(p_rows) loop
  if r->>'record_kind' is distinct from 'item_balance' then raise exception 'Only item balances may be staged'; end if;
  if coalesce(r->>'source_record_id','')!~'^[0-9a-f]{64}:.+:[0-9]+$' then raise exception 'Source identity missing'; end if;
  insert into public.tally_stock_sources(id,source_file,source_row,godown,product_name,quantity,unit,balance_date,raw,imported_by)
  values(r->>'source_record_id',r->>'source_file',(r->>'source_row')::integer,r->>'godown_name_raw',r->>'product_name_raw',(r->>'quantity')::numeric,r->>'unit_raw',(r->>'balance_as_of_date')::date,r,auth.uid()) on conflict(id) do nothing;
  select raw into previous from public.tally_stock_sources where id=r->>'source_record_id';
  if previous is distinct from r then raise exception 'Source row already exists with different content'; end if;
  n:=n+1;
 end loop;
 return n;
end $$;
create function public.save_tally_stock_correction(p_id uuid,p_source_id text,p_expected_version integer,p_product_id uuid,p_pieces bigint,p_batch text,p_expiry date,p_reason text)
returns public.tally_stock_corrections language plpgsql security definer set search_path=public,pg_temp as $$
declare v integer; result public.tally_stock_corrections;
begin
 if not public.inventory_owner() then raise exception 'Owner access required'; end if;
 perform 1 from public.tally_stock_sources where id=p_source_id for update;
 if not found then raise exception 'Source row not found'; end if;
 select coalesce(max(version),0)+1 into v from public.tally_stock_corrections where source_id=p_source_id;
 if p_expected_version is null or p_expected_version<>v-1 then raise exception 'Correction changed; refresh and compare'; end if;
 insert into public.tally_stock_corrections(id,source_id,version,product_id,pieces,batch,expiry,reason,created_by)
 values(p_id,p_source_id,v,p_product_id,p_pieces,trim(coalesce(p_batch,'')),p_expiry,trim(p_reason),auth.uid()) returning * into result;
 return result;
end $$;
revoke all on function public.import_tally_stock_review(jsonb) from public,anon;
revoke all on function public.save_tally_stock_correction(uuid,text,integer,uuid,bigint,text,date,text) from public,anon;
grant execute on function public.import_tally_stock_review(jsonb) to authenticated;
grant execute on function public.save_tally_stock_correction(uuid,text,integer,uuid,bigint,text,date,text) to authenticated;
commit;
