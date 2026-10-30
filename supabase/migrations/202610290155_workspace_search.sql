begin;

-- Suggestions only: detail routes retain their own permission checks and full reads.
create function public.workspace_search(p_query text)
returns jsonb language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare
 v_query text; v_match text; v_proformas boolean; v_invoices boolean; v_groups jsonb; v_result jsonb;
 v_space constant text:=U&'\0009\000a\000b\000c\000d\0020\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff';
begin
 if public.inventory_active_staff() is not true then raise exception 'Active staff access is required' using errcode='42501'; end if;
 if p_query is null or length(p_query)>120 then raise exception 'Search must be 120 characters or fewer'; end if;
 v_query:=btrim(p_query,v_space); v_match:=lower(v_query);
 -- Delivery-only readers cannot open the current Pro forma route.
 v_proformas:=public.has_access('proformas') is true;
 v_invoices:=public.accounting_access() is true;
 v_groups:=jsonb_build_object(
  'clients',jsonb_build_object('available',true,'rows','[]'::jsonb,'has_more',false),
  'products',jsonb_build_object('available',true,'rows','[]'::jsonb,'has_more',false),
  'proformas',jsonb_build_object('available',v_proformas,'rows','[]'::jsonb,'has_more',false),
  'invoices',jsonb_build_object('available',v_invoices,'rows','[]'::jsonb,'has_more',false));
 if length(v_query)<2 then return jsonb_build_object('query',v_query,'groups',v_groups); end if;

 with candidates as materialized (
  select o.id,coalesce(o.name,'Client name missing') as title,coalesce(o.location,'') as subtitle,
   case when o.parent_id is null then 'client' else 'branch' end as kind,
   case when lower(o.name)=v_match then 0 when starts_with(lower(o.name),v_match) then 1 else 2 end as rank
  from public.organizations o where o.deleted_at is null
   and strpos(lower(concat_ws(' ',o.name,o.location)),v_match)>0
  order by rank,lower(o.name),o.id limit 6
 ), ranked as (select *,row_number() over(order by rank,lower(title),id) as position from candidates)
 select jsonb_build_object('available',true,'rows',coalesce(jsonb_agg(jsonb_build_object(
  'id',id,'title',left(title,180),'subtitle',left(subtitle,180),'kind',kind) order by position) filter(where position<=5),'[]'::jsonb),'has_more',count(*)>5)
 into v_result from ranked;
 v_groups:=jsonb_set(v_groups,'{clients}',v_result);

 with identities as (
  select p.id,p.sku,case when r.id is null then p.name else r.name end as name,
   case when r.id is null then p.source->>'company' else r.company end as company,
   case when r.id is null then p.source->>'model' else r.specification end as model,
   case when r.id is null then p.source->>'specification' else r.specification end as specification
  from public.products p
  left join lateral (select id,name,company,specification from public.product_detail_reviews where product_id=p.id order by version desc limit 1) r on true
  where p.deleted_at is null
 ), candidates as materialized (
  select id,coalesce(name,'Product name missing') as title,concat_ws(' · ',nullif(sku,''),nullif(company,''),nullif(coalesce(nullif(specification,''),model),'')) as subtitle,
   case when lower(name)=v_match or lower(sku)=v_match then 0 when starts_with(lower(name),v_match) or starts_with(lower(sku),v_match) then 1 else 2 end as rank
  from identities where strpos(lower(concat_ws(' ',name,sku,model,specification,company)),v_match)>0
  order by rank,lower(name),id limit 6
 ), ranked as (select *,row_number() over(order by rank,lower(title),id) as position from candidates)
 select jsonb_build_object('available',true,'rows',coalesce(jsonb_agg(jsonb_build_object(
  'id',id,'title',left(title,180),'subtitle',left(subtitle,180),'kind','product') order by position) filter(where position<=5),'[]'::jsonb),'has_more',count(*)>5)
 into v_result from ranked;
 v_groups:=jsonb_set(v_groups,'{products}',v_result);

 if v_proformas then
  with candidates as materialized (
   select p.id,p.document_number as title,concat_ws(' · ',coalesce(o.name,'Client unavailable'),replace(p.status,'_',' ')) as subtitle,
    case when lower(p.document_number)=v_match then 0 when starts_with(lower(p.document_number),v_match) then 1 else 2 end as rank
   from public.sales_proformas p
   left join public.organizations o on o.id=p.organization_id and o.deleted_at is null
   left join public.contacts c on c.id=p.contact_id and c.deleted_at is null
   where p.deleted_at is null and strpos(lower(concat_ws(' ',p.document_number,o.name,o.location,
    case when c.title<>'N/A' then nullif(c.title,'') end,c.first_name,c.last_name,p.acceptance_reference)),v_match)>0
   order by rank,lower(p.document_number),p.id limit 6
  ), ranked as (select *,row_number() over(order by rank,lower(title),id) as position from candidates)
  select jsonb_build_object('available',true,'rows',coalesce(jsonb_agg(jsonb_build_object(
   'id',id,'title',left(title,180),'subtitle',left(subtitle,180),'kind','proforma') order by position) filter(where position<=5),'[]'::jsonb),'has_more',count(*)>5)
  into v_result from ranked;
  v_groups:=jsonb_set(v_groups,'{proformas}',v_result);
 end if;

 if v_invoices then
  with candidates as materialized (
   select i.id,i.invoice_number as title,concat_ws(' · ',coalesce(o.name,'Client unavailable'),
    case when i.voided_at is not null then 'Void' end,case when i.opening_import_id is not null then 'Opening balance' end) as subtitle,
    case when i.opening_import_id is not null then 'opening_balance' else 'invoice' end as kind,
    case when lower(i.invoice_number)=v_match or lower(i.opening_reference)=v_match then 0
     when starts_with(lower(i.invoice_number),v_match) or starts_with(lower(i.opening_reference),v_match) then 1 else 2 end as rank
   from public.acc_invoices i left join public.organizations o on o.id=i.organization_id and o.deleted_at is null
   where strpos(lower(concat_ws(' ',i.invoice_number,o.name,i.opening_reference)),v_match)>0
   order by rank,lower(i.invoice_number),i.id limit 6
  ), ranked as (select *,row_number() over(order by rank,lower(title),id) as position from candidates)
  select jsonb_build_object('available',true,'rows',coalesce(jsonb_agg(jsonb_build_object(
   'id',id,'title',left(title,180),'subtitle',left(subtitle,180),'kind',kind) order by position) filter(where position<=5),'[]'::jsonb),'has_more',count(*)>5)
  into v_result from ranked;
  v_groups:=jsonb_set(v_groups,'{invoices}',v_result);
 end if;
 return jsonb_build_object('query',v_query,'groups',v_groups);
end $$;
revoke all on function public.workspace_search(text) from public,anon;
grant execute on function public.workspace_search(text) to authenticated;
commit;
