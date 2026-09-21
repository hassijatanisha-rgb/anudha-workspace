begin;

create sequence public.service_case_number_seq start 1;

create table public.equipment_assets (
 id uuid primary key,
 organization_id uuid not null references public.organizations(id),
 product_id uuid not null references public.products(id),
 source_delivery_line_id uuid references public.sales_delivery_lines(id),
 unit_number integer not null default 1 check (unit_number between 1 and 1000000),
 model text check (model is null or length(trim(model)) between 1 and 200),
 serial_number text check (serial_number is null or length(trim(serial_number)) between 1 and 200),
 installation_location text check (installation_location is null or length(trim(installation_location)) between 2 and 300),
 status text not null default 'pending_installation' check (status in ('pending_installation','active','in_service','retired')),
 installed_on date,
 maintenance_interval_months integer check (maintenance_interval_months in (3,6,12,24,36)),
 next_maintenance_date date,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(source_delivery_line_id,unit_number),
 check ((installed_on is null)=(status='pending_installation')),
 check (next_maintenance_date is null or installed_on is not null)
);

create table public.service_cases (
 id uuid primary key,
 case_number text not null unique,
 case_type text not null check (case_type in ('installation','service')),
 asset_id uuid not null references public.equipment_assets(id),
 source_delivery_note_id uuid references public.sales_delivery_notes(id),
 source_case_id uuid references public.service_cases(id),
 organization_id uuid not null references public.organizations(id),
 contact_id uuid references public.contacts(id),
 product_id uuid not null references public.products(id),
 status text not null default 'new' check (status in ('new','assigned','scheduled','on_site','report_required','completed','cancelled')),
 hod_user_id uuid references auth.users(id),
 assigned_user_id uuid references auth.users(id),
 scheduled_for date,
 started_at timestamptz,
 completed_at timestamptz,
 problem_summary text not null default '' check (length(problem_summary)<=4000),
 version integer not null default 1 check (version>0),
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 check (status in ('new','cancelled') or assigned_user_id is not null),
 check (status not in ('scheduled','on_site','report_required','completed') or scheduled_for is not null),
 check ((status='completed')=(completed_at is not null))
);

create unique index one_installation_case_per_asset on public.service_cases(asset_id) where case_type='installation';
create unique index one_open_service_case_per_asset on public.service_cases(asset_id) where case_type='service' and status not in ('completed','cancelled');
create index service_cases_queue on public.service_cases(case_type,status,scheduled_for,created_at desc);
create index service_cases_assignee on public.service_cases(assigned_user_id,status,scheduled_for);

create table public.service_case_events (
 id uuid primary key,
 case_id uuid not null references public.service_cases(id),
 from_status text,
 to_status text not null,
 note text not null check (length(trim(note)) between 2 and 2000),
 assigned_user_id uuid references auth.users(id),
 actor_user_id uuid not null references auth.users(id),
 created_at timestamptz not null default now()
);

create table public.service_reports (
 id uuid primary key,
 case_id uuid not null unique references public.service_cases(id),
 template_code text not null check (template_code in ('installation_rev_2','service_rev_2')),
 customer_name text not null,
 contact_name text not null,
 contact_phone text not null default '',
 project_name text not null default '',
 installation_location text not null,
 equipment_name text not null,
 equipment_model text not null,
 serial_number text not null,
 subject text not null default '',
 reported_problem text not null default '',
 work_completed text not null check (length(trim(work_completed)) between 2 and 8000),
 parts_used text not null default '' check (length(parts_used)<=4000),
 actual_work_date date not null,
 actual_engineer_id uuid not null references auth.users(id),
 actual_engineer_name text not null,
 engineer_signed_date date not null,
 customer_representative text not null,
 customer_signed_date date not null,
 customer_signoff_reference text not null,
 anudha_representative text not null,
 anudha_signed_date date not null,
 anudha_signoff_reference text not null,
 training_completed boolean,
 qc_training_status text check (qc_training_status is null or qc_training_status in ('completed','not_applicable')),
 machine_collected boolean,
 collection_representative text,
 collection_signed_date date,
 collection_reference text,
 currency text not null default 'TZS' check (currency in ('TZS','USD','EUR')),
 service_charge_minor bigint not null default 0 check (service_charge_minor>=0),
 charge_reference text not null default '',
 maintenance_interval_months integer not null check (maintenance_interval_months in (3,6,12,24,36)),
 next_maintenance_date date not null,
 submitted_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(),
 check (next_maintenance_date>actual_work_date),
 check ((machine_collected is true)=(collection_representative is not null and collection_signed_date is not null and collection_reference is not null))
);

