begin;

do $$
declare v_delivery record; v_line record; v_unit integer; v_asset_id uuid; v_case_id uuid; v_number text;
begin
 for v_delivery in select delivery.* from public.sales_delivery_notes delivery where delivery.status='delivered' order by delivery.created_at,delivery.id loop
  for v_line in
   select line.id,line.product_id,line.quantity from public.sales_delivery_lines line
   where line.delivery_note_id=v_delivery.id and exists(
    select 1 from public.product_inventory_classifications classification
    where classification.product_id=line.product_id and classification.version=(select max(latest.version) from public.product_inventory_classifications latest where latest.product_id=line.product_id) and classification.category='machines'
   )
  loop
   for v_unit in select generate_series(1,v_line.quantity) loop
    v_asset_id:=gen_random_uuid();
    insert into public.equipment_assets(id,organization_id,product_id,source_delivery_line_id,unit_number)
    values(v_asset_id,v_delivery.organization_id,v_line.product_id,v_line.id,v_unit)
    on conflict (source_delivery_line_id,unit_number) do nothing;
    select id into v_asset_id from public.equipment_assets where source_delivery_line_id=v_line.id and unit_number=v_unit;
    if not exists(select 1 from public.service_cases where asset_id=v_asset_id and case_type='installation') then
     v_case_id:=gen_random_uuid(); v_number:='INS-'||to_char(v_delivery.delivered_at,'YYYY')||'-'||lpad(nextval('public.service_case_number_seq')::text,6,'0');
     insert into public.service_cases(id,case_number,case_type,asset_id,source_delivery_note_id,organization_id,contact_id,product_id,created_by,created_at,updated_at)
     values(v_case_id,v_number,'installation',v_asset_id,v_delivery.id,v_delivery.organization_id,v_delivery.contact_id,v_line.product_id,coalesce(v_delivery.delivered_by,v_delivery.created_by),coalesce(v_delivery.delivered_at,v_delivery.created_at),coalesce(v_delivery.delivered_at,v_delivery.created_at));
     insert into public.service_case_events(id,case_id,to_status,note,actor_user_id,created_at)
     values(gen_random_uuid(),v_case_id,'new','Existing signed delivery note created this installation case',coalesce(v_delivery.delivered_by,v_delivery.created_by),coalesce(v_delivery.delivered_at,v_delivery.created_at));
    end if;
   end loop;
  end loop;
 end loop;
end $$;

commit;
