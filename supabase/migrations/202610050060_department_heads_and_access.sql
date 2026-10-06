-- Department heads and per-person access. Three levels: owner (everything), department head (manages the people in
-- their own department) and staff. Each head or staff member has a list of areas they may use; the database checks it
-- on every save (require_access at the top of each save/advance function) and every read (has_access in the read
-- rules), so hiding a menu item is never the only protection. A head can create logins for their own department, reset
-- their passwords and two-step sign-in, switch them on or off, and give them only areas the head has. Heads can see
-- the whole staff list but change only their own department. Approving purchases and travel stays owner-only.
-- Everyone already on the staff list keeps today's full access (all areas). Every change is logged.
-- Rollback: a forward migration that sets has_access() to inventory_active_staff() restores today's behaviour.
begin;

alter table public.staff drop constraint staff_role_check;
alter table public.staff add constraint staff_role_check check (role in ('owner','head','staff'));

create function public.staff_access_areas() returns text[] language sql immutable set search_path=public,pg_temp as $$
 select array['leads','proformas','deliveries','service','purchasing','stock','stock_count','travel','reports']::text[]
$$;
alter table public.staff add column access text[] not null default '{}'
 check (access <@ array['leads','proformas','deliveries','service','purchasing','stock','stock_count','travel','reports']::text[]);
update public.staff set access=public.staff_access_areas() where role<>'owner';

alter table public.staff_account_events drop constraint staff_account_events_action_check;
alter table public.staff_account_events add constraint staff_account_events_action_check check (action in
 ('created','password_reset','phone_changed','department_changed','two_step_reset','access_changed','role_changed','deactivated','reactivated'));

-- The owner has every area; a head or staff member has the areas on their list.
create function public.has_access(p_area text) returns boolean
language sql stable security definer set search_path=public,pg_temp as $$
 select exists(select 1 from public.staff s where s.user_id=(select auth.uid()) and s.active and (s.role='owner' or p_area=any(s.access)))
  and public.mfa_satisfied()
$$;
create function public.require_access(p_area text) returns void
language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
 if not public.has_access(p_area) then
  raise exception 'You do not have access to %. Ask your department head.', replace(p_area,'_',' ') using errcode='42501';
 end if;
end $$;
create function public.is_department_head() returns boolean
language sql stable security definer set search_path=public,pg_temp as $$
 select exists(select 1 from public.staff where user_id=(select auth.uid()) and active and role='head') and public.mfa_satisfied()
$$;
-- The owner manages everyone; a head manages staff (not other heads or owners) in their own department, not themself.
create function public.can_manage_staff(p_user_id uuid) returns boolean
language sql stable security definer set search_path=public,pg_temp as $$
 select public.mfa_satisfied() and exists(
  select 1 from public.staff me where me.user_id=(select auth.uid()) and me.active and (
   me.role='owner' or (me.role='head' and me.department<>'' and p_user_id<>me.user_id and exists(
    select 1 from public.staff t where t.user_id=p_user_id and t.role='staff' and t.department=me.department))))
$$;

-- Read rules: heads see the whole staff list; the account history follows who may manage the person.
alter policy staff_read on public.staff using ((user_id = (select auth.uid())) or (select public.is_owner()) or (select public.is_department_head()));
alter policy staff_account_events_read on public.staff_account_events using ((select public.is_owner()) or public.can_manage_staff(user_id));

-- Read rules per area.
alter policy sales_leads_read on public.sales_leads using ((select public.has_access('leads')));
alter policy sales_lead_events_read on public.sales_lead_events using ((select public.has_access('leads')));
alter policy sales_proformas_read on public.sales_proformas using ((select public.has_access('proformas')));
alter policy sales_proforma_lines_read on public.sales_proforma_lines using ((select public.has_access('proformas')));
alter policy sales_proforma_revisions_read on public.sales_proforma_revisions using ((select public.has_access('proformas')));
alter policy sales_proforma_events_read on public.sales_proforma_events using ((select public.has_access('proformas')));
alter policy sales_delivery_notes_read on public.sales_delivery_notes using ((select public.has_access('deliveries')));
alter policy sales_delivery_lines_read on public.sales_delivery_lines using ((select public.has_access('deliveries')));
alter policy sales_delivery_events_read on public.sales_delivery_events using ((select public.has_access('deliveries')));
alter policy service_cases_read on public.service_cases using ((select public.has_access('service')));
alter policy service_case_events_read on public.service_case_events using ((select public.has_access('service')));
alter policy service_reports_read on public.service_reports using ((select public.has_access('service')));
alter policy service_report_accessories_read on public.service_report_accessories using ((select public.has_access('service')));
alter policy service_training_attendees_read on public.service_training_attendees using ((select public.has_access('service')));
alter policy purchase_orders_read on public.purchase_orders using ((select public.has_access('purchasing')));
alter policy purchase_order_lines_read on public.purchase_order_lines using ((select public.has_access('purchasing')));
alter policy purchase_order_events_read on public.purchase_order_events using ((select public.has_access('purchasing')));
alter policy suppliers_read on public.suppliers using ((select public.has_access('purchasing')));
alter policy inventory_locations_read on public.inventory_locations using ((select public.has_access('stock')));
alter policy inventory_lots_read on public.inventory_lots using ((select public.has_access('stock')));
alter policy inventory_movements_read on public.inventory_movements using ((select public.has_access('stock')));
alter policy inventory_transfers_read on public.inventory_transfers using ((select public.has_access('stock')));
alter policy inventory_issues_read on public.inventory_issues using ((select public.has_access('stock')));
alter policy stock_count_sessions_read on public.stock_count_sessions using ((select public.has_access('stock_count')));
alter policy stock_count_entries_read on public.stock_count_entries using ((select public.has_access('stock_count')));
alter policy count_catalogue_read on public.count_catalogue using ((select public.has_access('stock_count')));
alter policy travel_requests_read on public.travel_requests using ((select public.has_access('travel')));
alter policy travel_request_events_read on public.travel_request_events using ((select public.has_access('travel')));

-- Owner: give someone a role (owner, head or staff) or switch them on/off. Changes to an existing person are logged.
create or replace function public.manage_staff(p_user_id uuid, p_role text, p_active boolean)
 returns public.staff language plpgsql security definer set search_path to 'pg_catalog','public' as $function$
declare result public.staff; v_old public.staff;
begin
  -- Serialize membership edits, including the last-owner check.
  lock table public.staff in share row exclusive mode;
  if not public.is_owner() then raise exception 'Owner access required' using errcode='42501'; end if;
  if p_role is null or p_role not in ('owner','head','staff') or p_active is null then raise exception 'Invalid membership'; end if;
  if exists(select 1 from public.staff where user_id=p_user_id and active and role='owner')
    and (not p_active or p_role <> 'owner')
    and (select count(*) from public.staff where active and role='owner') <= 1 then
    raise exception 'At least one active owner is required';
  end if;
  select * into v_old from public.staff where user_id=p_user_id;
  insert into public.staff(user_id,role,active) values(p_user_id,p_role,p_active)
  on conflict(user_id) do update set role=excluded.role,active=excluded.active returning * into result;
  if v_old.user_id is not null and v_old.role<>result.role then
    insert into public.staff_account_events(user_id,action,note,actor_user_id) values(p_user_id,'role_changed',v_old.role||' → '||result.role,auth.uid());
  end if;
  if v_old.user_id is not null and v_old.active<>result.active then
    insert into public.staff_account_events(user_id,action,note,actor_user_id) values(p_user_id,case when result.active then 'reactivated' else 'deactivated' end,'',auth.uid());
  end if;
  return result;
end $function$;

-- Which areas a person may use. A head can only give areas they have themselves.
create function public.set_staff_access(p_user_id uuid, p_access text[])
returns public.staff language plpgsql security definer set search_path=public,pg_temp as $$
declare v_row public.staff; v_me public.staff; v_access text[];
begin
 select array(select distinct a from unnest(coalesce(p_access,'{}')) a order by a) into v_access;
 if not (v_access <@ public.staff_access_areas()) then raise exception 'Choose areas from the list'; end if;
 if not public.can_manage_staff(p_user_id) then raise exception 'You can only change access for people in your own department' using errcode='42501'; end if;
 select * into v_me from public.staff where user_id=auth.uid();
 select * into v_row from public.staff where user_id=p_user_id for update;
 if not found then raise exception 'Staff account does not exist'; end if;
 if v_row.role='owner' then raise exception 'Owners always have full access'; end if;
 if v_me.role<>'owner' and not (v_access <@ v_me.access) then
  raise exception 'You can only give access you have yourself: %', array_to_string(array(select a from unnest(v_access) a where not a=any(v_me.access)),', ');
 end if;
 if v_row.access is distinct from v_access then
  update public.staff set access=v_access where user_id=p_user_id returning * into v_row;
  insert into public.staff_account_events(user_id,action,note,actor_user_id) values(p_user_id,'access_changed',left(array_to_string(v_access,', '),500),auth.uid());
 end if;
 return v_row;
end $$;

