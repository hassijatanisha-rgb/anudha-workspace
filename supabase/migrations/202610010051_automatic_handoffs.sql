-- Every open order, job and request always has one responsible person. Each workflow step hands the record to the
-- next person automatically: the creator for sales follow-up, then the owner-chosen default for each later step
-- (Tally invoice, packing, delivery, installation, service, purchase approval). A Tally invoice linked to its
-- Pro forma closes the invoicing task, opens a packing job and tells the Pro forma creator. Records waiting at a step
-- with no default person are listed by unowned_work() so nothing sits unseen. Uses the existing work_assignments
-- history; does not change any workflow status, stock or money. A failure here never blocks the workflow itself.
-- Rollback: drop the triggers in a forward migration; assignments and notices stay as history.
begin;

alter table public.work_assignments drop constraint work_assignments_record_type_check;
alter table public.work_assignments add constraint work_assignments_record_type_check
 check (record_type in ('proforma','delivery','service','lead','pending','purchase','tally_invoice'));

create or replace function public.work_record_exists(p_record_type text, p_record_id uuid)
returns boolean language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
 return case p_record_type
  when 'proforma' then exists(select 1 from public.sales_proformas where id=p_record_id and deleted_at is null)
  when 'delivery' then exists(select 1 from public.sales_delivery_notes where id=p_record_id)
  when 'service' then exists(select 1 from public.service_cases where id=p_record_id)
  when 'lead' then exists(select 1 from public.sales_leads where id=p_record_id)
  when 'pending' then exists(select 1 from public.pending_stock_requests where id=p_record_id)
  when 'purchase' then exists(select 1 from public.purchase_orders where id=p_record_id)
  when 'tally_invoice' then exists(select 1 from public.tally_sales_invoices where id=p_record_id)
  else false end;
end $$;
revoke all on function public.work_record_exists(text,uuid) from public, anon, authenticated;

-- Who does each step by default, chosen by the owner. Versioned and append-only; the latest version applies.
create table public.workflow_step_owners (
 id uuid primary key default gen_random_uuid(),
 step text not null check (step in ('invoice','packing','delivery','installation','service','purchase_approval')),
 version integer not null check (version > 0),
 default_user_id uuid references auth.users(id),
 team uuid[] not null default '{}' check (cardinality(team) <= 30),
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(),
 unique (step, version)
);
create index workflow_step_owners_default on public.workflow_step_owners(default_user_id);
create index workflow_step_owners_created_by on public.workflow_step_owners(created_by);
create function public.deny_workflow_step_owner_mutation() returns trigger
language plpgsql set search_path=public,pg_temp as $$ begin raise exception 'Step owner history is immutable; save a new version'; end $$;
create trigger workflow_step_owners_immutable before update or delete on public.workflow_step_owners for each row execute function public.deny_workflow_step_owner_mutation();
create trigger workflow_step_owners_no_truncate before truncate on public.workflow_step_owners for each statement execute function public.deny_workflow_step_owner_mutation();
alter table public.workflow_step_owners enable row level security;
create policy workflow_step_owners_read on public.workflow_step_owners for select to authenticated using ((select public.inventory_active_staff()));
revoke all on public.workflow_step_owners from public, anon, authenticated;
grant select on public.workflow_step_owners to authenticated;

create function public.set_workflow_step_owner(p_step text, p_expected_version integer, p_default_user_id uuid, p_team uuid[] default '{}')
returns public.workflow_step_owners language plpgsql security definer set search_path=public,pg_temp as $$
declare v_next integer; v_row public.workflow_step_owners; v_team uuid[] := coalesce(p_team,'{}');
begin
 if not public.inventory_owner() then raise exception 'Only the owner can choose who does each step'; end if;
 perform pg_advisory_xact_lock(hashtextextended('step-owner:'||coalesce(p_step,''),0));
 select coalesce(max(version),0)+1 into v_next from public.workflow_step_owners where step=p_step;
 if p_expected_version is null or p_expected_version <> v_next-1 then raise exception 'Step owner changed; refresh'; end if;
 if p_default_user_id is not null and not exists(select 1 from public.staff where user_id=p_default_user_id and active) then raise exception 'Choose an active employee'; end if;
 if exists(select 1 from unnest(v_team) t where not exists(select 1 from public.staff where user_id=t and active)) then raise exception 'Team members must be active employees'; end if;
 if p_default_user_id is not null and not (p_default_user_id = any(v_team)) then v_team := array_prepend(p_default_user_id, v_team); end if;
 insert into public.workflow_step_owners(step,version,default_user_id,team,created_by) values(p_step,v_next,p_default_user_id,v_team,auth.uid()) returning * into v_row;
 return v_row;
