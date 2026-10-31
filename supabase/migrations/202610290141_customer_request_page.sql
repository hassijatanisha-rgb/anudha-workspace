begin;

create function public.customer_request_page(p_section text default 'inquiries',p_filter text default 'open',p_query text default '',p_page integer default 0)
returns jsonb language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare v_result jsonb;
 -- Match String.trim() in the existing request search.
 v_space constant text:=U&'\0009\000a\000b\000c\000d\0020\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff';
begin
 if public.inventory_active_staff() is not true or (public.has_access('leads') or public.has_access('service')) is not true then
  raise exception 'Customer request access is required' using errcode='42501';
 end if;
 if p_section is null or p_section not in ('inquiries','complaints') then raise exception 'Choose a valid request section'; end if;
 if p_filter is null or p_filter not in ('open','new','mine','done','all') then raise exception 'Choose a valid request filter'; end if;
 if p_query is null or length(p_query)>2000 then raise exception 'Search must be 2000 characters or fewer'; end if;
 if p_page is null or p_page<0 or p_page>1000000 then raise exception 'Choose a valid request page'; end if;
 with scope as materialized (
  select r.* from public.customer_requests r
  where (case when p_section='inquiries' then r.kind in ('inquiry','quote') else r.kind in ('complaint','support') end)
   and (r.status in ('received','in_progress') or r.updated_at>=now()-interval '183 days')
 ), matches as materialized (
  select * from scope where
   (case p_filter when 'open' then status in ('received','in_progress') when 'new' then status='received'
    when 'mine' then status in ('received','in_progress') and assigned_user_id=auth.uid()
    when 'done' then status in ('resolved','closed') else true end)
   and strpos(lower(concat_ws(' ',request_number,name,phone,email,organization,product,message)),lower(btrim(p_query,v_space)))>0
 ), totals as (
  select count(*) as total,greatest(1,(count(*)+24)/25) as pages,least(p_page,greatest(0,(count(*)-1)/25)) as page from matches
 ), page_rows as (
  select id,request_number,kind,status,name,organization,created_at from matches
  order by (status='received') desc,created_at desc,id limit 25 offset (select page*25 from totals)
 )
 select jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(r) order by (status='received') desc,created_at desc,id) from page_rows r),'[]'::jsonb),
  'total',totals.total,'page',totals.page,'pages',totals.pages,
  'counts',(select jsonb_build_object('all',count(*),'open',count(*) filter(where status in ('received','in_progress')),
   'new',count(*) filter(where status='received'),'mine',count(*) filter(where status in ('received','in_progress') and assigned_user_id=auth.uid()),
   'done',count(*) filter(where status in ('resolved','closed'))) from scope))
 into v_result from totals;
 return v_result;
end $$;
revoke all on function public.customer_request_page(text,text,text,integer) from public,anon;
grant execute on function public.customer_request_page(text,text,text,integer) to authenticated;
commit;