create table public.service_report_accessories (
 id uuid primary key,
 report_id uuid not null references public.service_reports(id),
 sort_order integer not null check (sort_order between 1 and 100),
 description text not null check (length(trim(description)) between 1 and 300),
 serial_number text not null default '' check (length(serial_number)<=200),
 unique(report_id,sort_order)
);

create table public.service_training_attendees (
 id uuid primary key,
 report_id uuid not null references public.service_reports(id),
 sort_order integer not null check (sort_order between 1 and 10),
 full_name text not null check (length(trim(full_name)) between 2 and 200),
 telephone text not null check (length(trim(telephone)) between 3 and 80),
 designation text not null check (length(trim(designation)) between 2 and 200),
 unique(report_id,sort_order)
);

create or replace function public.deny_service_history_mutation()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin raise exception 'Service history and signed reports are immutable'; end $$;
create trigger service_case_events_immutable before update or delete on public.service_case_events for each row execute function public.deny_service_history_mutation();
create trigger service_reports_immutable before update or delete on public.service_reports for each row execute function public.deny_service_history_mutation();
create trigger service_report_accessories_immutable before update or delete on public.service_report_accessories for each row execute function public.deny_service_history_mutation();
create trigger service_training_attendees_immutable before update or delete on public.service_training_attendees for each row execute function public.deny_service_history_mutation();

create or replace function public.service_add_months(p_date date,p_months integer)
returns date language plpgsql immutable set search_path=public,pg_temp as $$
declare v_month date; v_last integer;
begin
 if p_date is null or p_months not in (3,6,12,24,36) then raise exception 'Choose a valid date and maintenance interval'; end if;
 v_month:=date_trunc('month',p_date)::date+make_interval(months=>p_months);
 v_last:=extract(day from (v_month+interval '1 month'-interval '1 day'))::integer;
 return make_date(extract(year from v_month)::integer,extract(month from v_month)::integer,least(extract(day from p_date)::integer,v_last));
end $$;

create or replace function public.create_installation_cases_for_delivery()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_line record; v_unit integer; v_asset_id uuid; v_case_id uuid; v_number text;
begin
 if new.status<>'delivered' or old.status='delivered' then return new; end if;
 for v_line in
  select line.id,line.product_id,line.quantity
  from public.sales_delivery_lines line
  where line.delivery_note_id=new.id and exists(
   select 1 from public.product_inventory_classifications classification
   where classification.product_id=line.product_id and classification.version=(select max(latest.version) from public.product_inventory_classifications latest where latest.product_id=line.product_id) and classification.category='machines'
  )
 loop
  for v_unit in select generate_series(1,v_line.quantity) loop
   select id into v_asset_id from public.equipment_assets where source_delivery_line_id=v_line.id and unit_number=v_unit;
   if v_asset_id is null then
    v_asset_id:=gen_random_uuid();
    insert into public.equipment_assets(id,organization_id,product_id,source_delivery_line_id,unit_number)
    values(v_asset_id,new.organization_id,v_line.product_id,v_line.id,v_unit);
   end if;
   if not exists(select 1 from public.service_cases where asset_id=v_asset_id and case_type='installation') then
    v_case_id:=gen_random_uuid();
    v_number:='INS-'||to_char(current_date,'YYYY')||'-'||lpad(nextval('public.service_case_number_seq')::text,6,'0');
    insert into public.service_cases(id,case_number,case_type,asset_id,source_delivery_note_id,organization_id,contact_id,product_id,created_by)
    values(v_case_id,v_number,'installation',v_asset_id,new.id,new.organization_id,new.contact_id,v_line.product_id,coalesce(new.delivered_by,new.created_by));
    insert into public.service_case_events(id,case_id,to_status,note,actor_user_id)
    values(gen_random_uuid(),v_case_id,'new','Signed delivery note created this installation case',coalesce(new.delivered_by,new.created_by));
   end if;
  end loop;
 end loop;
 return new;
