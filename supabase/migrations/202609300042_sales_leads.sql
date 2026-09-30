-- Inquiries, leads and opportunities. Additive schema only; no stock, price or invoice changes.
-- Rollback: hide the UI and revoke the RPCs in a reviewed forward migration; keep rows and history.
begin;

create sequence public.sales_lead_number_seq;

create table public.sales_leads (
 id uuid primary key,
 lead_number text not null unique,
 stage text not null check (stage in ('inquiry','lead','opportunity','won','lost')),
 source text not null check (source in ('phone','email','walk_in','whatsapp','referral','website','other')),
 organization_id uuid references public.organizations(id),
 contact_id uuid references public.contacts(id),
 caller_name text not null default '' check (length(caller_name) <= 200),
 caller_phone text not null default '' check (length(caller_phone) <= 60),
 caller_organization text not null default '' check (length(caller_organization) <= 300),
 subject text not null check (length(trim(subject)) between 2 and 300),
 details text not null default '' check (length(details) <= 8000),
 estimated_value_minor bigint check (estimated_value_minor is null or estimated_value_minor >= 0),
 currency text not null default 'TZS' check (currency in ('TZS','USD','EUR')),
 owner_user_id uuid references auth.users(id),
 next_action text not null default '' check (length(next_action) <= 500),
 next_action_on date,
 lost_reason text not null default '' check (length(lost_reason) <= 1000),
 proforma_id uuid references public.sales_proformas(id),
 version integer not null default 1 check (version > 0),
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 -- A lead is identified either by a client record or by a named caller with a phone number.
 check (organization_id is not null or (length(trim(caller_name)) >= 2 and length(trim(caller_phone)) >= 6)),
 check ((stage = 'won') = (proforma_id is not null)),
 check (stage <> 'lost' or length(trim(lost_reason)) >= 3)
);
create index sales_leads_stage_due on public.sales_leads(stage, next_action_on nulls last, id);
create index sales_leads_owner on public.sales_leads(owner_user_id, stage);
create index sales_leads_organization on public.sales_leads(organization_id);
create index sales_leads_proforma on public.sales_leads(proforma_id);

create table public.sales_lead_events (
 id uuid primary key default gen_random_uuid(),
 lead_id uuid not null references public.sales_leads(id),
 action text not null,
 from_stage text,
 to_stage text not null,
 assigned_user_id uuid references auth.users(id),
 note text not null default '',
 actor_user_id uuid not null references auth.users(id),
 created_at timestamptz not null default now()
);
create index sales_lead_events_lead on public.sales_lead_events(lead_id, created_at);
create index sales_lead_events_actor on public.sales_lead_events(actor_user_id);
create index sales_lead_events_assignee on public.sales_lead_events(assigned_user_id);

create function public.deny_sales_lead_mutation()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
 raise exception 'Lead history is immutable and leads are never hard-deleted';
end $$;
create trigger sales_lead_events_immutable before update or delete on public.sales_lead_events
for each row execute function public.deny_sales_lead_mutation();
create trigger sales_lead_events_no_truncate before truncate on public.sales_lead_events
for each statement execute function public.deny_sales_lead_mutation();
create trigger sales_leads_no_delete before delete on public.sales_leads
for each row execute function public.deny_sales_lead_mutation();
create trigger sales_leads_no_truncate before truncate on public.sales_leads
for each statement execute function public.deny_sales_lead_mutation();

alter table public.sales_leads enable row level security;
alter table public.sales_lead_events enable row level security;
create policy sales_leads_read on public.sales_leads for select to authenticated using ((select public.inventory_active_staff()));
create policy sales_lead_events_read on public.sales_lead_events for select to authenticated using ((select public.inventory_active_staff()));
revoke all on public.sales_leads, public.sales_lead_events from public, anon, authenticated;
grant select on public.sales_leads, public.sales_lead_events to authenticated;
revoke all on sequence public.sales_lead_number_seq from public, anon, authenticated;

create function public.sales_lead_active_assignee(p_user_id uuid)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select p_user_id is null or exists(select 1 from public.staff where user_id=p_user_id and active=true)
$$;
revoke all on function public.sales_lead_active_assignee(uuid) from public, anon, authenticated;

-- Create (expected version 0) or edit the descriptive fields of an open lead.
create function public.save_sales_lead(p_id uuid, p_expected_version integer, p_fields jsonb)
returns public.sales_leads language plpgsql security definer set search_path=public,pg_temp as $$
declare
 v_row public.sales_leads; v_new public.sales_leads;
 v_org uuid; v_contact uuid; v_owner uuid; v_value bigint; v_due date;
begin
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
end $$;

-- Stage changes and assignment. Every change records the actor, time and note.
create function public.advance_sales_lead(p_id uuid, p_expected_version integer, p_action text, p_assigned_user_id uuid default null, p_note text default '', p_proforma_id uuid default null)
returns public.sales_leads language plpgsql security definer set search_path=public,pg_temp as $$
declare v_row public.sales_leads; v_new public.sales_leads; v_to text; v_note text := trim(coalesce(p_note,''));
begin
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
end $$;

revoke all on function public.save_sales_lead(uuid,integer,jsonb), public.advance_sales_lead(uuid,integer,text,uuid,text,uuid) from public, anon;
grant execute on function public.save_sales_lead(uuid,integer,jsonb), public.advance_sales_lead(uuid,integer,text,uuid,text,uuid) to authenticated;
commit;
