-- A reviewed invoice releases reserved stock to packing and opens machine planning atomically.
begin;

alter table public.service_cases alter column asset_id drop not null;
alter table public.service_cases
 add column planned_delivery_line_id uuid references public.sales_delivery_lines(id),
 add column planned_unit_number integer check (planned_unit_number between 1 and 1000000),
 add column delivery_ready boolean not null default true,
 add column reused_case_id uuid references public.service_cases(id),
 add constraint installation_plan_identity check ((planned_delivery_line_id is null)=(planned_unit_number is null)),
 add constraint installation_plan_source check (planned_delivery_line_id is null or
  (case_type='installation' and source_delivery_note_id is not null and intake_source='erp_delivery')),
 add constraint service_case_asset_required check (asset_id is not null or
  (planned_delivery_line_id is not null and not delivery_ready and status in ('new','assigned','scheduled','cancelled'))),
 add constraint installation_reused_case check (reused_case_id is null or (reused_case_id<>id and status='cancelled'));
create unique index installation_plan_delivery_unit on public.service_cases(planned_delivery_line_id,planned_unit_number)
 where planned_delivery_line_id is not null;

-- An invoice-time plan retains its serial obligation even if the catalog category is corrected later.
create or replace function public.guard_machine_delivery_serials()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if new.status not in ('ready','out_for_delivery','delivered') or old.status is not distinct from new.status then return new; end if;
 if exists(select 1 from public.sales_delivery_lines line where line.delivery_note_id=new.id
  and ((new.status<>'delivered' and public.delivery_product_requires_serial(line.product_id))
   or exists(select 1 from public.service_cases where planned_delivery_line_id=line.id))
  and line.quantity<>(select count(*) from public.delivery_line_serials serial where serial.delivery_line_id=line.id and serial.returned_at is null
   and serial.inventory_serial_id is not null
   and (new.status='delivered' or public.inventory_serial_available_lot(serial.inventory_serial_id)=line.lot_id))) then
  raise exception 'Enter one real serial number for every machine unit and other serial-tracked item before marking Packed, sending out or completing this delivery';
 end if;
 return new;
end $$;
revoke all on function public.guard_machine_delivery_serials() from public,anon,authenticated;

-- Packing sees only the line identities it needs, without service-case read access.
create function public.planned_delivery_serial_lines(p_delivery_note_ids uuid[])
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
 if not (public.has_access('deliveries') or public.has_access('stock') or public.has_access('service')) then raise exception 'Delivery, stock or service access is required'; end if;
 if coalesce(cardinality(p_delivery_note_ids),0) not between 1 and 100 then raise exception 'Choose between 1 and 100 delivery notes'; end if;
 return (select coalesce(jsonb_agg(jsonb_build_object('delivery_line_id',line.id) order by line.id),'[]'::jsonb)
  from public.sales_delivery_lines line where line.delivery_note_id=any(p_delivery_note_ids)
   and exists(select 1 from public.service_cases where planned_delivery_line_id=line.id));
end $$;
revoke all on function public.planned_delivery_serial_lines(uuid[]) from public,anon;
grant execute on function public.planned_delivery_serial_lines(uuid[]) to authenticated;

-- Hold the delivery before the case, matching cancellation and delivery reconciliation.
create function public.lock_service_delivery(p_case_id uuid,p_require_delivered boolean)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare v_status text;v_asset uuid;v_ready boolean;
begin
 select n.status into v_status
 from public.service_cases c join public.sales_delivery_notes n on n.id=c.source_delivery_note_id
 where c.id=p_case_id and c.case_type='installation' for share of n;
 if found and p_require_delivered then
  select asset_id,delivery_ready into v_asset,v_ready from public.service_cases where id=p_case_id;
  if v_status<>'delivered' or v_asset is null or not v_ready then
   raise exception 'This installation is awaiting signed delivery. You can assign an engineer and schedule it now; start work after delivery.';
  end if;
 end if;
end $$;
revoke all on function public.lock_service_delivery(uuid,boolean) from public,anon,authenticated;

create or replace function public.create_installation_cases_for_delivery()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_line record;v_unit integer;v_asset public.equipment_assets;v_plan public.service_cases;v_existing public.service_cases;
 v_case_id uuid;v_number text;v_serial text;v_installation boolean;v_charges text;v_location text;v_actor uuid;