end $$;

create function public.workflow_step_default(p_step text) returns uuid
language sql stable security definer set search_path=public,pg_temp as $$
 select o.default_user_id from public.workflow_step_owners o
 where o.step=p_step and exists(select 1 from public.staff s where s.user_id=o.default_user_id and s.active)
   and o.version=(select max(version) from public.workflow_step_owners where step=p_step)
$$;

-- Short updates for people who should know but do not own the next step (for example: your Pro forma was invoiced).
create table public.work_notices (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id),
 record_type text not null check (record_type in ('proforma','delivery','service','lead','pending','purchase','tally_invoice')),
 record_id uuid not null,
 record_label text not null check (length(record_label) between 1 and 200),
 message text not null check (length(message) between 1 and 500),
 created_at timestamptz not null default now(),
 read_at timestamptz
);
create index work_notices_user_unread on public.work_notices(user_id, created_at desc) where read_at is null;
create function public.guard_work_notice() returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
 if tg_op='DELETE' then raise exception 'Notices are never deleted'; end if;
 if (to_jsonb(new)-'read_at') is distinct from (to_jsonb(old)-'read_at') or old.read_at is not null then raise exception 'Only an unread notice can be marked read'; end if;
 return new;
end $$;
create trigger work_notices_guard before update or delete on public.work_notices for each row execute function public.guard_work_notice();
alter table public.work_notices enable row level security;
create policy work_notices_read on public.work_notices for select to authenticated using (user_id = (select auth.uid()) or (select public.inventory_owner()));
revoke all on public.work_notices from public, anon, authenticated;
grant select on public.work_notices to authenticated;
create function public.dismiss_work_notice(p_id uuid) returns public.work_notices
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_row public.work_notices;
begin
 update public.work_notices set read_at=now() where id=p_id and user_id=auth.uid() and read_at is null returning * into v_row;
 if not found then raise exception 'Notice not found or already read'; end if;
 return v_row;
end $$;

-- Internal: hand a record to p_assignee (no-op if they already hold this task, or if nobody is set for the step).
create function public.auto_assign_work(p_type text, p_id uuid, p_label text, p_task text, p_assignee uuid, p_note text default '')
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare v_open public.work_assignments; v_new uuid := gen_random_uuid();
begin
 if p_assignee is null or not exists(select 1 from public.staff where user_id=p_assignee and active) then return; end if;
 perform pg_advisory_xact_lock(hashtextextended('work:'||p_type||':'||p_id::text,0));
 select * into v_open from public.work_assignments where record_type=p_type and record_id=p_id and status='open' for update;
 if found and v_open.assignee_user_id=p_assignee and v_open.task=left(trim(p_task),300) then return; end if;
 if found then
  update public.work_assignments set status='handed_on',closed_by=coalesce(auth.uid(),p_assignee),closed_at=now(),close_note='Moved to the next step automatically',version=version+1,updated_at=now() where id=v_open.id;
 end if;
 insert into public.work_assignments(id,record_type,record_id,record_label,task,note,assignee_user_id,assigned_by,status,previous_assignment_id)
 values(v_new,p_type,p_id,left(coalesce(nullif(trim(p_label),''),'Record'),200),left(trim(p_task),300),left('Automatic: '||coalesce(p_note,''),2000),p_assignee,coalesce(auth.uid(),p_assignee),'open',v_open.id);
