begin;

-- A bounded read page and whole-scope counts share one caller-visible snapshot.
-- No stock quantities, reservations or write transactions are changed here.
create function public.inventory_stock_page(
 p_query text default '', p_location_id uuid default null, p_status text default '',
 p_page integer default 0, p_product_id uuid default null
) returns jsonb language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare v_result jsonb; v_today date := (current_timestamp at time zone 'Africa/Dar_es_Salaam')::date;
begin
 if not public.inventory_active_staff() then raise exception 'Active staff access is required' using errcode='42501'; end if;
 if p_page is null or p_page<0 or p_page>1000000 then raise exception 'Choose a valid stock page'; end if;
 if p_query is null or length(p_query)>2000 then raise exception 'Search must be 2000 characters or fewer'; end if;
 if p_status is null or p_status not in ('','available','quarantine','expired','empty') then raise exception 'Choose a valid stock status'; end if;
 with scoped_lots as materialized (
  select * from public.inventory_lots where p_product_id is null or product_id=p_product_id
 ), identities as materialized (
  select p.id,p.sku,case when r.id is null then p.name else r.name end as name,
   jsonb_build_object('company',case when r.id is null then p.source->>'company' else r.company end,
    'specification',case when r.id is null then p.source->>'specification' else r.specification end,
    'model',case when r.id is null then p.source->>'model' else r.specification end) as source
  from public.products p
  left join lateral (select id,name,company,specification from public.product_detail_reviews where product_id=p.id order by version desc limit 1) r on true
  where p.id in (select product_id from scoped_lots) or p.id=p_product_id
 ), matches as materialized (
  select lot.* from scoped_lots lot
  left join identities p on p.id=lot.product_id
  left join public.inventory_locations place on place.id=lot.location_id
  where (p_location_id is null or lot.location_id=p_location_id)
   and (p_status='' or lot.stock_status=p_status
    or (p_status='expired' and lot.expiry_date<v_today)
    or (p_status='empty' and lot.sealed_cartons=0 and lot.loose_units=0))
   and strpos(lower(concat_ws(' ',coalesce(p.name,'Unknown product'),p.sku,p.source->>'company',coalesce(nullif(p.source->>'specification',''),p.source->>'model'),coalesce(place.name,'Unknown godown'),place.code,lot.batch_number)),lower(btrim(p_query)))>0
 ), counts as (
  select count(*) as total,greatest(1,(count(*)+49)/50) as pages,least(p_page,greatest(0,(count(*)-1)/50)) as page from matches
 ), page_rows as materialized (
  select * from matches order by updated_at desc,id limit 50 offset (select page*50 from counts)
 ), totals as (
  select count(*) as scope_count,coalesce(sum(lot.sealed_cartons),0) as cartons,coalesce(sum(lot.loose_units),0) as loose,
   coalesce(sum(lot.reserved_units),0) as reserved,coalesce(sum(lot.loose_units-lot.reserved_units),0) as free_loose,
   coalesce(sum(case when lot.stock_status='available' and (lot.expiry_date is null or lot.expiry_date>=v_today) and place.active and place.is_dispatch_hub then lot.loose_units-lot.reserved_units else 0 end),0) as invoiceable_loose,
   coalesce(bool_and(lot.sealed_cartons>=0 and lot.loose_units>=0 and lot.reserved_units>=0 and lot.reserved_units<=lot.loose_units),true) as valid
  from scoped_lots lot left join public.inventory_locations place on place.id=lot.location_id
 )
 select jsonb_build_object(
  'rows',coalesce((select jsonb_agg(to_jsonb(lot) order by lot.updated_at desc,lot.id) from page_rows lot),'[]'::jsonb),
  'products',coalesce((select jsonb_agg(to_jsonb(p)) from identities p where p.id in (select product_id from page_rows) or p.id=p_product_id),'[]'::jsonb),
  'locations',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'code',code,'active',active,'is_dispatch_hub',is_dispatch_hub) order by name,id) from public.inventory_locations),'[]'::jsonb),
  'packs',coalesce((select jsonb_agg(jsonb_build_object('id',id,'product_id',product_id,'version',version,'base_unit',base_unit,'units_per_carton',units_per_carton)) from public.product_pack_definitions where id in (select pack_definition_id from page_rows)),'[]'::jsonb),
  'total',counts.total,'page',counts.page,'pages',counts.pages,'scope_count',totals.scope_count,
  'totals',jsonb_build_object('cartons',totals.cartons,'loose',totals.loose,'reserved',totals.reserved,'freeLoose',totals.free_loose,'invoiceableLoose',totals.invoiceable_loose),
  'valid',totals.valid,'as_of',v_today
 ) into v_result from counts cross join totals;
 if not (v_result->>'valid')::boolean then raise exception 'Invalid stock or reservation count. Refresh and review this lot.'; end if;
 if exists(select 1 from jsonb_each_text(v_result->'totals') where value::numeric>9007199254740991) then raise exception 'Stock totals exceed the supported range.'; end if;
 return v_result-'valid';
end $$;
revoke all on function public.inventory_stock_page(text,uuid,text,integer,uuid) from public,anon;
grant execute on function public.inventory_stock_page(text,uuid,text,integer,uuid) to authenticated;
commit;
