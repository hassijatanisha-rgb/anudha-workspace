begin;

-- Current product prices are a separate bounded read; quote pricing keeps its complete cache.
create function public.product_price_page(
 p_query text default '', p_currency text default '', p_status text default 'configured',
 p_page integer default 0, p_product_id uuid default null
) returns jsonb language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare v_result jsonb; v_edit boolean := public.inventory_owner() is true or public.accounting_access() is true;
 v_space constant text:=U&'\0009\000a\000b\000c\000d\0020\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff';
begin
 if public.inventory_active_staff() is not true or (v_edit or public.has_access('proformas')) is not true then raise exception 'Product price access is required for active staff' using errcode='42501'; end if;
 if p_query is null or length(p_query)>2000 then raise exception 'Search must be 2000 characters or fewer'; end if;
 if p_currency is null or p_currency not in ('','TZS','USD','EUR') then raise exception 'Choose TZS, USD or EUR'; end if;
 if p_status is null or p_status not in ('all','configured','missing') then raise exception 'Choose a valid price status'; end if;
 if p_page is null or p_page<0 or p_page>1000000 then raise exception 'Choose a valid product price page'; end if;
 with identities as materialized (
  select p.id,p.sku,case when r.id is null then p.name else r.name end as name,
   case when r.id is null then p.source->>'company' else r.company end as company,
   case when r.id is null then coalesce(nullif(p.source->>'specification',''),p.source->>'model') else r.specification end as specification
  from public.products p left join lateral (
   select id,name,company,specification from public.product_detail_reviews where product_id=p.id order by version desc limit 1
  ) r on true where p.deleted_at is null and (p_product_id is null or p.id=p_product_id)
 ), current_prices as materialized (
  select product_id,jsonb_agg(jsonb_build_object('product_id',product_id,'currency',currency,'unit_price_minor',unit_price_minor,
   'version',version,'updated_by',updated_by,'updated_at',updated_at) order by currency) as prices,string_agg(currency,' ' order by currency) as currencies
  from public.product_sale_prices where (p_currency='' or currency=p_currency) and product_id in(select id from identities) group by product_id
 ), scope as materialized (
  select p.*,coalesce(pr.prices,'[]'::jsonb) as prices,pr.currencies from identities p left join current_prices pr on pr.product_id=p.id
 ), matches as materialized (
  select * from scope where (p_status='all' or (p_status='configured' and jsonb_array_length(prices)>0) or (p_status='missing' and jsonb_array_length(prices)=0))
   and strpos(lower(concat_ws(' ',name,sku,company,specification,currencies)),lower(btrim(p_query,v_space)))>0
 ), counts as (
  select count(*) as total,greatest(1,(count(*)+24)/25) as pages,least(p_page,greatest(0,(count(*)-1)/25)) as page from matches
 ), page_rows as (
  select * from matches order by lower(coalesce(name,'')),id limit 25 offset (select page*25 from counts)
 )
 select jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(r)-'currencies' order by lower(coalesce(r.name,'')),r.id) from page_rows r),'[]'::jsonb),
  'total',counts.total,'page',counts.page,'pages',counts.pages,'can_edit',v_edit,
  'totals',(select jsonb_build_object('products',count(*),'configured',count(*) filter(where jsonb_array_length(prices)>0),'missing',count(*) filter(where jsonb_array_length(prices)=0)) from scope))
 into v_result from counts;
 if exists(select 1 from jsonb_each_text(v_result->'totals') where value::numeric>9007199254740991) then raise exception 'Product price totals exceed the supported range'; end if;
 return v_result;
end $$;
revoke all on function public.product_price_page(text,text,text,integer,uuid) from public,anon;
grant execute on function public.product_price_page(text,text,text,integer,uuid) to authenticated;
commit;