end $$;

-- Internal: close whatever is open on a record when the record itself is finished or cancelled.
create function public.auto_close_work(p_type text, p_id uuid, p_status text, p_note text)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
 update public.work_assignments set status=p_status,closed_by=coalesce(auth.uid(),assignee_user_id),closed_at=now(),close_note=left(p_note,1000),version=version+1,updated_at=now()
 where record_type=p_type and record_id=p_id and status='open';
end $$;

create function public.auto_notice(p_user uuid, p_type text, p_id uuid, p_label text, p_message text)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if p_user is null or p_user = auth.uid() then return; end if;
 insert into public.work_notices(user_id,record_type,record_id,record_label,message) values(p_user,p_type,p_id,left(coalesce(nullif(p_label,''),'Record'),200),left(p_message,500));
end $$;

-- Workflow rules. Each trigger body is guarded: if handing on fails, the business action still succeeds and the
-- record shows up as needing a responsible person.
create function public.handoff_proforma() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 begin
  if tg_op='INSERT' then
   perform public.auto_assign_work('proforma',new.id,new.document_number,'Prepare the Pro forma and send it to the customer',coalesce(new.prepared_by,auth.uid()));
  elsif new.status is distinct from old.status then
   if new.status='sent' then
    perform public.auto_assign_work('proforma',new.id,new.document_number,'Follow up until the customer accepts',coalesce(new.prepared_by,auth.uid()));
   elsif new.status='accepted' then
    perform public.auto_assign_work('proforma',new.id,new.document_number,'Make the tax invoice in TallyPrime — type '||new.document_number||' in Order No.',public.workflow_step_default('invoice'),'Customer accepted: '||coalesce(new.acceptance_reference,''));
   elsif new.status in ('rejected','cancelled') then
    perform public.auto_close_work('proforma',new.id,'cancelled','Pro forma '||new.status);
   end if;
  end if;
 exception when others then raise warning 'Automatic handoff for Pro forma % failed: %', new.id, sqlerrm;
 end;
 return null;
end $$;
create trigger sales_proformas_handoff after insert or update of status on public.sales_proformas for each row execute function public.handoff_proforma();

create function public.handoff_tally_invoice() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_pf public.sales_proformas; v_packer uuid;
begin
 begin
  if new.match_status='matched' and not new.cancelled and (tg_op='INSERT' or old.match_status<>'matched' or old.cancelled or old.proforma_id is distinct from new.proforma_id) then
   select * into v_pf from public.sales_proformas where id=new.proforma_id;
   perform public.auto_close_work('proforma',v_pf.id,'done','Invoiced in Tally '||new.voucher_number);
   v_packer := public.workflow_step_default('packing');
   perform public.auto_assign_work('tally_invoice',new.id,v_pf.document_number||' · Tally '||new.voucher_number,'Pack order '||v_pf.document_number||' (Tally invoice '||new.voucher_number||')',v_packer,coalesce(new.party_name,''));
   perform public.auto_notice(v_pf.prepared_by,'proforma',v_pf.id,v_pf.document_number,
    'Invoiced in Tally ('||new.voucher_number||') and sent to packing'||coalesce(' — '||(select display_name from public.staff where user_id=v_packer),''));
  elsif tg_op='UPDATE' and (new.cancelled and not old.cancelled or new.match_status<>'matched' and old.match_status='matched') then
   perform public.auto_close_work('tally_invoice',new.id,'cancelled',case when new.cancelled then 'Invoice cancelled in Tally' else 'Invoice no longer linked to this order' end);
  end if;
 exception when others then raise warning 'Automatic handoff for Tally invoice % failed: %', new.id, sqlerrm;
 end;
 return null;
end $$;
create trigger tally_sales_invoices_handoff after insert or update of match_status, cancelled, proforma_id on public.tally_sales_invoices for each row execute function public.handoff_tally_invoice();

