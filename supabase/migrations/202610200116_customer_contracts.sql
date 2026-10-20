begin;
create sequence public.customer_contract_number_seq;
create table public.customer_contracts (
 id uuid primary key,
 contract_number text not null unique,
 organization_id uuid not null references public.organizations(id),
 kind text not null check(kind in ('service','placement','payment_terms')),
 title text not null check(length(trim(title)) between 2 and 200),
 reference text not null default '' check(length(reference)<=500),
 starts_on date not null check(isfinite(starts_on)),
 ends_on date check(isfinite(ends_on) and ends_on>=starts_on),
 notes text not null default '' check(length(notes)<=4000),
 status text not null default 'draft' check(status in ('draft','approved','cancelled')),
 approved_attachment_id uuid references public.document_attachments(id),
 approved_by uuid references auth.users(id),
 approved_at timestamptz,
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 version integer not null default 1,
 check(status<>'approved' or (approved_attachment_id is not null and approved_by is not null and approved_at is not null))
);
create index customer_contracts_customer on public.customer_contracts(organization_id,updated_at desc,id);
create table public.customer_contract_events (
 id uuid primary key,
 contract_id uuid not null references public.customer_contracts(id),
 action text not null check(action in ('save','approve','cancel')),
 actor_user_id uuid not null references auth.users(id),
 request jsonb not null,
 snapshot jsonb not null,
 created_at timestamptz not null default now()
);
create index customer_contract_events_parent on public.customer_contract_events(contract_id,created_at,id);
create trigger customer_contract_events_immutable before update or delete on public.customer_contract_events
 for each row execute function public.deny_sales_history_mutation();
create trigger customer_contract_events_no_truncate before truncate on public.customer_contract_events
 for each statement execute function public.deny_sales_history_mutation();
create trigger customer_contracts_no_delete before delete on public.customer_contracts
 for each row execute function public.deny_sales_history_mutation();
create trigger customer_contracts_no_truncate before truncate on public.customer_contracts
 for each statement execute function public.deny_sales_history_mutation();

create function public.customer_contract_access(p_kind text)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select public.inventory_active_staff() is true and case when p_kind='service' then public.has_access('service')
 when p_kind in ('placement','payment_terms') then public.has_access('proformas') else false end
$$;
alter table public.customer_contracts enable row level security;
alter table public.customer_contract_events enable row level security;
revoke all on public.customer_contracts,public.customer_contract_events from public,anon,authenticated;
grant select on public.customer_contracts,public.customer_contract_events to authenticated;
create policy customer_contracts_read on public.customer_contracts for select to authenticated using(public.customer_contract_access(kind));
create policy customer_contract_events_read on public.customer_contract_events for select to authenticated
 using(exists(select 1 from public.customer_contracts c where c.id=contract_id and public.customer_contract_access(c.kind)));

create function public.save_customer_contract(p_request_id uuid,p_id uuid,p_expected_version integer,p_organization_id uuid,
 p_kind text,p_title text,p_reference text,p_starts_on date,p_ends_on date,p_notes text)
returns public.customer_contracts language plpgsql security definer set search_path=public,pg_temp as $$
declare v_row public.customer_contracts; v_event public.customer_contract_events; v_request jsonb;
begin
 if public.customer_contract_access(p_kind) is not true then raise exception 'Contract access required' using errcode='42501'; end if;
 if p_request_id is null or p_id is null or p_expected_version is null or p_expected_version<0 then raise exception 'Contract identity and expected version required'; end if;
 if length(trim(coalesce(p_title,''))) not between 2 and 200 or length(coalesce(p_reference,''))>500 or length(coalesce(p_notes,''))>4000
  or p_starts_on is null or not isfinite(p_starts_on) or (p_ends_on is not null and (not isfinite(p_ends_on) or p_ends_on<p_starts_on)) then raise exception 'Check the contract title, dates, reference and notes'; end if;
 if not exists(select 1 from public.organizations where id=p_organization_id and deleted_at is null) then raise exception 'Choose an active customer'; end if;
 v_request:=jsonb_build_object('version',p_expected_version,'organization',p_organization_id,'kind',p_kind,'title',trim(p_title),
  'reference',trim(coalesce(p_reference,'')),'starts',p_starts_on,'ends',p_ends_on,'notes',trim(coalesce(p_notes,'')));
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,20116));
 select * into v_row from public.customer_contracts where id=p_id for update;
 if found and public.customer_contract_access(v_row.kind) is not true then raise exception 'Contract access required' using errcode='42501'; end if;
 select * into v_event from public.customer_contract_events where id=p_request_id;
 if found then
  if v_event.contract_id<>p_id or v_event.action<>'save' or v_event.actor_user_id<>auth.uid() or v_event.request<>v_request then raise exception 'Contract request already used'; end if;
  return jsonb_populate_record(null::public.customer_contracts,v_event.snapshot);
 end if;
 select * into v_row from public.customer_contracts where id=p_id for update;
 if found then
  if public.customer_contract_access(v_row.kind) is not true then raise exception 'Contract access required' using errcode='42501'; end if;
  if v_row.version<>p_expected_version or v_row.status<>'draft' then raise exception 'Only the current draft can be edited; refresh the contract'; end if;
  update public.customer_contracts set organization_id=p_organization_id,kind=p_kind,title=trim(p_title),reference=trim(coalesce(p_reference,'')),
   starts_on=p_starts_on,ends_on=p_ends_on,notes=trim(coalesce(p_notes,'')),version=version+1,updated_at=now() where id=p_id returning * into v_row;
 else
  if p_expected_version<>0 then raise exception 'Contract not found'; end if;
  insert into public.customer_contracts(id,contract_number,organization_id,kind,title,reference,starts_on,ends_on,notes,created_by)
  values(p_id,'CT-'||to_char(current_date,'YYYY')||'-'||lpad(nextval('public.customer_contract_number_seq')::text,6,'0'),p_organization_id,p_kind,
   trim(p_title),trim(coalesce(p_reference,'')),p_starts_on,p_ends_on,trim(coalesce(p_notes,'')),auth.uid()) returning * into v_row;
 end if;
 insert into public.customer_contract_events(id,contract_id,action,actor_user_id,request,snapshot)
 values(p_request_id,p_id,'save',auth.uid(),v_request,to_jsonb(v_row));
 return v_row;
