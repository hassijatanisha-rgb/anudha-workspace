-- Pending stock orders: customer quantities waiting for stock, separate from ordinary tasks.
-- Additive only. It never reserves or deducts stock; stock timing stays in the invoice workflow.
-- Rollback: hide the UI and revoke the RPCs in a reviewed forward migration; keep rows and history.
begin;

create sequence public.pending_stock_number_seq;

create table public.pending_stock_requests (
 id uuid primary key,
 request_number text not null unique,
 status text not null check (status in ('waiting','fulfilled','cancelled','expired')),
 organization_id uuid not null references public.organizations(id),
 contact_id uuid references public.contacts(id),
 product_id uuid not null references public.products(id),
 quantity integer not null check (quantity between 1 and 1000000),
 proforma_id uuid references public.sales_proformas(id),
 lead_id uuid references public.sales_leads(id),
 salesperson_user_id uuid not null references auth.users(id),
 notes text not null default '' check (length(notes) <= 4000),
 expires_on date not null,
 extension_count integer not null default 0 check (extension_count between 0 and 4),
 close_note text not null default '' check (length(close_note) <= 1000),
 closed_by uuid references auth.users(id),
 closed_at timestamptz,
 version integer not null default 1 check (version > 0),
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 check ((status = 'waiting') = (closed_at is null and closed_by is null)),
 check (status in ('waiting','expired') or length(trim(close_note)) >= 3)
);
create index pending_stock_waiting on public.pending_stock_requests(status, expires_on, id);
create index pending_stock_product on public.pending_stock_requests(product_id) where status='waiting';
create index pending_stock_salesperson on public.pending_stock_requests(salesperson_user_id, status);
create index pending_stock_organization on public.pending_stock_requests(organization_id);

create table public.pending_stock_events (
 id uuid primary key default gen_random_uuid(),
 request_id uuid not null references public.pending_stock_requests(id),
 action text not null,
 from_status text,
 to_status text not null,
 note text not null default '',
 expires_on date not null,
 actor_user_id uuid not null references auth.users(id),
 created_at timestamptz not null default now()
);
create index pending_stock_events_request on public.pending_stock_events(request_id, created_at);
create index pending_stock_events_actor on public.pending_stock_events(actor_user_id);

create function public.deny_pending_stock_mutation()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
 raise exception 'Pending stock history is immutable and requests are never hard-deleted';
end $$;
create trigger pending_stock_events_immutable before update or delete on public.pending_stock_events for each row execute function public.deny_pending_stock_mutation();
create trigger pending_stock_events_no_truncate before truncate on public.pending_stock_events for each statement execute function public.deny_pending_stock_mutation();
create trigger pending_stock_no_delete before delete on public.pending_stock_requests for each row execute function public.deny_pending_stock_mutation();
create trigger pending_stock_no_truncate before truncate on public.pending_stock_requests for each statement execute function public.deny_pending_stock_mutation();

alter table public.pending_stock_requests enable row level security;
alter table public.pending_stock_events enable row level security;
create policy pending_stock_read on public.pending_stock_requests for select to authenticated using ((select public.inventory_active_staff()));
create policy pending_stock_events_read on public.pending_stock_events for select to authenticated using ((select public.inventory_active_staff()));
revoke all on public.pending_stock_requests, public.pending_stock_events from public, anon, authenticated;
grant select on public.pending_stock_requests, public.pending_stock_events to authenticated;
revoke all on sequence public.pending_stock_number_seq from public, anon, authenticated;

-- Create a waiting request. The invoice split workflow can call this with the same arguments.
create function public.create_pending_stock_request(p_id uuid, p_organization_id uuid, p_contact_id uuid, p_product_id uuid, p_quantity integer,
 p_proforma_id uuid default null, p_lead_id uuid default null, p_salesperson_user_id uuid default null, p_notes text default '')
