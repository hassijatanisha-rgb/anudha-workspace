-- Review evidence only; no source balances, stock lots or costing are changed.
-- Rollback: revoke the mapping RPC in a forward migration; preserve audit history.
begin;
create table public.godown_mapping_reviews (
 id uuid primary key,
 source_godown text not null check(length(source_godown) between 1 and 2000),
 version integer not null check(version>0),
 location_id uuid references public.inventory_locations(id),
 reason text not null check(length(trim(reason)) between 5 and 1000),
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(),
 unique(source_godown,version)
);
create trigger godown_mapping_immutable before update or delete on public.godown_mapping_reviews for each row execute function public.deny_product_classification_mutation();
alter table public.godown_mapping_reviews enable row level security;
revoke all on public.godown_mapping_reviews from public,anon,authenticated;
grant select on public.godown_mapping_reviews to authenticated;
create policy godown_mapping_read on public.godown_mapping_reviews for select to authenticated using((select public.inventory_active_staff()));
create function public.save_godown_mapping_review(p_id uuid,p_godown text,p_expected_version integer,p_location_id uuid,p_reason text)
returns public.godown_mapping_reviews language plpgsql security definer set search_path=public,pg_temp as $$
declare prior public.godown_mapping_reviews; v integer; v_space text:=U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF';
begin
 if public.inventory_owner() is not true then raise exception 'Owner access and verified sign-in are required' using errcode='42501'; end if;
 if p_id is null or p_expected_version is null or p_expected_version<0 or p_expected_version>=2147483647 then raise exception 'Request and valid expected version are required'; end if;
 if p_godown is null or length(p_godown) not between 1 and 2000 or btrim(p_godown,v_space)='' then raise exception 'Source godown is required'; end if;
 if p_reason is null or length(btrim(p_reason,v_space)) not between 5 and 1000 then raise exception 'Enter evidence of 5 to 1000 characters'; end if;
 -- Serialize retries by request ID, then revisions by the exact source label.
 perform pg_advisory_xact_lock(hashtextextended('godown-request:'||p_id::text,0));
 perform pg_advisory_xact_lock(hashtextextended('godown-source:'||p_godown,0));
 select * into prior from public.godown_mapping_reviews where id=p_id;
 if found then
  if prior.source_godown is distinct from p_godown or prior.location_id is distinct from p_location_id or prior.reason is distinct from btrim(p_reason,v_space) or prior.created_by is distinct from auth.uid() or prior.version<>p_expected_version+1 then raise exception 'Request conflict'; end if;
  return prior;
 end if;
 if not exists(select 1 from public.tally_stock_sources where godown=p_godown) then raise exception 'Unknown source godown'; end if;
 if p_location_id is not null then
  perform 1 from public.inventory_locations where id=p_location_id and active for share;
  if not found then raise exception 'Choose an active location'; end if;
 end if;
 select coalesce(max(version),0) into v from public.godown_mapping_reviews where source_godown=p_godown;
 if v<>p_expected_version then raise exception 'Mapping changed; reopen and compare'; end if;
 insert into public.godown_mapping_reviews(id,source_godown,version,location_id,reason,created_by)
 values(p_id,p_godown,v+1,p_location_id,btrim(p_reason,v_space),auth.uid()) returning * into prior;
 return prior;
end $$;
revoke all on function public.save_godown_mapping_review(uuid,text,integer,uuid,text) from public,anon;
grant execute on function public.save_godown_mapping_review(uuid,text,integer,uuid,text) to authenticated;

