-- Customer returns and credit notes (owner decisions, 12 October 2026).
-- A return is recorded against a delivered delivery line and goes into quarantine, never straight back into stock.
-- Within 7 days of delivery anyone with delivery or stock access may record it; later, a head or the owner must
-- override with a reason. A stores head or the owner inspects each line: restock, write off or return to supplier.
-- Sterile and cold-chain goods are restocked only with an explicit seal and temperature confirmation. Accounts create
-- a Credit Note draft from the return, priced from the original Pro forma line; the tax invoice is never changed.
begin;

alter table public.inventory_movements drop constraint if exists inventory_movements_movement_type_check;
alter table public.inventory_movements add constraint inventory_movements_movement_type_check check (movement_type in
 ('opening_balance','opening_adjustment','transfer_dispatch','transfer_receipt','quarantine_receipt','break_pack','consumer_issue','consumer_return',
  'return_release','return_write_off','return_to_supplier'));

create table if not exists public.sales_return_policy(
 id boolean primary key default true check(id),
 window_days integer not null default 7 check(window_days between 1 and 365),
 version integer not null default 1 check(version>0),
 updated_by uuid, updated_at timestamptz not null default now()
);
insert into public.sales_return_policy(id) values(true) on conflict(id) do nothing;

create sequence if not exists public.sales_return_number_seq;
create table if not exists public.sales_returns(
 id uuid primary key,
 return_number text not null unique,
 delivery_note_id uuid not null references public.sales_delivery_notes(id),
 organization_id uuid not null,
 category text not null check(category in ('wrong_item','wrong_size','unopened','damaged','expired','sterile','cold_chain','other')),
 notes text not null default '' check(length(notes)<=2000),
 late_override_reason text check(late_override_reason is null or length(trim(late_override_reason)) between 5 and 1000),
 status text not null default 'quarantined' check(status in ('quarantined','resolved')),
 credit_note_draft_id uuid unique,
 received_by uuid not null, received_at timestamptz not null default now(),
 version integer not null default 1 check(version>0)
);
create table if not exists public.sales_return_lines(
 id uuid primary key,
 return_id uuid not null references public.sales_returns(id),
 delivery_line_id uuid not null references public.sales_delivery_lines(id),
 product_id uuid not null,
 quantity integer not null check(quantity>0),
 quarantine_lot_id uuid not null references public.inventory_lots(id),
 resolution text check(resolution in ('restock','write_off','return_to_supplier')),
 resolution_note text check(resolution_note is null or length(trim(resolution_note)) between 3 and 1000),
 condition_confirmed boolean not null default false,
 resolved_by uuid, resolved_at timestamptz,
 check((resolution is null)=(resolved_by is null) and (resolution is null)=(resolved_at is null) and (resolution is null)=(resolution_note is null))
);
create index if not exists sales_return_lines_delivery_line on public.sales_return_lines(delivery_line_id);
create index if not exists sales_returns_delivery on public.sales_returns(delivery_note_id);

-- History is append-only: a return and its lines change only through the functions below, and never get deleted.
create or replace function public.guard_sales_return_history() returns trigger language plpgsql set search_path to 'public','pg_temp' as $$
begin
 if tg_op='DELETE' then raise exception 'Returns are permanent history'; end if;
 if tg_table_name='sales_return_lines' then
  if old.resolution is not null or (new.id,new.return_id,new.delivery_line_id,new.product_id,new.quantity,new.quarantine_lot_id) is distinct from (old.id,old.return_id,old.delivery_line_id,old.product_id,old.quantity,old.quarantine_lot_id) then
   raise exception 'A return line is decided once and never edited';
  end if;
 elsif (new.id,new.return_number,new.delivery_note_id,new.organization_id,new.category,new.notes,new.late_override_reason,new.received_by,new.received_at)
   is distinct from (old.id,old.return_number,old.delivery_note_id,old.organization_id,old.category,old.notes,old.late_override_reason,old.received_by,old.received_at)
   or (old.credit_note_draft_id is not null and new.credit_note_draft_id is distinct from old.credit_note_draft_id) then
  raise exception 'Return details are permanent history';
 end if;
 return new;
end $$;
drop trigger if exists sales_returns_history on public.sales_returns;
create trigger sales_returns_history before update or delete on public.sales_returns for each row execute function public.guard_sales_return_history();
drop trigger if exists sales_return_lines_history on public.sales_return_lines;
create trigger sales_return_lines_history before update or delete on public.sales_return_lines for each row execute function public.guard_sales_return_history();