-- Head: put a newly created login on the staff list in the head's own department (called by the staff-accounts
-- Edge Function under the head's session). The owner uses manage_staff instead.
create function public.add_department_staff(p_user_id uuid, p_access text[])
returns public.staff language plpgsql security definer set search_path=public,pg_temp as $$
declare v_me public.staff; v_row public.staff; v_access text[];
begin
 select array(select distinct a from unnest(coalesce(p_access,'{}')) a order by a) into v_access;
 select * into v_me from public.staff where user_id=auth.uid() and active and role='head';
 if not found or not public.mfa_satisfied() then raise exception 'Only a department head can add staff here' using errcode='42501'; end if;
 if v_me.department='' then raise exception 'Ask the owner to set your department first'; end if;
 if not (v_access <@ v_me.access) then raise exception 'You can only give access you have yourself'; end if;
 if not exists(select 1 from auth.users where id=p_user_id) then raise exception 'Login not found'; end if;
 if exists(select 1 from public.staff where user_id=p_user_id) then raise exception 'This person is already on the staff list'; end if;
 insert into public.staff(user_id,role,active,department,access) values(p_user_id,'staff',true,v_me.department,v_access) returning * into v_row;
 return v_row;
end $$;

-- Owner or head: switch a person's login on or off (someone leaving, or coming back).
create function public.set_staff_active(p_user_id uuid, p_active boolean)
returns public.staff language plpgsql security definer set search_path=public,pg_temp as $$
declare v_row public.staff;
begin
 if p_active is null then raise exception 'Choose on or off'; end if;
 if p_user_id=auth.uid() then raise exception 'You cannot switch off your own login'; end if;
 if not public.can_manage_staff(p_user_id) then raise exception 'You can only change people in your own department' using errcode='42501'; end if;
 select * into v_row from public.staff where user_id=p_user_id for update;
 if not found then raise exception 'Staff account does not exist'; end if;
 if v_row.role='owner' then raise exception 'Use the owner settings to change an owner'; end if;
 if v_row.active<>p_active then
  update public.staff set active=p_active where user_id=p_user_id returning * into v_row;
  insert into public.staff_account_events(user_id,action,note,actor_user_id) values(p_user_id,case when p_active then 'reactivated' else 'deactivated' end,'',auth.uid());
 end if;
 return v_row;
end $$;

-- Name, phone and history: the owner for anyone, a head for their own department.
create or replace function public.record_staff_account_event(p_user_id uuid, p_action text, p_note text default '')
returns public.staff_account_events language plpgsql security definer set search_path=public,pg_temp as $$
declare v_row public.staff_account_events;
begin
 if not public.can_manage_staff(p_user_id) then raise exception 'Owner or department head access required' using errcode='42501'; end if;
 if not exists(select 1 from public.staff where user_id=p_user_id) then raise exception 'Staff account does not exist'; end if;
 insert into public.staff_account_events(user_id,action,note,actor_user_id) values(p_user_id,p_action,left(trim(coalesce(p_note,'')),500),auth.uid()) returning * into v_row;
 return v_row;
end $$;

create or replace function public.set_staff_phone(p_user_id uuid, p_phone text)
returns public.staff language plpgsql security definer set search_path=public,pg_temp as $$
declare v_row public.staff; v_phone text := regexp_replace(coalesce(p_phone,''),'[[:space:]()-]','','g');
begin
 if not public.can_manage_staff(p_user_id) then raise exception 'Owner or department head access required' using errcode='42501'; end if;
 if v_phone <> '' and v_phone !~ '^\+[0-9]{8,15}$' then raise exception 'Enter the phone with country code, for example +255712345678'; end if;
 update public.staff set phone=v_phone where user_id=p_user_id returning * into v_row;
 if not found then raise exception 'Staff account does not exist'; end if;
 insert into public.staff_account_events(user_id,action,note,actor_user_id) values(p_user_id,'phone_changed',v_phone,auth.uid());
 return v_row;
end $$;

create or replace function public.set_staff_display_name(p_user_id uuid, p_expected_version integer, p_display_name text)
 returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $function$
declare v_row public.staff; v_name text:=regexp_replace(p_display_name,'^[[:space:]]+|[[:space:]]+$','','g');
begin
 if not public.can_manage_staff(p_user_id) then raise exception 'Owner or department head access required'; end if;
 if p_user_id is null or p_expected_version is null or p_expected_version<0 then raise exception 'Staff account and nonnegative expected version are required'; end if;
 if v_name is null or length(v_name) not between 1 and 120 then raise exception 'Display name must be nonblank and at most 120 characters'; end if;
 perform pg_advisory_xact_lock(20260929,40);
 select * into v_row from public.staff where user_id=p_user_id for update; if not found then raise exception 'Staff account does not exist'; end if;
 if v_row.name_version<>p_expected_version then raise exception 'Staff name changed; refresh before saving'; end if;
 if v_row.name_version=2147483647 then raise exception 'Staff name version exhausted'; end if;
 update public.staff set display_name=v_name,name_version=name_version+1 where user_id=p_user_id returning * into v_row;
 return jsonb_build_object('user_id',v_row.user_id,'display_name',v_row.display_name,'name_version',v_row.name_version,'active',v_row.active);
end $function$;

-- The name guard on the staff table itself follows the same rule (it used to allow only the owner).
create or replace function public.audit_staff_display_name_change()
 returns trigger language plpgsql security definer set search_path to 'public','pg_temp' as $function$ begin
if tg_op='INSERT' then if new.display_name is not null or new.name_version is distinct from 0 then raise exception 'Start unnamed at version zero; the owner or department head sets the display name separately';end if;return new;end if;
if row(new.display_name,new.name_version) is not distinct from row(old.display_name,old.name_version) then return new;end if;
if not public.can_manage_staff(old.user_id) then raise exception 'Owner or department head access required';end if;
if new.display_name is null or length(new.display_name) not between 1 and 120 or new.display_name<>regexp_replace(new.display_name,'^[[:space:]]+|[[:space:]]+$','','g') then raise exception 'Display name must be trimmed, nonblank and at most 120 characters';end if;
if new.name_version is null or new.name_version::bigint<>old.name_version::bigint+1 then raise exception 'Name version must increment by one';end if;
insert into public.staff_display_name_events(user_id,old_display_name,new_display_name,old_name_version,new_name_version,actor_user_id) values(old.user_id,old.display_name,new.display_name,old.name_version,new.name_version,auth.uid());return new;end $function$;

create or replace function public.staff_two_step_status()
 returns table(user_id uuid, enabled boolean) language sql stable security definer set search_path to 'public','pg_temp' as $function$
 select s.user_id, exists(select 1 from auth.mfa_factors f where f.user_id = s.user_id and f.status = 'verified')
 from public.staff s where public.is_owner() or public.can_manage_staff(s.user_id)
$function$;

-- Every save and step change checks the area first. Bodies below are unchanged apart from the require_access line.
-- save_sales_lead: needs "leads"
CREATE OR REPLACE FUNCTION public.save_sales_lead(p_id uuid, p_expected_version integer, p_fields jsonb)
 RETURNS sales_leads
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
 v_row public.sales_leads; v_new public.sales_leads;
 v_org uuid; v_contact uuid; v_owner uuid; v_value bigint; v_due date;
begin
 perform public.require_access('leads');
 if not public.inventory_active_staff() then raise exception 'Active staff access is required'; end if;
 if p_id is null or p_expected_version is null or p_expected_version < 0 or p_fields is null or jsonb_typeof(p_fields) <> 'object' then
  raise exception 'Lead request, expected version and fields are required';
 end if;
 begin
  v_org := nullif(p_fields->>'organization_id','')::uuid;
  v_contact := nullif(p_fields->>'contact_id','')::uuid;
  v_owner := nullif(p_fields->>'owner_user_id','')::uuid;
  v_value := nullif(p_fields->>'estimated_value_minor','')::bigint;
  v_due := nullif(p_fields->>'next_action_on','')::date;
 exception when others then raise exception 'Lead fields contain an invalid ID, amount or date';
 end;
 if v_org is not null and not exists(select 1 from public.organizations where id=v_org and deleted_at is null) then raise exception 'Choose an existing client'; end if;
 if v_contact is not null and (v_org is null or not exists(select 1 from public.contacts where id=v_contact and organization_id=v_org and deleted_at is null)) then
  raise exception 'Choose a contact from the selected client';
 end if;
 if not public.sales_lead_active_assignee(v_owner) then raise exception 'Assign the lead to an active employee'; end if;
 perform pg_advisory_xact_lock(hashtextextended('sales-lead:'||p_id::text,0));
 select * into v_row from public.sales_leads where id=p_id for update;
 if p_expected_version = 0 then
  if found then
   -- A lost response is retried with the same ID: return the row this user already created.
   if v_row.created_by = auth.uid() and v_row.version = 1 and v_row.subject = trim(coalesce(p_fields->>'subject','')) then return v_row; end if;
   raise exception 'Lead already exists; refresh and compare';
  end if;
  insert into public.sales_leads(id,lead_number,stage,source,organization_id,contact_id,caller_name,caller_phone,caller_organization,subject,details,
   estimated_value_minor,currency,owner_user_id,next_action,next_action_on,created_by)
  values(p_id,'LD-'||lpad(nextval('public.sales_lead_number_seq')::text,6,'0'),
   case when v_owner is null then 'inquiry' else 'lead' end,
   coalesce(nullif(p_fields->>'source',''),'phone'),v_org,v_contact,
   trim(coalesce(p_fields->>'caller_name','')),trim(coalesce(p_fields->>'caller_phone','')),trim(coalesce(p_fields->>'caller_organization','')),
   trim(coalesce(p_fields->>'subject','')),coalesce(p_fields->>'details',''),v_value,coalesce(nullif(p_fields->>'currency',''),'TZS'),
   v_owner,trim(coalesce(p_fields->>'next_action','')),v_due,auth.uid())
  returning * into v_new;
  insert into public.sales_lead_events(lead_id,action,from_stage,to_stage,assigned_user_id,note,actor_user_id)
  values(v_new.id,'create',null,v_new.stage,v_new.owner_user_id,v_new.subject,auth.uid());
  return v_new;
 end if;
 if not found then raise exception 'Lead not found'; end if;
 if v_row.version <> p_expected_version then raise exception 'Lead changed; refresh and compare'; end if;
 if v_row.stage in ('won','lost') then raise exception 'Reopen the lead before editing it'; end if;
 update public.sales_leads set
  source=coalesce(nullif(p_fields->>'source',''),source),organization_id=v_org,contact_id=v_contact,
  caller_name=trim(coalesce(p_fields->>'caller_name','')),caller_phone=trim(coalesce(p_fields->>'caller_phone','')),
  caller_organization=trim(coalesce(p_fields->>'caller_organization','')),subject=trim(coalesce(p_fields->>'subject','')),
  details=coalesce(p_fields->>'details',''),estimated_value_minor=v_value,currency=coalesce(nullif(p_fields->>'currency',''),currency),
  next_action=trim(coalesce(p_fields->>'next_action','')),next_action_on=v_due,version=version+1,updated_at=now()
 where id=p_id returning * into v_new;
 insert into public.sales_lead_events(lead_id,action,from_stage,to_stage,assigned_user_id,note,actor_user_id)
 values(v_new.id,'edit',v_row.stage,v_new.stage,v_new.owner_user_id,'Details updated',auth.uid());
 return v_new;