end $$;

create trigger create_installation_cases_after_delivery
after update of status on public.sales_delivery_notes
for each row execute function public.create_installation_cases_for_delivery();

create or replace function public.create_service_case(p_id uuid,p_asset_id uuid,p_contact_id uuid,p_problem_summary text)
returns public.service_cases language plpgsql security definer set search_path=public,pg_temp as $$
declare v_asset public.equipment_assets; v_row public.service_cases; v_number text;
begin
 if not public.inventory_active_staff() then raise exception 'Active staff access is required'; end if;
 if length(trim(coalesce(p_problem_summary,''))) not between 2 and 4000 then raise exception 'Describe the requested service work'; end if;
 select * into v_asset from public.equipment_assets where id=p_asset_id and status in ('active','in_service') for update;
 if not found then raise exception 'Choose an installed machine'; end if;
 if exists(select 1 from public.service_cases where asset_id=p_asset_id and case_type='service' and status not in ('completed','cancelled')) then raise exception 'This machine already has open service work'; end if;
 if p_contact_id is not null and not exists(select 1 from public.contacts where id=p_contact_id and organization_id=v_asset.organization_id and deleted_at is null and status<>'incorrect') then raise exception 'Choose a current contact for this client'; end if;
 v_number:='SRV-'||to_char(current_date,'YYYY')||'-'||lpad(nextval('public.service_case_number_seq')::text,6,'0');
 insert into public.service_cases(id,case_number,case_type,asset_id,organization_id,contact_id,product_id,problem_summary,created_by)
 values(p_id,v_number,'service',v_asset.id,v_asset.organization_id,p_contact_id,v_asset.product_id,trim(p_problem_summary),auth.uid()) returning * into v_row;
 insert into public.service_case_events(id,case_id,to_status,note,actor_user_id) values(gen_random_uuid(),v_row.id,'new','Service request recorded',auth.uid());
 return v_row;
end $$;

create or replace function public.advance_service_case(p_id uuid,p_expected_version integer,p_action text,p_assigned_user_id uuid default null,p_scheduled_for date default null,p_note text default '')
returns public.service_cases language plpgsql security definer set search_path=public,pg_temp as $$
declare v_row public.service_cases; v_from text; v_to text; v_assignee uuid;
begin
 if not public.inventory_active_staff() then raise exception 'Active staff access is required'; end if;
 if length(trim(coalesce(p_note,''))) not between 2 and 2000 then raise exception 'Enter a progress note'; end if;
 select * into v_row from public.service_cases where id=p_id and version=p_expected_version for update;
 if not found then raise exception 'Service case changed; refresh before continuing'; end if;
 v_from:=v_row.status;
 if p_action='assign' and v_from='new' then v_to:='assigned';
 elsif p_action='reassign' and v_from in ('assigned','scheduled') then v_to:=v_from;
 elsif p_action='schedule' and v_from='assigned' then v_to:='scheduled';
 elsif p_action='start' and v_from='scheduled' then v_to:='on_site';
 elsif p_action='submit_report' and v_from='on_site' then v_to:='report_required';
 elsif p_action='cancel' and v_from in ('new','assigned','scheduled') then v_to:='cancelled';
 else raise exception 'This is not the next allowed service step'; end if;
 v_assignee:=case when p_action in ('assign','reassign') then p_assigned_user_id else v_row.assigned_user_id end;
 if v_to not in ('new','cancelled') and (v_assignee is null or not exists(select 1 from public.staff where user_id=v_assignee and active=true)) then raise exception 'Choose an active employee'; end if;
 if p_action='schedule' and (p_scheduled_for is null or p_scheduled_for<current_date) then raise exception 'Choose today or a future work date'; end if;
 update public.service_cases set status=v_to,assigned_user_id=v_assignee,
  hod_user_id=case when p_action='assign' then auth.uid() else hod_user_id end,
  scheduled_for=case when p_action='schedule' then p_scheduled_for else scheduled_for end,
  started_at=case when p_action='start' then now() else started_at end,
  completed_at=completed_at,
  version=version+1,updated_at=now()
 where id=v_row.id returning * into v_row;
 insert into public.service_case_events(id,case_id,from_status,to_status,note,assigned_user_id,actor_user_id)
 values(gen_random_uuid(),v_row.id,v_from,v_to,trim(p_note),v_assignee,auth.uid());
 return v_row;
