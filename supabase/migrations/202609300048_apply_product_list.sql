-- Apply the consolidated product list (Tally + CRM, AN codes) to the ERP products, owner only, in batches.
-- Existing products get a new product_detail_reviews / product_inventory_classifications version; nothing is
-- overwritten, and a correction saved by a person is never replaced by the list. Products that are not in the ERP
-- are created with the AN code as stock code. Stock, prices and documents are not touched. Adds the Furniture
-- category. Rollback: products created here are identified by source->>'origin' and can be archived; review rows
-- stay as history.
begin;

alter table public.product_inventory_classifications drop constraint product_inventory_classifications_category_check;
alter table public.product_inventory_classifications add constraint product_inventory_classifications_category_check
 check (category in ('machines','furniture','reagents','consumables','spares','non_stock','unclassified'));

create or replace function public.save_product_inventory_classification(p_id uuid,p_product_id uuid,p_expected_version integer,p_category text,p_reason text)
returns public.product_inventory_classifications language plpgsql security definer set search_path=public,pg_temp as $$
declare v_row public.product_inventory_classifications; v_next integer;
begin
 if not public.inventory_active_staff() then raise exception 'Active staff access is required'; end if;
 if p_category not in ('machines','furniture','reagents','consumables','spares','non_stock','unclassified') then raise exception 'Choose a supported inventory category'; end if;
 if not exists(select 1 from public.products where id=p_product_id) then raise exception 'Choose a saved product'; end if;
 select coalesce(max(version),0)+1 into v_next from public.product_inventory_classifications where product_id=p_product_id;
 if p_expected_version<>v_next-1 then raise exception 'Product classification changed; refresh before saving'; end if;
 insert into public.product_inventory_classifications(id,product_id,version,category,reason,created_by)
 values(p_id,p_product_id,v_next,p_category,trim(p_reason),auth.uid()) returning * into v_row;
 return v_row;
end $$;

create function public.apply_product_list(p_rows jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
 c_reason constant text := 'Anudha product list 2026-09-30 (Tally + CRM consolidated)';
 v_row jsonb; v_n integer := 0; v_code text; v_product text; v_company text; v_spec text; v_cat text; v_class text;
 v_extra jsonb; v_ids uuid[]; v_pid uuid; v_review public.product_detail_reviews; v_klass public.product_inventory_classifications;
 v_created integer := 0; v_reviewed integer := 0; v_classified integer := 0; v_kept integer := 0;
begin
 if not public.inventory_owner() then raise exception 'Only the owner can apply the product list'; end if;
 if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) not between 1 and 500 then raise exception 'Send between 1 and 500 products at a time'; end if;
 perform pg_advisory_xact_lock(hashtextextended('apply-product-list',0));
 for v_row in select value from jsonb_array_elements(p_rows) loop
  v_n := v_n + 1;
  v_code := v_row->>'code'; v_product := trim(coalesce(v_row->>'product','')); v_company := trim(coalesce(v_row->>'company',''));
  v_spec := trim(coalesce(v_row->>'specification','')); v_cat := coalesce(v_row->>'category','Not sure');
  if v_code is null or v_code !~ '^AN-[0-9]{5}$' then raise exception 'Product % has no valid AN code', v_n; end if;
  if v_product = '' then raise exception '% has no product name', v_code; end if;
  v_class := case v_cat when 'Machine' then 'machines' when 'Furniture' then 'furniture' when 'Spare' then 'spares' when 'Consumable' then 'consumables'
   when 'Reagent' then 'reagents' when 'Not sure' then 'unclassified' end;
  if v_class is null then raise exception '% has an unknown category', v_code; end if;
  begin
   select coalesce(array_agg(x::uuid),'{}') into v_ids from jsonb_array_elements_text(coalesce(v_row->'erp_product_ids','[]'::jsonb)) x;
  exception when others then raise exception '% has an invalid ERP id', v_code;
  end;

  -- The count screen searches the same list.
  insert into public.count_catalogue(code,product,company,specification,category,search_text,erp_product_ids,loaded_by)
  values(v_code,v_product,v_company,v_spec,v_cat,left(coalesce(v_row->>'search_text',''),4000),v_ids,auth.uid())
  on conflict (code) do update set product=excluded.product,company=excluded.company,specification=excluded.specification,category=excluded.category,
   search_text=excluded.search_text,erp_product_ids=excluded.erp_product_ids,loaded_by=excluded.loaded_by,loaded_at=now();

  v_extra := jsonb_strip_nulls(jsonb_build_object('an_code',v_code,
   'company_note',nullif(trim(coalesce(v_row->>'company_note','')),''),
   'suggested_company',nullif(trim(coalesce(v_row->>'suggested_company','')),'')));
  select coalesce(array_agg(id),'{}') into v_ids from public.products where id = any(v_ids) and deleted_at is null;
  if cardinality(v_ids) = 0 then
   select coalesce(array_agg(id),'{}') into v_ids from public.products where source->>'an_code' = v_code and deleted_at is null;
  end if;
  if cardinality(v_ids) = 0 then
   v_pid := gen_random_uuid();
   insert into public.products(id,name,sku,source,match_status,revision)
   values(v_pid,v_product,v_code,v_extra||jsonb_build_object('origin',c_reason,'company',v_company,'specification',v_spec),'unreviewed',1);
   v_ids := array[v_pid]; v_created := v_created + 1;
  end if;

  foreach v_pid in array v_ids loop
   update public.products set sku=case when trim(sku)='' then v_code else sku end, source=source||v_extra, revision=revision+1
    where id=v_pid and (trim(sku)='' or not (source @> v_extra));
   select * into v_review from public.product_detail_reviews where product_id=v_pid order by version desc limit 1;
   if not found or (v_review.reason = c_reason and (v_review.name,v_review.company,v_review.specification) is distinct from (v_product,v_company,v_spec)) then
    insert into public.product_detail_reviews(id,product_id,version,name,company,specification,sale_status,batch_required,expiry_required,reason,created_by)
    values(gen_random_uuid(),v_pid,coalesce(v_review.version,0)+1,v_product,v_company,v_spec,coalesce(v_review.sale_status,'unknown'),v_review.batch_required,v_review.expiry_required,c_reason,auth.uid());
    v_reviewed := v_reviewed + 1;
   elsif v_review.reason <> c_reason then v_kept := v_kept + 1;
   end if;
   select * into v_klass from public.product_inventory_classifications where product_id=v_pid order by version desc limit 1;
   if not found or (v_klass.reason = c_reason and v_klass.category <> v_class) then
    insert into public.product_inventory_classifications(id,product_id,version,category,reason,created_by)
    values(gen_random_uuid(),v_pid,coalesce(v_klass.version,0)+1,v_class,c_reason,auth.uid());
    v_classified := v_classified + 1;
   end if;
  end loop;
 end loop;
 return jsonb_build_object('rows',v_n,'created',v_created,'reviewed',v_reviewed,'classified',v_classified,'kept_manual',v_kept);
end $$;

revoke all on function public.apply_product_list(jsonb) from public, anon;
grant execute on function public.apply_product_list(jsonb) to authenticated;
commit;
