-- Equipment may arrive for work without an ERP sale. Keep customer and site separate,
-- and leave an unknown serial empty until the engineer identifies the actual unit.
begin;

alter table public.equipment_assets add column serial_unknown boolean not null default true;
update public.equipment_assets set serial_unknown=false where serial_number is not null;
alter table public.equipment_assets add constraint equipment_asset_serial_known check (serial_unknown=(serial_number is null));
-- A repair does not establish an installation date for externally supplied equipment.
alter table public.equipment_assets drop constraint equipment_assets_check;
alter table public.equipment_assets drop constraint equipment_assets_check1;
alter table public.equipment_assets add constraint equipment_asset_installation_date check (installed_on is null or status<>'pending_installation');
create unique index equipment_asset_product_serial on public.equipment_assets(product_id,upper(trim(serial_number))) where serial_number is not null;

alter table public.service_cases
 add column site_organization_id uuid references public.organizations(id),
 add column site_location text not null default '' check(length(site_location)<=300),
 add column project_name text not null default '' check(length(project_name)<=200),
 add column intake_source text not null default 'erp_delivery' check(intake_source in ('erp_delivery','third_party','legacy','distributor','customer_request')),
 add column intake_request jsonb;
drop index public.one_installation_case_per_asset;
create unique index one_open_installation_case_per_asset on public.service_cases(asset_id) where case_type='installation' and status not in ('completed','cancelled');
-- Preventive visits must not prevent a new repair request after the last repair finished.
drop index public.one_open_service_case_per_asset;
create unique index one_open_service_case_per_asset on public.service_cases(asset_id) where case_type='service' and source_case_id is null and status not in ('completed','cancelled');
create unique index one_open_maintenance_case_per_asset on public.service_cases(asset_id) where case_type='service' and source_case_id is not null and status not in ('completed','cancelled');
alter policy equipment_assets_read on public.equipment_assets using ((select public.has_access('service')));

