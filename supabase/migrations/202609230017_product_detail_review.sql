begin;
-- Review metadata only: never modifies source exports or operational stock.
create table public.product_detail_reviews (
 id uuid primary key,
 product_id uuid not null references public.products(id),
 version integer not null check(version>0),
 name text not null check(length(trim(name)) between 1 and 500),
 company text not null default '' check(length(company)<=500),
 specification text not null default '' check(length(specification)<=2000),
 sale_status text not null check(sale_status in ('unknown','active','inactive_serviced')),
 batch_required boolean,
 expiry_required boolean,
 reason text not null check(length(trim(reason)) between 5 and 1000),
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(),
 unique(product_id,version)
);
create trigger product_detail_reviews_immutable before update or delete on public.product_detail_reviews
for each row execute function public.deny_product_classification_mutation();
alter table public.product_detail_reviews enable row level security;
revoke all on public.product_detail_reviews from public,anon,authenticated;
grant select on public.product_detail_reviews to authenticated;
create policy product_detail_reviews_read on public.product_detail_reviews for select to authenticated using(public.inventory_active_staff());
create function public.save_product_detail_review(p_id uuid,p_product_id uuid,p_expected_version integer,p_name text,p_company text,p_specification text,p_sale_status text,p_batch_required boolean,p_expiry_required boolean,p_reason text)
returns public.product_detail_reviews language plpgsql security definer set search_path=public,pg_temp as $$
declare v_next integer; v_row public.product_detail_reviews;
begin
 if not public.inventory_owner() then raise exception 'Owner access is required to correct product details'; end if;
 perform 1 from public.products where id=p_product_id for update;
 if not found then raise exception 'Choose an existing product'; end if;
 select coalesce(max(version),0)+1 into v_next from public.product_detail_reviews where product_id=p_product_id;
 if p_expected_version is null or p_expected_version<>v_next-1 then raise exception 'Product details changed; refresh and compare before saving'; end if;
 insert into public.product_detail_reviews(id,product_id,version,name,company,specification,sale_status,batch_required,expiry_required,reason,created_by)
 values(p_id,p_product_id,v_next,trim(p_name),trim(coalesce(p_company,'')),trim(coalesce(p_specification,'')),p_sale_status,p_batch_required,p_expiry_required,trim(p_reason),auth.uid()) returning * into v_row;
 return v_row;
end $$;
revoke all on function public.save_product_detail_review(uuid,uuid,integer,text,text,text,text,boolean,boolean,text) from public,anon;
grant execute on function public.save_product_detail_review(uuid,uuid,integer,text,text,text,text,boolean,boolean,text) to authenticated;
commit;