alter table public.sales_return_policy enable row level security;
alter table public.sales_returns enable row level security;
alter table public.sales_return_lines enable row level security;
revoke all on public.sales_return_policy, public.sales_returns, public.sales_return_lines from public, anon, authenticated;
grant select on public.sales_return_policy, public.sales_returns, public.sales_return_lines to authenticated;
drop policy if exists sales_return_policy_read on public.sales_return_policy;
create policy sales_return_policy_read on public.sales_return_policy for select to authenticated using ((select public.inventory_active_staff()));
drop policy if exists sales_returns_read on public.sales_returns;
create policy sales_returns_read on public.sales_returns for select to authenticated using ((select public.has_access('deliveries')) or (select public.has_access('stock')) or (select public.accounting_access()));
drop policy if exists sales_return_lines_read on public.sales_return_lines;
create policy sales_return_lines_read on public.sales_return_lines for select to authenticated using ((select public.has_access('deliveries')) or (select public.has_access('stock')) or (select public.accounting_access()));

-- p_lines: [{"deliveryLineId": uuid, "quantity": int}]
create or replace function public.record_sales_return(p_id uuid, p_delivery_note_id uuid, p_category text, p_notes text, p_late_override_reason text, p_lines jsonb)
returns public.sales_returns language plpgsql security definer set search_path to 'public','pg_temp' as $$
declare v_note public.sales_delivery_notes; v_result public.sales_returns; v_window integer; v_late boolean; v_item record; v_line public.sales_delivery_lines;
 v_source public.inventory_lots; v_lot public.inventory_lots; v_returned integer; v_override text:=nullif(trim(coalesce(p_late_override_reason,'')),'');
begin
 if not (public.has_access('deliveries') or public.has_access('stock')) then raise exception 'You need delivery or stock access to record a return. Ask your department head.'; end if;
 if p_id is null or p_delivery_note_id is null then raise exception 'Return and delivery are required'; end if;
 select * into v_result from public.sales_returns where id=p_id;
 if found then
  if v_result.delivery_note_id=p_delivery_note_id and v_result.received_by=auth.uid() then return v_result; end if;
  raise exception 'This return was already recorded differently; refresh';
 end if;
 if p_category not in ('wrong_item','wrong_size','unopened','damaged','expired','sterile','cold_chain','other') then raise exception 'Choose why the goods came back'; end if;
 if length(coalesce(p_notes,''))>2000 then raise exception 'Notes are too long'; end if;
 if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) not between 1 and 100 then raise exception 'Add between 1 and 100 returned items'; end if;
 select * into v_note from public.sales_delivery_notes where id=p_delivery_note_id for update;
 if not found or v_note.status<>'delivered' or v_note.delivered_at is null then raise exception 'Only a delivered order can be returned'; end if;
 select window_days into v_window from public.sales_return_policy where id;
 v_late:=(now() at time zone 'Africa/Dar_es_Salaam')::date > (v_note.delivered_at at time zone 'Africa/Dar_es_Salaam')::date + v_window;
 if v_late and v_override is null then raise exception 'This delivery is older than % days. A department head or the owner must record the return with a reason.', v_window; end if;
 if v_late and not (public.inventory_owner() or public.is_department_head()) then raise exception 'Late returns need a department head or the owner.'; end if;
 if not v_late and v_override is not null then raise exception 'This return is within % days; no override is needed.', v_window; end if;
 if v_override is not null and length(v_override)<5 then raise exception 'Write the reason for accepting a late return'; end if;
 insert into public.sales_returns(id,return_number,delivery_note_id,organization_id,category,notes,late_override_reason,received_by)
 values(p_id,'RT-'||to_char(now() at time zone 'Africa/Dar_es_Salaam','YYYY')||'-'||lpad(nextval('public.sales_return_number_seq')::text,6,'0'),v_note.id,v_note.organization_id,p_category,trim(coalesce(p_notes,'')),v_override,auth.uid())
 returning * into v_result;
 for v_item in select (e->>'deliveryLineId')::uuid line_id,(e->>'quantity')::integer qty from jsonb_array_elements(p_lines) e loop
  if v_item.line_id is null or v_item.qty is null or v_item.qty<1 then raise exception 'Every returned item needs a whole quantity'; end if;
  select * into v_line from public.sales_delivery_lines where id=v_item.line_id and delivery_note_id=v_note.id for update;
  if not found then raise exception 'A returned item is not on this delivery'; end if;
  select coalesce(sum(quantity),0) into v_returned from public.sales_return_lines where delivery_line_id=v_line.id;
  if v_returned+v_item.qty>v_line.quantity then raise exception 'You cannot return more than was delivered (% delivered, % already returned)', v_line.quantity, v_returned; end if;
  select * into v_source from public.inventory_lots where id=v_line.lot_id;
  select * into v_lot from public.inventory_lots where product_id=v_source.product_id and location_id=v_source.location_id and pack_definition_id=v_source.pack_definition_id
   and batch_number is not distinct from v_source.batch_number and coalesce(expiry_date,'infinity'::date)=coalesce(v_source.expiry_date,'infinity'::date) and stock_status='quarantine' for update;
  if found then
   update public.inventory_lots set loose_units=loose_units+v_item.qty,version=version+1,updated_at=now() where id=v_lot.id;
  else
   insert into public.inventory_lots(id,product_id,location_id,pack_definition_id,batch_number,expiry_date,sealed_cartons,loose_units,reserved_units,stock_status)
   values(gen_random_uuid(),v_source.product_id,v_source.location_id,v_source.pack_definition_id,v_source.batch_number,v_source.expiry_date,0,v_item.qty,0,'quarantine') returning * into v_lot;
  end if;
  insert into public.inventory_movements(id,lot_id,movement_type,loose_unit_change,base_unit_change,reason,actor_user_id)
  values(gen_random_uuid(),v_lot.id,'consumer_return',v_item.qty,v_item.qty,'Return '||v_result.return_number||' from '||v_note.delivery_number,auth.uid());
  insert into public.sales_return_lines(id,return_id,delivery_line_id,product_id,quantity,quarantine_lot_id)
  values(gen_random_uuid(),v_result.id,v_line.id,v_line.product_id,v_item.qty,v_lot.id);
 end loop;
 return v_result;