end $$;

create or replace function public.complete_service_report(
 p_case_id uuid,p_expected_version integer,p_actual_work_date date,p_equipment_model text,p_serial_number text,p_installation_location text,
 p_project_name text,p_subject text,p_work_completed text,p_parts_used text,p_actual_engineer_id uuid,p_actual_engineer_name text,
 p_engineer_signed_date date,p_customer_representative text,p_customer_signed_date date,p_customer_signoff_reference text,
 p_anudha_representative text,p_anudha_signed_date date,p_anudha_signoff_reference text,p_training_completed boolean,p_qc_training_status text,
 p_machine_collected boolean,p_collection_representative text,p_collection_signed_date date,p_collection_reference text,
 p_currency text,p_service_charge_minor bigint,p_charge_reference text,p_maintenance_interval_months integer,p_accessories jsonb,p_attendees jsonb
)
returns public.service_cases language plpgsql security definer set search_path=public,pg_temp as $$
declare v_case public.service_cases; v_asset public.equipment_assets; v_report_id uuid; v_next date; v_next_case_id uuid; v_next_number text; v_customer text; v_contact text; v_phone text; v_product text;
begin
 if not public.inventory_active_staff() then raise exception 'Active staff access is required'; end if;
 select * into v_case from public.service_cases where id=p_case_id and version=p_expected_version and status='report_required' for update;
 if not found then raise exception 'Service case changed or is not ready for its report'; end if;
 select * into v_asset from public.equipment_assets where id=v_case.asset_id for update;
 if p_actual_work_date is null or p_actual_work_date>current_date then raise exception 'Enter the actual completed work date'; end if;
 if p_maintenance_interval_months not in (3,6,12,24,36) then raise exception 'Choose a maintenance interval'; end if;
 if length(trim(coalesce(p_equipment_model,'')))<1 or length(trim(coalesce(p_serial_number,'')))<1 or length(trim(coalesce(p_installation_location,'')))<2 then raise exception 'Model, serial number and machine location are required'; end if;
 if length(trim(coalesce(p_work_completed,'')))<2 or length(trim(coalesce(p_actual_engineer_name,'')))<2 then raise exception 'Work completed and actual engineer are required'; end if;
 if p_actual_engineer_id is null or not exists(select 1 from public.staff where user_id=p_actual_engineer_id and active=true) then raise exception 'Choose an active engineer'; end if;
 if length(trim(coalesce(p_customer_representative,'')))<2 or p_customer_signed_date is null or length(trim(coalesce(p_customer_signoff_reference,'')))<2 then raise exception 'Customer sign-off is required'; end if;
 if length(trim(coalesce(p_anudha_representative,'')))<2 or p_anudha_signed_date is null or length(trim(coalesce(p_anudha_signoff_reference,'')))<2 then raise exception 'Anudha sign-off is required'; end if;
 if v_case.case_type='installation' and (p_training_completed is not true or p_qc_training_status not in ('completed','not_applicable') or jsonb_typeof(p_attendees)<>'array' or jsonb_array_length(p_attendees) not between 1 and 10) then raise exception 'Record installation training, QC training and 1 to 10 attendees'; end if;
 if jsonb_typeof(p_accessories)<>'array' or jsonb_array_length(p_accessories)>100 then raise exception 'Accessories must be a list of at most 100 rows'; end if;
 if p_machine_collected is true and (length(trim(coalesce(p_collection_representative,'')))<2 or p_collection_signed_date is null or length(trim(coalesce(p_collection_reference,'')))<2) then raise exception 'Complete the machine collection sign-off'; end if;
 if p_currency not in ('TZS','USD','EUR') or p_service_charge_minor<0 then raise exception 'Enter a valid service charge'; end if;
 if exists(select 1 from public.equipment_assets where lower(trim(serial_number))=lower(trim(p_serial_number)) and id<>v_asset.id) then raise exception 'This serial number belongs to another machine'; end if;
 select name into v_customer from public.organizations where id=v_case.organization_id;
 select trim(concat_ws(' ',title,first_name,last_name)),trim(concat_ws(' ',country_code,phone)) into v_contact,v_phone from public.contacts where id=v_case.contact_id;
 select name into v_product from public.products where id=v_case.product_id;
 v_next:=public.service_add_months(p_actual_work_date,p_maintenance_interval_months);
 v_report_id:=gen_random_uuid();
 insert into public.service_reports(id,case_id,template_code,customer_name,contact_name,contact_phone,project_name,installation_location,equipment_name,equipment_model,serial_number,subject,reported_problem,work_completed,parts_used,actual_work_date,actual_engineer_id,actual_engineer_name,engineer_signed_date,customer_representative,customer_signed_date,customer_signoff_reference,anudha_representative,anudha_signed_date,anudha_signoff_reference,training_completed,qc_training_status,machine_collected,collection_representative,collection_signed_date,collection_reference,currency,service_charge_minor,charge_reference,maintenance_interval_months,next_maintenance_date,submitted_by)
 values(v_report_id,v_case.id,case when v_case.case_type='installation' then 'installation_rev_2' else 'service_rev_2' end,v_customer,coalesce(v_contact,''),coalesce(v_phone,''),trim(coalesce(p_project_name,'')),trim(p_installation_location),v_product,trim(p_equipment_model),trim(p_serial_number),trim(coalesce(p_subject,'')),v_case.problem_summary,trim(p_work_completed),trim(coalesce(p_parts_used,'')),p_actual_work_date,p_actual_engineer_id,trim(p_actual_engineer_name),p_engineer_signed_date,trim(p_customer_representative),p_customer_signed_date,trim(p_customer_signoff_reference),trim(p_anudha_representative),p_anudha_signed_date,trim(p_anudha_signoff_reference),case when v_case.case_type='installation' then p_training_completed else null end,case when v_case.case_type='installation' then p_qc_training_status else null end,p_machine_collected,case when p_machine_collected then trim(p_collection_representative) end,case when p_machine_collected then p_collection_signed_date end,case when p_machine_collected then trim(p_collection_reference) end,p_currency,p_service_charge_minor,trim(coalesce(p_charge_reference,'')),p_maintenance_interval_months,v_next,auth.uid());
 insert into public.service_report_accessories(id,report_id,sort_order,description,serial_number)
 select gen_random_uuid(),v_report_id,ordinality,trim(row.description),trim(coalesce(row.serial_number,'')) from jsonb_to_recordset(p_accessories) with ordinality as row(description text,serial_number text,ordinality bigint);
 if v_case.case_type='installation' then
  insert into public.service_training_attendees(id,report_id,sort_order,full_name,telephone,designation)
  select gen_random_uuid(),v_report_id,ordinality,trim(row.full_name),trim(row.telephone),trim(row.designation) from jsonb_to_recordset(p_attendees) with ordinality as row(full_name text,telephone text,designation text,ordinality bigint);
 end if;
 update public.equipment_assets set model=trim(p_equipment_model),serial_number=trim(p_serial_number),installation_location=trim(p_installation_location),status='active',installed_on=coalesce(installed_on,p_actual_work_date),maintenance_interval_months=p_maintenance_interval_months,next_maintenance_date=v_next,updated_at=now() where id=v_asset.id;
 update public.service_cases set status='completed',completed_at=now(),version=version+1,updated_at=now() where id=v_case.id returning * into v_case;
 insert into public.service_case_events(id,case_id,from_status,to_status,note,assigned_user_id,actor_user_id) values(gen_random_uuid(),v_case.id,'report_required','completed','Signed report completed; next service scheduled',v_case.assigned_user_id,auth.uid());
 v_next_case_id:=gen_random_uuid(); v_next_number:='SRV-'||to_char(current_date,'YYYY')||'-'||lpad(nextval('public.service_case_number_seq')::text,6,'0');
 insert into public.service_cases(id,case_number,case_type,asset_id,source_case_id,organization_id,contact_id,product_id,status,hod_user_id,assigned_user_id,scheduled_for,problem_summary,created_by)
 values(v_next_case_id,v_next_number,'service',v_case.asset_id,v_case.id,v_case.organization_id,v_case.contact_id,v_case.product_id,'scheduled',v_case.hod_user_id,coalesce(v_case.assigned_user_id,p_actual_engineer_id),v_next,'Planned preventive maintenance',auth.uid());
 insert into public.service_case_events(id,case_id,to_status,note,assigned_user_id,actor_user_id) values(gen_random_uuid(),v_next_case_id,'scheduled','Automatically scheduled from completed report',coalesce(v_case.assigned_user_id,p_actual_engineer_id),auth.uid());
 return v_case;