end $function$;

-- advance_sales_lead: needs "leads"
CREATE OR REPLACE FUNCTION public.advance_sales_lead(p_id uuid, p_expected_version integer, p_action text, p_assigned_user_id uuid DEFAULT NULL::uuid, p_note text DEFAULT ''::text, p_proforma_id uuid DEFAULT NULL::uuid)
 RETURNS sales_leads
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_row public.sales_leads; v_new public.sales_leads; v_to text; v_note text := trim(coalesce(p_note,''));
begin
 perform public.require_access('leads');
 if not public.inventory_active_staff() then raise exception 'Active staff access is required'; end if;
 if p_id is null or p_expected_version is null or p_action is null then raise exception 'Lead, expected version and action are required'; end if;
 if length(v_note) > 1000 then raise exception 'Note is too long'; end if;
 perform pg_advisory_xact_lock(hashtextextended('sales-lead:'||p_id::text,0));
 select * into v_row from public.sales_leads where id=p_id for update;
 if not found then raise exception 'Lead not found'; end if;
 if v_row.version <> p_expected_version then raise exception 'Lead changed; refresh and compare'; end if;
 v_to := case p_action
  when 'assign' then case when v_row.stage='inquiry' then 'lead' else v_row.stage end
  when 'qualify' then 'lead'
  when 'opportunity' then 'opportunity'
  when 'won' then 'won'
  when 'lost' then 'lost'
  when 'reopen' then 'lead'
  else null end;
 if v_to is null then raise exception 'Unknown lead action'; end if;
 if p_action in ('assign','qualify','opportunity','won','lost') and v_row.stage in ('won','lost') then raise exception 'This lead is closed. Reopen it first'; end if;
 if p_action='reopen' and v_row.stage <> 'lost' then raise exception 'Only lost leads can be reopened'; end if;
 if p_action='qualify' and v_row.stage <> 'inquiry' then raise exception 'Only inquiries can be qualified'; end if;
 if p_action='opportunity' and v_row.stage <> 'lead' then raise exception 'Only qualified leads become opportunities'; end if;
 if p_action='assign' and (p_assigned_user_id is null or not public.sales_lead_active_assignee(p_assigned_user_id)) then raise exception 'Assign the lead to an active employee'; end if;
 if p_action in ('qualify','opportunity','won') and v_row.owner_user_id is null and p_assigned_user_id is null then raise exception 'Assign a salesperson first'; end if;
 if p_action='lost' and length(v_note) < 3 then raise exception 'Enter why the lead was lost'; end if;
 if p_action='won' then
  if p_proforma_id is null then raise exception 'Choose the Pro forma created for this lead'; end if;
  if not exists(select 1 from public.sales_proformas where id=p_proforma_id and deleted_at is null
   and (v_row.organization_id is null or organization_id=v_row.organization_id)) then
   raise exception 'Choose a Pro forma for the same client';
  end if;
  if exists(select 1 from public.sales_leads where proforma_id=p_proforma_id and id<>p_id) then raise exception 'That Pro forma is already linked to another lead'; end if;
 end if;
 update public.sales_leads set stage=v_to,
  owner_user_id=case when p_action='assign' then p_assigned_user_id else coalesce(owner_user_id,p_assigned_user_id) end,
  proforma_id=case when p_action='won' then p_proforma_id when p_action='reopen' then null else proforma_id end,
  organization_id=case when p_action='won' and organization_id is null then (select organization_id from public.sales_proformas where id=p_proforma_id) else organization_id end,
  lost_reason=case when p_action='lost' then v_note when p_action='reopen' then '' else lost_reason end,
  version=version+1,updated_at=now()
 where id=p_id returning * into v_new;
 insert into public.sales_lead_events(lead_id,action,from_stage,to_stage,assigned_user_id,note,actor_user_id)
 values(v_new.id,p_action,v_row.stage,v_new.stage,v_new.owner_user_id,v_note,auth.uid());
 return v_new;
end $function$;

-- save_sales_proforma: needs "proformas"
CREATE OR REPLACE FUNCTION public.save_sales_proforma(p_id uuid, p_expected_version integer, p_organization_id uuid, p_contact_id uuid, p_currency text, p_valid_until date, p_delivery_period text, p_payment_terms text, p_notes text, p_lines jsonb)
 RETURNS sales_proformas
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
 v_row public.sales_proformas;
 v_existing public.sales_proformas;
 v_revision integer;
 v_number text;
 v_count integer;
 v_subtotal bigint;
 v_discount bigint;
 v_tax bigint;
 v_snapshot jsonb;
