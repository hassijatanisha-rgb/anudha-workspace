-- Every delivered machine remains identifiable even when its installation is deferred.
begin;
create or replace function public.create_installation_cases_for_delivery()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_line record;v_unit integer;v_asset public.equipment_assets;v_case_id uuid;v_number text;v_serial text;v_installation boolean;v_charges text;v_location text;
begin
 if new.status<>'delivered' or old.status='delivered' then return new; end if;
 select installation_required,installation_charge_notes into v_installation,v_charges from public.sales_proformas where id=new.proforma_id;
 if not found then raise exception 'The delivered order is unavailable'; end if;
 select left(trim(coalesce(location,'')),300) into v_location from public.organizations where id=new.organization_id;
 for v_line in
  select line.id,line.product_id,line.quantity from public.sales_delivery_lines line
  where line.delivery_note_id=new.id and exists(
   select 1 from public.product_inventory_classifications classification
   where classification.product_id=line.product_id and classification.version=(select max(latest.version) from public.product_inventory_classifications latest where latest.product_id=line.product_id) and classification.category='machines'
  ) order by line.id
 loop
  for v_unit in select generate_series(1,v_line.quantity) loop
   v_asset:=null;v_serial:=null;
   select serial_number into v_serial from public.delivery_line_serials where delivery_line_id=v_line.id order by upper(serial_number),id offset v_unit-1 limit 1;
   if v_serial is not null then
    perform pg_advisory_xact_lock(hashtextextended('equipment-serial:'||v_line.product_id::text||':'||upper(trim(v_serial)),0));
    select * into v_asset from public.equipment_assets where product_id=v_line.product_id and upper(trim(serial_number))=upper(trim(v_serial)) for update;
   end if;
   if v_asset.id is null then
    select * into v_asset from public.equipment_assets where source_delivery_line_id=v_line.id and unit_number=v_unit for update;
   end if;
   if v_asset.id is null then
    insert into public.equipment_assets(id,organization_id,product_id,source_delivery_line_id,unit_number,serial_number,serial_unknown,installation_location)
    values(gen_random_uuid(),new.organization_id,v_line.product_id,v_line.id,v_unit,v_serial,v_serial is null,case when length(v_location)>=2 then v_location end) returning * into v_asset;
   elsif v_serial is not null and v_asset.serial_number is null then
    update public.equipment_assets set serial_number=v_serial,serial_unknown=false,updated_at=now() where id=v_asset.id returning * into v_asset;
   end if;
   if v_installation and not exists(select 1 from public.service_cases where asset_id=v_asset.id and case_type='installation'
      and (status not in ('completed','cancelled') or source_delivery_note_id=new.id)) then
    v_case_id:=gen_random_uuid();
    v_number:='INS-'||to_char(current_date,'YYYY')||'-'||lpad(nextval('public.service_case_number_seq')::text,6,'0');
    insert into public.service_cases(id,case_number,case_type,asset_id,source_delivery_note_id,organization_id,site_organization_id,site_location,contact_id,product_id,intake_source,problem_summary,created_by)
    values(v_case_id,v_number,'installation',v_asset.id,new.id,new.organization_id,new.organization_id,coalesce(nullif(v_location,''),v_asset.installation_location,''),new.contact_id,v_line.product_id,'erp_delivery',
     case when length(trim(coalesce(v_charges,'')))>0 then left('Installation charges: '||trim(v_charges),4000) else '' end,coalesce(new.delivered_by,new.created_by));
    insert into public.service_case_events(id,case_id,to_status,note,actor_user_id)
    values(gen_random_uuid(),v_case_id,'new','Signed delivery note created this installation case',coalesce(new.delivered_by,new.created_by));
   end if;
  end loop;
 end loop;
 return new;
end $$;
revoke all on function public.create_installation_cases_for_delivery() from public,anon,authenticated;
commit;
