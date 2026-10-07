-- Leads: who we spoke to and their role, handover with a required note, and the next step on the card.
-- 1. caller_role on the lead (Doctor/User, Head of department, Procurement, Management, Biomedical engineer, Other).
--    It is kept on the lead, not on the contact: the role matters for this conversation, a new caller has no contact
--    record yet, and contacts already carry a free-text position that client review owns. The caller name and phone
--    may now also be filled for a known client when the person is not a named contact.
-- 2. hand_over_sales_lead: changes the salesperson with a note of at least 5 words, optionally setting the next step.
--    The history row keeps who handed it, to whom, when and the note (from_user_id is new on sales_lead_events).
--    The existing sales_leads_handoff trigger puts the lead on the new person's "Work handed to me" list with the
--    note, the next step as the task and its date as the due date. Changing an owner through
--    advance_sales_lead('assign') without a note is no longer allowed; first assignment of an inquiry is unchanged.
-- No stock, price, Pro forma or client rows change.
-- Rollback: a forward migration that restores save_sales_lead, advance_sales_lead and handoff_lead from
-- 202610050060 / 202610010051 and revokes hand_over_sales_lead; keep the new columns and history rows.
begin;

alter table public.sales_leads add column caller_role text not null default ''
 check (caller_role in ('','doctor','head_of_department','procurement','management','biomedical','other'));
alter table public.sales_lead_events add column from_user_id uuid references auth.users(id);
create index sales_lead_events_from_user on public.sales_lead_events(from_user_id);