returns public.pending_stock_requests language plpgsql security definer set search_path=public,pg_temp as $$
declare v_row public.pending_stock_requests; v_salesperson uuid := coalesce(p_salesperson_user_id, auth.uid());
begin
 if not public.inventory_active_staff() then raise exception 'Active staff access is required'; end if;
 if p_id is null or p_organization_id is null or p_product_id is null or p_quantity is null then raise exception 'Client, product and quantity are required'; end if;
 if p_quantity not between 1 and 1000000 then raise exception 'Quantity must be a whole number from 1 to 1,000,000'; end if;
 if length(coalesce(p_notes,'')) > 4000 then raise exception 'Notes are too long'; end if;
 perform pg_advisory_xact_lock(hashtextextended('pending-stock:'||p_id::text,0));
 select * into v_row from public.pending_stock_requests where id=p_id;
 if found then
  -- A retried request with identical content returns the saved row; anything else is a conflict.
  if v_row.created_by=auth.uid() and v_row.organization_id=p_organization_id and v_row.product_id=p_product_id and v_row.quantity=p_quantity
   and v_row.contact_id is not distinct from p_contact_id and v_row.proforma_id is not distinct from p_proforma_id and v_row.lead_id is not distinct from p_lead_id then return v_row; end if;
  raise exception 'Pending request already exists; refresh and compare';
 end if;
 if not exists(select 1 from public.organizations where id=p_organization_id and deleted_at is null) then raise exception 'Choose an existing client'; end if;
 if p_contact_id is not null and not exists(select 1 from public.contacts where id=p_contact_id and organization_id=p_organization_id and deleted_at is null) then raise exception 'Choose a contact from the selected client'; end if;
 if not exists(select 1 from public.products where id=p_product_id and deleted_at is null) then raise exception 'Choose an active product'; end if;
 if p_proforma_id is not null and not exists(select 1 from public.sales_proformas where id=p_proforma_id and organization_id=p_organization_id and deleted_at is null) then raise exception 'Choose a Pro forma for the same client'; end if;
 if p_lead_id is not null and not exists(select 1 from public.sales_leads where id=p_lead_id) then raise exception 'Lead not found'; end if;
 if not exists(select 1 from public.staff where user_id=v_salesperson and active) then raise exception 'Choose an active salesperson'; end if;
 insert into public.pending_stock_requests(id,request_number,status,organization_id,contact_id,product_id,quantity,proforma_id,lead_id,salesperson_user_id,notes,expires_on,created_by)
 values(p_id,'PS-'||lpad(nextval('public.pending_stock_number_seq')::text,6,'0'),'waiting',p_organization_id,p_contact_id,p_product_id,p_quantity,p_proforma_id,p_lead_id,
  v_salesperson,trim(coalesce(p_notes,'')),(current_date + interval '6 months')::date,auth.uid())
 returning * into v_row;
 insert into public.pending_stock_events(request_id,action,from_status,to_status,note,expires_on,actor_user_id)
 values(v_row.id,'create',null,'waiting',v_row.notes,v_row.expires_on,auth.uid());
 return v_row;
end $$;

-- fulfil / cancel: salesperson or owner, with a reason. extend: owner only, max four extensions.
-- expire: anyone, only once the six-month closure date has passed.
create function public.advance_pending_stock_request(p_id uuid, p_expected_version integer, p_action text, p_note text default '', p_extend_months integer default null)
returns public.pending_stock_requests language plpgsql security definer set search_path=public,pg_temp as $$
declare v_row public.pending_stock_requests; v_new public.pending_stock_requests; v_note text := trim(coalesce(p_note,'')); v_owner boolean := public.inventory_owner();
begin
 if not public.inventory_active_staff() then raise exception 'Active staff access is required'; end if;
 if p_id is null or p_expected_version is null or p_action is null then raise exception 'Request, expected version and action are required'; end if;
 if length(v_note) > 1000 then raise exception 'Note is too long'; end if;
 perform pg_advisory_xact_lock(hashtextextended('pending-stock:'||p_id::text,0));
 select * into v_row from public.pending_stock_requests where id=p_id for update;
 if not found then raise exception 'Pending request not found'; end if;
 if v_row.version <> p_expected_version then raise exception 'Pending request changed; refresh and compare'; end if;
 if v_row.status <> 'waiting' then raise exception 'This pending request is already closed'; end if;
 if p_action in ('fulfil','cancel') then
  if not v_owner and v_row.salesperson_user_id <> auth.uid() then raise exception 'Only the salesperson or the owner can close this request'; end if;
  if length(v_note) < 3 then raise exception 'Enter the invoice, delivery or cancellation reference'; end if;
  update public.pending_stock_requests set status=case when p_action='fulfil' then 'fulfilled' else 'cancelled' end,close_note=v_note,closed_by=auth.uid(),closed_at=now(),version=version+1,updated_at=now()
  where id=p_id returning * into v_new;
 elsif p_action='extend' then
  if not v_owner then raise exception 'Only the owner can extend a pending request'; end if;
  if p_extend_months is null or p_extend_months not between 1 and 6 then raise exception 'Extend by 1 to 6 months'; end if;
  if length(v_note) < 3 then raise exception 'Enter why this request is being extended'; end if;
  if v_row.extension_count >= 4 then raise exception 'This request has already been extended four times'; end if;
  update public.pending_stock_requests set expires_on=(greatest(expires_on,current_date) + make_interval(months=>p_extend_months))::date,extension_count=extension_count+1,version=version+1,updated_at=now()
  where id=p_id returning * into v_new;
 elsif p_action='expire' then
  if v_row.expires_on >= current_date then raise exception 'This request is not due to close until %', v_row.expires_on; end if;
  update public.pending_stock_requests set status='expired',close_note=coalesce(nullif(v_note,''),'Closed after the pending period ended'),closed_by=auth.uid(),closed_at=now(),version=version+1,updated_at=now()
  where id=p_id returning * into v_new;
 else
  raise exception 'Unknown pending request action';
 end if;
 insert into public.pending_stock_events(request_id,action,from_status,to_status,note,expires_on,actor_user_id)
 values(v_new.id,p_action,v_row.status,v_new.status,v_note,v_new.expires_on,auth.uid());
 return v_new;
end $$;

revoke all on function public.create_pending_stock_request(uuid,uuid,uuid,uuid,integer,uuid,uuid,uuid,text), public.advance_pending_stock_request(uuid,integer,text,text,integer) from public, anon;
grant execute on function public.create_pending_stock_request(uuid,uuid,uuid,uuid,integer,uuid,uuid,uuid,text), public.advance_pending_stock_request(uuid,integer,text,text,integer) to authenticated;
commit;