begin
 perform public.require_access('proformas');
 if not public.inventory_active_staff() then raise exception 'Active staff access is required'; end if;
 -- proforma_save_validation_024
 if p_expected_version is null or p_expected_version<0 then raise exception 'A nonnegative expected version is required'; end if;
 if p_lines is null or jsonb_typeof(p_lines) is distinct from 'array' then raise exception 'Pro forma lines must be a JSON array'; end if;
 if p_currency is null then raise exception 'Choose TZS, USD or EUR currency'; end if;
 if p_currency not in ('TZS','USD','EUR') then raise exception 'Choose TZS, USD or EUR'; end if;
 if p_valid_until is null or p_valid_until<current_date then raise exception 'Validity date cannot be in the past'; end if;
 if length(trim(coalesce(p_delivery_period,''))) not between 2 and 300 then raise exception 'Enter the delivery period'; end if;
 if length(trim(coalesce(p_payment_terms,''))) not between 2 and 1000 then raise exception 'Enter payment terms'; end if;
 if length(coalesce(p_notes,''))>4000 then raise exception 'Notes are too long'; end if;
 if jsonb_typeof(p_lines)<>'array' or jsonb_array_length(p_lines) not between 1 and 100 then raise exception 'Add between 1 and 100 items'; end if;
 if not exists(select 1 from public.organizations where id=p_organization_id and deleted_at is null) or
    not exists(select 1 from public.contacts where id=p_contact_id and organization_id=p_organization_id and deleted_at is null and status<>'incorrect') then
  raise exception 'Choose an active client branch and one of its valid contacts';
 end if;
 select count(*) into v_count from jsonb_array_elements(p_lines) line
 join public.products product on product.id=(line->>'productId')::uuid;
 if v_count<>jsonb_array_length(p_lines) then raise exception 'One or more products are unavailable'; end if;
 if exists(select 1 from jsonb_array_elements(p_lines) line where
   coalesce(line->>'productId','')='' or coalesce((line->>'quantity')::integer,0) not between 1 and 1000000 or
   coalesce((line->>'unitPriceMinor')::bigint,-1)<0 or coalesce((line->>'discountBasisPoints')::integer,-1) not between 0 and 10000 or
   coalesce((line->>'taxBasisPoints')::integer,-1) not between 0 and 10000 or
   length(trim(coalesce(line->>'uom',''))) not between 1 and 40 or length(trim(coalesce(line->>'description',''))) not between 1 and 4000
 ) then raise exception 'Check every item, quantity, unit, price, discount and tax'; end if;

 select coalesce(sum(gross),0),coalesce(sum(discount),0),coalesce(sum(round((gross-discount)*tax_basis_points/10000)),0)
 into v_subtotal,v_discount,v_tax from (
  select (line->>'quantity')::bigint*(line->>'unitPriceMinor')::bigint as gross,
         round((line->>'quantity')::numeric*(line->>'unitPriceMinor')::numeric*(line->>'discountBasisPoints')::numeric/10000) as discount,
         (line->>'taxBasisPoints')::numeric as tax_basis_points
  from jsonb_array_elements(p_lines) line
 ) totals;
 if v_subtotal>9000000000000000 or v_subtotal-v_discount+v_tax>9000000000000000 then raise exception 'Document total is too large'; end if;

 if p_expected_version=0 then
  v_number:='PF-'||to_char(current_date,'YYYY')||'-'||lpad(nextval('public.proforma_document_number_seq')::text,6,'0');
  insert into public.sales_proformas(id,document_number,organization_id,contact_id,currency,valid_until,delivery_period,payment_terms,notes,subtotal_minor,discount_minor,tax_minor,total_minor,prepared_by)
  values(p_id,v_number,p_organization_id,p_contact_id,p_currency,p_valid_until,trim(p_delivery_period),trim(p_payment_terms),trim(coalesce(p_notes,'')),v_subtotal,v_discount,v_tax,v_subtotal-v_discount+v_tax,auth.uid()) returning * into v_row;
 else
  select * into v_existing from public.sales_proformas where id=p_id for update;
  if not found then raise exception 'Pro forma invoice not found'; end if;
  if v_existing.version<>p_expected_version then raise exception 'Pro forma changed; refresh before saving'; end if;
  if v_existing.status<>'draft' then raise exception 'Only a draft can be revised'; end if;
  update public.sales_proformas set organization_id=p_organization_id,contact_id=p_contact_id,currency=p_currency,valid_until=p_valid_until,
   delivery_period=trim(p_delivery_period),payment_terms=trim(p_payment_terms),notes=trim(coalesce(p_notes,'')),subtotal_minor=v_subtotal,
   discount_minor=v_discount,tax_minor=v_tax,total_minor=v_subtotal-v_discount+v_tax,revision=revision+1,version=version+1,updated_at=now()
  where id=p_id returning * into v_row;
  delete from public.sales_proforma_lines where proforma_id=p_id;
 end if;

 insert into public.sales_proforma_lines(id,proforma_id,product_id,sort_order,description,quantity,uom,unit_price_minor,discount_basis_points,tax_basis_points)
 select gen_random_uuid(),v_row.id,(line->>'productId')::uuid,ordinality,trim(line->>'description'),(line->>'quantity')::integer,trim(line->>'uom'),
        (line->>'unitPriceMinor')::bigint,(line->>'discountBasisPoints')::integer,(line->>'taxBasisPoints')::integer
 from jsonb_array_elements(p_lines) with ordinality as item(line,ordinality);

 select jsonb_build_object('documentNumber',v_row.document_number,'revision',v_row.revision,'organizationId',v_row.organization_id,'contactId',v_row.contact_id,
  'currency',v_row.currency,'validUntil',v_row.valid_until,'deliveryPeriod',v_row.delivery_period,'paymentTerms',v_row.payment_terms,'notes',v_row.notes,
  'subtotalMinor',v_row.subtotal_minor,'discountMinor',v_row.discount_minor,'taxMinor',v_row.tax_minor,'totalMinor',v_row.total_minor,
  'lines',jsonb_agg(jsonb_build_object('productId',l.product_id,'description',l.description,'quantity',l.quantity,'uom',l.uom,'unitPriceMinor',l.unit_price_minor,'discountBasisPoints',l.discount_basis_points,'taxBasisPoints',l.tax_basis_points) order by l.sort_order))
 into v_snapshot from public.sales_proforma_lines l where l.proforma_id=v_row.id;
 insert into public.sales_proforma_revisions(id,proforma_id,revision,snapshot,created_by) values(gen_random_uuid(),v_row.id,v_row.revision,v_snapshot,auth.uid());
 if p_expected_version=0 then insert into public.sales_proforma_events(id,proforma_id,to_status,reference,actor_user_id) values(gen_random_uuid(),v_row.id,'draft','Created',auth.uid()); end if;
 return v_row;
end $function$;

-- advance_sales_proforma: needs "proformas"
CREATE OR REPLACE FUNCTION public.advance_sales_proforma(p_id uuid, p_expected_version integer, p_action text, p_reference text DEFAULT ''::text)
 RETURNS sales_proformas
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_row public.sales_proformas; v_from text; v_to text; v_reference text:=trim(coalesce(p_reference,''));
begin
 perform public.require_access('proformas');
 if not public.inventory_active_staff() then raise exception 'Active staff access is required'; end if;
 select * into v_row from public.sales_proformas where id=p_id and version=p_expected_version for update;
 if not found then raise exception 'Pro forma changed; refresh before continuing'; end if;
 v_from:=v_row.status;
 if p_action='send' and v_from='draft' then v_to:='sent';
 elsif p_action='revise' and v_from='sent' then v_to:='draft';
 elsif p_action='accept' and v_from='sent' then v_to:='accepted';
 elsif p_action='reject' and v_from='sent' then v_to:='rejected';
 elsif p_action='cancel' and v_from in ('draft','sent') then v_to:='cancelled';
 else raise exception 'This is not the next allowed Pro forma step'; end if;
 if p_action in ('revise','accept','reject','cancel') and length(v_reference)<2 then raise exception 'Enter the customer reference or reason'; end if;
 update public.sales_proformas set status=v_to,version=version+1,updated_at=now(),
  acceptance_reference=case when v_to='accepted' then v_reference else acceptance_reference end,
  accepted_by=case when v_to='accepted' then auth.uid() else accepted_by end,
  accepted_at=case when v_to='accepted' then now() else accepted_at end
 where id=v_row.id returning * into v_row;
 insert into public.sales_proforma_events(id,proforma_id,from_status,to_status,reference,actor_user_id) values(gen_random_uuid(),v_row.id,v_from,v_to,v_reference,auth.uid());
 return v_row;
end $function$;

-- create_sales_delivery_note: needs "deliveries"
CREATE OR REPLACE FUNCTION public.create_sales_delivery_note(p_id uuid, p_proforma_id uuid, p_expected_proforma_version integer, p_accounts_reference text, p_expected_delivery_date date, p_lines jsonb)
 RETURNS sales_delivery_notes
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_proforma public.sales_proformas; v_row public.sales_delivery_notes; v_number text;
begin
 perform public.require_access('deliveries');
 if not public.inventory_active_staff() then raise exception 'Active staff access is required'; end if;
 if length(trim(coalesce(p_accounts_reference,''))) not between 2 and 120 then raise exception 'Enter the Accounts approval reference'; end if;
 if p_expected_delivery_date is null or p_expected_delivery_date<current_date then raise exception 'Expected delivery date cannot be in the past'; end if;
 select * into v_proforma from public.sales_proformas where id=p_proforma_id and version=p_expected_proforma_version and status='accepted' for update;
 if not found then raise exception 'Submitted Pro forma changed; refresh before recording approval'; end if;
 if exists(select 1 from public.sales_delivery_notes where proforma_id=p_proforma_id and status not in ('cancelled','delivered')) then raise exception 'This Pro forma already has an open delivery'; end if;
 if not exists(
  select 1 from public.sales_proforma_lines pl where pl.proforma_id=p_proforma_id and pl.quantity>
   coalesce((select sum(dl.quantity) from public.sales_delivery_lines dl join public.sales_delivery_notes dn on dn.id=dl.delivery_note_id where dl.proforma_line_id=pl.id and dn.status<>'cancelled'),0)
 ) then raise exception 'Every accepted quantity is already assigned to a delivery'; end if;
 v_number:='DN-'||to_char(current_date,'YYYY')||'-'||lpad(nextval('public.delivery_note_number_seq')::text,6,'0');
 insert into public.sales_delivery_notes(id,delivery_number,proforma_id,organization_id,contact_id,accounts_reference,expected_delivery_date,created_by)
 values(p_id,v_number,v_proforma.id,v_proforma.organization_id,v_proforma.contact_id,trim(p_accounts_reference),p_expected_delivery_date,auth.uid()) returning * into v_row;
 insert into public.sales_delivery_events(id,delivery_note_id,to_status,reference,actor_user_id)
 values(gen_random_uuid(),v_row.id,'accounts_approved',v_row.accounts_reference,auth.uid());
 return v_row;
end $function$;