-- save_sales_lead: unchanged apart from caller_role.
create or replace function public.save_sales_lead(p_id uuid, p_expected_version integer, p_fields jsonb)
returns public.sales_leads language plpgsql security definer set search_path=public,pg_temp as $$
declare
 v_row public.sales_leads; v_new public.sales_leads;
 v_org uuid; v_contact uuid; v_owner uuid; v_value bigint; v_due date; v_role text;
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
 v_role := coalesce(p_fields->>'caller_role','');
 if v_role not in ('','doctor','head_of_department','procurement','management','biomedical','other') then raise exception 'Choose the role of the person we spoke to from the list'; end if;
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
  insert into public.sales_leads(id,lead_number,stage,source,organization_id,contact_id,caller_name,caller_phone,caller_organization,caller_role,subject,details,
   estimated_value_minor,currency,owner_user_id,next_action,next_action_on,created_by)
  values(p_id,'LD-'||lpad(nextval('public.sales_lead_number_seq')::text,6,'0'),
   case when v_owner is null then 'inquiry' else 'lead' end,
   coalesce(nullif(p_fields->>'source',''),'phone'),v_org,v_contact,
   trim(coalesce(p_fields->>'caller_name','')),trim(coalesce(p_fields->>'caller_phone','')),trim(coalesce(p_fields->>'caller_organization','')),v_role,
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
  caller_organization=trim(coalesce(p_fields->>'caller_organization','')),caller_role=v_role,subject=trim(coalesce(p_fields->>'subject','')),
  details=coalesce(p_fields->>'details',''),estimated_value_minor=v_value,currency=coalesce(nullif(p_fields->>'currency',''),currency),
  next_action=trim(coalesce(p_fields->>'next_action','')),next_action_on=v_due,version=version+1,updated_at=now()
 where id=p_id returning * into v_new;
 insert into public.sales_lead_events(lead_id,action,from_stage,to_stage,assigned_user_id,note,actor_user_id)
 values(v_new.id,'edit',v_row.stage,v_new.stage,v_new.owner_user_id,'Details updated',auth.uid());
 return v_new;
end $$;

-- advance_sales_lead: unchanged apart from "assign" refusing to replace an existing salesperson (use Hand over).
create or replace function public.advance_sales_lead(p_id uuid, p_expected_version integer, p_action text, p_assigned_user_id uuid default null, p_note text default '', p_proforma_id uuid default null)
returns public.sales_leads language plpgsql security definer set search_path=public,pg_temp as $$
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
 if p_action='assign' and v_row.owner_user_id is not null and v_row.owner_user_id <> p_assigned_user_id then
  raise exception 'Use Hand over to give this lead to someone else, with a short note';
 end if;
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
end $$;

-- Hand a lead to another salesperson with a note (at least 5 words), optionally setting the next step and its date.
create function public.hand_over_sales_lead(p_id uuid, p_expected_version integer, p_new_owner_user_id uuid, p_note text,
 p_next_action text default null, p_next_action_on date default null)
returns public.sales_leads language plpgsql security definer set search_path=public,pg_temp as $$
declare v_row public.sales_leads; v_new public.sales_leads; v_note text := btrim(regexp_replace(coalesce(p_note,''),'\s+',' ','g'));
 v_next text := trim(coalesce(p_next_action,''));
begin
 perform public.require_access('leads');
 if not public.inventory_active_staff() then raise exception 'Active staff access is required'; end if;
 if p_id is null or p_expected_version is null or p_new_owner_user_id is null then raise exception 'Lead, expected version and new salesperson are required'; end if;
 if array_length(regexp_split_to_array(v_note,' '),1) < 5 or v_note = '' then raise exception 'Write a handover note of at least 5 words'; end if;
 if length(v_note) > 1000 then raise exception 'Note is too long'; end if;
 if length(v_next) > 500 then raise exception 'Next step is too long'; end if;
 if p_next_action_on is not null and p_next_action_on < current_date - 1 then raise exception 'The next step date cannot be in the past'; end if;
 perform pg_advisory_xact_lock(hashtextextended('sales-lead:'||p_id::text,0));
 select * into v_row from public.sales_leads where id=p_id for update;
 if not found then raise exception 'Lead not found'; end if;
 if v_row.version <> p_expected_version then
  -- Lost response: the same handover by the same person was already saved; return it.
  if v_row.version = p_expected_version+1 and v_row.owner_user_id = p_new_owner_user_id and exists(select 1 from public.sales_lead_events e
   where e.lead_id=p_id and e.action='handover' and e.actor_user_id=auth.uid() and e.assigned_user_id=p_new_owner_user_id and e.note=v_note
   and e.created_at=(select max(created_at) from public.sales_lead_events where lead_id=p_id)) then return v_row; end if;
  raise exception 'Lead changed; refresh and compare';
 end if;
 if v_row.stage in ('won','lost') then raise exception 'This lead is closed. Reopen it first'; end if;
 if v_row.owner_user_id = p_new_owner_user_id then raise exception 'This person already has the lead'; end if;
 if not exists(select 1 from public.staff where user_id=p_new_owner_user_id and active and (role='owner' or 'leads'=any(access))) then
  raise exception 'Choose an active employee who can open Leads';
 end if;
 -- The handoff trigger reads this note for the new person's work list; it lasts only for this update.
 perform set_config('anudha.lead_handover_note',v_note,true);
 update public.sales_leads set stage=case when stage='inquiry' then 'lead' else stage end,owner_user_id=p_new_owner_user_id,
  next_action=case when v_next<>'' then v_next else next_action end,next_action_on=coalesce(p_next_action_on,next_action_on),
  version=version+1,updated_at=now()
 where id=p_id returning * into v_new;
 perform set_config('anudha.lead_handover_note','',true);
 if not exists(select 1 from public.work_assignments where record_type='lead' and record_id=p_id and status='open' and assignee_user_id=p_new_owner_user_id) then
  raise exception 'The lead could not be put on the new person''s work list. Nothing was changed';
 end if;
 insert into public.sales_lead_events(lead_id,action,from_stage,to_stage,assigned_user_id,from_user_id,note,actor_user_id)
 values(v_new.id,'handover',v_row.stage,v_new.stage,v_new.owner_user_id,v_row.owner_user_id,v_note,auth.uid());
 return v_new;
end $$;

-- handoff_lead: unchanged, except a handover puts the note, next step and due date on the new person's work list.
create or replace function public.handoff_lead() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_note text := coalesce(current_setting('anudha.lead_handover_note',true),''); v_open public.work_assignments;
begin
 if v_note<>'' and tg_op='UPDATE' and new.stage not in ('won','lost') and new.owner_user_id is distinct from old.owner_user_id then
  -- Not guarded: hand_over_sales_lead must fail rather than leave the lead off the new person's list.
  perform pg_advisory_xact_lock(hashtextextended('work:lead:'||new.id::text,0));
  select * into v_open from public.work_assignments where record_type='lead' and record_id=new.id and status='open' for update;
  if found then
   update public.work_assignments set status='handed_on',closed_by=coalesce(auth.uid(),v_open.assignee_user_id),closed_at=now(),
    close_note=left('Handed over to '||coalesce((select display_name from public.staff where user_id=new.owner_user_id),'the next salesperson'),1000),
    version=version+1,updated_at=now() where id=v_open.id;
  end if;
  insert into public.work_assignments(id,record_type,record_id,record_label,task,note,assignee_user_id,assigned_by,due_on,status,previous_assignment_id)
  values(gen_random_uuid(),'lead',new.id,left(new.lead_number||' · '||new.subject,200),left(coalesce(nullif(trim(new.next_action),''),'Follow up '||new.lead_number),300),
   left('Handover: '||v_note,2000),new.owner_user_id,coalesce(auth.uid(),new.owner_user_id),new.next_action_on,'open',v_open.id);
  return null;
 end if;
 begin
  if new.stage in ('won','lost') and (tg_op='INSERT' or old.stage not in ('won','lost')) then
   perform public.auto_close_work('lead',new.id,'done','Lead '||new.stage);
  elsif new.stage not in ('won','lost') and (tg_op='INSERT' or new.owner_user_id is distinct from old.owner_user_id) then
   perform public.auto_assign_work('lead',new.id,new.lead_number,coalesce(nullif(trim(new.next_action),''),'Follow up '||new.lead_number),coalesce(new.owner_user_id,new.created_by));
  end if;
 exception when others then raise warning 'Automatic handoff for lead % failed: %', new.id, sqlerrm;
 end;
 return null;
end $$;

revoke all on function public.hand_over_sales_lead(uuid,integer,uuid,text,text,date) from public, anon;
grant execute on function public.hand_over_sales_lead(uuid,integer,uuid,text,text,date) to authenticated;
commit;