begin
 if new.status is not distinct from old.status then return new; end if;
 if new.status not in ('sent_to_sales','delivered','cancelled') then return new; end if;
 v_actor:=coalesce(auth.uid(),new.delivered_by,new.created_by);
 if new.status='cancelled' then
  for v_plan in select * from public.service_cases where source_delivery_note_id=new.id
   and planned_delivery_line_id is not null and status not in ('completed','cancelled') order by id for update loop
   if v_plan.status not in ('new','assigned','scheduled') then raise exception 'Installation work has started; review it before cancelling this delivery'; end if;
   update public.service_cases set status='cancelled',version=version+1,updated_at=now() where id=v_plan.id;
   insert into public.service_case_events(id,case_id,from_status,to_status,note,assigned_user_id,actor_user_id)
   values(gen_random_uuid(),v_plan.id,v_plan.status,'cancelled','Source delivery cancelled; installation planning closed',v_plan.assigned_user_id,v_actor);
  end loop;
  return new;
 end if;
 -- A packing release must not recreate cases or change existing planning assignments.
 if new.status='sent_to_sales' and old.status<>'tax_invoice_created' then return new; end if;
 select installation_required,installation_charge_notes into v_installation,v_charges from public.sales_proformas where id=new.proforma_id;
 if not found then raise exception 'The installation order is unavailable'; end if;
 if new.status='sent_to_sales' then
  if not v_installation then return new; end if;
  if (select coalesce(sum(line.quantity),0) from public.sales_delivery_lines line where line.delivery_note_id=new.id
   and (select c.category from public.product_inventory_classifications c where c.product_id=line.product_id order by c.version desc limit 1)='machines')>1000 then
   raise exception 'This invoice needs more than 1,000 machine installation plans. Invoice the machine quantities in batches of at most 1,000 units.';
  end if;
 end if;
 select left(trim(coalesce(location,'')),300) into v_location from public.organizations where id=new.organization_id;
 for v_line in select line.id,line.product_id,line.quantity from public.sales_delivery_lines line
  where line.delivery_note_id=new.id and (exists(select 1 from public.product_inventory_classifications c
    where c.product_id=line.product_id and c.version=(select max(version) from public.product_inventory_classifications where product_id=line.product_id)
     and c.category='machines') or exists(select 1 from public.service_cases where planned_delivery_line_id=line.id)) order by line.id
 loop
  for v_unit in select generate_series(1,v_line.quantity) loop
   select * into v_plan from public.service_cases where planned_delivery_line_id=v_line.id and planned_unit_number=v_unit for update;
   if new.status='sent_to_sales' then
    if not v_installation or v_plan.id is not null then continue; end if;
    v_case_id:=gen_random_uuid();v_number:='INS-'||to_char(current_date,'YYYY')||'-'||lpad(nextval('public.service_case_number_seq')::text,6,'0');
    insert into public.service_cases(id,case_number,case_type,source_delivery_note_id,organization_id,site_organization_id,site_location,
     contact_id,product_id,intake_source,problem_summary,created_by,planned_delivery_line_id,planned_unit_number,delivery_ready)
    values(v_case_id,v_number,'installation',new.id,new.organization_id,new.organization_id,coalesce(v_location,''),new.contact_id,
     v_line.product_id,'erp_delivery',case when length(trim(coalesce(v_charges,'')))>0 then left('Installation charges: '||trim(v_charges),4000) else '' end,
     v_actor,v_line.id,v_unit,false);
    insert into public.service_case_events(id,case_id,to_status,note,actor_user_id)
    values(gen_random_uuid(),v_case_id,'new','Invoice posted; plan installation while awaiting signed delivery',v_actor);
    continue;
   end if;
   v_asset:=null;v_serial:=null;v_existing:=null;
   select serial_number into v_serial from public.delivery_line_serials where delivery_line_id=v_line.id
    and returned_at is null order by upper(serial_number),id offset v_unit-1 limit 1;
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
   select * into v_existing from public.service_cases where asset_id=v_asset.id and case_type='installation'
    and (status not in ('completed','cancelled') or source_delivery_note_id=new.id) and id is distinct from v_plan.id
    order by created_at,id limit 1;
   if v_plan.id is not null then
    if v_existing.id is not null and v_plan.status<>'cancelled' then
     update public.service_cases set asset_id=v_asset.id,delivery_ready=true,status='cancelled',reused_case_id=v_existing.id,
      version=version+1,updated_at=now() where id=v_plan.id;
     insert into public.service_case_events(id,case_id,from_status,to_status,note,assigned_user_id,actor_user_id)
     values(gen_random_uuid(),v_plan.id,v_plan.status,'cancelled','Signed delivery reuses existing installation '||v_existing.case_number||' ('||v_existing.id||')',v_plan.assigned_user_id,v_actor);
    else
     update public.service_cases set asset_id=v_asset.id,delivery_ready=true,version=version+1,updated_at=now() where id=v_plan.id;
     insert into public.service_case_events(id,case_id,from_status,to_status,note,assigned_user_id,actor_user_id)
     values(gen_random_uuid(),v_plan.id,v_plan.status,v_plan.status,'Signed delivery identified the planned machine; engineer and schedule retained',v_plan.assigned_user_id,v_actor);
    end if;
   elsif v_installation and v_existing.id is null then
    -- Older deliveries without an invoice-time plan retain their original installation behavior.
    v_case_id:=gen_random_uuid();v_number:='INS-'||to_char(current_date,'YYYY')||'-'||lpad(nextval('public.service_case_number_seq')::text,6,'0');
    insert into public.service_cases(id,case_number,case_type,asset_id,source_delivery_note_id,organization_id,site_organization_id,site_location,contact_id,product_id,intake_source,problem_summary,created_by)
    values(v_case_id,v_number,'installation',v_asset.id,new.id,new.organization_id,new.organization_id,coalesce(nullif(v_location,''),v_asset.installation_location,''),new.contact_id,v_line.product_id,'erp_delivery',
     case when length(trim(coalesce(v_charges,'')))>0 then left('Installation charges: '||trim(v_charges),4000) else '' end,v_actor);
    insert into public.service_case_events(id,case_id,to_status,note,actor_user_id)
    values(gen_random_uuid(),v_case_id,'new','Signed delivery note created this installation case',v_actor);
   end if;
  end loop;
 end loop;
 return new;