end $$;

create function public.decide_customer_contract(p_request_id uuid,p_id uuid,p_expected_version integer,p_action text,p_attachment_id uuid,p_reference text)
returns public.customer_contracts language plpgsql security definer set search_path=public,pg_temp as $$
declare v_row public.customer_contracts; v_event public.customer_contract_events; v_request jsonb;
begin
 if public.inventory_owner() is not true then raise exception 'Owner approval required' using errcode='42501'; end if;
 if p_id is null or p_request_id is null or p_action is null or p_action not in ('approve','cancel')
  or p_expected_version is null or p_expected_version<1 or length(trim(coalesce(p_reference,''))) not between 2 and 1000 then raise exception 'Decision, current version and reference required'; end if;
 v_request:=jsonb_build_object('version',p_expected_version,'action',p_action,'attachment',p_attachment_id,'reference',trim(p_reference));
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,20116));
 select * into v_event from public.customer_contract_events where id=p_request_id;
 if found then
  if v_event.contract_id<>p_id or v_event.action<>p_action or v_event.actor_user_id<>auth.uid() or v_event.request<>v_request then raise exception 'Contract request already used'; end if;
  return jsonb_populate_record(null::public.customer_contracts,v_event.snapshot);
 end if;
 select * into v_row from public.customer_contracts where id=p_id for update;
 if not found or v_row.version<>p_expected_version then raise exception 'Contract changed; refresh before deciding'; end if;
 if p_action='approve' then
  if v_row.status<>'draft' or (v_row.ends_on is not null and v_row.ends_on<current_date) then raise exception 'Only an unexpired draft can be approved'; end if;
  if not exists(select 1 from public.document_attachments where id=p_attachment_id and record_type='contract' and record_id=p_id) then raise exception 'Select the uploaded contract document to approve'; end if;
 elsif v_row.status='cancelled' then raise exception 'Contract is already cancelled'; end if;
 update public.customer_contracts set status=case p_action when 'approve' then 'approved' else 'cancelled' end,
  approved_attachment_id=case when p_action='approve' then p_attachment_id else approved_attachment_id end,
  approved_by=case when p_action='approve' then auth.uid() else approved_by end,approved_at=case when p_action='approve' then now() else approved_at end,
  version=version+1,updated_at=now() where id=p_id returning * into v_row;
 insert into public.customer_contract_events(id,contract_id,action,actor_user_id,request,snapshot)
 values(p_request_id,p_id,p_action,auth.uid(),v_request,to_jsonb(v_row));
 return v_row;
end $$;

alter table public.document_attachments drop constraint document_attachments_record_type_check;
alter table public.document_attachments add constraint document_attachments_record_type_check
 check(record_type in ('proforma','delivery','service','accounting','contract'));
create or replace function public.document_attachment_parent_access(p_record_type text,p_record_id uuid)
returns boolean language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
 if auth.uid() is null or public.inventory_active_staff() is not true then return false; end if;
 case p_record_type
 when 'proforma' then return (public.has_access('proformas') or public.has_access('deliveries')) and exists(select 1 from public.sales_proformas where id=p_record_id);
 when 'delivery' then return public.has_access('deliveries') and exists(select 1 from public.sales_delivery_notes where id=p_record_id);
 when 'service' then return public.has_access('service') and exists(select 1 from public.service_cases where id=p_record_id);
 when 'accounting' then return public.accounting_access() and exists(select 1 from public.accounting_drafts where id=p_record_id);
 when 'contract' then return exists(select 1 from public.customer_contracts where id=p_record_id and public.customer_contract_access(kind));
 else return false;
 end case;
end $$;
create or replace function public.document_attachment_path_access(p_path text)
returns boolean language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
 if p_path is null or p_path !~ '^(proforma|delivery|service|accounting|contract)/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(pdf|jpg|jpeg|png)$' then return false; end if;
 return public.document_attachment_parent_access(split_part(p_path,'/',1),split_part(p_path,'/',2)::uuid);
end $$;
revoke all on function public.customer_contract_access(text),public.save_customer_contract(uuid,uuid,integer,uuid,text,text,text,date,date,text),public.decide_customer_contract(uuid,uuid,integer,text,uuid,text) from public,anon;
grant execute on function public.customer_contract_access(text),public.save_customer_contract(uuid,uuid,integer,uuid,text,text,text,date,date,text),public.decide_customer_contract(uuid,uuid,integer,text,uuid,text) to authenticated;
commit;