create function public.create_service_intake(
 p_id uuid,p_case_type text,p_asset_id uuid,p_expected_asset_updated_at timestamptz,
 p_organization_id uuid,p_site_organization_id uuid,p_contact_id uuid,p_product_id uuid,
 p_model text,p_serial_number text,p_serial_unknown boolean,p_location text,p_project_name text,p_problem_summary text,p_source text
) returns public.service_cases language plpgsql security definer set search_path=public,pg_temp as $$
declare v_asset public.equipment_assets; v_row public.service_cases; v_open public.service_cases; v_request jsonb; v_customer uuid; v_site uuid; v_number text; v_serial text:=nullif(trim(p_serial_number),'');
begin
 perform public.require_access('service');
 if p_id is null or p_case_type is null or p_case_type not in ('installation','service') then raise exception 'Choose installation or repair/service'; end if;
 if p_source is null or p_source not in ('third_party','legacy','distributor','customer_request') then raise exception 'Choose where this equipment came from'; end if;
 if length(trim(coalesce(p_problem_summary,''))) not between 2 and 4000 then raise exception 'Describe the requested work'; end if;
 if length(trim(coalesce(p_location,''))) not between 2 and 300 or length(coalesce(p_project_name,''))>200 then raise exception 'Enter the machine site or location'; end if;
 v_request:=jsonb_build_object('case_type',p_case_type,'asset_id',p_asset_id,'asset_updated_at',p_expected_asset_updated_at,
  'organization_id',p_organization_id,'site_organization_id',p_site_organization_id,'contact_id',p_contact_id,'product_id',p_product_id,
  'model',trim(coalesce(p_model,'')),'serial',v_serial,'serial_unknown',p_serial_unknown,'location',trim(p_location),
  'project',trim(coalesce(p_project_name,'')),'problem',trim(p_problem_summary),'source',p_source);
 perform pg_advisory_xact_lock(hashtextextended('service-intake:'||p_id::text,0));
 select * into v_row from public.service_cases where id=p_id;
 if found then
  if v_row.created_by is distinct from auth.uid() or v_row.intake_request is distinct from v_request then raise exception 'This request was already saved with different details; refresh before continuing'; end if;
  return v_row;
 end if;
 if p_asset_id is not null then
  select * into v_asset from public.equipment_assets where id=p_asset_id for update;
  if not found or v_asset.status='retired' then raise exception 'Choose a current machine'; end if;
  if p_expected_asset_updated_at is null or v_asset.updated_at is distinct from p_expected_asset_updated_at then raise exception 'Machine details changed; refresh before continuing'; end if;
  if p_organization_id is distinct from v_asset.organization_id or p_product_id is distinct from v_asset.product_id
    or trim(coalesce(p_model,'')) is distinct from coalesce(v_asset.model,'') or v_serial is distinct from v_asset.serial_number or p_serial_unknown is distinct from v_asset.serial_unknown then
   raise exception 'Keep the existing machine identity and customer; choose the destination site separately';
  end if;
 else
  if p_product_id is null or not exists(select 1 from public.products where id=p_product_id and deleted_at is null) then raise exception 'Choose a current equipment product'; end if;
  if length(trim(coalesce(p_model,''))) not between 1 and 200 then raise exception 'Enter the equipment model'; end if;
  if p_serial_unknown is null or p_serial_unknown is distinct from (v_serial is null) or length(coalesce(v_serial,''))>200 then raise exception 'Enter the real serial number or explicitly mark it unknown'; end if;
  if v_serial is not null then
   perform pg_advisory_xact_lock(hashtextextended('equipment-serial:'||p_product_id::text||':'||upper(v_serial),0));
   if exists(select 1 from public.equipment_assets where product_id=p_product_id and upper(trim(serial_number))=upper(v_serial)) then raise exception 'This product and serial already identify a machine. Choose that existing machine'; end if;
  end if;
 end if;
 v_customer:=coalesce(v_asset.organization_id,p_organization_id);v_site:=coalesce(p_site_organization_id,v_customer);
 if v_customer is null or not exists(select 1 from public.organizations where id=v_customer and deleted_at is null)
  or not exists(select 1 from public.organizations where id=v_site and deleted_at is null) then raise exception 'Choose a current customer and destination site'; end if;
 if p_contact_id is not null and not exists(select 1 from public.contacts where id=p_contact_id and organization_id=v_site and deleted_at is null and status<>'incorrect') then raise exception 'Choose a current contact at the destination site'; end if;
 if p_asset_id is null then
  insert into public.equipment_assets(id,organization_id,product_id,model,serial_number,serial_unknown,installation_location,status)
  values(gen_random_uuid(),v_customer,p_product_id,trim(p_model),v_serial,p_serial_unknown,trim(p_location),case when p_case_type='installation' then 'pending_installation' else 'in_service' end) returning * into v_asset;
 end if;
 select * into v_open from public.service_cases where asset_id=v_asset.id and case_type=p_case_type
  and (p_case_type='installation' or source_case_id is null) and status not in ('completed','cancelled') order by created_at limit 1;
 if found then raise exception 'This machine already has open % job % (%). Open that job or cancel it first.',p_case_type,v_open.case_number,replace(v_open.status,'_',' '); end if;
 v_number:=case when p_case_type='installation' then 'INS-' else 'SRV-' end||to_char(current_date,'YYYY')||'-'||lpad(nextval('public.service_case_number_seq')::text,6,'0');
 insert into public.service_cases(id,case_number,case_type,asset_id,organization_id,site_organization_id,contact_id,product_id,site_location,project_name,problem_summary,intake_source,intake_request,created_by)
 values(p_id,v_number,p_case_type,v_asset.id,v_customer,p_site_organization_id,p_contact_id,v_asset.product_id,trim(p_location),trim(coalesce(p_project_name,'')),trim(p_problem_summary),p_source,v_request,auth.uid()) returning * into v_row;
 insert into public.service_case_events(id,case_id,to_status,note,actor_user_id) values(gen_random_uuid(),v_row.id,'new','Independent '||p_case_type||' request recorded ('||replace(p_source,'_',' ')||')',auth.uid());
 return v_row;
end $$;
revoke all on function public.create_service_intake(uuid,text,uuid,timestamptz,uuid,uuid,uuid,uuid,text,text,boolean,text,text,text,text) from public,anon;
grant execute on function public.create_service_intake(uuid,text,uuid,timestamptz,uuid,uuid,uuid,uuid,text,text,boolean,text,text,text,text) to authenticated;