-- Review evidence only. This function never reads the private raw import or posts stock.
create or replace function public.tally_stock_review_page(p_godown text default '',p_query text default '',p_page integer default 0,p_readiness_page integer default 0,p_today date default current_date)
returns jsonb language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare v_result jsonb; v_space text:=U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF';
begin
 if public.inventory_active_staff() is not true then raise exception 'Active staff access is required' using errcode='42501'; end if;
 if p_godown is null or length(p_godown)>2000 or p_query is null or length(p_query)>2000 then raise exception 'Godown and search must be 2000 characters or fewer'; end if;
 if p_page is null or p_page<0 or p_page>1000000 or p_readiness_page is null or p_readiness_page<0 or p_readiness_page>1000000 then raise exception 'Choose a valid review page'; end if;
 if p_today is null or not isfinite(p_today) then raise exception 'A valid company date is required'; end if;
 with recursive source_rows as materialized (
  select s.id,s.godown,s.product_name,s.quantity,s.unit,s.balance_date,c.id as correction_id,c.product_id,c.pieces,c.batch,c.expiry
  from public.tally_stock_sources s left join lateral (
   select id,product_id,pieces,batch,expiry from public.tally_stock_corrections where source_id=s.id order by version desc limit 1
  ) c on true
 ), identities as materialized (
  select p.id,coalesce(r.name,p.name) as name,
   case when r.id is null then p.source->'company' else to_jsonb(r.company) end as company,
   case when r.id is null then p.source->'specification' else to_jsonb(r.specification) end as specification,
   case when r.id is null then p.source->'model' else to_jsonb(r.specification) end as model,
   case when r.id is null then p.source->'sale_status' else to_jsonb(r.sale_status) end as sale_status,
   case when r.id is null then p.source->'batch_required' else to_jsonb(r.batch_required) end as batch_required,
   case when r.id is null then p.source->'expiry_required' else to_jsonb(r.expiry_required) end as expiry_required
  from public.products p left join lateral (
   select id,name,company,specification,sale_status,batch_required,expiry_required from public.product_detail_reviews where product_id=p.id order by version desc limit 1
  ) r on true where p.deleted_at is null and p.id in (select product_id from source_rows)
 ), metadata as (
  select id,'company' as field,case when company in ('null','false','0','""') then null else company end as value from identities
  union all
  select id,'specification',case when specification is null or specification in ('null','false','0','""') then case when model in ('null','false','0','""') then null else model end else specification end from identities
 ), metadata_text(id,field,value) as (
  select * from metadata union all
  select id,field,value->0 from metadata_text where case when jsonb_typeof(value)='array' then jsonb_array_length(value)=1 else false end
 ), metadata_present as (
  -- String(array) joins with commas: only a singleton needs recursive inspection for blankness.
  select id,bool_and(case jsonb_typeof(value) when 'string' then btrim(value#>>'{}',v_space)<>'' when 'array' then jsonb_array_length(value)>1 when 'null' then false else value is not null end) as present
  from metadata_text where not case when jsonb_typeof(value)='array' then jsonb_array_length(value)=1 else false end group by id
 ), checked as materialized (
  select s.*,p.id is not null as mapped,coalesce(
   btrim(s.godown,v_space)<>'' and s.pieces is not null and p.id is not null and btrim(p.name,v_space)<>'' and m.present
   and p.sale_status in ('"active"','"inactive_serviced"') and jsonb_typeof(p.batch_required)='boolean' and jsonb_typeof(p.expiry_required)='boolean'
   and (p.batch_required='false' or btrim(s.batch,v_space)<>'')
   and (p.expiry_required='false' or (s.expiry::text~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$' and s.expiry>p_today)),false) as checks_passed
  from source_rows s left join identities p on p.id=s.product_id left join metadata_present m on m.id=p.id
 ), scoped as materialized (
  select * from checked where p_godown='' or godown=p_godown
 ), matches as materialized (
  select * from scoped where strpos(lower(concat_ws(' ',product_name,godown,coalesce(unit,''))),lower(btrim(p_query,v_space)))>0
 ), counts as (
  select count(*) as total,greatest(1,(count(*)+49)/50) as pages,least(p_page,greatest(0,(count(*)-1)/50)) as page from matches
 ), page_rows as (
  select id,godown,product_name,quantity,unit,balance_date,pieces,correction_id is not null as reviewed,checks_passed from matches order by id limit 50 offset (select page*50 from counts)
 ), readiness as materialized (
  select godown as name,count(*) as total,count(*) filter(where checks_passed) as checked,count(*) filter(where not checks_passed) as blocked,
   count(*) filter(where not mapped) as unmapped,count(*) filter(where quantity<0) as negative from checked group by godown
 ), readiness_counts as (
  select count(*) as total,greatest(1,(count(*)+19)/20) as pages,least(p_readiness_page,greatest(0,(count(*)-1)/20)) as page from readiness
 ), readiness_rows as (
  select r.*,case when m.version is null then null else jsonb_build_object('version',m.version,'location_id',m.location_id,'location_name',l.name,'location_active',coalesce(l.active,false)) end as mapping
  from (select * from readiness order by name limit 20 offset (select page*20 from readiness_counts)) r
  left join lateral (select version,location_id from public.godown_mapping_reviews where source_godown=r.name order by version desc limit 1) m on true
  left join public.inventory_locations l on l.id=m.location_id
 )
 select jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(r) order by id) from page_rows r),'[]'::jsonb),
  'total',counts.total,'page',counts.page,'pages',counts.pages,
  'scope',(select jsonb_build_object('total',count(*),'reviewed',count(*) filter(where correction_id is not null),'negative',count(*) filter(where quantity<0),'missingQuantity',count(*) filter(where quantity is null)) from scoped),
  'readiness',jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(r) order by name) from readiness_rows r),'[]'::jsonb),'total',rc.total,'page',rc.page,'pages',rc.pages))
 into v_result from counts cross join readiness_counts rc;
 return v_result;
end $$;
revoke all on function public.tally_stock_review_page(text,text,integer,integer,date) from public,anon;
grant execute on function public.tally_stock_review_page(text,text,integer,integer,date) to authenticated;
commit;
