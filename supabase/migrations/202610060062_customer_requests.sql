-- Customer requests from the website: inquiries, quote requests, complaints and support requests. Each gets a
-- request number (REQ-2026-000001) the customer keeps; inquiries and quote requests also open a lead in Leads
-- (stage "Needs a salesperson", source Website). Submissions come only through the website-request Edge Function
-- (service role), which also sends the confirmation by WhatsApp or email when those are set up and records the result.
-- Staff work requests through advance_customer_request: take it, mark resolved (with what was done), close, reopen.
-- Inquiries and quotes are visible with Leads access; complaints and support with Leads or Service access.
-- Rollback: revoke the functions in a forward migration; the tables keep the history.
begin;

create sequence public.customer_request_number_seq;

create table public.customer_requests (
 id uuid primary key default gen_random_uuid(),
 request_number text not null unique,
 kind text not null check (kind in ('inquiry','quote','complaint','support')),
 status text not null default 'received' check (status in ('received','in_progress','resolved','closed')),
 name text not null check (length(trim(name)) between 2 and 200),
 phone text not null check (phone ~ '^\+?[0-9]{6,15}$'),
 email text not null default '' check (email = '' or (length(email) <= 200 and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')),
 organization text not null default '' check (length(organization) <= 300),
 product text not null default '' check (length(product) <= 300),
 quantity text not null default '' check (length(quantity) <= 60),
 message text not null check (length(trim(message)) between 2 and 4000),
 contact_channel text not null default 'whatsapp' check (contact_channel in ('whatsapp','email','phone')),
 lead_id uuid references public.sales_leads(id),
 assigned_user_id uuid references auth.users(id),
 resolution_note text not null default '' check (length(resolution_note) <= 2000),
 confirmation_status text not null default 'pending' check (confirmation_status in ('pending','sent','failed','not_set_up')),
 confirmation_detail text not null default '' check (length(confirmation_detail) <= 500),
 source text not null default 'website' check (source in ('website')),
 client_key text not null default '' check (length(client_key) <= 128),
 version integer not null default 1 check (version > 0),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 closed_at timestamptz,
 check ((status = 'resolved') <= (length(trim(resolution_note)) >= 3))
);
create index customer_requests_open on public.customer_requests(kind, status, created_at desc);
create index customer_requests_client on public.customer_requests(client_key, created_at desc);
create index customer_requests_phone on public.customer_requests(phone, created_at desc);
create index customer_requests_lead on public.customer_requests(lead_id);
create index customer_requests_assignee on public.customer_requests(assigned_user_id);

create table public.customer_request_events (
 id uuid primary key default gen_random_uuid(),
 request_id uuid not null references public.customer_requests(id),
 action text not null check (action in ('received','confirmation','take','assign','resolve','close','reopen')),
 from_status text,
 to_status text not null,
 note text not null default '' check (length(note) <= 2000),
 assigned_user_id uuid references auth.users(id),
 actor_user_id uuid references auth.users(id),
 created_at timestamptz not null default now()
);
create index customer_request_events_request on public.customer_request_events(request_id, created_at);
create index customer_request_events_actor on public.customer_request_events(actor_user_id);
create function public.deny_customer_request_event_mutation() returns trigger
language plpgsql set search_path=public,pg_temp as $$ begin raise exception 'Request history is permanent'; end $$;
create trigger customer_request_events_immutable before update or delete on public.customer_request_events for each row execute function public.deny_customer_request_event_mutation();
create trigger customer_request_events_no_truncate before truncate on public.customer_request_events for each statement execute function public.deny_customer_request_event_mutation();

alter table public.customer_requests enable row level security;
alter table public.customer_request_events enable row level security;
create policy customer_requests_read on public.customer_requests for select to authenticated using (
 case when kind in ('inquiry','quote') then (select public.has_access('leads'))
      else (select public.has_access('leads')) or (select public.has_access('service')) end);
create policy customer_request_events_read on public.customer_request_events for select to authenticated using (
 exists(select 1 from public.customer_requests r where r.id = customer_request_events.request_id));
revoke all on public.customer_requests, public.customer_request_events from public, anon, authenticated;
grant select on public.customer_requests, public.customer_request_events to authenticated;
revoke all on sequence public.customer_request_number_seq from public, anon, authenticated;

-- Website submission (service role only, through the Edge Function). p_client_key is a one-way hash of the sender's
-- network address, used only to stop floods: at most 5 requests per hour from one place, and the same phone cannot
-- send the same message twice within 10 minutes (the earlier request number is returned instead).
create function public.submit_customer_request(p_kind text, p_name text, p_phone text, p_email text, p_organization text,
 p_product text, p_quantity text, p_message text, p_channel text, p_client_key text)
returns table(id uuid, request_number text, kind text, duplicate boolean)
language plpgsql security definer set search_path=public,pg_temp as $$
#variable_conflict use_column
declare v_row public.customer_requests; v_owner uuid; v_lead uuid; v_phone text; v_label text;
begin
 v_phone := regexp_replace(coalesce(p_phone,''),'[^0-9+]','','g');
 if coalesce(p_kind,'') not in ('inquiry','quote','complaint','support') then raise exception 'Choose what the request is about'; end if;
 if length(trim(coalesce(p_name,''))) < 2 then raise exception 'Enter your name'; end if;
 if v_phone !~ '^\+?[0-9]{6,15}$' then raise exception 'Enter a phone number we can reach you on'; end if;
 if length(trim(coalesce(p_message,''))) < 2 then raise exception 'Tell us how we can help'; end if;
 perform pg_advisory_xact_lock(hashtextextended('customer-request:'||coalesce(p_client_key,''),0));
 select * into v_row from public.customer_requests r where r.phone = v_phone and r.message = trim(p_message)
  and r.created_at > now() - interval '10 minutes' order by r.created_at desc limit 1;
 if found then return query select v_row.id, v_row.request_number, v_row.kind, true; return; end if;
 if coalesce(p_client_key,'') <> '' and (select count(*) from public.customer_requests r where r.client_key = p_client_key and r.created_at > now() - interval '1 hour') >= 5 then
  raise exception 'Too many requests from this connection. Please call or WhatsApp us instead.';
 end if;
 insert into public.customer_requests(request_number,kind,name,phone,email,organization,product,quantity,message,contact_channel,client_key)
 values('REQ-'||to_char(now(),'YYYY')||'-'||lpad(nextval('public.customer_request_number_seq')::text,6,'0'),p_kind,trim(p_name),v_phone,
  lower(trim(coalesce(p_email,''))),trim(coalesce(p_organization,'')),trim(coalesce(p_product,'')),trim(coalesce(p_quantity,'')),trim(p_message),
  case when p_channel in ('whatsapp','email','phone') then p_channel else 'whatsapp' end,coalesce(p_client_key,''))
 returning * into v_row;
 insert into public.customer_request_events(request_id,action,to_status,note) values(v_row.id,'received','received','From the website');
 -- Inquiries and quote requests also open a lead, recorded under the owner, waiting for a salesperson.
 if v_row.kind in ('inquiry','quote') then
  select s.user_id into v_owner from public.staff s where s.active and s.role='owner' order by s.user_id limit 1;
  if v_owner is not null then
   v_lead := gen_random_uuid();
   v_label := case when v_row.kind='quote' then 'Quote request' else 'Website inquiry' end||case when v_row.product<>'' then ': '||v_row.product else '' end;
   insert into public.sales_leads(id,lead_number,stage,source,caller_name,caller_phone,caller_organization,subject,details,created_by)
   values(v_lead,'LD-'||lpad(nextval('public.sales_lead_number_seq')::text,6,'0'),'inquiry','website',left(v_row.name,200),left(v_row.phone,60),
    left(v_row.organization,300),left(v_label,300),left(v_row.request_number||case when v_row.quantity<>'' then ' · Quantity: '||v_row.quantity else '' end
    ||case when v_row.email<>'' then ' · Email: '||v_row.email else '' end||E'\n\n'||v_row.message,8000),v_owner);
   insert into public.sales_lead_events(lead_id,action,from_stage,to_stage,assigned_user_id,note,actor_user_id)
   values(v_lead,'create',null,'inquiry',null,'From website request '||v_row.request_number,v_owner);
   update public.customer_requests set lead_id=v_lead where customer_requests.id=v_row.id;
  end if;
 end if;
 return query select v_row.id, v_row.request_number, v_row.kind, false;
end $$;

-- The Edge Function records whether the confirmation went out (and why not), so staff can follow up by hand.
create function public.record_customer_request_confirmation(p_id uuid, p_status text, p_detail text)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if p_status not in ('sent','failed','not_set_up') then raise exception 'Unknown confirmation result'; end if;
 update public.customer_requests set confirmation_status=p_status,confirmation_detail=left(coalesce(p_detail,''),500) where id=p_id;
 if not found then raise exception 'Request not found'; end if;
 insert into public.customer_request_events(request_id,action,to_status,note)
 select id,'confirmation',status,left(p_status||case when coalesce(p_detail,'')<>'' then ': '||p_detail else '' end,2000) from public.customer_requests where id=p_id;
end $$;

-- Public tracking (through the Edge Function): the request number plus the last 6 digits of the phone it was sent from.
create function public.track_customer_request(p_request_number text, p_phone_end text)
returns table(request_number text, kind text, status text, received_at timestamptz, updated_at timestamptz)
language sql stable security definer set search_path=public,pg_temp as $$
 select r.request_number, r.kind, r.status, r.created_at, r.updated_at from public.customer_requests r
 where r.request_number = upper(trim(p_request_number))
   and length(regexp_replace(coalesce(p_phone_end,''),'[^0-9]','','g')) >= 6
   and right(r.phone, 6) = right(regexp_replace(coalesce(p_phone_end,''),'[^0-9]','','g'), 6)
$$;

-- Staff: take a request, give it to someone, mark it resolved with what was done, close it, or reopen it.
create function public.advance_customer_request(p_id uuid, p_expected_version integer, p_action text, p_assigned_user_id uuid default null, p_note text default '')
returns public.customer_requests language plpgsql security definer set search_path=public,pg_temp as $$
declare v_row public.customer_requests; v_from text; v_to text; v_assignee uuid; v_note text := trim(coalesce(p_note,''));
begin
 select * into v_row from public.customer_requests where id=p_id for update;
 if not found then raise exception 'Request not found'; end if;
 if not (case when v_row.kind in ('inquiry','quote') then public.has_access('leads') else public.has_access('leads') or public.has_access('service') end) then
  raise exception 'You do not have access to this request. Ask your department head.' using errcode='42501';
 end if;
 if v_row.version <> p_expected_version then raise exception 'Request changed; refresh and compare'; end if;
 if length(v_note) > 2000 then raise exception 'Note is too long'; end if;
 v_assignee := v_row.assigned_user_id; v_from := v_row.status;
 if p_action = 'take' and v_row.status in ('received','in_progress') then v_to := 'in_progress'; v_assignee := auth.uid();
 elsif p_action = 'assign' and v_row.status in ('received','in_progress') then
  if p_assigned_user_id is null or not exists(select 1 from public.staff where user_id=p_assigned_user_id and active) then raise exception 'Choose an active employee'; end if;
  v_to := 'in_progress'; v_assignee := p_assigned_user_id;
 elsif p_action = 'resolve' and v_row.status in ('received','in_progress') then
  if length(v_note) < 3 then raise exception 'Write what was done for the customer'; end if;
  v_to := 'resolved';
 elsif p_action = 'close' and v_row.status in ('received','in_progress','resolved') then
  if v_row.status <> 'resolved' and length(v_note) < 3 then raise exception 'Write why it is closed'; end if;
  v_to := 'closed';
 elsif p_action = 'reopen' and v_row.status in ('resolved','closed') then v_to := 'in_progress';
 else raise exception 'This is not the next allowed step for this request'; end if;
 update public.customer_requests set status=v_to, assigned_user_id=v_assignee,
  resolution_note=case when p_action='resolve' then v_note else resolution_note end,
  closed_at=case when v_to in ('resolved','closed') then coalesce(closed_at,now()) else null end,
  version=version+1, updated_at=now()
 where id=p_id returning * into v_row;
 insert into public.customer_request_events(request_id,action,from_status,to_status,note,assigned_user_id,actor_user_id)
 values(v_row.id,p_action,v_from,v_to,v_note,v_assignee,auth.uid());
 return v_row;
end $$;

revoke all on function public.submit_customer_request(text,text,text,text,text,text,text,text,text,text),
 public.record_customer_request_confirmation(uuid,text,text), public.track_customer_request(text,text) from public, anon, authenticated;
grant execute on function public.submit_customer_request(text,text,text,text,text,text,text,text,text,text),
 public.record_customer_request_confirmation(uuid,text,text), public.track_customer_request(text,text) to service_role;
revoke all on function public.advance_customer_request(uuid,integer,text,uuid,text) from public, anon;
grant execute on function public.advance_customer_request(uuid,integer,text,uuid,text) to authenticated;
revoke all on function public.deny_customer_request_event_mutation() from public, anon, authenticated;
commit;