end $$;

create or replace function public.resolve_sales_return_line(p_line_id uuid, p_expected_version integer, p_resolution text, p_note text, p_condition_confirmed boolean)
returns public.sales_returns language plpgsql security definer set search_path to 'public','pg_temp' as $$
declare v_return public.sales_returns; v_line public.sales_return_lines; v_q public.inventory_lots; v_lot public.inventory_lots; v_note text:=trim(coalesce(p_note,''));
begin
 if not public.packing_supervisor() then raise exception 'Only the stores head or the owner can inspect returns.'; end if;
 if p_resolution not in ('restock','write_off','return_to_supplier') then raise exception 'Choose restock, write off or return to supplier'; end if;
 if length(v_note) not between 3 and 1000 then raise exception 'Write what the inspection found'; end if;
 select * into v_line from public.sales_return_lines where id=p_line_id for update;
 if not found then raise exception 'Return line not found'; end if;
 select * into v_return from public.sales_returns where id=v_line.return_id and version=p_expected_version for update;
 if not found then raise exception 'Return changed; refresh before deciding'; end if;
 if v_line.resolution is not null then raise exception 'This item was already decided'; end if;
 if p_resolution='restock' and v_return.category in ('sterile','cold_chain') and p_condition_confirmed is not true then
  raise exception 'Sterile and cold-chain goods are restocked only after you confirm the seal and temperature were checked.';
 end if;
 if p_resolution='restock' and v_return.category='expired' then raise exception 'Expired goods cannot go back into stock. Write them off or return them to the supplier.'; end if;
 select * into v_q from public.inventory_lots where id=v_line.quarantine_lot_id for update;
 if v_q.loose_units<v_line.quantity then raise exception 'Quarantine stock no longer matches this return; ask the stores head to check it.'; end if;
 update public.inventory_lots set loose_units=loose_units-v_line.quantity,version=version+1,updated_at=now() where id=v_q.id;
 insert into public.inventory_movements(id,lot_id,movement_type,loose_unit_change,base_unit_change,reason,actor_user_id)
 values(gen_random_uuid(),v_q.id,case p_resolution when 'restock' then 'return_release' when 'write_off' then 'return_write_off' else 'return_to_supplier' end,
  -v_line.quantity,-v_line.quantity,'Return '||v_return.return_number||': '||v_note,auth.uid());
 if p_resolution='restock' then
  select * into v_lot from public.inventory_lots where product_id=v_q.product_id and location_id=v_q.location_id and pack_definition_id=v_q.pack_definition_id
   and batch_number is not distinct from v_q.batch_number and coalesce(expiry_date,'infinity'::date)=coalesce(v_q.expiry_date,'infinity'::date) and stock_status='available' for update;
  if found then
   update public.inventory_lots set loose_units=loose_units+v_line.quantity,version=version+1,updated_at=now() where id=v_lot.id;
  else
   insert into public.inventory_lots(id,product_id,location_id,pack_definition_id,batch_number,expiry_date,sealed_cartons,loose_units,reserved_units,stock_status)
   values(gen_random_uuid(),v_q.product_id,v_q.location_id,v_q.pack_definition_id,v_q.batch_number,v_q.expiry_date,0,v_line.quantity,0,'available') returning * into v_lot;
  end if;
  insert into public.inventory_movements(id,lot_id,movement_type,loose_unit_change,base_unit_change,reason,actor_user_id)
  values(gen_random_uuid(),v_lot.id,'return_release',v_line.quantity,v_line.quantity,'Return '||v_return.return_number||' restocked after inspection',auth.uid());
 end if;
 update public.sales_return_lines set resolution=p_resolution,resolution_note=v_note,condition_confirmed=coalesce(p_condition_confirmed,false),resolved_by=auth.uid(),resolved_at=now() where id=v_line.id;
 update public.sales_returns set version=version+1,
  status=case when exists(select 1 from public.sales_return_lines where return_id=v_return.id and resolution is null) then 'quarantined' else 'resolved' end
 where id=v_return.id returning * into v_return;
 return v_return;
