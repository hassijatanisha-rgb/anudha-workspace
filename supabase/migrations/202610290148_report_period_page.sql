begin;

-- Each branch is a fixed caller-RLS query. Only period/page values are bound;
-- the shared outer query counts and totals the entire result before paging it.
create function public.report_period_page(p_kind text,p_since timestamptz,p_until timestamptz,p_now timestamptz,p_today date,p_page integer default 0)
returns jsonb language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare v_query text;v_keys text[];v_result jsonb;
begin
 if public.inventory_active_staff() is not true then raise exception 'Active staff access is required' using errcode='42501'; end if;
 if p_kind is null or p_kind not in('tasks','proformas','leads','purchasing','service','travel','movements','deliveries')
  or p_since is null or p_until is null or not isfinite(p_since) or not isfinite(p_until) or p_since>=p_until
  or p_now is null or not isfinite(p_now) or p_today is null or not isfinite(p_today)
  or p_page is null or p_page<0 or p_page>1000000 then raise exception 'Choose a valid report page' using errcode='22023'; end if;
 if p_kind='movements' and public.inventory_owner() is not true then raise exception 'Stock reports are for the owner only' using errcode='42501'; end if;
 if p_kind='tasks' then
  v_keys:=array['given','onTime','late','open','lateNow'];
  v_query:=$query$
   with source as (select *,row_number() over(order by due_at,id) first_row from public.team_tasks where due_at>=$1 and due_at<$2),
   grouped as (select assignee_user_id actor,count(*) given,
    count(*) filter(where status='done' and floor(extract(epoch from closed_at)*1000)<=floor(extract(epoch from due_at)*1000)) "onTime",
    count(*) filter(where status='done' and (closed_at is null or floor(extract(epoch from closed_at)*1000)>floor(extract(epoch from due_at)*1000))) late,
    count(*) filter(where status='open') open,count(*) filter(where status='open' and floor(extract(epoch from due_at)*1000)<floor(extract(epoch from $3)*1000)) "lateNow",min(first_row) first_row
    from source group by assignee_user_id)
   select actor,given,"onTime",late,open,"lateNow",row_number() over(order by "lateNow" desc,given desc,first_row) _order from grouped
  $query$;
 elsif p_kind='proformas' then
  v_keys:=array['made','accepted'];
  v_query:=$query$
   with source as (select *,row_number() over(order by created_at,id) first_row from public.sales_proformas where created_at>=$1 and created_at<$2 and deleted_at is null),
   grouped as (select coalesce(prepared_by::text,'') actor,coalesce(nullif(currency,''),'TZS') currency,count(*) made,coalesce(sum(total_minor),0) quoted,
    count(*) filter(where status='accepted') accepted,coalesce(sum(total_minor) filter(where status='accepted'),0) "acceptedValue",min(first_row) first_row from source group by prepared_by,coalesce(nullif(currency,''),'TZS'))
   select actor,currency,made,quoted,accepted,"acceptedValue",floor(accepted*100.0/made+0.5) rate,row_number() over(order by first_row) _order from grouped
  $query$;
 elsif p_kind='leads' then
  v_keys:=array['recorded','won','lost','open'];
  v_query:=$query$
   with source as (select *,row_number() over(order by created_at,id) first_row from public.sales_leads where created_at>=$1 and created_at<$2),
   grouped as (select coalesce(nullif(source,''),'other') source,count(*) recorded,count(*) filter(where stage='won') won,count(*) filter(where stage='lost') lost,
    count(*) filter(where stage is null or stage not in('won','lost')) open,min(first_row) first_row from source group by coalesce(nullif(source,''),'other'))
   select source,recorded,won,lost,open,case when won+lost>0 then floor(won*100.0/(won+lost)+0.5) else 0 end rate,row_number() over(order by recorded desc,first_row) _order from grouped
  $query$;
 elsif p_kind='purchasing' then
  v_keys:=array['requests','waiting','ordered','arrived','cancelled'];
  v_query:=$query$
   with source as (select *,row_number() over(order by created_at,id) first_row from public.purchase_orders where created_at>=$1 and created_at<$2),
   grouped as (select supplier_id,count(*) requests,count(*) filter(where status in('requested','approved')) waiting,count(*) filter(where status='ordered') ordered,
    count(*) filter(where status='closed') arrived,count(*) filter(where status='cancelled') cancelled,
    coalesce(sum(greatest(0,floor(extract(epoch from closed_at)*1000)-floor(extract(epoch from created_at)*1000))) filter(where status='closed'),0) "arrivalMs",min(first_row) first_row from source group by supplier_id)
   select coalesce(g.supplier_id::text,'') supplier_id,coalesce(s.name,'Supplier not chosen') supplier,g.requests,g.waiting,g.ordered,g.arrived,g.cancelled,g."arrivalMs",
    case when g.arrived>0 then g."arrivalMs"/g.arrived end "avgMs",row_number() over(order by g.requests desc,g.first_row) _order from grouped g left join public.suppliers s on s.id=g.supplier_id
  $query$;
 elsif p_kind='service' then
  v_keys:=array['installations','services','completed','open','late'];
  v_query:=$query$
   with source as (select *,row_number() over(order by created_at,id) first_row from public.service_cases where created_at>=$1 and created_at<$2),
   grouped as (select coalesce(assigned_user_id::text,'') actor,count(*) filter(where case_type='installation') installations,count(*) filter(where case_type<>'installation' or case_type is null) services,
    count(*) filter(where status='completed') completed,count(*) filter(where status not in('completed','cancelled')) open,
    count(*) filter(where status not in('completed','cancelled') and scheduled_for<$4) late,
    coalesce(sum(greatest(0,floor(extract(epoch from completed_at)*1000)-floor(extract(epoch from created_at)*1000))) filter(where status='completed'),0) "doneMs",min(first_row) first_row from source group by assigned_user_id)
   select actor,installations,services,completed,open,late,"doneMs",case when completed>0 then "doneMs"/completed end "avgMs",row_number() over(order by first_row) _order from grouped
  $query$;
 elsif p_kind='travel' then
  v_keys:=array['trips','days','places'];
  v_query:=$query$
   with source as (select *,row_number() over(order by depart_at,id) first_row from public.travel_requests where depart_at>=$1 and depart_at<$2 and status in('approved','done')),
   people as (select t.*,person.actor,person.position from source t cross join lateral unnest(t.travellers) with ordinality person(actor,position)),
   grouped as (select actor,count(*) trips,sum(greatest(0,floor(extract(epoch from return_at)*1000)-floor(extract(epoch from depart_at)*1000))) ms,min(first_row*100+position) first_row from people group by actor),
   places as (select actor,count(distinct coalesce(to_jsonb(nullif(stop.value->>'organization_id','')),stop.value->'destination','{"missing":true}'::jsonb)) places
    from people cross join lateral jsonb_array_elements(case when jsonb_array_length(coalesce(itinerary,'[]'::jsonb))>0 then itinerary else jsonb_build_array(jsonb_build_object('organization_id',organization_id,'destination',destination)) end) stop(value) group by actor),
   encoded as (select g.*,('x'||encode(float8send(ms::float8/86400000),'hex'))::bit(64)::bigint bits from grouped g),
   float_parts as (select *,((bits>>52)&2047)::integer-1075 exponent,((bits&4503599627370495)::numeric+4503599627370496)*10 numerator from encoded),
   -- JS toFixed(1) rounds the exact binary float, including 1.15 -> 1.1.
   rounded as (select *,case when ms=0 then 0 when exponent>=0 then numerator*power(2::numeric,exponent)/10
    else div(numerator*2+power(2::numeric,-exponent),power(2::numeric,-exponent)*2)/10 end days from float_parts)
   select g.actor,g.trips,g.ms,g.days,p.places,row_number() over(order by g.days desc,g.first_row) _order from rounded g join places p on p.actor=g.actor
  $query$;
 elsif p_kind='movements' then
  v_keys:=array['count','pieces_in','pieces_out','net'];
  v_query:=$query$
   with grouped as (select l.product_id,l.location_id,m.movement_type,count(*) count,
    coalesce(sum(m.base_unit_change) filter(where m.base_unit_change>=0),0) pieces_in,-coalesce(sum(m.base_unit_change) filter(where m.base_unit_change<0),0) pieces_out
    from public.inventory_movements m left join public.inventory_lots l on l.id=m.lot_id where m.created_at>=$1 and m.created_at<$2 group by l.product_id,l.location_id,m.movement_type),
   named as (select g.*,coalesce(r.name,nullif(p.name,''),'Unknown product') product,coalesce(nullif(l.name,''),'Unknown location') location from grouped g
    left join public.products p on p.id=g.product_id
    left join lateral(select name from public.product_detail_reviews where product_id=p.id order by version desc limit 1) r on true
    left join public.inventory_locations l on l.id=g.location_id)
   select coalesce(product_id::text,'') product_id,coalesce(location_id::text,'') location_id,movement_type,product,location,count,pieces_in,pieces_out,pieces_in-pieces_out net,
    row_number() over(order by product,movement_type,product_id,location_id) _order from named
  $query$;
 else
  v_keys:=array['days'];
  v_query:=$query$
   with durations as (select n.id,n.delivery_number delivery,coalesce(p.document_number,'') proforma,coalesce(o.name,'') client,n.delivered_at,
    greatest(0,floor(extract(epoch from n.delivered_at)*1000)-floor(extract(epoch from coalesce(p.accepted_at,n.created_at))*1000)) ms
    from public.sales_delivery_notes n left join public.sales_proformas p on p.id=n.proforma_id left join public.organizations o on o.id=n.organization_id and o.deleted_at is null
    where n.delivered_at>=$1 and n.delivered_at<$2 and n.status='delivered'),
   encoded as (select *,('x'||encode(float8send(ms::float8/86400000),'hex'))::bit(64)::bigint bits from durations),
   float_parts as (select *,((bits>>52)&2047)::integer-1075 exponent,((bits&4503599627370495)::numeric+4503599627370496)*10 numerator from encoded),
   rounded as (select *,case when ms=0 then 0 when exponent>=0 then numerator*power(2::numeric,exponent)/10
    else div(numerator*2+power(2::numeric,-exponent),power(2::numeric,-exponent)*2)/10 end days from float_parts)
   select id,delivery,proforma,client,delivered_at,ms,days,row_number() over(order by ms desc,delivered_at,id) _order from rounded
  $query$;
 end if;
 execute 'with rows as materialized ('||v_query||'), totals as (
  select count(*) total,greatest(1,(count(*)+49)/50) pages,least($5,greatest(0,(count(*)-1)/50)) page from rows
 ), page_rows as (select * from rows order by _order limit 50 offset(select page*50 from totals))
 select jsonb_build_object(''kind'',$6,''total'',t.total,''pages'',t.pages,''page'',t.page,
  ''totals'',(select jsonb_object_agg(key,(select coalesce(sum((to_jsonb(r)->>key)::numeric),0) from rows r)) from unnest($7::text[]) key),
  ''rows'',coalesce((select jsonb_agg(to_jsonb(p)-''_order'' order by p._order) from page_rows p),''[]''::jsonb)) from totals t'
 into v_result using p_since,p_until,p_now,p_today,p_page,p_kind,v_keys;
 return v_result;
end $$;
revoke all on function public.report_period_page(text,timestamptz,timestamptz,timestamptz,date,integer) from public,anon;
grant execute on function public.report_period_page(text,timestamptz,timestamptz,timestamptz,date,integer) to authenticated;
commit;
