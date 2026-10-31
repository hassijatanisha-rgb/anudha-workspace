begin;

create function public.sales_proforma_page(p_query text default '',p_filter text default 'all',p_page integer default 0)
returns jsonb language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare v_result jsonb;
begin
 if not public.inventory_active_staff() or not (public.has_access('proformas') or public.has_access('deliveries')) then
  raise exception 'Pro forma access is required' using errcode='42501';
 end if;
 if p_query is null or length(p_query)>2000 then raise exception 'Search must be 2000 characters or fewer'; end if;
 if p_filter is null or p_filter not in ('all','mine','placement','draft','revised','sent','waiting','delivery','partial','done','closed') then raise exception 'Choose a valid Pro forma filter'; end if;
 if p_page is null or p_page<0 or p_page>1000000 then raise exception 'Choose a valid Pro forma page'; end if;
 with identities as materialized (
  select p.id,p.document_number,p.status,p.revision,p.currency,p.total_minor,p.prepared_by,p.created_at,p.updated_at,p.acceptance_reference,p.commercial_kind,
   coalesce(o.name,'Client unavailable') as organization_name,coalesce(o.location,'') as organization_location,
   case when c.id is null then 'Contact unavailable' else concat_ws(' ',case when c.title<>'N/A' then nullif(c.title,'') end,nullif(c.first_name,''),nullif(c.last_name,'')) end as contact_name,
   p.prepared_by=auth.uid() and exists(select 1 from unnest(array[p.created_at,p.accepted_at,p.updated_at]) t where (t at time zone 'Africa/Dar_es_Salaam')::date=(now() at time zone 'Africa/Dar_es_Salaam')::date) as mine_today,
   case when p.status in ('cancelled','rejected') then 'closed'
    when p.status='draft' then case when p.revision>1 then 'revised' else 'draft' end
    when p.status='sent' then 'sent'
    when latest.status is null or latest.status='draft' then 'waiting'
    when quantities.complete then 'done' when quantities.partial then 'partial' else 'delivery' end as register_tag
  from public.sales_proformas p
  left join public.organizations o on o.id=p.organization_id and o.deleted_at is null
  left join public.contacts c on c.id=p.contact_id and c.deleted_at is null
  left join lateral (select n.status from public.sales_delivery_notes n where n.proforma_id=p.id and n.status<>'cancelled' order by n.created_at desc,n.id limit 1) latest on true
  left join lateral (
   select count(*)>0 and bool_and(coalesce(delivered.quantity,0)>=l.quantity) as complete,bool_or(coalesce(delivered.quantity,0)>0) as partial
   from public.sales_proforma_lines l
   left join lateral (select sum(dl.quantity) as quantity from public.sales_delivery_lines dl join public.sales_delivery_notes n on n.id=dl.delivery_note_id
    where dl.proforma_line_id=l.id and n.proforma_id=p.id and n.status='delivered') delivered on true
   where l.proforma_id=p.id
  ) quantities on p.status='accepted' and latest.status is not null
  where p.deleted_at is null
 ), matches as materialized (
  select * from identities where (p_filter='all' or (p_filter='mine' and mine_today) or (p_filter='placement' and commercial_kind='placement') or register_tag=p_filter)
   and strpos(lower(concat_ws(' ',document_number,organization_name,organization_location,contact_name,coalesce(acceptance_reference,''))),lower(btrim(p_query)))>0
 ), totals as (
  select count(*) as total,greatest(1,(count(*)+49)/50) as pages,least(p_page,greatest(0,(count(*)-1)/50)) as page from matches
 ), page_rows as materialized (
  select * from matches order by created_at desc,id limit 50 offset (select page*50 from totals)
 )
 select jsonb_build_object(
  'rows',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'document_number',p.document_number,'status',p.status,'revision',p.revision,'currency',p.currency,'total_minor',p.total_minor,'prepared_by',p.prepared_by,'created_at',p.created_at,'updated_at',p.updated_at,
   'register_summary',true,'register_tag',p.register_tag,'organization',jsonb_build_object('name',p.organization_name,'location',p.organization_location),'contact_name',p.contact_name,
   'items_summary',coalesce(items.preview,'')||case when items.total>3 then ' · +'||(items.total-3)::text||' more' else '' end) order by p.created_at desc,p.id)
   from page_rows p left join lateral (
    select count(*) as total,string_agg(quantity::text||' × '||product_name,' · ' order by sort_order,id) filter(where position<=3) as preview
    from (select l.id,l.sort_order,l.quantity,coalesce(product.name,'Product unavailable') as product_name,row_number() over(order by l.sort_order,l.id) as position
     from public.sales_proforma_lines l left join public.products product on product.id=l.product_id where l.proforma_id=p.id) lines
   ) items on true),'[]'::jsonb),
  'total',totals.total,'page',totals.page,'pages',totals.pages,
  'counts',(select coalesce(jsonb_object_agg(register_tag,n),'{}'::jsonb) from (select register_tag,count(*) n from identities group by register_tag) counts)
   ||jsonb_build_object('all',(select count(*) from identities),'mine',(select count(*) from identities where mine_today),'placement',(select count(*) from identities where commercial_kind='placement')),
  'live_status',public.order_live_status(coalesce((select array_agg(id) from page_rows where status='accepted'),'{}'::uuid[])),
  'discount_policy',(select to_jsonb(d) from public.discount_policy d where d.id limit 1)
 ) into v_result from totals;
 return v_result;
end $$;
revoke all on function public.sales_proforma_page(text,text,integer) from public,anon;
grant execute on function public.sales_proforma_page(text,text,integer) to authenticated;
commit;
