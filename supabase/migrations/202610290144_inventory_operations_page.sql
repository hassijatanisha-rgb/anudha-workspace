begin;

-- Landing pages read only caller-visible summaries. Transaction prerequisites stay on demand.
create function public.inventory_operations_page(
 p_section text, p_query text default '', p_status text default '', p_page integer default 0
) returns jsonb language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare v_result jsonb;
begin
 if not public.inventory_active_staff() or not public.has_access('stock') then raise exception 'Stock access is required for active staff' using errcode='42501'; end if;
 if p_section is null or p_section not in ('locations','transfers') then raise exception 'Choose locations or transfers'; end if;
 if p_page is null or p_page<0 or p_page>1000000 then raise exception 'Choose a valid inventory page'; end if;
 if p_query is null or length(p_query)>2000 then raise exception 'Search must be 2000 characters or fewer'; end if;
 if p_status is null or (p_section='locations' and p_status not in ('','active','inactive','godown','dispatch_hub'))
  or (p_section='transfers' and p_status not in ('','requested','in_transit','received','quarantine','cancelled')) then raise exception 'Choose a valid inventory status'; end if;
 if p_section='locations' then
  with scope as materialized (
   select id,name,code,active,is_dispatch_hub from public.inventory_locations
  ), matches as materialized (
   select * from scope where (p_status='' or (p_status='active' and active) or (p_status='inactive' and not active)
    or (p_status='dispatch_hub' and is_dispatch_hub) or (p_status='godown' and not is_dispatch_hub))
    and strpos(lower(concat_ws(' ',name,code)),lower(btrim(p_query)))>0
  ), counts as (
   select count(*) as total,greatest(1,(count(*)+49)/50) as pages,least(p_page,greatest(0,(count(*)-1)/50)) as page from matches
  ), page_rows as (
   select * from matches order by name,id limit 50 offset (select page*50 from counts)
  )
  select jsonb_build_object('section',p_section,'rows',coalesce((select jsonb_agg(to_jsonb(r) order by r.name,r.id) from page_rows r),'[]'::jsonb),
   'total',counts.total,'page',counts.page,'pages',counts.pages,
   'totals',(select jsonb_build_object('all',count(*),'active',count(*) filter(where active),'dispatch_hub',count(*) filter(where is_dispatch_hub)) from scope))
  into v_result from counts;
 else
  with scope as materialized (
   select id,product_id,from_location_id,to_location_id,pack_definition_id,cartons,expected_units,expected_at,status,created_at from public.inventory_transfers
  ), identities as materialized (
   select p.id,p.sku,case when r.id is null then p.name else r.name end as name,
    case when r.id is null then p.source->>'company' else r.company end as company,
    case when r.id is null then coalesce(nullif(p.source->>'specification',''),p.source->>'model') else r.specification end as specification
   from public.products p left join lateral (
    select id,name,company,specification from public.product_detail_reviews where product_id=p.id order by version desc limit 1
   ) r on true where p.id in (select product_id from scope)
  ), matches as materialized (
   select t.*,p.name as product_name,p.sku,p.company,p.specification,f.name as from_name,d.name as to_name,pack.base_unit
   from scope t left join identities p on p.id=t.product_id
    left join public.inventory_locations f on f.id=t.from_location_id left join public.inventory_locations d on d.id=t.to_location_id
    left join public.product_pack_definitions pack on pack.id=t.pack_definition_id
   where (p_status='' or t.status=p_status)
    and strpos(lower(concat_ws(' ',coalesce(p.name,'Unknown product'),p.sku,p.company,p.specification,coalesce(f.name,'Unknown godown'),f.code,coalesce(d.name,'Unknown godown'),d.code,t.expected_at)),lower(btrim(p_query)))>0
  ), counts as (
   select count(*) as total,greatest(1,(count(*)+24)/25) as pages,least(p_page,greatest(0,(count(*)-1)/25)) as page from matches
  ), page_rows as (
   select * from matches order by created_at desc,id limit 25 offset (select page*25 from counts)
  )
  select jsonb_build_object('section',p_section,'rows',coalesce((select jsonb_agg(to_jsonb(r) order by r.created_at desc,r.id) from page_rows r),'[]'::jsonb),
   'total',counts.total,'page',counts.page,'pages',counts.pages,
   'totals',(select jsonb_build_object('all',count(*),'requested',count(*) filter(where status='requested'),'in_transit',count(*) filter(where status='in_transit'),
    'received',count(*) filter(where status='received'),'quarantine',count(*) filter(where status='quarantine'),'cancelled',count(*) filter(where status='cancelled')) from scope))
  into v_result from counts;
 end if;
 if exists(select 1 from jsonb_each_text(v_result->'totals') where value::numeric>9007199254740991) then raise exception 'Inventory totals exceed the supported range'; end if;
 return v_result;
end $$;
revoke all on function public.inventory_operations_page(text,text,text,integer) from public,anon;
grant execute on function public.inventory_operations_page(text,text,text,integer) to authenticated;
commit;
