begin;

create function public.purchasing_page(p_section text default 'orders',p_filter text default 'requested',p_query text default '',p_page integer default 0)
returns jsonb language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare v_result jsonb;v_query text;v_older text;v_today date;
begin
 if not public.inventory_active_staff() or not public.has_access('purchasing') then raise exception 'Purchasing access is required' using errcode='42501'; end if;
 if p_section is null or p_section not in ('orders','suppliers') then raise exception 'Choose a valid purchasing section'; end if;
 if p_filter is null or p_filter not in ('requested','approved','ordered','finished','all') then raise exception 'Choose a valid purchase filter'; end if;
 if p_query is null or length(p_query)>2000 then raise exception 'Search must be 2000 characters or fewer'; end if;
 if p_page is null or p_page<0 or p_page>1000000 then raise exception 'Choose a valid purchasing page'; end if;
 v_query:=lower(btrim(p_query));
 v_older:=lower(btrim(regexp_replace(p_query,'[^[:alnum:]./ -]',' ','g')));
 v_today:=(now() at time zone 'Africa/Dar_es_Salaam')::date;
 if p_section='suppliers' then
  with matches as materialized (
   select id,supplier_number,name,active,country,contact_name from public.suppliers
   where strpos(lower(concat_ws(' ',supplier_number,name,country,contact_name,phone,email,tin)),v_query)>0
  ), totals as (
   select count(*) as total,greatest(1,(count(*)+19)/20) as pages,least(p_page,greatest(0,(count(*)-1)/20)) as page from matches
  ), page_rows as (
   select * from matches order by active desc,lower(name),id limit 20 offset (select page*20 from totals)
  )
  select jsonb_build_object('section',p_section,'filter',p_filter,'query',p_query,'total',total,'page',page,'pages',pages,
   'counts',jsonb_build_object('all',(select count(*) from public.suppliers)),
   'rows',coalesce((select jsonb_agg(to_jsonb(p)||jsonb_build_object('register_summary',true,'kind','suppliers') order by active desc,lower(name),id) from page_rows p),'[]'::jsonb))
  into v_result from totals;
 else
  -- Keep the register's six-month finished window. A PO/LPO search also reaches older finished orders.
  with scoped as materialized (
   select o.id,o.po_number,o.status,o.expected_on,o.lpo_reference,o.created_at,case when v_query='' then '' else o.notes end as notes,
    coalesce(s.name,'') as supplier_name,o.status='ordered' and o.expected_on<v_today as overdue
   from public.purchase_orders o left join public.suppliers s on s.id=o.supplier_id
   where o.status in ('requested','approved','ordered') or o.updated_at>=now()-interval '183 days'
    or (length(v_older)>=3 and (strpos(lower(o.po_number),v_older)>0 or strpos(lower(o.lpo_reference),v_older)>0))
  ), matches as materialized (
   select o.id,o.po_number,o.status,o.expected_on,o.lpo_reference,o.created_at,o.supplier_name,coalesce(o.overdue,false) as overdue
   from scoped o
   where (p_filter='all' or (p_filter='finished' and o.status in ('closed','cancelled')) or o.status=p_filter)
    and (v_query='' or strpos(lower(concat_ws(' ',o.po_number,o.lpo_reference,o.notes,o.supplier_name,
     (select string_agg(coalesce(review.name,product.name,'Unknown product'),' ' order by l.line_number,l.id)
      from public.purchase_order_lines l left join public.products product on product.id=l.product_id
      left join lateral(select r.name from public.product_detail_reviews r where r.product_id=product.id order by r.version desc limit 1) review on true
      where l.purchase_order_id=o.id))),v_query)>0)
  ), totals as (
   select count(*) as total,greatest(1,(count(*)+19)/20) as pages,least(p_page,greatest(0,(count(*)-1)/20)) as page from matches
  ), page_rows as (
   select * from matches order by overdue desc,expected_on nulls last,created_at desc,id limit 20 offset (select page*20 from totals)
  )
  select jsonb_build_object('section',p_section,'filter',p_filter,'query',p_query,'total',total,'page',page,'pages',pages,
   'counts',jsonb_build_object('all',(select count(*) from scoped),'requested',(select count(*) from scoped where status='requested'),
    'approved',(select count(*) from scoped where status='approved'),'ordered',(select count(*) from scoped where status='ordered'),'overdue',(select count(*) from scoped where overdue)),
   'rows',coalesce((select jsonb_agg(to_jsonb(p)||jsonb_build_object('register_summary',true,'kind','orders') order by overdue desc,expected_on nulls last,created_at desc,id) from page_rows p),'[]'::jsonb))
  into v_result from totals;
 end if;
 return v_result;
end $$;
revoke all on function public.purchasing_page(text,text,text,integer) from public,anon;
grant execute on function public.purchasing_page(text,text,text,integer) to authenticated;
commit;
