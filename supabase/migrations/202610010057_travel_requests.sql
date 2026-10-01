-- Travel requests: who is going, where (a client or a typed place), why, who they are meeting, and when they leave and
-- return. The owner approves or declines; afterwards the trip is marked done with a short outcome, or cancelled.
-- Every active employee can see requests, so everyone knows who is away. History is append-only.
-- Rollback: revoke the RPCs in a forward migration; keep the rows as history.
begin;

create sequence public.travel_request_number_seq;
revoke all on sequence public.travel_request_number_seq from public, anon, authenticated;

create table public.travel_requests (
 id uuid primary key,
 request_number text not null unique,
 travellers uuid[] not null check (cardinality(travellers) between 1 and 20),
 organization_id uuid references public.organizations(id),
 destination text not null default '' check (length(destination) <= 300),
 purpose text not null check (purpose in ('meeting','installation','service','delivery','training','other')),
 meeting_with text not null default '' check (length(meeting_with) <= 300),
 depart_at timestamptz not null,
 return_at timestamptz not null,
 transport text not null default '' check (length(transport) <= 200),
 notes text not null default '' check (length(notes) <= 2000),
 status text not null default 'requested' check (status in ('requested','approved','declined','done','cancelled')),
 decided_by uuid references auth.users(id),
 decided_at timestamptz,
 decision_note text not null default '' check (length(decision_note) <= 1000),
 outcome_note text not null default '' check (length(outcome_note) <= 2000),
 version integer not null default 1 check (version > 0),
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 check (return_at > depart_at),
 check (organization_id is not null or length(trim(destination)) >= 2)
);
create index travel_requests_depart on public.travel_requests(depart_at desc);
create index travel_requests_status on public.travel_requests(status, depart_at);
create index travel_requests_organization on public.travel_requests(organization_id);
create index travel_requests_created_by on public.travel_requests(created_by);
create index travel_requests_decided_by on public.travel_requests(decided_by);
create index travel_requests_travellers on public.travel_requests using gin(travellers);

create table public.travel_request_events (
 id uuid primary key default gen_random_uuid(),
 request_id uuid not null references public.travel_requests(id),
 action text not null check (action in ('create','edit','approve','decline','done','cancel')),
 note text not null default '' check (length(note) <= 2000),
 actor_user_id uuid not null references auth.users(id),
 created_at timestamptz not null default now()
);
create index travel_request_events_request on public.travel_request_events(request_id, created_at);
create index travel_request_events_actor on public.travel_request_events(actor_user_id);

create function public.deny_travel_mutation() returns trigger
language plpgsql set search_path=public,pg_temp as $$ begin raise exception 'Travel requests are closed, never deleted; their history is never changed'; end $$;
create trigger travel_requests_no_delete before delete on public.travel_requests for each row execute function public.deny_travel_mutation();
create trigger travel_requests_no_truncate before truncate on public.travel_requests for each statement execute function public.deny_travel_mutation();
create trigger travel_request_events_immutable before update or delete on public.travel_request_events for each row execute function public.deny_travel_mutation();
create trigger travel_request_events_no_truncate before truncate on public.travel_request_events for each statement execute function public.deny_travel_mutation();

alter table public.travel_requests enable row level security;
alter table public.travel_request_events enable row level security;
create policy travel_requests_read on public.travel_requests for select to authenticated using ((select public.inventory_active_staff()));
create policy travel_request_events_read on public.travel_request_events for select to authenticated using ((select public.inventory_active_staff()));
revoke all on public.travel_requests, public.travel_request_events from public, anon, authenticated;
grant select on public.travel_requests, public.travel_request_events to authenticated;

-- Create, or edit while still waiting for a decision (the person who asked, or the owner).
create function public.save_travel_request(p_id uuid, p_expected_version integer, p_travellers uuid[], p_organization_id uuid,
 p_destination text, p_purpose text, p_meeting_with text, p_depart_at timestamptz, p_return_at timestamptz, p_transport text, p_notes text)
returns public.travel_requests language plpgsql security definer set search_path=public,pg_temp as $$
declare v_row public.travel_requests; v_people uuid[];
begin
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
 -- A lost response retried with the same request returns the saved row.
 if p_expected_version = 0 and v_row.created_by = auth.uid() and v_row.version = 1 then return v_row; end if;
 if auth.uid() <> v_row.created_by and not public.inventory_owner() then raise exception 'Only the person who asked or the owner can change this request'; end if;
 if v_row.status <> 'requested' then raise exception 'This request has already been decided'; end if;
 if v_row.version <> p_expected_version then raise exception 'Travel request changed; refresh'; end if;
 update public.travel_requests set travellers=v_people,organization_id=p_organization_id,destination=trim(coalesce(p_destination,'')),purpose=p_purpose,
  meeting_with=trim(coalesce(p_meeting_with,'')),depart_at=p_depart_at,return_at=p_return_at,transport=trim(coalesce(p_transport,'')),notes=coalesce(p_notes,''),
  version=version+1,updated_at=now() where id = p_id returning * into v_row;
 insert into public.travel_request_events(request_id,action,note,actor_user_id) values(v_row.id,'edit','',auth.uid());
 return v_row;
end $$;

-- approve / decline: owner only, while waiting. done: a traveller, the person who asked or the owner, once approved.
-- cancel: the person who asked or the owner, before it is done.
create function public.advance_travel_request(p_id uuid, p_expected_version integer, p_action text, p_note text default '')
returns public.travel_requests language plpgsql security definer set search_path=public,pg_temp as $$
declare v_row public.travel_requests; v_status text;
begin
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
end $$;

revoke all on function public.save_travel_request(uuid,integer,uuid[],uuid,text,text,text,timestamptz,timestamptz,text,text), public.advance_travel_request(uuid,integer,text,text) from public, anon;
grant execute on function public.save_travel_request(uuid,integer,uuid[],uuid,text,text,text,timestamptz,timestamptz,text,text), public.advance_travel_request(uuid,integer,text,text) to authenticated;
revoke all on function public.deny_travel_mutation() from public, anon, authenticated;
commit;
