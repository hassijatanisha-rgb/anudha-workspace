begin;

create function public.pending_stock_page(p_query text default '',p_filter text default 'waiting',p_page integer default 0,p_salesperson_ids uuid[] default '{}'::uuid[])
returns jsonb language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare v_result jsonb;v_available jsonb;v_stock_error boolean:=false;v_today date:=(now() at time zone 'Africa/Dar_es_Salaam')::date;
 v_space constant text:=U&'\0009\000a\000b\000c\000d\0020\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff';
begin
 -- Pending requests remain available to all active staff; inventory and joins retain caller RLS.
 if public.inventory_active_staff() is not true then raise exception 'Active staff access is required' using errcode='42501'; end if;
 if p_query is null or length(p_query)>2000 then raise exception 'Search must be 2000 characters or fewer'; end if;
 if p_filter is null or p_filter not in ('waiting','arrived','mine','due','closed','all') then raise exception 'Choose a valid pending order filter'; end if;
 if p_page is null or p_page<0 or p_page>1000000 then raise exception 'Choose a valid pending order page'; end if;
 if p_salesperson_ids is null or cardinality(p_salesperson_ids)>10000 then raise exception 'Search may match at most 10000 salesperson IDs'; end if;
 -- Stock is advisory. Preserve the request list if its independent stock check fails.
 begin
  select coalesce(jsonb_object_agg(product_id,available),'{}'::jsonb) into v_available from (
   select l.product_id,sum(l.sealed_cartons::numeric*p.units_per_carton+l.loose_units-l.reserved_units) as available
   from public.inventory_lots l join public.product_pack_definitions p on p.id=l.pack_definition_id
   join public.inventory_locations g on g.id=l.location_id and g.active
   where l.stock_status='available' and (l.expiry_date is null or (l.expiry_date>v_today and l.expiry_date<=date '9999-12-31'))
    and p.units_per_carton>=0 and l.sealed_cartons>=0 and l.loose_units>=0 and l.reserved_units between 0 and l.loose_units
    and exists(select 1 from public.pending_stock_requests r where r.product_id=l.product_id)
   group by l.product_id
  ) available;
 exception when others then v_stock_error:=true;v_available:=null;
 end;
 with identities as materialized (
  select r.*,coalesce(case when review.id is null then p.name else review.name end,'Unknown product') as product_name,
   case when o.id is null then 'Client unavailable' else o.name||case when coalesce(o.location,'')<>'' then ' · '||o.location else '' end end as client_label,
   case when v_stock_error then null else coalesce((v_available->>r.product_id::text)::numeric,0) end as available_units
  from public.pending_stock_requests r
  left join public.organizations o on o.id=r.organization_id and o.deleted_at is null
  left join public.products p on p.id=r.product_id and p.deleted_at is null
  left join lateral (select d.id,d.name from public.product_detail_reviews d where d.product_id=p.id order by d.version desc limit 1) review on true
 ), states as materialized (
  select *,case when status<>'waiting' then 'closed' when expires_on<v_today then 'due' when available_units is null then 'unknown'
   when available_units>=quantity then 'arrived' when available_units>0 then 'partial' else 'waiting' end as state_key from identities
 ), matches as materialized (
  select * from states where (p_filter='all' or (p_filter='closed' and status<>'waiting') or (status='waiting' and
   (p_filter='waiting' or (p_filter='arrived' and state_key in ('arrived','partial')) or (p_filter='mine' and salesperson_user_id=auth.uid()) or (p_filter='due' and expires_on<=v_today+14))))
   and (strpos(lower(concat_ws(' ',request_number,notes,close_note,client_label,product_name)),lower(btrim(p_query,v_space)))>0 or salesperson_user_id=any(p_salesperson_ids))
 ), totals as (
  select count(*) as total,greatest(1,(count(*)+49)/50) as pages,least(p_page,greatest(0,(count(*)-1)/50)) as page from matches
 ), page_rows as materialized (
  select *,case state_key when 'due' then 0 when 'arrived' then 1 when 'partial' then 2 when 'waiting' then 3 when 'unknown' then 4 else 5 end as state_rank
  from matches order by state_rank,expires_on,id limit 50 offset (select page*50 from totals)
 )
 select jsonb_build_object('rows',coalesce((select jsonb_agg(jsonb_build_object(
  'id',r.id,'request_number',r.request_number,'product_id',r.product_id,'quantity',r.quantity,'status',r.status,
  'expires_on',r.expires_on,'closed_at',r.closed_at,'proforma_line_id',r.proforma_line_id,
  'client_label',r.client_label,'product_name',r.product_name,'available_units',r.available_units,'state_key',r.state_key,'page_summary',true
 ) order by r.state_rank,r.expires_on,r.id) from page_rows r),'[]'::jsonb),
  'total',totals.total,'page',totals.page,'pages',totals.pages,'as_of',v_today,'availability_error',v_stock_error,
  'counts',(select jsonb_build_object('all',count(*),'waiting',count(*) filter(where status='waiting'),'arrived',count(*) filter(where status='waiting' and state_key in ('arrived','partial')),
   'mine',count(*) filter(where status='waiting' and salesperson_user_id=auth.uid()),'due',count(*) filter(where status='waiting' and expires_on<=v_today+14),'closed',count(*) filter(where status<>'waiting')) from states),
  'mine_arrived',(select count(*) from states where status='waiting' and state_key in ('arrived','partial') and salesperson_user_id=auth.uid())
 ) into v_result from totals;
 return v_result;
end $$;
revoke all on function public.pending_stock_page(text,text,integer,uuid[]) from public,anon;
grant execute on function public.pending_stock_page(text,text,integer,uuid[]) to authenticated;
commit;
