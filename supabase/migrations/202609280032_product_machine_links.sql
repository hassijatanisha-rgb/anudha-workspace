begin;
-- Additive metadata only. Rollback is a new forward migration revoking RPC
-- execution and disabling the editor; preserve this table and its history.
create table public.product_machine_link_reviews (
 id uuid primary key,
 product_id uuid not null references public.products(id),
 version integer not null check(version>0),
 machine_ids uuid[] not null check(cardinality(machine_ids)<=100),
 reason text not null check(length(trim(reason)) between 5 and 1000),
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(),
 unique(product_id,version)
);
create trigger product_machine_link_reviews_immutable before update or delete on public.product_machine_link_reviews
for each row execute function public.deny_product_classification_mutation();
alter table public.product_machine_link_reviews enable row level security;
revoke all on public.product_machine_link_reviews from public,anon,authenticated;
grant select on public.product_machine_link_reviews to authenticated;
create policy product_machine_link_reviews_read on public.product_machine_link_reviews for select to authenticated using(public.inventory_active_staff());

-- Serialize new category decisions against compatibility validation. The
-- existing classification RPC retains its active-staff authorization.
create function public.lock_product_classification_insert()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 perform 1 from public.products where id=new.product_id for update;
 return new;
end $$;
revoke all on function public.lock_product_classification_insert() from public,anon,authenticated;
create trigger product_classification_insert_lock before insert on public.product_inventory_classifications
for each row execute function public.lock_product_classification_insert();

create function public.save_product_machine_link_review(p_id uuid,p_product_id uuid,p_expected_version integer,p_machine_ids uuid[],p_reason text)
returns public.product_machine_link_reviews language plpgsql security definer set search_path=public,pg_temp as $$
declare v_next integer;v_row public.product_machine_link_reviews;v_machine uuid;v_category text;
begin
 if not public.inventory_owner() then raise exception 'Owner access is required to correct machine links'; end if;
 if p_machine_ids is null then raise exception 'Supply a machine ID array, including an empty array to clear links'; end if;
 if cardinality(p_machine_ids)>100 then raise exception 'Choose at most 100 compatible machines'; end if;
 if array_ndims(p_machine_ids)>1 then raise exception 'Supply a one-dimensional machine ID array'; end if;
 if array_position(p_machine_ids,null) is not null then raise exception 'Machine IDs cannot contain null'; end if;
 if cardinality(p_machine_ids)<>(select count(distinct x) from unnest(p_machine_ids) x) then raise exception 'Machine IDs cannot contain duplicates'; end if;
 if p_product_id=any(p_machine_ids) then raise exception 'A product cannot link to itself'; end if;
 -- A single deterministic lock order covers source, targets, archive updates,
 -- and the category insert trigger. Validate only after acquiring these locks.
 perform 1 from public.products where id=p_product_id or id=any(p_machine_ids) order by id for update;
 if not exists(select 1 from public.products where id=p_product_id) then raise exception 'Choose an existing product'; end if;
 if exists(select 1 from public.products where id=p_product_id and deleted_at is not null) then raise exception 'Restore the archived product before editing links'; end if;
 select coalesce((select c.category from public.product_inventory_classifications c where c.product_id=p_product_id order by c.version desc limit 1),p.source->>'category','unclassified') into v_category from public.products p where p.id=p_product_id;
 if v_category not in ('reagents','consumables','spares') then raise exception 'Choose a reagent, consumable or spare before editing machine links'; end if;
 foreach v_machine in array p_machine_ids loop
  if not exists(select 1 from public.products where id=v_machine) then raise exception 'Choose existing saved machines'; end if;
  if exists(select 1 from public.products where id=v_machine and deleted_at is not null) then raise exception 'Archived machines cannot be linked'; end if;
  select coalesce((select c.category from public.product_inventory_classifications c where c.product_id=v_machine order by c.version desc limit 1),p.source->>'category','unclassified') into v_category from public.products p where p.id=v_machine;
  if v_category<>'machines' then raise exception 'Every compatible target must be classified as a machine'; end if;
 end loop;
 select coalesce(max(version),0)+1 into v_next from public.product_machine_link_reviews where product_id=p_product_id;
 if p_expected_version is null or p_expected_version<>v_next-1 then raise exception 'Machine links changed; refresh and compare before saving'; end if;
 insert into public.product_machine_link_reviews(id,product_id,version,machine_ids,reason,created_by)
 values(p_id,p_product_id,v_next,array(select x from unnest(p_machine_ids) x order by x),trim(p_reason),auth.uid()) returning * into v_row;
 return v_row;
end $$;
revoke all on function public.save_product_machine_link_review(uuid,uuid,integer,uuid[],text) from public,anon;
grant execute on function public.save_product_machine_link_review(uuid,uuid,integer,uuid[],text) to authenticated;
commit;
