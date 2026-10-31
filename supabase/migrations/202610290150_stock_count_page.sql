begin;

-- Physical count reads stay separate from ERP stock. All aggregates use caller-visible rows.
create function public.stock_count_page(
 p_tab text default 'count', p_session_id uuid default null, p_godown text default '',
 p_status text default 'recorded', p_page integer default 0, p_session_page integer default 0
) returns jsonb language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare v_open public.stock_count_sessions; v_session public.stock_count_sessions; v_result jsonb;
begin
 if not public.inventory_active_staff() or not public.has_access('stock_count') then raise exception 'Stock count access is required for active staff' using errcode='42501'; end if;
 if p_tab is null or p_tab not in ('count','review') or p_status is null or p_status not in ('recorded','accepted','rejected','void','all') then raise exception 'Choose a valid count view'; end if;
 if p_page is null or p_page<0 or p_page>1000000 or p_session_page is null or p_session_page<0 or p_session_page>1000000 then raise exception 'Choose a valid count page'; end if;
 if p_godown is null or length(p_godown)>200 then raise exception 'Choose a valid godown'; end if;
 select * into v_open from public.stock_count_sessions where status='open' order by opened_at desc,id limit 1;
 if p_tab='count' then v_session:=v_open;
 elsif p_session_id is not null then
  select * into v_session from public.stock_count_sessions where id=p_session_id;
  if not found then raise exception 'Count session is unavailable. Refresh the session list'; end if;
 elsif v_open.id is not null then v_session:=v_open;
 else select * into v_session from public.stock_count_sessions order by opened_at desc,id limit 1;
 end if;
 with scope as materialized (
  select * from public.stock_count_entries where session_id=v_session.id
 ), matching as materialized (
  select * from scope where (p_godown='' or godown=p_godown) and (p_tab='count' or p_status='all' or status=p_status)
   and (p_tab='review' or p_godown<>'')
 ), counts as (
  select count(*) as total,greatest(1,(count(*)+49)/50) as pages,least(p_page,greatest(0,(count(*)-1)/50)) as page from matching
 ), page_rows as (
  select * from matching order by counted_at desc,id limit 50 offset (select page*50 from counts)
 ), session_counts as (
  select count(*) as total,greatest(1,(count(*)+24)/25) as pages,least(p_session_page,greatest(0,(count(*)-1)/25)) as page from public.stock_count_sessions
 ), session_rows as (
  select * from public.stock_count_sessions order by opened_at desc,id limit 25 offset (select page*25 from session_counts)
 )
 select jsonb_build_object(
  'catalogue_total',(select count(*) from public.count_catalogue),'open_session',case when v_open.id is null then null else to_jsonb(v_open) end,
  'session',case when v_session.id is null then null else to_jsonb(v_session) end,
  'sessions',(select jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(s) order by opened_at desc,id) from session_rows s),'[]'::jsonb),'total',total,'page',page,'pages',pages) from session_counts),
  'entries',jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(e)||jsonb_build_object('catalogue',case when c.code is null then null else jsonb_build_object('code',c.code,'product',c.product,'company',c.company,'specification',c.specification,'category',c.category) end) order by e.counted_at desc,e.id) from page_rows e left join public.count_catalogue c on c.code=e.code),'[]'::jsonb),'total',counts.total,'page',counts.page,'pages',counts.pages),
  'stats',(select jsonb_build_object('all',count(*),'recorded',count(*) filter(where status='recorded'),'accepted',count(*) filter(where status='accepted'),'rejected',count(*) filter(where status='rejected'),'void',count(*) filter(where status='void'),
   'accepted_lines',count(distinct concat_ws('|',coalesce(code,'unlisted:'||unlisted),godown,unit,condition,batch,coalesce(expiry::text,''))) filter(where status='accepted'),
   'godowns',coalesce((select jsonb_agg(jsonb_build_object('godown',g.godown,'total',g.total) order by g.godown) from (select godown,count(*) as total from scope where status not in ('void','rejected') group by godown) g),'[]'::jsonb)) from scope)
 ) into v_result from counts;
 return v_result;
end $$;

create function public.stock_count_catalogue_page(p_query text)
returns jsonb language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare v_query text; v_words text[]; v_rows jsonb;
 -- ECMAScript trim / \s characters, including non-breaking spaces and BOM from pasted names.
 v_space constant text:=chr(9)||chr(10)||chr(11)||chr(12)||chr(13)||chr(32)||chr(160)||chr(5760)||chr(8192)||chr(8193)||chr(8194)||chr(8195)||chr(8196)||chr(8197)||chr(8198)||chr(8199)||chr(8200)||chr(8201)||chr(8202)||chr(8232)||chr(8233)||chr(8239)||chr(8287)||chr(12288)||chr(65279);
begin
 if not public.inventory_active_staff() or not public.has_access('stock_count') then raise exception 'Stock count access is required for active staff' using errcode='42501'; end if;
 if p_query is null or length(p_query)>2000 then raise exception 'Search must be 2000 characters or fewer'; end if;
 v_query:=lower(btrim(p_query,v_space));if v_query='' then return '[]'::jsonb;end if;
 v_words:=regexp_split_to_array(v_query,'['||v_space||']+');
 select coalesce(jsonb_agg(jsonb_build_object('code',code,'product',product,'company',company,'specification',specification,'category',category) order by rank,name_length,code),'[]'::jsonb) into v_rows from (
  select c.*,case when lower(code)=v_query then 0 when left(lower(product),length(v_query))=v_query then 1 when strpos(lower(product),v_query)>0 then 2 else 3 end as rank,
   (select sum(case when ascii(ch)>65535 then 2 else 1 end) from unnest(string_to_array(product,null)) ch) as name_length
  from public.count_catalogue c where not exists(select 1 from unnest(v_words) word where strpos(lower(concat_ws(' ',code,product,company,specification,search_text)),word)=0)
  order by rank,name_length,code limit 25
 ) matches;
 return v_rows;
end $$;
revoke all on function public.stock_count_page(text,uuid,text,text,integer,integer),public.stock_count_catalogue_page(text) from public,anon;
grant execute on function public.stock_count_page(text,uuid,text,text,integer,integer),public.stock_count_catalogue_page(text) to authenticated;
commit;