end $$;
revoke all on function public.create_installation_cases_for_delivery() from public,anon,authenticated;

-- Amend only the installed callsites, keeping all later authorization/serial/report patches.
do $migration$
declare r record;v_definition text;v_oid oid;
begin
 for r in select * from (values
  ('public.record_delivery_serials(uuid,integer,jsonb)',
   $old$  if not public.delivery_product_requires_serial(v_line.product_id) then raise exception 'This product does not need serial numbers'; end if;$old$,
   $new$  if not public.delivery_product_requires_serial(v_line.product_id)
   and not exists(select 1 from public.service_cases where planned_delivery_line_id=v_line.id) then raise exception 'This product does not need serial numbers'; end if;$new$),
  ('public.invoice_order_quantities(uuid,uuid,integer,date,date,jsonb,text,date,text)',
   $old$ perform public.create_tax_invoice_and_reserve_stock(v_dn.id,v_dn.version,v.invoice_number);$old$,
   $new$ v_dn:=public.create_tax_invoice_and_reserve_stock(v_dn.id,v_dn.version,v.invoice_number);
 perform public.advance_sales_delivery(v_dn.id,v_dn.version,'send_to_sales','','','','');$new$),
  ('public.advance_service_case(uuid,integer,text,uuid,date,text)',
   $old$ select * into v_row from public.service_cases where id=p_id and version=p_expected_version for update;$old$,
   $new$ perform public.lock_service_delivery(p_id,p_action in ('start','submit_report'));
 select * into v_row from public.service_cases where id=p_id and version=p_expected_version for update;$new$),
  ('public.complete_service_report(uuid,integer,date,text,text,text,text,text,text,text,uuid,text,date,text,date,text,text,date,text,boolean,text,boolean,text,date,text,text,bigint,text,integer,jsonb,jsonb)',
   $old$ select * into v_case from public.service_cases where id=p_case_id and version=p_expected_version and status='report_required' for update;$old$,
   $new$ perform public.lock_service_delivery(p_case_id,true);
 select * into v_case from public.service_cases where id=p_case_id and version=p_expected_version and status='report_required' for update;$new$)
 ) patches(signature,old_body,new_body) loop
  v_oid:=to_regprocedure(r.signature);
  if v_oid is null then raise exception 'Missing immediate handoff dependency: %',r.signature; end if;
  if not (select prosecdef and prolang=(select oid from pg_language where lanname='plpgsql') from pg_proc where oid=v_oid) then
   raise exception 'Unexpected immediate handoff security: %',r.signature;
  end if;
  v_definition:=pg_get_functiondef(v_oid);
  if (length(v_definition)-length(replace(v_definition,r.old_body,'')))/length(r.old_body)<>1 then
   raise exception 'Unexpected immediate handoff implementation: %',r.signature;
  end if;
  execute replace(v_definition,r.old_body,r.new_body);
 end loop;
end $migration$;

commit;