end $$;

alter table public.equipment_assets enable row level security;
alter table public.service_cases enable row level security;
alter table public.service_case_events enable row level security;
alter table public.service_reports enable row level security;
alter table public.service_report_accessories enable row level security;
alter table public.service_training_attendees enable row level security;
create policy equipment_assets_read on public.equipment_assets for select to authenticated using (public.inventory_active_staff());
create policy service_cases_read on public.service_cases for select to authenticated using (public.inventory_active_staff());
create policy service_case_events_read on public.service_case_events for select to authenticated using (public.inventory_active_staff());
create policy service_reports_read on public.service_reports for select to authenticated using (public.inventory_active_staff());
create policy service_report_accessories_read on public.service_report_accessories for select to authenticated using (public.inventory_active_staff());
create policy service_training_attendees_read on public.service_training_attendees for select to authenticated using (public.inventory_active_staff());
revoke all on public.equipment_assets,public.service_cases,public.service_case_events,public.service_reports,public.service_report_accessories,public.service_training_attendees from anon;
grant select on public.equipment_assets,public.service_cases,public.service_case_events,public.service_reports,public.service_report_accessories,public.service_training_attendees to authenticated;
revoke all on function public.create_service_case(uuid,uuid,uuid,text) from public,anon;
revoke all on function public.advance_service_case(uuid,integer,text,uuid,date,text) from public,anon;
revoke all on function public.complete_service_report(uuid,integer,date,text,text,text,text,text,text,text,uuid,text,date,text,date,text,text,date,text,boolean,text,boolean,text,date,text,text,bigint,text,integer,jsonb,jsonb) from public,anon;
grant execute on function public.create_service_case(uuid,uuid,uuid,text) to authenticated;
grant execute on function public.advance_service_case(uuid,integer,text,uuid,date,text) to authenticated;
grant execute on function public.complete_service_report(uuid,integer,date,text,text,text,text,text,text,text,uuid,text,date,text,date,text,text,date,text,boolean,text,boolean,text,date,text,text,bigint,text,integer,jsonb,jsonb) to authenticated;

commit;
