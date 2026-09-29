-- Review metadata only. Dependencies: 001, 002, 017.
-- Forward-only audit history: rollback by disabling RPC access, retaining rows.
begin;
create table public.product_source_mapping_reviews (
 id uuid primary key,
 source_key text not null check(length(source_key) between 1 and 1000 and source_key=btrim(source_key)),
 version integer not null check(version>0),
 product_id uuid references public.products(id),
 decision text not null check(decision in ('linked','unresolved')),
 snapshot jsonb not null,
 reason text not null check(length(btrim(reason)) between 5 and 1000),
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(),
 unique(source_key,version),
 check((decision='linked' and product_id is not null) or (decision='unresolved' and product_id is null))
);
create trigger product_source_mapping_reviews_immutable before update or delete on public.product_source_mapping_reviews
for each row execute function public.deny_product_classification_mutation();
alter table public.product_source_mapping_reviews enable row level security;
revoke all on public.product_source_mapping_reviews from public,anon,authenticated;
grant select on public.product_source_mapping_reviews to authenticated;
create policy product_source_mapping_reviews_read on public.product_source_mapping_reviews for select to authenticated using(public.inventory_active_staff());

create function public.save_product_source_mapping_review(p_id uuid,p_source_key text,p_expected_version integer,p_product_id uuid,p_decision text,p_snapshot jsonb,p_reason text)
returns public.product_source_mapping_reviews language plpgsql security definer set search_path=public,pg_temp as $$
declare
 v_row public.product_source_mapping_reviews; v_next integer; v_product jsonb; v_original jsonb;
 v_detail public.product_detail_reviews; v_part jsonb; v_key text; v_value jsonb;
 v_wanted text; v_actual text; v_fields text[]:=array['name','originalName','model','manufacturer','description','active','source','units','totalStock','locations','matchStatus','matchConfidence','notes'];
begin
 if not public.inventory_owner() then raise exception 'Owner access is required to save source mappings'; end if;
 if p_source_key is null or length(p_source_key) not between 1 and 1000 or p_source_key<>btrim(p_source_key) or p_source_key!~'[^[:space:]]' then raise exception 'Invalid source key'; end if;
 if p_id is null then raise exception 'Review ID is required'; end if;
 if p_expected_version is null or p_expected_version<0 then raise exception 'Expected version must be a nonnegative integer'; end if;
 if p_decision is null or p_decision not in ('linked','unresolved') then raise exception 'Invalid mapping decision'; end if;
 if (p_decision='linked')<>(p_product_id is not null) then raise exception 'Linked mappings require a product; unresolved mappings require no product'; end if;
 if p_reason is null or length(btrim(p_reason)) not between 5 and 1000 then raise exception 'Reason must contain 5 to 1000 characters'; end if;
 if p_snapshot is null or jsonb_typeof(p_snapshot)<>'object'
 or not(p_snapshot ?& array['original','corrected','editedLocally','editedAt'])
 or p_snapshot-array['original','corrected','editedLocally','editedAt']<>'{}'::jsonb
 or jsonb_typeof(p_snapshot->'original')<>'object' or jsonb_typeof(p_snapshot->'corrected')<>'object'
 or jsonb_typeof(p_snapshot->'editedLocally')<>'boolean'
 or jsonb_typeof(p_snapshot->'editedAt') not in ('number','null') then raise exception 'Invalid mapping snapshot'; end if;
 foreach v_key in array array['original','corrected'] loop
  v_part:=p_snapshot->v_key;
  if v_part-v_fields<>'{}'::jsonb then raise exception 'Invalid snapshot field'; end if;
  for v_key,v_value in select key,value from jsonb_each(v_part) loop
   if jsonb_typeof(v_value) not in ('string','null') and not(v_key in ('totalStock','matchConfidence') and jsonb_typeof(v_value)='number') then raise exception 'Invalid snapshot field value'; end if;
   if jsonb_typeof(v_value)='string' and length(v_value#>>'{}')>20000 then raise exception 'Snapshot field is too long'; end if;
  end loop;
 end loop;
 foreach v_key in array array['originalName','source','units','totalStock','locations','matchConfidence'] loop
  if (p_snapshot->'original'->v_key) is distinct from (p_snapshot->'corrected'->v_key) then raise exception 'Source provenance changed: %',v_key; end if;
 end loop;
 -- Consistent ordering: serialize a source key before locking a catalog product.
 perform pg_advisory_xact_lock(hashtextextended(p_source_key,330033));
 select * into v_row from public.product_source_mapping_reviews where id=p_id;
 if found then
  if v_row.source_key is distinct from p_source_key or v_row.version-1 is distinct from p_expected_version
   or v_row.product_id is distinct from p_product_id or v_row.decision is distinct from p_decision
   or v_row.snapshot is distinct from p_snapshot or v_row.reason is distinct from p_reason then
   raise exception 'Review ID already exists with different payload';
  end if;
  return v_row;
 end if;
 select snapshot->'original' into v_original from public.product_source_mapping_reviews
 where source_key=p_source_key order by version limit 1;
 if found and v_original is distinct from p_snapshot->'original' then
  raise exception 'Source baseline changed; use a separate source key for a new import';
 end if;
 select coalesce(max(version),0)+1 into v_next from public.product_source_mapping_reviews where source_key=p_source_key;
 if p_expected_version<>v_next-1 then raise exception 'Source mapping changed; refresh before saving'; end if;
 if p_decision='linked' then
  select to_jsonb(p) into v_product from public.products p where id=p_product_id for update;
  if not found or v_product->>'deleted_at' is not null then raise exception 'Choose an existing unarchived product'; end if;
  select * into v_detail from public.product_detail_reviews where product_id=p_product_id order by version desc limit 1;
  foreach v_key in array array['name','manufacturer','model','units'] loop
   v_wanted:=lower(btrim(regexp_replace(coalesce(p_snapshot->'corrected'->>v_key,''),'[[:space:]]+',' ','g')));
   v_actual:=case v_key
    when 'name' then case when v_detail.id is not null then v_detail.name else v_product->>'name' end
    when 'manufacturer' then case when v_detail.id is not null then v_detail.company else v_product->'source'->>'company' end
    when 'model' then case when v_detail.id is not null then v_detail.specification else coalesce(nullif(v_product->'source'->>'specification',''),v_product->'source'->>'model') end
    when 'units' then coalesce(nullif(v_product->'source'->>'units',''),v_product->'source'->>'pack_unit') end;
   v_actual:=lower(btrim(regexp_replace(coalesce(v_actual,''),'[[:space:]]+',' ','g')));
   if v_wanted='' or v_actual='' or v_actual<>v_wanted then raise exception 'Product identity must match exactly: %',v_key; end if;
  end loop;
 end if;
 insert into public.product_source_mapping_reviews(id,source_key,version,product_id,decision,snapshot,reason,created_by)
 values(p_id,p_source_key,v_next,p_product_id,p_decision,p_snapshot,p_reason,auth.uid()) returning * into v_row;
 return v_row;
end $$;
revoke all on function public.save_product_source_mapping_review(uuid,text,integer,uuid,text,jsonb,text) from public,anon;
grant execute on function public.save_product_source_mapping_review(uuid,text,integer,uuid,text,jsonb,text) to authenticated;
commit;
