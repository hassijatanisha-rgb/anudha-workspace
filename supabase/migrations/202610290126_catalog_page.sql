begin;

-- One read snapshot supplies corrected identities, exact counts and a 25-row page.
-- Invoker rights keep the existing active-staff/MFA row policies in force.
-- Avoid first-call compilation overhead observed in rollback profiling; keep JIT off only for this read.
create function public.catalog_page(
 p_query text default '', p_category text default 'review', p_colour text default '',
 p_sort text default 'name', p_page integer default 0, p_machine_id uuid default null,
 p_product_id uuid default null
) returns jsonb language plpgsql stable security invoker set search_path=public,pg_temp set jit=off as $$
declare v_result jsonb;
begin
 if not public.inventory_active_staff() then raise exception 'Active staff access is required' using errcode='42501'; end if;
 if p_page is null or p_page<0 or p_page>1000000 then raise exception 'Choose a valid product page'; end if;
 if p_query is null or length(p_query)>2000 then raise exception 'Search must be 2000 characters or fewer'; end if;
 if p_category is null or p_category not in ('review','all','machines','furniture','reagents','consumables','spares','non_stock','unclassified') then raise exception 'Choose a valid category'; end if;
 if p_colour is null or p_colour not in ('','red','yellow','ok') then raise exception 'Choose a valid colour'; end if;
 if p_sort is null or p_sort not in ('name','company','issues') then raise exception 'Choose a valid product sort'; end if;
 with current_products as materialized (
  select p.id,p.sku,case when r.id is null then p.name else r.name end as name,
   coalesce(c.category,nullif(p.source->>'category',''),'unclassified') as category,
   case when p_product_id is not null then coalesce(p.source,'{}'::jsonb) else
    jsonb_build_object('company',p.source->'company','model',p.source->'model','specification',p.source->'specification',
     'sale_status',p.source->'sale_status','batch_required',p.source->'batch_required','expiry_required',p.source->'expiry_required',
     'machine_ids',p.source->'machine_ids','suggested_company',p.source->'suggested_company','company_note',p.source->'company_note') end
    || case when r.id is null then '{}'::jsonb else jsonb_build_object('company',r.company,'specification',r.specification,'model',r.specification,'sale_status',r.sale_status,'batch_required',r.batch_required,'expiry_required',r.expiry_required) end
    || case when l.id is null then '{}'::jsonb else jsonb_build_object('machine_ids',l.machine_ids) end as source,
   case when p_product_id is not null then to_jsonb(p) end as original,
   case when p_product_id is not null then to_jsonb(r) end as review,
   case when p_product_id is not null then to_jsonb(l) end as links,
   case when c.id is null then null when p_product_id is not null then to_jsonb(c) else jsonb_build_object('category',c.category,'version',c.version) end as classification
  from public.products p
  left join lateral (select * from public.product_detail_reviews where product_id=p.id order by version desc limit 1) r on true
  left join lateral (select * from public.product_inventory_classifications where product_id=p.id order by version desc limit 1) c on true
  left join lateral (select * from public.product_machine_link_reviews where product_id=p.id order by version desc limit 1) l on true
  where p.deleted_at is null and (p_product_id is null or p.id=p_product_id)
 ), identities as (
  select *,count(*) over (partition by
   regexp_replace(lower(btrim(coalesce(name,''))),'\s+',' ','g'),
   regexp_replace(lower(btrim(coalesce(source->>'company',''))),'\s+',' ','g'),
   regexp_replace(lower(btrim(coalesce(nullif(source->>'specification',''),source->>'model',''))),'\s+',' ','g')) as duplicate_count,
   case when source->'machine_ids' is null or source->'machine_ids'='null'::jsonb then true
    when jsonb_typeof(source->'machine_ids')<>'array' then false
    else not exists(select 1 from jsonb_array_elements(source->'machine_ids') x where jsonb_typeof(x)<>'string' or btrim(x#>>'{}')='' or btrim(x#>>'{}')<>x#>>'{}') end as links_valid
  from current_products
 ), checked as (
  select *,
   (case when btrim(coalesce(name,''))='' then 1 else 0 end
    +case when btrim(coalesce(source->>'company',''))='' then 1 else 0 end
    +case when btrim(coalesce(nullif(source->>'specification',''),source->>'model',''))='' then 1 else 0 end
    +case when coalesce(source->>'sale_status','') not in ('active','inactive_serviced') then 1 else 0 end
    +case when coalesce(jsonb_typeof(source->'batch_required'),'')<>'boolean' then 1 else 0 end
    +case when coalesce(jsonb_typeof(source->'expiry_required'),'')<>'boolean' then 1 else 0 end
    +case when btrim(coalesce(sku,''))='' then 1 else 0 end
    +case when category='unclassified' then 1 else 0 end
    +case when not links_valid then 1 else 0 end
    +case when category in ('reagents','consumables','spares') and case when jsonb_typeof(source->'machine_ids')='array' then jsonb_array_length(source->'machine_ids')=0 else true end then 1 else 0 end) as issue_count,
   (case when btrim(coalesce(name,''))='' then 1 else 0 end
    +case when btrim(coalesce(source->>'company',''))='' then 1 else 0 end
    +case when btrim(coalesce(nullif(source->>'specification',''),source->>'model',''))='' then 1 else 0 end
    +case when category='unclassified' then 1 else 0 end
    +case when btrim(coalesce(sku,''))='' then 1 else 0 end
    +case when duplicate_count>1 then 1 else 0 end) as quality_count
  from identities
 ), scored as materialized (
  select *,case when quality_count=0 then 'ok' when quality_count=1 then 'yellow' else 'red' end as colour from checked
 -- These scopes only filter scored rows; inlining avoids copying the same identities into temporary stores.
 ), machine_scope as not materialized (
  select * from scored where p_machine_id is null or (category<>'machines' and links_valid and source->'machine_ids' @> to_jsonb(array[p_machine_id::text]))
 ), category_scope as not materialized (
  select * from machine_scope where p_category='all' or (p_category='review' and issue_count>0) or category=p_category
 ), matches as materialized (
  select * from category_scope where (p_colour='' or colour=p_colour)
   and strpos(lower(concat_ws(' ',name,sku,source->>'model',source->>'specification',source->>'company')),lower(btrim(p_query)))>0
 ), totals as (
  select count(*) as total,greatest(1,(count(*)+24)/25) as pages,least(p_page,greatest(0,(count(*)-1)/25)) as page from matches
 ), page_rows as (
  select *,row_number() over(order by case when p_sort='issues' then issue_count end desc,
   case when p_sort='company' then lower(coalesce(source->>'company','')) end,
   lower(coalesce(name,'')),id) as position
  from matches
  order by case when p_sort='issues' then issue_count end desc,
   case when p_sort='company' then lower(coalesce(source->>'company','')) end,lower(coalesce(name,'')),id
  limit 25 offset (select page*25 from totals)
 )
 select jsonb_build_object(
  'rows',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'sku',sku,'catalog_current',true,'catalog_classification',classification,'catalog_duplicate_count',duplicate_count,
   'source',case when p_product_id is not null then source else jsonb_build_object('company',source->'company','model',source->'model','specification',source->'specification','sale_status',source->'sale_status','batch_required',source->'batch_required','expiry_required',source->'expiry_required','machine_ids',source->'machine_ids','suggested_company',source->'suggested_company','company_note',source->'company_note') end || jsonb_build_object('category',category),
   'original',original,'review',review,'links',links) order by position) from page_rows),'[]'::jsonb),
  'total',totals.total,'page',totals.page,'pages',totals.pages,
  'metrics',(select jsonb_build_object('products',count(*),'review',count(*) filter(where issue_count>0),'active',count(*) filter(where source->>'sale_status'='active'),'manufacturers',count(distinct btrim(source->>'company')) filter(where btrim(coalesce(source->>'company',''))<>'')) from scored),
  'category_counts',(select coalesce(jsonb_object_agg(category,n),'{}'::jsonb) from (select category,count(*) n from machine_scope group by category) counts)
    || jsonb_build_object('all',(select count(*) from machine_scope),'review',(select count(*) from machine_scope where issue_count>0)),
  'colour_counts',(select coalesce(jsonb_object_agg(colour,n),'{}'::jsonb) from (select colour,count(*) n from category_scope group by colour) counts)
 ) into v_result from totals;
 return v_result;
end $$;
revoke all on function public.catalog_page(text,text,text,text,integer,uuid,uuid) from public,anon;
grant execute on function public.catalog_page(text,text,text,text,integer,uuid,uuid) to authenticated;
commit;