-- advance_sales_delivery: needs "deliveries"
CREATE OR REPLACE FUNCTION public.advance_sales_delivery(p_id uuid, p_expected_version integer, p_action text, p_carrier text DEFAULT ''::text, p_tracking_reference text DEFAULT ''::text, p_recipient_name text DEFAULT ''::text, p_proof_reference text DEFAULT ''::text)
 RETURNS sales_delivery_notes
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_row public.sales_delivery_notes; v_from text; v_to text; v_line record; v_lot public.inventory_lots; v_issue_id uuid; v_reference text;
begin
 perform public.require_access('deliveries');
 if not public.inventory_active_staff() then raise exception 'Active staff access is required'; end if;
 select * into v_row from public.sales_delivery_notes where id=p_id and version=p_expected_version for update;
 if not found then raise exception 'Delivery changed; refresh before continuing'; end if;
 v_from:=v_row.status;
 if p_action='tax_invoice' and v_from='accounts_approved' then v_to:='tax_invoice_created';
 elsif p_action='send_to_sales' and v_from='tax_invoice_created' then v_to:='sent_to_sales';
 elsif p_action='ready' and v_from='packing' then v_to:='ready';
 elsif p_action='dispatch' and v_from='ready' then v_to:='out_for_delivery';
 elsif p_action='deliver' and v_from='out_for_delivery' then v_to:='delivered';
 elsif p_action='cancel' and v_from in ('accounts_approved','tax_invoice_created','sent_to_sales','packing','ready') then v_to:='cancelled';
 else raise exception 'This is not the next allowed delivery step'; end if;

 if p_action='tax_invoice' and length(trim(coalesce(p_proof_reference,''))) not between 2 and 120 then raise exception 'Enter a valid tax invoice number or reference'; end if;
 if p_action='dispatch' and (length(trim(coalesce(p_carrier,''))) not between 2 and 200 or length(trim(coalesce(p_tracking_reference,''))) not between 2 and 200) then raise exception 'Enter a valid driver or vehicle and out-for-delivery reference'; end if;
 if p_action='deliver' and (length(trim(coalesce(p_recipient_name,''))) not between 2 and 200 or length(trim(coalesce(p_proof_reference,''))) not between 2 and 500) then raise exception 'Enter a valid recipient and signed delivery-note proof reference'; end if;
 if p_action='cancel' and length(trim(coalesce(p_proof_reference,''))) not between 2 and 500 then raise exception 'Enter a valid cancellation reason'; end if;

 if p_action in ('ready','dispatch') then
  for v_line in select lot_id,product_id,sum(quantity)::integer as quantity from public.sales_delivery_lines where delivery_note_id=v_row.id group by lot_id,product_id order by lot_id loop
   select lot.* into v_lot from public.inventory_lots lot join public.inventory_locations location on location.id=lot.location_id
   where lot.id=v_line.lot_id and lot.product_id=v_line.product_id and lot.stock_status='available' and location.active=true and location.is_dispatch_hub=true for update of lot;
   if not found or v_lot.reserved_units<v_line.quantity or v_lot.loose_units<v_line.quantity then raise exception 'Reserved Haadi stock is no longer sufficient for this delivery'; end if;
  end loop;
 end if;

 if p_action='dispatch' then
  for v_line in select * from public.sales_delivery_lines where delivery_note_id=v_row.id order by lot_id,id loop
   select * into v_lot from public.inventory_lots where id=v_line.lot_id for update;
   update public.inventory_lots set loose_units=loose_units-v_line.quantity,reserved_units=reserved_units-v_line.quantity,version=version+1,updated_at=now() where id=v_lot.id;
   v_issue_id:=gen_random_uuid();
   insert into public.inventory_issues(id,lot_id,organization_id,product_id,quantity,issued_on,reference,reason,issued_by,delivery_note_id,delivery_line_id)
   values(v_issue_id,v_lot.id,v_row.organization_id,v_line.product_id,v_line.quantity,current_date,v_row.delivery_number,'Out for delivery from accepted '||(select document_number from public.sales_proformas where id=v_row.proforma_id),auth.uid(),v_row.id,v_line.id);
   update public.sales_delivery_lines set inventory_issue_id=v_issue_id where id=v_line.id;
   insert into public.inventory_movements(id,lot_id,movement_type,loose_unit_change,base_unit_change,reason,actor_user_id)
   values(gen_random_uuid(),v_lot.id,'consumer_issue',-v_line.quantity,-v_line.quantity,'Delivery '||v_row.delivery_number||' · '||trim(p_tracking_reference),auth.uid());
  end loop;
 end if;
 if p_action='cancel' and v_from in ('packing','ready') then
  for v_line in select lot_id,sum(quantity)::integer quantity from public.sales_delivery_lines where delivery_note_id=v_row.id group by lot_id order by lot_id loop
   select * into v_lot from public.inventory_lots where id=v_line.lot_id for update;
   if not found or v_lot.reserved_units<v_line.quantity then raise exception 'Reserved Haadi stock is inconsistent; cancellation stopped'; end if;
   update public.inventory_lots set reserved_units=reserved_units-v_line.quantity,version=version+1,updated_at=now() where id=v_line.lot_id;
  end loop;
 end if;

 v_reference:=case
  when p_action='tax_invoice' then trim(p_proof_reference)
  when p_action='dispatch' then trim(p_tracking_reference)
  when p_action in ('deliver','cancel') then trim(p_proof_reference)
  when p_action='send_to_sales' then 'Sent to downstairs sales'
  when p_action='start_packing' then 'Packing started'
  else 'Packing and stock checked'
 end;
 update public.sales_delivery_notes set status=v_to,version=version+1,updated_at=now(),
  tax_invoice_reference=case when p_action='tax_invoice' then trim(p_proof_reference) else tax_invoice_reference end,
  carrier=case when p_action='dispatch' then trim(p_carrier) else carrier end,
  tracking_reference=case when p_action='dispatch' then trim(p_tracking_reference) else tracking_reference end,
  dispatched_by=case when p_action='dispatch' then auth.uid() else dispatched_by end,
  dispatched_at=case when p_action='dispatch' then now() else dispatched_at end,
  recipient_name=case when p_action='deliver' then trim(p_recipient_name) else recipient_name end,
  proof_reference=case when p_action='deliver' then trim(p_proof_reference) else proof_reference end,
  delivered_by=case when p_action='deliver' then auth.uid() else delivered_by end,
  delivered_at=case when p_action='deliver' then now() else delivered_at end
 where id=v_row.id returning * into v_row;
 insert into public.sales_delivery_events(id,delivery_note_id,from_status,to_status,reference,actor_user_id)
 values(gen_random_uuid(),v_row.id,v_from,v_to,v_reference,auth.uid());
 return v_row;
end $function$;

-- start_sales_delivery_packing: needs "deliveries"
CREATE OR REPLACE FUNCTION public.start_sales_delivery_packing(p_id uuid, p_expected_version integer, p_lines jsonb)
 RETURNS sales_delivery_notes
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_row public.sales_delivery_notes; v_count integer; v_line record; v_lot public.inventory_lots;
begin
 perform public.require_access('deliveries');
 if not public.inventory_active_staff() then raise exception 'Active staff access is required'; end if;
 if jsonb_typeof(p_lines)<>'array' or jsonb_array_length(p_lines) not between 1 and 100 then raise exception 'Choose at least one item to pack'; end if;
 select * into v_row from public.sales_delivery_notes where id=p_id and version=p_expected_version and status='sent_to_sales' for update;
 if not found then raise exception 'Delivery changed; refresh before starting packing'; end if;
 if exists(select 1 from public.sales_delivery_lines where delivery_note_id=p_id) then raise exception 'Packing stock has already been selected'; end if;
 if exists(select 1 from jsonb_array_elements(p_lines) line where coalesce((line->>'quantity')::integer,0) not between 1 and 1000000) then raise exception 'Every packing quantity must be a positive whole number'; end if;
 select count(*) into v_count from jsonb_array_elements(p_lines) line
 join public.sales_proforma_lines pl on pl.id=(line->>'proformaLineId')::uuid and pl.proforma_id=v_row.proforma_id
 join public.inventory_lots lot on lot.id=(line->>'lotId')::uuid and lot.product_id=pl.product_id and lot.stock_status='available'
 join public.inventory_locations location on location.id=lot.location_id and location.active=true and location.is_dispatch_hub=true;
 if v_count<>jsonb_array_length(p_lines) then raise exception 'Every packing item must use matching available stock at Haadi'; end if;
 if exists(
  select 1 from (
   select pl.id,pl.quantity,
    coalesce((select sum(dl.quantity) from public.sales_delivery_lines dl join public.sales_delivery_notes dn on dn.id=dl.delivery_note_id where dl.proforma_line_id=pl.id and dn.status<>'cancelled'),0)+
    coalesce((select sum((line->>'quantity')::integer) from jsonb_array_elements(p_lines) line where (line->>'proformaLineId')::uuid=pl.id),0) as allocated
   from public.sales_proforma_lines pl where pl.proforma_id=v_row.proforma_id
  ) totals where allocated>quantity
 ) then raise exception 'A packing quantity exceeds the submitted Pro forma balance'; end if;
 for v_line in select (line->>'lotId')::uuid lot_id,sum((line->>'quantity')::integer)::integer quantity from jsonb_array_elements(p_lines) line group by (line->>'lotId')::uuid order by (line->>'lotId')::uuid loop
  select * into v_lot from public.inventory_lots where id=v_line.lot_id for update;
  if v_lot.loose_units-v_lot.reserved_units<v_line.quantity then raise exception 'Haadi stock is no longer sufficient for this packing list'; end if;
  update public.inventory_lots set reserved_units=reserved_units+v_line.quantity,version=version+1,updated_at=now() where id=v_lot.id;
 end loop;
 insert into public.sales_delivery_lines(id,delivery_note_id,proforma_line_id,product_id,lot_id,quantity)
 select gen_random_uuid(),v_row.id,pl.id,pl.product_id,(line->>'lotId')::uuid,(line->>'quantity')::integer
 from jsonb_array_elements(p_lines) line join public.sales_proforma_lines pl on pl.id=(line->>'proformaLineId')::uuid;
 update public.sales_delivery_notes set status='packing',version=version+1,updated_at=now() where id=v_row.id returning * into v_row;
 insert into public.sales_delivery_events(id,delivery_note_id,from_status,to_status,reference,actor_user_id)
 values(gen_random_uuid(),v_row.id,'sent_to_sales','packing','Packing started and stock reserved',auth.uid());
 return v_row;
end $function$;

-- create_service_case: needs "service"
CREATE OR REPLACE FUNCTION public.create_service_case(p_id uuid, p_asset_id uuid, p_contact_id uuid, p_problem_summary text)
 RETURNS service_cases
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_asset public.equipment_assets; v_row public.service_cases; v_number text;
begin
 perform public.require_access('service');
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
end $function$;