end $$;

-- Accounts: a Credit Note draft priced from the original Pro forma lines, linked to the tax invoice reference.
create or replace function public.create_return_credit_note(p_return_id uuid, p_expected_version integer, p_draft_id uuid)
returns public.accounting_drafts language plpgsql security definer set search_path to 'public','pg_temp' as $$
declare v_return public.sales_returns; v_note public.sales_delivery_notes; v_currency text; v_lines jsonb; v_total bigint; v_body jsonb; v_draft public.accounting_drafts;
begin
 if public.accounting_access() is not true then raise exception 'Only accounts staff can create a credit note.'; end if;
 select * into v_return from public.sales_returns where id=p_return_id and version=p_expected_version for update;
 if not found then raise exception 'Return changed; refresh before continuing'; end if;
 if v_return.credit_note_draft_id is not null then
  if v_return.credit_note_draft_id=p_draft_id then select * into v_draft from public.accounting_drafts where id=p_draft_id; return v_draft; end if;
  raise exception 'A credit note draft already exists for this return';
 end if;
 select * into v_note from public.sales_delivery_notes where id=v_return.delivery_note_id;
 select currency into v_currency from public.sales_proformas where id=v_note.proforma_id;
 with priced as (
  select rl.quantity, pl.description, pl.uom,
   rl.quantity::bigint*pl.unit_price_minor as gross,
   round(rl.quantity::numeric*pl.unit_price_minor*pl.discount_basis_points/10000)::bigint as discount, pl.tax_basis_points
  from public.sales_return_lines rl join public.sales_delivery_lines dl on dl.id=rl.delivery_line_id
  join public.sales_proforma_lines pl on pl.id=dl.proforma_line_id
  where rl.return_id=v_return.id
 ), totals as (select *, gross-discount as net, round((gross-discount)::numeric*tax_basis_points/10000)::bigint as tax from priced)
 select jsonb_agg(jsonb_build_object('particulars',description||' · '||quantity||' '||uom||' returned ('||v_return.return_number||')','amount',to_char((net+tax)/100.0,'FM999999999999990.00'),
   'quantityReturned',quantity,'netMinor',net,'taxMinor',tax)), coalesce(sum(net+tax),0)
 into v_lines, v_total from totals;
 if v_lines is null then raise exception 'This return has no priced items'; end if;
 v_body:=jsonb_build_object('number','','date',to_char(now() at time zone 'Africa/Dar_es_Salaam','YYYY-MM-DD'),
  'reference',coalesce(v_note.tax_invoice_reference,''),'reference_date',coalesce(to_char(v_note.delivered_at at time zone 'Africa/Dar_es_Salaam','YYYY-MM-DD'),''),
  'party',coalesce((select name from public.organizations where id=v_return.organization_id),''),'amount_words','',
  'lines',v_lines,'currency',coalesce(v_currency,'TZS'),'totalMinor',v_total,
  'source',jsonb_build_object('returnId',v_return.id,'returnNumber',v_return.return_number,'deliveryNumber',v_note.delivery_number,'taxInvoiceReference',v_note.tax_invoice_reference));
 insert into public.accounting_drafts(id,kind,version,organization_id,contact_id,body,created_by,updated_by)
 values(p_draft_id,'credit_note',1,v_return.organization_id,null,v_body,auth.uid(),auth.uid()) returning * into v_draft;
 insert into public.accounting_draft_history(draft_id,version,organization_id,contact_id,body,actor_id) values(v_draft.id,1,v_draft.organization_id,null,v_draft.body,auth.uid());
 update public.sales_returns set credit_note_draft_id=v_draft.id,version=version+1 where id=v_return.id;
 return v_draft;
end $$;

revoke all on function public.record_sales_return(uuid,uuid,text,text,text,jsonb), public.resolve_sales_return_line(uuid,integer,text,text,boolean),
 public.create_return_credit_note(uuid,integer,uuid), public.guard_sales_return_history() from public, anon;
grant execute on function public.record_sales_return(uuid,uuid,text,text,text,jsonb), public.resolve_sales_return_line(uuid,integer,text,text,boolean),
 public.create_return_credit_note(uuid,integer,uuid) to authenticated;

commit;
