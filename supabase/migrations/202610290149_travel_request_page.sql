begin;

create function public.travel_request_page(p_filter text default 'upcoming',p_page integer default 0,p_now timestamptz default now())
returns jsonb language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare v_result jsonb;
begin
 if public.inventory_active_staff() is not true or public.has_access('travel') is not true then raise exception 'Travel access is required for active staff' using errcode='42501'; end if;
 if p_filter is null or p_filter not in ('upcoming','waiting','mine','past') then raise exception 'Choose a valid travel filter'; end if;
 if p_page is null or p_page<0 or p_page>1000000 then raise exception 'Choose a valid travel page'; end if;
 if p_now is null or not isfinite(p_now) then raise exception 'A valid browser time is required'; end if;
 with visible as materialized (
  select id,request_number,status,depart_at,return_at,travellers,purpose,purposes,organization_id,destination,
   jsonb_array_length(itinerary) as stop_count,
   case when jsonb_array_length(itinerary)>0 then itinerary->0->>'organization_id' else organization_id::text end as first_organization,
   case when jsonb_array_length(itinerary)>0 then itinerary->0->>'destination' else destination end as first_destination,
   status in ('requested','approved') and isfinite(return_at) and return_at>=p_now as upcoming,
   status='requested' as waiting,created_by=auth.uid() or auth.uid()=any(travellers) as mine,
   status in ('done','declined','cancelled') or (status='approved' and isfinite(return_at) and return_at<p_now) as past
  from public.travel_requests
 ), matches as materialized (
  select * from visible where case p_filter when 'upcoming' then upcoming when 'waiting' then waiting when 'mine' then mine else past end
 ), counts as (
  select count(*) as total,greatest(1,(count(*)+24)/25) as pages,least(p_page,greatest(0,(count(*)-1)/25)) as page from matches
 ), page_rows as (
  select * from matches order by case when p_filter='past' then depart_at end desc,case when p_filter<>'past' then depart_at end,id
  limit 25 offset (select page*25 from counts)
 ), summaries as (
  select p.id,p.request_number,p.status,p.depart_at,p.return_at,p.purpose,p.purposes,p.travellers[1:2] as traveller_ids,cardinality(p.travellers) as traveller_count,p.stop_count,
   case when o.id is null then coalesce(p.first_destination,'') else o.name||case when coalesce(o.location,'')<>'' then ' · '||o.location else '' end end as first_place
  from page_rows p left join public.organizations o on o.id::text=p.first_organization and o.deleted_at is null
 )
 select jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(s) order by case when p_filter='past' then depart_at end desc,case when p_filter<>'past' then depart_at end,id) from summaries s),'[]'::jsonb),
  'filter',p_filter,'total',counts.total,'page',counts.page,'pages',counts.pages,'as_of',p_now,
  'counts',(select jsonb_build_object('upcoming',count(*) filter(where upcoming),'waiting',count(*) filter(where waiting),'mine',count(*) filter(where mine),'past',count(*) filter(where past)) from visible)) into v_result from counts;
 return v_result;
end $$;
revoke all on function public.travel_request_page(text,integer,timestamptz) from public,anon;
grant execute on function public.travel_request_page(text,integer,timestamptz) to authenticated;
commit;