-- advance_service_case: needs "service"
CREATE OR REPLACE FUNCTION public.advance_service_case(p_id uuid, p_expected_version integer, p_action text, p_assigned_user_id uuid DEFAULT NULL::uuid, p_scheduled_for date DEFAULT NULL::date, p_note text DEFAULT ''::text)
 RETURNS service_cases
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_row public.service_cases; v_from text; v_to text; v_assignee uuid;
begin
 perform public.require_access('service');
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
end $function$;

-- save_purchase_request: needs "purchasing"
CREATE OR REPLACE FUNCTION public.save_purchase_request(p_id uuid, p_expected_version integer, p_supplier_id uuid, p_currency text, p_expected_on date, p_notes text, p_lines jsonb)
 RETURNS purchase_orders
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_row public.purchase_orders; v_new public.purchase_orders; v_line jsonb; v_n integer := 0; v_product uuid; v_qty integer; v_price bigint; v_pending uuid;
begin
 perform public.require_access('purchasing');
 if not public.inventory_active_staff() then raise exception 'Active staff access is required'; end if;
 if p_id is null or p_expected_version is null or p_expected_version < 0 then raise exception 'Purchase request and expected version are required'; end if;
 if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) not between 1 and 200 then raise exception 'Add between 1 and 200 items'; end if;
 if coalesce(p_currency,'TZS') not in ('TZS','USD','EUR') then raise exception 'Choose TZS, USD or EUR'; end if;
 if length(coalesce(p_notes,'')) > 4000 then raise exception 'Notes are too long'; end if;
 if p_supplier_id is not null and not exists(select 1 from public.suppliers where id=p_supplier_id and active) then raise exception 'Choose an active supplier'; end if;
 perform pg_advisory_xact_lock(hashtextextended('purchase:'||p_id::text,0));
 select * into v_row from public.purchase_orders where id=p_id for update;
 if p_expected_version = 0 then
  if found then
   if v_row.requested_by=auth.uid() and v_row.version=1 and v_row.status='requested'
    and (select count(*) from public.purchase_order_lines where purchase_order_id=p_id)=jsonb_array_length(p_lines) then return v_row; end if;
   raise exception 'Purchase request already exists; refresh and compare';
  end if;
  insert into public.purchase_orders(id,po_number,status,supplier_id,currency,expected_on,notes,requested_by)
  values(p_id,'PO-'||lpad(nextval('public.purchase_order_number_seq')::text,6,'0'),'requested',p_supplier_id,coalesce(p_currency,'TZS'),p_expected_on,coalesce(p_notes,''),auth.uid())
  returning * into v_new;
  insert into public.purchase_order_events(purchase_order_id,action,from_status,to_status,note,actor_user_id) values(p_id,'request',null,'requested','',auth.uid());
 else
  if not found then raise exception 'Purchase request not found'; end if;
  if v_row.version <> p_expected_version then raise exception 'Purchase request changed; refresh and compare'; end if;
  if v_row.status <> 'requested' then raise exception 'Only a request that is not yet approved can be edited'; end if;
  delete from public.purchase_order_lines where purchase_order_id=p_id;
  update public.purchase_orders set supplier_id=p_supplier_id,currency=coalesce(p_currency,'TZS'),expected_on=p_expected_on,notes=coalesce(p_notes,''),version=version+1,updated_at=now()
  where id=p_id returning * into v_new;
  insert into public.purchase_order_events(purchase_order_id,action,from_status,to_status,note,actor_user_id) values(p_id,'edit','requested','requested','Items or details changed',auth.uid());
 end if;
 for v_line in select value from jsonb_array_elements(p_lines) loop
  v_n := v_n + 1;
  begin
   v_product := (v_line->>'product_id')::uuid; v_qty := (v_line->>'quantity')::integer;
   v_price := nullif(v_line->>'unit_price_minor','')::bigint; v_pending := nullif(v_line->>'pending_request_id','')::uuid;
  exception when others then raise exception 'Item % has an invalid product, quantity, price or pending order', v_n;
  end;
  if v_product is null or not exists(select 1 from public.products where id=v_product and deleted_at is null) then raise exception 'Item % needs an active product', v_n; end if;
  if v_qty is null or v_qty not between 1 and 1000000 then raise exception 'Item % needs a whole quantity from 1 to 1,000,000', v_n; end if;
  if v_price is not null and v_price < 0 then raise exception 'Item % has a negative price', v_n; end if;
  if v_pending is not null and not exists(select 1 from public.pending_stock_requests where id=v_pending and product_id=v_product) then raise exception 'Item % is linked to a pending order for a different product', v_n; end if;
  insert into public.purchase_order_lines(purchase_order_id,line_number,product_id,quantity,unit_price_minor,pending_request_id,note)
  values(p_id,v_n,v_product,v_qty,v_price,v_pending,left(coalesce(v_line->>'note',''),500));
 end loop;
 return v_new;
end $function$;

-- advance_purchase_order: needs "purchasing"
CREATE OR REPLACE FUNCTION public.advance_purchase_order(p_id uuid, p_expected_version integer, p_action text, p_note text DEFAULT ''::text, p_lpo_reference text DEFAULT ''::text, p_expected_on date DEFAULT NULL::date)
 RETURNS purchase_orders
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_row public.purchase_orders; v_new public.purchase_orders; v_note text := trim(coalesce(p_note,'')); v_lpo text := trim(coalesce(p_lpo_reference,''));
begin
 perform public.require_access('purchasing');
 if not public.inventory_active_staff() then raise exception 'Active staff access is required'; end if;
 if p_id is null or p_expected_version is null or p_action is null then raise exception 'Purchase order, expected version and action are required'; end if;
 if length(v_note) > 1000 or length(v_lpo) > 120 then raise exception 'Note or LPO reference is too long'; end if;
 perform pg_advisory_xact_lock(hashtextextended('purchase:'||p_id::text,0));
 select * into v_row from public.purchase_orders where id=p_id for update;
 if not found then raise exception 'Purchase order not found'; end if;
 if v_row.version <> p_expected_version then raise exception 'Purchase order changed; refresh and compare'; end if;
 if p_action='approve' then
  if not public.inventory_owner() then raise exception 'Only the owner can approve purchases'; end if;
  if v_row.status <> 'requested' then raise exception 'Only a request can be approved'; end if;
  update public.purchase_orders set status='approved',approved_by=auth.uid(),approved_at=now(),version=version+1,updated_at=now() where id=p_id returning * into v_new;
 elsif p_action='order' then
  if v_row.status <> 'approved' then raise exception 'Approve the purchase before ordering'; end if;
  if v_row.supplier_id is null then raise exception 'Choose the supplier before ordering'; end if;
  if length(v_lpo) < 2 then raise exception 'Enter the LPO number sent to the supplier'; end if;
  if p_expected_on is not null and p_expected_on < current_date then raise exception 'Expected arrival cannot be in the past'; end if;
  update public.purchase_orders set status='ordered',ordered_by=auth.uid(),ordered_at=now(),lpo_reference=v_lpo,expected_on=coalesce(p_expected_on,expected_on),version=version+1,updated_at=now()
  where id=p_id returning * into v_new;
 elsif p_action='close' then
  if v_row.status <> 'ordered' then raise exception 'Only an ordered purchase can be closed'; end if;
  if length(v_note) < 3 then raise exception 'Enter the delivery note or receipt reference'; end if;
  update public.purchase_orders set status='closed',closed_by=auth.uid(),closed_at=now(),close_note=v_note,version=version+1,updated_at=now() where id=p_id returning * into v_new;
 elsif p_action='cancel' then
  if v_row.status in ('closed','cancelled') then raise exception 'This purchase order is already finished'; end if;
  if v_row.status <> 'requested' and not public.inventory_owner() then raise exception 'Only the owner can cancel an approved or ordered purchase'; end if;
  if v_row.status = 'requested' and not public.inventory_owner() and v_row.requested_by <> auth.uid() then raise exception 'Only the requester or the owner can cancel this request'; end if;
  if length(v_note) < 3 then raise exception 'Enter why the purchase is cancelled'; end if;
  update public.purchase_orders set status='cancelled',closed_by=auth.uid(),closed_at=now(),close_note=v_note,version=version+1,updated_at=now() where id=p_id returning * into v_new;
 else
  raise exception 'Unknown purchase action';
 end if;
 insert into public.purchase_order_events(purchase_order_id,action,from_status,to_status,note,actor_user_id)
 values(p_id,p_action,v_row.status,v_new.status,case when p_action='order' then 'LPO '||v_lpo else v_note end,auth.uid());
 return v_new;
end $function$;