create function public.handoff_delivery() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_inv record;
begin
 begin
  if tg_op='INSERT' then
   -- Packing continues on the delivery note; the Tally invoice packing job is handed on to it.
   for v_inv in select id from public.tally_sales_invoices where proforma_id=new.proforma_id and match_status='matched' loop
    perform public.auto_close_work('tally_invoice',v_inv.id,'handed_on','Packing continues on '||new.delivery_number);
   end loop;
  end if;
  if tg_op='INSERT' or new.status is distinct from old.status then
   if new.status in ('accounts_approved','tax_invoice_created') then
    perform public.auto_assign_work('delivery',new.id,new.delivery_number,'Confirm the Tally tax invoice for '||new.delivery_number,public.workflow_step_default('invoice'));
   elsif new.status in ('sent_to_sales','packing','ready') then
    perform public.auto_assign_work('delivery',new.id,new.delivery_number,case new.status when 'ready' then 'Hand '||new.delivery_number||' to delivery' else 'Pack '||new.delivery_number end,public.workflow_step_default('packing'));
   elsif new.status='out_for_delivery' then
    perform public.auto_assign_work('delivery',new.id,new.delivery_number,'Deliver '||new.delivery_number||' and record the signed delivery note',public.workflow_step_default('delivery'));
   elsif new.status='delivered' then
    perform public.auto_close_work('delivery',new.id,'done','Delivered');
   elsif new.status='cancelled' then
    perform public.auto_close_work('delivery',new.id,'cancelled','Delivery cancelled');
   end if;
  end if;
 exception when others then raise warning 'Automatic handoff for delivery % failed: %', new.id, sqlerrm;
 end;
 return null;
end $$;
create trigger sales_delivery_notes_handoff after insert or update of status on public.sales_delivery_notes for each row execute function public.handoff_delivery();

create function public.handoff_service() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_kind text := case when new.case_type='installation' then 'installation' else 'service' end;
begin
 begin
  if new.status in ('completed') and (tg_op='INSERT' or old.status<>'completed') then
   perform public.auto_close_work('service',new.id,'done','Job completed');
  elsif new.status='cancelled' and (tg_op='INSERT' or old.status<>'cancelled') then
   perform public.auto_close_work('service',new.id,'cancelled','Job cancelled');
  elsif new.assigned_user_id is not null and (tg_op='INSERT' or new.assigned_user_id is distinct from old.assigned_user_id or new.status is distinct from old.status) then
   perform public.auto_assign_work('service',new.id,new.case_number,
    case new.status when 'report_required' then 'Complete the '||v_kind||' report for '||new.case_number else 'Carry out '||v_kind||' '||new.case_number end,new.assigned_user_id);
  elsif tg_op='INSERT' and new.status='new' then
   perform public.auto_assign_work('service',new.id,new.case_number,'Assign an engineer and schedule '||v_kind||' '||new.case_number,coalesce(public.workflow_step_default(v_kind),new.hod_user_id));
  end if;
 exception when others then raise warning 'Automatic handoff for service case % failed: %', new.id, sqlerrm;
 end;
 return null;
end $$;
create trigger service_cases_handoff after insert or update of status, assigned_user_id on public.service_cases for each row execute function public.handoff_service();

create function public.handoff_lead() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
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
create trigger sales_leads_handoff after insert or update of stage, owner_user_id on public.sales_leads for each row execute function public.handoff_lead();

create function public.handoff_pending() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 begin
  if tg_op='INSERT' and new.status='waiting' then
   perform public.auto_assign_work('pending',new.id,new.request_number,'Tell the customer when the stock arrives',coalesce(new.salesperson_user_id,new.created_by));
  elsif tg_op='UPDATE' and new.status<>old.status and new.status<>'waiting' then
   perform public.auto_close_work('pending',new.id,case when new.status='fulfilled' then 'done' else 'cancelled' end,'Pending order '||new.status);
  end if;
 exception when others then raise warning 'Automatic handoff for pending order % failed: %', new.id, sqlerrm;
 end;
 return null;
end $$;
create trigger pending_stock_requests_handoff after insert or update of status on public.pending_stock_requests for each row execute function public.handoff_pending();

