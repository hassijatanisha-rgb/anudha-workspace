begin;

create table public.product_inventory_classifications (
 id uuid primary key,
 product_id uuid not null references public.products(id),
 version integer not null check (version > 0),
 category text not null check (category in ('machines','reagents','consumables','spares','non_stock','unclassified')),
 reason text not null check (length(trim(reason)) between 5 and 1000),
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(),
 unique(product_id,version)
);

create or replace function public.deny_product_classification_mutation()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
 raise exception 'Product classifications are immutable; save a new version';
end $$;
create trigger product_inventory_classifications_immutable before update or delete on public.product_inventory_classifications for each row execute function public.deny_product_classification_mutation();

create or replace function public.save_product_inventory_classification(p_id uuid,p_product_id uuid,p_expected_version integer,p_category text,p_reason text)
returns public.product_inventory_classifications language plpgsql security definer set search_path=public,pg_temp as $$
declare v_row public.product_inventory_classifications; v_next integer;
begin
 if not public.inventory_active_staff() then raise exception 'Active staff access is required'; end if;
 if p_category not in ('machines','reagents','consumables','spares','non_stock','unclassified') then raise exception 'Choose a supported inventory category'; end if;
 if not exists(select 1 from public.products where id=p_product_id) then raise exception 'Choose a saved product'; end if;
 select coalesce(max(version),0)+1 into v_next from public.product_inventory_classifications where product_id=p_product_id;
 if p_expected_version<>v_next-1 then raise exception 'Product classification changed; refresh before saving'; end if;
 insert into public.product_inventory_classifications(id,product_id,version,category,reason,created_by)
 values(p_id,p_product_id,v_next,p_category,trim(p_reason),auth.uid()) returning * into v_row;
 return v_row;
end $$;

alter table public.product_inventory_classifications enable row level security;
create policy product_inventory_classifications_read on public.product_inventory_classifications for select to authenticated using (public.inventory_active_staff());
revoke all on public.product_inventory_classifications from anon;
grant select on public.product_inventory_classifications to authenticated;
revoke all on function public.save_product_inventory_classification(uuid,uuid,integer,text,text) from public,anon;
grant execute on function public.save_product_inventory_classification(uuid,uuid,integer,text,text) to authenticated;

commit;