-- save_supplier: needs "purchasing"
CREATE OR REPLACE FUNCTION public.save_supplier(p_id uuid, p_expected_version integer, p_fields jsonb)
 RETURNS suppliers
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_row public.suppliers; v_new public.suppliers; v_active boolean;
begin
 perform public.require_access('purchasing');
 if not public.inventory_active_staff() then raise exception 'Active staff access is required'; end if;
 if p_id is null or p_expected_version is null or p_expected_version < 0 or p_fields is null or jsonb_typeof(p_fields) <> 'object' then raise exception 'Supplier request, expected version and fields are required'; end if;
 v_active := coalesce((p_fields->>'active')::boolean, true);
 perform pg_advisory_xact_lock(hashtextextended('supplier:'||p_id::text,0));
 select * into v_row from public.suppliers where id=p_id for update;
 if p_expected_version = 0 then
  if found then
   if v_row.created_by=auth.uid() and v_row.version=1 and v_row.name=trim(coalesce(p_fields->>'name','')) then return v_row; end if;
   raise exception 'Supplier already exists; refresh and compare';
  end if;
  if not v_active then raise exception 'New suppliers start active'; end if;
  begin
   insert into public.suppliers(id,supplier_number,name,country,contact_name,phone,email,tin,payment_terms,notes,created_by)
   values(p_id,'SUP-'||lpad(nextval('public.supplier_number_seq')::text,6,'0'),trim(coalesce(p_fields->>'name','')),trim(coalesce(p_fields->>'country','')),
    trim(coalesce(p_fields->>'contact_name','')),trim(coalesce(p_fields->>'phone','')),lower(trim(coalesce(p_fields->>'email',''))),trim(coalesce(p_fields->>'tin','')),
    trim(coalesce(p_fields->>'payment_terms','')),coalesce(p_fields->>'notes',''),auth.uid())
   returning * into v_new;
  exception when unique_violation then raise exception 'A supplier with this name already exists';
  end;
  return v_new;
 end if;
 if not found then raise exception 'Supplier not found'; end if;
 if v_row.version <> p_expected_version then raise exception 'Supplier changed; refresh and compare'; end if;
 if v_active is distinct from v_row.active and not public.inventory_owner() then raise exception 'Only the owner can deactivate or reactivate a supplier'; end if;
 begin
  update public.suppliers set name=trim(coalesce(p_fields->>'name','')),country=trim(coalesce(p_fields->>'country','')),contact_name=trim(coalesce(p_fields->>'contact_name','')),
   phone=trim(coalesce(p_fields->>'phone','')),email=lower(trim(coalesce(p_fields->>'email',''))),tin=trim(coalesce(p_fields->>'tin','')),
   payment_terms=trim(coalesce(p_fields->>'payment_terms','')),notes=coalesce(p_fields->>'notes',''),active=v_active,version=version+1,updated_at=now()
  where id=p_id returning * into v_new;
 exception when unique_violation then raise exception 'A supplier with this name already exists';
 end;
 return v_new;
end $function$;

-- issue_consumer_units: needs "stock"
CREATE OR REPLACE FUNCTION public.issue_consumer_units(p_id uuid, p_lot_id uuid, p_expected_version integer, p_organization_id uuid, p_quantity integer, p_issued_on date, p_reference text, p_reason text)
 RETURNS inventory_issues
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_lot public.inventory_lots; v_issue public.inventory_issues;
begin
 perform public.require_access('stock');
 if not public.inventory_active_staff() then raise exception 'Active staff access is required'; end if;
 select * into v_lot from public.inventory_lots where id=p_lot_id and version=p_expected_version and stock_status='available' for update;
 if not found then raise exception 'Stock changed; refresh before issuing'; end if;
 if not exists(select 1 from public.organizations where id=p_organization_id and deleted_at is null) then raise exception 'Choose an active client or branch'; end if;
 if p_quantity<1 or p_quantity>v_lot.loose_units-v_lot.reserved_units then raise exception 'Not enough loose consumer units'; end if;
 update public.inventory_lots set loose_units=loose_units-p_quantity,version=version+1,updated_at=now() where id=v_lot.id;
 insert into public.inventory_issues(id,lot_id,organization_id,product_id,quantity,issued_on,reference,reason,issued_by)
 values(p_id,v_lot.id,p_organization_id,v_lot.product_id,p_quantity,p_issued_on,trim(p_reference),trim(p_reason),auth.uid()) returning * into v_issue;
 insert into public.inventory_movements(id,lot_id,movement_type,loose_unit_change,base_unit_change,reason,actor_user_id)
 values(gen_random_uuid(),v_lot.id,'consumer_issue',-p_quantity,-p_quantity,trim(p_reason),auth.uid());
 return v_issue;
end $function$;

-- receive_inventory_transfer: needs "stock"
CREATE OR REPLACE FUNCTION public.receive_inventory_transfer(p_id uuid, p_expected_version integer, p_actual_units integer, p_inspection text, p_note text)
 RETURNS inventory_transfers
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_transfer public.inventory_transfers; v_lot public.inventory_lots; v_status text; v_batch text; v_expiry date;
begin
 perform public.require_access('stock');
 if not public.inventory_active_staff() then raise exception 'Active staff access is required'; end if;
 if p_actual_units<0 then raise exception 'Counted units cannot be negative'; end if;
 select * into v_transfer from public.inventory_transfers where id=p_id and version=p_expected_version and status='in_transit' for update;
 if not found then raise exception 'Transfer changed; refresh before receiving'; end if;
 select batch_number,expiry_date into v_batch,v_expiry from public.inventory_lots where id=v_transfer.source_lot_id;
 if p_actual_units<>v_transfer.expected_units or p_inspection<>'pass' or (v_expiry is not null and v_expiry<current_date) then
  v_status:='quarantine';
 else
  v_status:='received';
 end if;
 insert into public.inventory_lots(id,product_id,location_id,pack_definition_id,batch_number,expiry_date,sealed_cartons,loose_units,stock_status)
 values(gen_random_uuid(),v_transfer.product_id,v_transfer.to_location_id,v_transfer.pack_definition_id,v_batch,v_expiry,case when v_status='received' then v_transfer.cartons else 0 end,case when v_status='quarantine' then p_actual_units else 0 end,v_status)
 on conflict (product_id,location_id,pack_definition_id,batch_number,(coalesce(expiry_date,'infinity'::date)),stock_status)
 do update set sealed_cartons=public.inventory_lots.sealed_cartons+excluded.sealed_cartons,loose_units=public.inventory_lots.loose_units+excluded.loose_units,version=public.inventory_lots.version+1,updated_at=now()
 returning * into v_lot;
 insert into public.inventory_movements(id,lot_id,transfer_id,movement_type,sealed_carton_change,loose_unit_change,base_unit_change,reason,actor_user_id)
 values(gen_random_uuid(),v_lot.id,v_transfer.id,case when v_status='received' then 'transfer_receipt' else 'quarantine_receipt' end,case when v_status='received' then v_transfer.cartons else 0 end,case when v_status='quarantine' then p_actual_units else 0 end,p_actual_units,trim(p_note),auth.uid());
 update public.inventory_transfers set status=v_status,actual_units=p_actual_units,inspection_note=trim(p_note),received_by=auth.uid(),received_at=now(),version=version+1 where id=v_transfer.id returning * into v_transfer;
 return v_transfer;
end $function$;

-- save_product_inventory_classification: needs "stock"
CREATE OR REPLACE FUNCTION public.save_product_inventory_classification(p_id uuid, p_product_id uuid, p_expected_version integer, p_category text, p_reason text)
 RETURNS product_inventory_classifications
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_row public.product_inventory_classifications; v_next integer;
begin
 perform public.require_access('stock');
 if not public.inventory_active_staff() then raise exception 'Active staff access is required'; end if;
 if p_category not in ('machines','furniture','reagents','consumables','spares','non_stock','unclassified') then raise exception 'Choose a supported inventory category'; end if;
 if not exists(select 1 from public.products where id=p_product_id) then raise exception 'Choose a saved product'; end if;
 select coalesce(max(version),0)+1 into v_next from public.product_inventory_classifications where product_id=p_product_id;
 if p_expected_version<>v_next-1 then raise exception 'Product classification changed; refresh before saving'; end if;
 insert into public.product_inventory_classifications(id,product_id,version,category,reason,created_by)
 values(p_id,p_product_id,v_next,p_category,trim(p_reason),auth.uid()) returning * into v_row;
 return v_row;
end $function$;

-- record_stock_count: needs "stock_count"
CREATE OR REPLACE FUNCTION public.record_stock_count(p_id uuid, p_session_id uuid, p_godown text, p_code text, p_unlisted text, p_quantity numeric, p_unit text, p_batch text DEFAULT ''::text, p_expiry date DEFAULT NULL::date, p_condition text DEFAULT 'good'::text, p_notes text DEFAULT ''::text)
 RETURNS stock_count_entries
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_row public.stock_count_entries;
begin
 perform public.require_access('stock_count');
 if not public.inventory_active_staff() then raise exception 'Active staff access is required'; end if;
 if p_id is null or p_session_id is null then raise exception 'Count and session are required'; end if;
 perform pg_advisory_xact_lock(hashtextextended('stock-count:'||p_id::text,0));
 select * into v_row from public.stock_count_entries where id=p_id;
 if found then
  if v_row.counted_by=auth.uid() and v_row.session_id=p_session_id and v_row.godown=p_godown and v_row.code is not distinct from nullif(p_code,'')
   and v_row.quantity=p_quantity and v_row.unit=p_unit then return v_row; end if;
  raise exception 'Count already saved with different details; refresh';
 end if;
 if not exists(select 1 from public.stock_count_sessions where id=p_session_id and status='open') then raise exception 'This count is closed; ask the owner to start one'; end if;
 if nullif(p_code,'') is not null and not exists(select 1 from public.count_catalogue where code=p_code) then raise exception 'Choose a product from the list, or describe it as not on the list'; end if;
 if p_expiry is not null and p_expiry < date '2000-01-01' then raise exception 'Check the expiry date'; end if;
 insert into public.stock_count_entries(id,session_id,godown,code,unlisted,quantity,unit,batch,expiry,condition,notes,counted_by)
 values(p_id,p_session_id,p_godown,nullif(p_code,''),case when nullif(p_code,'') is null then trim(coalesce(p_unlisted,'')) else '' end,p_quantity,p_unit,
  trim(coalesce(p_batch,'')),p_expiry,coalesce(p_condition,'good'),trim(coalesce(p_notes,'')),auth.uid())
 returning * into v_row;
 return v_row;