create function public.handoff_purchase() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 begin
  if tg_op='INSERT' or new.status is distinct from old.status then
   if new.status='requested' then
    perform public.auto_assign_work('purchase',new.id,new.po_number,'Approve or reject purchase '||new.po_number,public.workflow_step_default('purchase_approval'));
   elsif new.status='approved' then
    perform public.auto_assign_work('purchase',new.id,new.po_number,'Place the order with the supplier (LPO)',new.requested_by);
   elsif new.status='ordered' then
    perform public.auto_assign_work('purchase',new.id,new.po_number,'Receive the goods and close '||new.po_number,new.requested_by);
   elsif new.status='closed' then
    perform public.auto_close_work('purchase',new.id,'done','Goods arrived');
   elsif new.status='cancelled' then
    perform public.auto_close_work('purchase',new.id,'cancelled','Purchase cancelled');
   end if;
  end if;
 exception when others then raise warning 'Automatic handoff for purchase % failed: %', new.id, sqlerrm;
 end;
 return null;
end $$;
create trigger purchase_orders_handoff after insert or update of status on public.purchase_orders for each row execute function public.handoff_purchase();

-- Open records nobody is responsible for, oldest first. Visible to all active staff: anyone can pick work up.
create function public.unowned_work()
returns table(record_type text, record_id uuid, record_label text, status text, waiting_since timestamptz)
language sql stable security definer set search_path=public,pg_temp as $$
 with open_records as (
  select 'proforma'::text t, p.id, p.document_number l, p.status s, p.updated_at w from public.sales_proformas p
   where p.deleted_at is null and p.status in ('draft','sent','accepted')
    and not exists(select 1 from public.tally_sales_invoices i where i.proforma_id=p.id and i.match_status='matched' and not i.cancelled)
  union all select 'tally_invoice', i.id, coalesce(p.document_number,'')||' · Tally '||i.voucher_number, 'invoiced', i.imported_at from public.tally_sales_invoices i join public.sales_proformas p on p.id=i.proforma_id
   where i.match_status='matched' and not i.cancelled and not exists(select 1 from public.sales_delivery_notes d where d.proforma_id=i.proforma_id)
  union all select 'delivery', d.id, d.delivery_number, d.status, d.updated_at from public.sales_delivery_notes d where d.status not in ('delivered','cancelled')
  union all select 'service', c.id, c.case_number, c.status, c.updated_at from public.service_cases c where c.status not in ('completed','cancelled')
  union all select 'lead', l.id, l.lead_number, l.stage, l.updated_at from public.sales_leads l where l.stage not in ('won','lost')
  union all select 'pending', r.id, r.request_number, r.status, r.updated_at from public.pending_stock_requests r where r.status='waiting'
  union all select 'purchase', o.id, o.po_number, o.status, o.updated_at from public.purchase_orders o where o.status not in ('closed','cancelled')
 )
 select o.t, o.id, o.l, o.s, o.w from open_records o
 where public.inventory_active_staff()
   and not exists(select 1 from public.work_assignments a where a.record_type=o.t and a.record_id=o.id and a.status='open')
 order by o.w nulls first
 limit 500
$$;

revoke all on function public.auto_assign_work(text,uuid,text,text,uuid,text), public.auto_close_work(text,uuid,text,text), public.auto_notice(uuid,text,uuid,text,text),
 public.handoff_proforma(), public.handoff_tally_invoice(), public.handoff_delivery(), public.handoff_service(), public.handoff_lead(), public.handoff_pending(), public.handoff_purchase(),
 public.deny_workflow_step_owner_mutation(), public.guard_work_notice() from public, anon, authenticated;
revoke all on function public.workflow_step_default(text), public.set_workflow_step_owner(text,integer,uuid,uuid[]), public.dismiss_work_notice(uuid), public.unowned_work() from public, anon;
grant execute on function public.set_workflow_step_owner(text,integer,uuid,uuid[]), public.dismiss_work_notice(uuid), public.unowned_work() to authenticated;
commit;