-- Preserve the existing signed-report contract and its training, signature, access and stale-save checks.
do $migration$
declare v_oid oid:=to_regprocedure('public.complete_service_report(uuid,integer,date,text,text,text,text,text,text,text,uuid,text,date,text,date,text,text,date,text,boolean,text,boolean,text,date,text,text,bigint,text,integer,jsonb,jsonb)');v_definition text;r record;
begin
 if v_oid is null then raise exception 'Missing service report RPC'; end if;
 v_definition:=pg_get_functiondef(v_oid);
 for r in select * from (values
  ($old$ select * into v_asset from public.equipment_assets where id=v_case.asset_id for update;$old$,
   $new$ perform pg_advisory_xact_lock(hashtextextended('equipment-serial:'||v_case.product_id::text||':'||upper(trim(coalesce(p_serial_number,''))),0));
 select * into v_asset from public.equipment_assets where id=v_case.asset_id for update;$new$),
  ($old$ if p_actual_engineer_id is null or not exists(select 1 from public.staff where user_id=p_actual_engineer_id and active=true) then raise exception 'Choose an active engineer'; end if;$old$,
   $new$ if p_actual_engineer_id is null or not exists(select 1 from public.staff where user_id=p_actual_engineer_id and active=true and (role='owner' or 'service'=any(access))) then raise exception 'Choose an active engineer with Service access'; end if;$new$),
  ($old$ if exists(select 1 from public.equipment_assets where lower(trim(serial_number))=lower(trim(p_serial_number)) and id<>v_asset.id) then raise exception 'This serial number belongs to another machine'; end if;$old$,
   $new$ if v_asset.serial_number is not null and upper(trim(v_asset.serial_number))<>upper(trim(p_serial_number)) then raise exception 'The report serial must match the existing machine'; end if;
 if exists(select 1 from public.equipment_assets where product_id=v_asset.product_id and upper(trim(serial_number))=upper(trim(p_serial_number)) and id<>v_asset.id) then raise exception 'This product and serial number belong to another machine'; end if;$new$),
  ($old$ select name into v_customer from public.organizations where id=v_case.organization_id;$old$,
   $new$ select name into v_customer from public.organizations where id=coalesce(v_case.site_organization_id,v_case.organization_id);$new$),
  ($old$serial_number=trim(p_serial_number),installation_location=trim(p_installation_location),status='active',installed_on=coalesce(installed_on,p_actual_work_date)$old$,
   $new$serial_number=trim(p_serial_number),serial_unknown=false,installation_location=trim(p_installation_location),status=case when v_case.case_type='installation' or status<>'pending_installation' then 'active' else status end,installed_on=case when v_case.case_type='installation' then coalesce(installed_on,p_actual_work_date) else installed_on end$new$),
  ($old$ v_next_case_id:=gen_random_uuid(); v_next_number:=$old$,
   $new$ if not exists(select 1 from public.service_cases where asset_id=v_case.asset_id and case_type='service' and source_case_id is not null and status not in ('completed','cancelled')) then
 v_next_case_id:=gen_random_uuid(); v_next_number:=$new$),
  ($old$case_id,to_status,note,assigned_user_id,actor_user_id) values(gen_random_uuid(),v_next_case_id,'scheduled','Automatically scheduled from completed report',coalesce(v_case.assigned_user_id,p_actual_engineer_id),auth.uid());$old$,
   $new$case_id,to_status,note,assigned_user_id,actor_user_id) values(gen_random_uuid(),v_next_case_id,'scheduled','Automatically scheduled from completed report',coalesce(v_case.assigned_user_id,p_actual_engineer_id),auth.uid());
 update public.service_cases set site_organization_id=v_case.site_organization_id,site_location=trim(p_installation_location),project_name=trim(coalesce(p_project_name,'')),intake_source=v_case.intake_source where id=v_next_case_id;
 end if;$new$)
 ) as changes(old_body,new_body) loop
  if (length(v_definition)-length(replace(v_definition,r.old_body,'')))/length(r.old_body)<>1 then raise exception 'Unexpected service report implementation'; end if;
  v_definition:=replace(v_definition,r.old_body,r.new_body);
 end loop;
 execute v_definition;
end $migration$;
commit;