end $function$;

-- review_stock_count: needs "stock_count"
CREATE OR REPLACE FUNCTION public.review_stock_count(p_id uuid, p_expected_version integer, p_action text, p_note text DEFAULT ''::text)
 RETURNS stock_count_entries
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_row public.stock_count_entries; v_note text := trim(coalesce(p_note,''));
begin
 perform public.require_access('stock_count');
 if not public.inventory_active_staff() then raise exception 'Active staff access is required'; end if;
 select * into v_row from public.stock_count_entries where id=p_id for update;
 if not found then raise exception 'Count not found'; end if;
 if v_row.version <> p_expected_version then raise exception 'Count changed; refresh'; end if;
 if v_row.status <> 'recorded' then raise exception 'This count has already been reviewed or voided'; end if;
 if p_action='void' then
  if v_row.counted_by <> auth.uid() and not public.inventory_owner() then raise exception 'Only the person who counted or the owner can void this'; end if;
  if length(v_note) < 3 then raise exception 'Enter why this count is being voided'; end if;
 elsif p_action in ('accept','reject') then
  if not public.inventory_owner() then raise exception 'Only the owner can accept or reject counts'; end if;
  if p_action='reject' and length(v_note) < 3 then raise exception 'Enter why the count is rejected'; end if;
 else raise exception 'Unknown review action';
 end if;
 update public.stock_count_entries set status=case p_action when 'void' then 'void' when 'accept' then 'accepted' else 'rejected' end,
  status_note=v_note,status_by=auth.uid(),status_at=now(),version=version+1 where id=p_id returning * into v_row;
 return v_row;
end $function$;

-- save_travel_request: needs "travel"
CREATE OR REPLACE FUNCTION public.save_travel_request(p_id uuid, p_expected_version integer, p_travellers uuid[], p_organization_id uuid, p_destination text, p_purpose text, p_meeting_with text, p_depart_at timestamp with time zone, p_return_at timestamp with time zone, p_transport text, p_notes text)
 RETURNS travel_requests
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_row public.travel_requests; v_people uuid[];
begin
 perform public.require_access('travel');
 if not public.inventory_active_staff() then raise exception 'Active staff access is required'; end if;
 if p_id is null or p_expected_version is null then raise exception 'Request and version are required'; end if;
 select array_agg(distinct t) into v_people from unnest(coalesce(p_travellers,'{}'::uuid[])) t where t is not null;
 if coalesce(cardinality(v_people),0) = 0 then raise exception 'Choose who is going'; end if;
 if cardinality(v_people) > 20 then raise exception 'Too many travellers on one request'; end if;
 if exists(select 1 from unnest(v_people) t where not exists(select 1 from public.staff s where s.user_id = t and s.active)) then raise exception 'Everyone travelling must be an active employee'; end if;
 if p_organization_id is not null and not exists(select 1 from public.organizations where id = p_organization_id and deleted_at is null) then raise exception 'Choose a client from the list'; end if;
 if p_organization_id is null and length(trim(coalesce(p_destination,''))) < 2 then raise exception 'Choose the client or type where you are going'; end if;
 if coalesce(p_purpose,'') not in ('meeting','installation','service','delivery','training','other') then raise exception 'Choose the reason for the trip'; end if;
 if p_depart_at is null or p_return_at is null then raise exception 'Choose when you leave and when you return'; end if;
 if p_return_at <= p_depart_at then raise exception 'The return must be after you leave'; end if;
 if p_return_at > p_depart_at + interval '60 days' then raise exception 'A trip can be at most 60 days'; end if;
 if length(coalesce(p_destination,'')) > 300 or length(coalesce(p_meeting_with,'')) > 300 or length(coalesce(p_transport,'')) > 200 or length(coalesce(p_notes,'')) > 2000 then raise exception 'One of the fields is too long'; end if;
 select * into v_row from public.travel_requests where id = p_id for update;
 if not found then
  if p_expected_version <> 0 then raise exception 'Travel request not found; refresh'; end if;
  if p_depart_at < now() - interval '1 day' then raise exception 'The trip cannot start in the past'; end if;
  insert into public.travel_requests(id,request_number,travellers,organization_id,destination,purpose,meeting_with,depart_at,return_at,transport,notes,created_by)
  values(p_id,'TR-'||lpad(nextval('public.travel_request_number_seq')::text,6,'0'),v_people,p_organization_id,trim(coalesce(p_destination,'')),p_purpose,
   trim(coalesce(p_meeting_with,'')),p_depart_at,p_return_at,trim(coalesce(p_transport,'')),coalesce(p_notes,''),auth.uid())
  returning * into v_row;
  insert into public.travel_request_events(request_id,action,note,actor_user_id) values(v_row.id,'create','',auth.uid());
  return v_row;
 end if;
 if p_expected_version = 0 and v_row.created_by = auth.uid() and v_row.version = 1 then return v_row; end if;
 if auth.uid() <> v_row.created_by and not public.inventory_owner() then raise exception 'Only the person who asked or the owner can change this request'; end if;
 if v_row.status <> 'requested' then raise exception 'This request has already been decided'; end if;
 if v_row.version <> p_expected_version then raise exception 'Travel request changed; refresh'; end if;
 update public.travel_requests set travellers=v_people,organization_id=p_organization_id,destination=trim(coalesce(p_destination,'')),purpose=p_purpose,
  meeting_with=trim(coalesce(p_meeting_with,'')),depart_at=p_depart_at,return_at=p_return_at,transport=trim(coalesce(p_transport,'')),notes=coalesce(p_notes,''),
  version=version+1,updated_at=now() where id = p_id returning * into v_row;
 insert into public.travel_request_events(request_id,action,note,actor_user_id) values(v_row.id,'edit','',auth.uid());
 return v_row;
end $function$;

-- advance_travel_request: needs "travel"
CREATE OR REPLACE FUNCTION public.advance_travel_request(p_id uuid, p_expected_version integer, p_action text, p_note text DEFAULT ''::text)
 RETURNS travel_requests
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_row public.travel_requests; v_status text;
begin
 perform public.require_access('travel');
 if not public.inventory_active_staff() then raise exception 'Active staff access is required'; end if;
 if coalesce(p_action,'') not in ('approve','decline','done','cancel') then raise exception 'Unknown action'; end if;
 if length(coalesce(p_note,'')) > 2000 then raise exception 'Note is too long'; end if;
 v_status := case when p_action = 'approve' then 'approved' when p_action = 'decline' then 'declined' when p_action = 'done' then 'done' else 'cancelled' end;
 select * into v_row from public.travel_requests where id = p_id for update;
 if not found then raise exception 'Travel request not found'; end if;
 if v_row.status = v_status then return v_row; end if;
 if v_row.version <> p_expected_version then raise exception 'Travel request changed; refresh'; end if;
 if p_action in ('approve','decline') then
  if not public.inventory_owner() then raise exception 'Only the owner can approve or decline travel'; end if;
  if v_row.status <> 'requested' then raise exception 'This request has already been decided'; end if;
  if p_action = 'decline' and length(trim(coalesce(p_note,''))) < 3 then raise exception 'Say why it is declined'; end if;
  update public.travel_requests set status=v_status,decided_by=auth.uid(),decided_at=now(),decision_note=trim(coalesce(p_note,'')),version=version+1,updated_at=now()
  where id = p_id returning * into v_row;
 elsif p_action = 'done' then
  if v_row.status <> 'approved' then raise exception 'Only an approved trip can be marked done'; end if;
  if not (auth.uid() = any(v_row.travellers) or auth.uid() = v_row.created_by or public.inventory_owner()) then raise exception 'Only a traveller, the person who asked or the owner can close this trip'; end if;
  if length(trim(coalesce(p_note,''))) < 3 then raise exception 'Write how the trip went'; end if;
  update public.travel_requests set status='done',outcome_note=trim(p_note),version=version+1,updated_at=now() where id = p_id returning * into v_row;
 else
  if v_row.status not in ('requested','approved') then raise exception 'This trip is already closed'; end if;
  if auth.uid() <> v_row.created_by and not public.inventory_owner() then raise exception 'Only the person who asked or the owner can cancel'; end if;
  update public.travel_requests set status='cancelled',outcome_note=trim(coalesce(p_note,'')),version=version+1,updated_at=now() where id = p_id returning * into v_row;
 end if;
 insert into public.travel_request_events(request_id,action,note,actor_user_id) values(v_row.id,p_action,coalesce(p_note,''),auth.uid());
 return v_row;
end $function$;

revoke all on function public.staff_access_areas(), public.has_access(text), public.require_access(text), public.is_department_head(),
 public.can_manage_staff(uuid), public.set_staff_access(uuid,text[]), public.add_department_staff(uuid,text[]), public.set_staff_active(uuid,boolean) from public, anon;
grant execute on function public.staff_access_areas(), public.has_access(text), public.is_department_head(), public.can_manage_staff(uuid),
 public.set_staff_access(uuid,text[]), public.add_department_staff(uuid,text[]), public.set_staff_active(uuid,boolean) to authenticated;
revoke all on function public.require_access(text) from authenticated;
commit;
