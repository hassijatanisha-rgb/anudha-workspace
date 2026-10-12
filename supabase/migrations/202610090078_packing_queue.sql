-- Packing queue (owner decision, staff meeting 2026-10-09). Accounts approve an order; about five stores packers pack
-- it before dispatch. Instead of one person handing orders out, each packer presses "Take next" on their phone.
--
-- * Queue = delivery notes waiting at "Sent to downstairs sales" (sent_to_sales). Customers waiting in the lobby
--   (cash, collecting now) go first, first come first served among themselves; delivery orders follow, oldest first.
--   "First come" is the moment the order reached the queue (packing_queued_at).
-- * Take next = the existing Start packing step (start_sales_delivery_packing, same checks, same history row),
--   assigned to the person who pressed it. Stock is picked by the rule Accounts already use for the Tax Invoice
--   reservation (migration 010): Haadi only, earliest expiry first, then oldest lot. An order that cannot be packed
--   for lack of stock is skipped and shows "Waiting for stock"; it is tried again first on the next press.
--   Rows are claimed with `for update skip locked`, so two packers pressing at once never get the same order; one
--   packer pressing twice is serialised with an advisory lock. One order per packer until they press Packed.
-- * Packed = the existing "Mark ready for delivery" step (advance_sales_delivery 'ready').
-- * The owner or a stores head can put an order back in the queue, with a reason (stock picked by the queue is
--   released again; it keeps its place in the queue).
-- * 30 minutes after an order was taken (packing_overdue_minutes(), the one setting) without Packed, the stores
--   head(s) and the owner get an urgent task, which shows in their bell. It closes itself when the order is packed,
--   put back or cancelled. Alerts are raised by whoever has the queue, the TV screen or the bell open (all poll).
-- * Lobby flag: sales_delivery_notes.customer_waiting, set at the Accounts approval hand-off (or changed later, until
--   packing starts) by anyone with Pro formas or Deliveries access.
-- * Delivery promise (shown, never blocks): an order with any item classified Machines (latest product
--   classification) is "by availability, agreed with the customer" and promised for its expected delivery date;
--   anything else counts as consumables, promised within 24 working hours (Monday to Saturday, Dar es Salaam time)
--   of the Accounts approval. More than 2 days past the promise, the order shows "Call the customer".
-- * order_live_status() gives the person who placed an order one live line (queue position, who is packing it, ...).
--
-- Rollback: a forward migration that revokes execute on packing_take_next, packing_mark_packed, packing_release,
-- packing_queue_board, packing_raise_overdue_alerts, set_delivery_customer_waiting and order_live_status, and drops
-- the trigger sales_delivery_notes_packing. The new columns are kept as history; the Delivery progress buttons keep
-- working as before. Open alert tasks can be closed by the owner from My tasks.
begin;

alter table public.sales_delivery_notes
 add column customer_waiting boolean not null default false,
 add column packing_queued_at timestamptz,
 add column packer_user_id uuid references auth.users(id),
 add column packing_taken_at timestamptz,
 add column packing_auto_reserved boolean not null default false,
 add column packing_blocked_reason text check (packing_blocked_reason is null or length(packing_blocked_reason) <= 300),
 add column packing_blocked_at timestamptz,
 add column packing_alerted_at timestamptz,
 add column packing_alert_task_ids uuid[] not null default '{}',
 add column promise_kind text check (promise_kind is null or promise_kind in ('consumables','machines')),
 add column promised_by timestamptz;

create index sales_delivery_notes_packing_queue on public.sales_delivery_notes(customer_waiting desc, packing_queued_at, created_at, id)
 where status='sent_to_sales';
create index sales_delivery_notes_packer on public.sales_delivery_notes(packer_user_id) where status='packing';
create index if not exists sales_delivery_events_note_time on public.sales_delivery_events(delivery_note_id, created_at);

-- The one setting: minutes a packer has before the order turns red and the stores head and owner are alerted.
create function public.packing_overdue_minutes() returns integer language sql immutable as $$ select 30 $$;
-- Amber warning on the phone and TV screen.
create function public.packing_amber_minutes() returns integer language sql immutable as $$ select 20 $$;

-- p_hours counted on working days only (Monday to Saturday, Dar es Salaam time); Sundays are skipped.
create function public.add_working_hours(p_start timestamptz, p_hours numeric) returns timestamptz
language plpgsql stable set search_path=public,pg_temp as $$
declare v_local timestamp := p_start at time zone 'Africa/Dar_es_Salaam'; v_left interval := make_interval(secs => p_hours*3600);
 v_chunk interval;
begin
 if p_start is null then return null; end if;
 while v_left > interval '0' loop
  if extract(isodow from v_local) = 7 then v_local := date_trunc('day', v_local) + interval '1 day'; continue; end if;
  v_chunk := least(v_left, date_trunc('day', v_local) + interval '1 day' - v_local);
  v_local := v_local + v_chunk; v_left := v_left - v_chunk;
 end loop;
 return v_local at time zone 'Africa/Dar_es_Salaam';
end $$;

create function public.delivery_promise_kind(p_proforma_id uuid) returns text
language sql stable security definer set search_path=public,pg_temp as $$
 select case when exists(
  select 1 from public.sales_proforma_lines pl
  where pl.proforma_id=p_proforma_id and (
   select c.category from public.product_inventory_classifications c where c.product_id=pl.product_id order by c.version desc limit 1
  )='machines') then 'machines' else 'consumables' end $$;

create function public.delivery_promised_by(p_kind text, p_approved_at timestamptz, p_expected date) returns timestamptz
language sql stable set search_path=public,pg_temp as $$
 select case when p_kind='machines' then ((p_expected + 1)::timestamp at time zone 'Africa/Dar_es_Salaam')
  else public.add_working_hours(p_approved_at, 24) end $$;

-- Owner, or an active head of the stores department.
create function public.packing_supervisor() returns boolean
language sql stable security definer set search_path=public,pg_temp as $$
 select public.inventory_active_staff() and exists(select 1 from public.staff where user_id=auth.uid() and active
  and (role='owner' or (role='head' and department='stores'))) $$;

create function public.packing_staff_name(p_user uuid) returns text
language sql stable security definer set search_path=public,pg_temp as $$
 select coalesce(nullif(trim((select display_name from public.staff where user_id=p_user)),''),'a packer') $$;

-- Closes the alert tasks of an order (packed, put back or cancelled).
create function public.packing_close_alerts(p_task_ids uuid[], p_actor uuid, p_status text, p_note text) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_task public.team_tasks;
begin
 for v_task in select * from public.team_tasks where id = any(p_task_ids) and status='open' order by id for update loop
  update public.team_tasks set status=p_status, close_note=left(p_note,1000), closed_by=p_actor, closed_at=now(),
   version=version+1, updated_at=now() where id=v_task.id;
  insert into public.team_task_events(task_id,action,note,actor_user_id)
  values(v_task.id, case when p_status='done' then 'done' else 'cancel' end, left(p_note,1000), p_actor);
 end loop;
end $$;

-- Promise on a new order; queue time when an order reaches the packers; clean-up when packing ends.
create function public.sales_delivery_notes_packing() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_actor uuid; v_minutes integer;
begin
 if tg_op='INSERT' then
  new.promise_kind := coalesce(new.promise_kind, public.delivery_promise_kind(new.proforma_id));
  new.promised_by := coalesce(new.promised_by, public.delivery_promised_by(new.promise_kind, coalesce(new.created_at, now()), new.expected_delivery_date));
  if new.status='sent_to_sales' then new.packing_queued_at := coalesce(new.packing_queued_at, now()); end if;
  return new;
 end if;
 if new.status is distinct from old.status then
  -- Put back from packing keeps its original place in the queue.
  if new.status='sent_to_sales' and old.status<>'packing' then new.packing_queued_at := now(); end if;
  if new.status='sent_to_sales' and new.packing_queued_at is null then new.packing_queued_at := now(); end if;
  if old.status='packing' then
   v_actor := coalesce(auth.uid(), old.packer_user_id);
   v_minutes := floor(extract(epoch from now()-coalesce(old.packing_taken_at, now()))/60);
   if cardinality(old.packing_alert_task_ids) > 0 and v_actor is not null then
    perform public.packing_close_alerts(old.packing_alert_task_ids, v_actor,
     case when new.status='ready' then 'done' else 'cancelled' end,
     case when new.status='ready' then 'Packed after '||v_minutes||' min'
          when new.status='sent_to_sales' then 'Put back in the packing queue'
          else 'Order '||replace(new.status,'_',' ') end);
   end if;
   new.packing_alert_task_ids := '{}';
   if new.status='sent_to_sales' then
    new.packer_user_id := null; new.packing_taken_at := null; new.packing_alerted_at := null;
   end if;
  end if;
 end if;
 return new;
end $$;
create trigger sales_delivery_notes_packing before insert or update on public.sales_delivery_notes
for each row execute function public.sales_delivery_notes_packing();

-- Existing orders: promise from today's rule, and queue time from their history.
update public.sales_delivery_notes n set
 promise_kind = public.delivery_promise_kind(n.proforma_id),
 promised_by = public.delivery_promised_by(public.delivery_promise_kind(n.proforma_id), n.created_at, n.expected_delivery_date),
 packing_queued_at = case when n.status in ('sent_to_sales','packing') then coalesce(
  (select max(e.created_at) from public.sales_delivery_events e where e.delivery_note_id=n.id and e.to_status='sent_to_sales'), n.updated_at) end;

-- "Customer waiting in the lobby — cash, collecting now" or "Delivery". Set at the Accounts approval hand-off by
-- Accounts or Sales, and changeable until packing starts.
create function public.set_delivery_customer_waiting(p_id uuid, p_expected_version integer, p_customer_waiting boolean)
returns public.sales_delivery_notes language plpgsql security definer set search_path=public,pg_temp as $$
declare v_row public.sales_delivery_notes;
begin
 if not (public.has_access('deliveries') or public.has_access('proformas')) then
  raise exception 'You do not have access to deliveries. Ask your department head.' using errcode='42501';
 end if;
 if p_customer_waiting is null then raise exception 'Choose customer waiting or delivery'; end if;
 select * into v_row from public.sales_delivery_notes where id=p_id and version=p_expected_version for update;
 if not found then raise exception 'Delivery changed; refresh before continuing'; end if;
 if v_row.status not in ('accounts_approved','tax_invoice_created','sent_to_sales') then
  raise exception 'Packing has already started; this can no longer be changed';
 end if;
 if v_row.customer_waiting = p_customer_waiting then return v_row; end if;
 update public.sales_delivery_notes set customer_waiting=p_customer_waiting, version=version+1, updated_at=now()
 where id=v_row.id returning * into v_row;
 insert into public.sales_delivery_events(id,delivery_note_id,from_status,to_status,reference,actor_user_id)
 values(gen_random_uuid(), v_row.id, v_row.status, v_row.status,
  case when p_customer_waiting then 'Customer waiting in the lobby — cash, collecting now' else 'Delivery (customer not waiting)' end, auth.uid());
 return v_row;
end $$;

-- Stock for a whole order by the Tax Invoice rule. Raises AN001 when the order cannot be packed now.
create function public.packing_pick_lots(p_note public.sales_delivery_notes) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_line record; v_lot record; v_needed integer; v_take integer; v_used jsonb := '{}'; v_out jsonb := '[]'; v_free integer;
begin
 for v_line in
  select pl.id, pl.product_id, pl.quantity, p.name from public.sales_proforma_lines pl join public.products p on p.id=pl.product_id
  where pl.proforma_id=p_note.proforma_id
   and coalesce((select c.category from public.product_inventory_classifications c where c.product_id=pl.product_id order by c.version desc limit 1),'') <> 'non_stock'
  order by pl.product_id, pl.sort_order, pl.id
 loop
  select v_line.quantity - coalesce(sum(dl.quantity),0)::integer into v_needed
  from public.sales_delivery_lines dl join public.sales_delivery_notes dn on dn.id=dl.delivery_note_id
  where dl.proforma_line_id=v_line.id and dn.status<>'cancelled';
  if v_needed <= 0 then continue; end if;
  for v_lot in
   select lot.id, lot.loose_units, lot.reserved_units from public.inventory_lots lot
   join public.inventory_locations location on location.id=lot.location_id
   where lot.product_id=v_line.product_id and lot.stock_status='available' and location.active and location.is_dispatch_hub
    and lot.loose_units-lot.reserved_units>0
   order by lot.expiry_date nulls last, lot.created_at, lot.id for update of lot
  loop
   v_free := v_lot.loose_units - v_lot.reserved_units - coalesce((v_used->>v_lot.id::text)::integer, 0);
   if v_free <= 0 then continue; end if;
   v_take := least(v_needed, v_free);
   v_used := v_used || jsonb_build_object(v_lot.id::text, coalesce((v_used->>v_lot.id::text)::integer,0)+v_take);
   v_out := v_out || jsonb_build_array(jsonb_build_object('proformaLineId',v_line.id,'lotId',v_lot.id,'quantity',v_take));
   v_needed := v_needed - v_take;
   exit when v_needed = 0;
  end loop;
  if v_needed > 0 then
   raise exception 'Not enough stock at Haadi for % (% more needed)', v_line.name, v_needed using errcode='AN001';
  end if;
 end loop;
 if jsonb_array_length(v_out) = 0 then raise exception 'Nothing is left to pack on this order' using errcode='AN001'; end if;
 return v_out;
end $$;

-- Take next: the top order a packer can pack now, started and assigned to the caller.
create function public.packing_take_next() returns public.sales_delivery_notes
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_me uuid := auth.uid(); v_note public.sales_delivery_notes; v_row public.sales_delivery_notes; v_current text;
 v_auto boolean; v_problem text; v_line record; v_lot public.inventory_lots; v_tried uuid[] := '{}';
begin
 perform public.require_access('deliveries');
 if not public.inventory_active_staff() then raise exception 'Active staff access is required'; end if;
 perform pg_advisory_xact_lock(hashtextextended('packing-packer:'||v_me::text, 0));
 select delivery_number into v_current from public.sales_delivery_notes where packer_user_id=v_me and status='packing' limit 1;
 if found then raise exception 'You are packing % now. Press Packed on it first.', v_current; end if;
 -- One row at a time: a FOR loop over the query would fetch, and so lock, several orders at once.
 loop
  select * into v_note from public.sales_delivery_notes where status='sent_to_sales' and id <> all(v_tried)
  order by customer_waiting desc, packing_queued_at nulls last, created_at, id
  limit 1 for update skip locked;
  exit when not found or cardinality(v_tried) >= 50;
  v_tried := v_tried || v_note.id;
  v_problem := null;
  begin
   if exists(select 1 from public.sales_delivery_lines where delivery_note_id=v_note.id) then
    -- Stock was already reserved for this order (Tax Invoice reservation): the same checks as Start packing.
    for v_line in select lot_id, sum(quantity)::integer quantity from public.sales_delivery_lines where delivery_note_id=v_note.id group by lot_id order by lot_id loop
     select lot.* into v_lot from public.inventory_lots lot join public.inventory_locations location on location.id=lot.location_id
     where lot.id=v_line.lot_id and lot.stock_status='available' and location.active and location.is_dispatch_hub for update of lot;
     if not found or v_lot.reserved_units<v_line.quantity or v_lot.loose_units<v_line.quantity then
      raise exception 'Reserved Haadi stock is no longer sufficient for this order' using errcode='AN001';
     end if;
    end loop;
    update public.sales_delivery_notes set status='packing', version=version+1, updated_at=now() where id=v_note.id returning * into v_row;
    insert into public.sales_delivery_events(id,delivery_note_id,from_status,to_status,reference,actor_user_id)
    values(gen_random_uuid(), v_row.id, 'sent_to_sales', 'packing', 'Packing started from the packing queue', v_me);
    v_auto := false;
   else
    v_row := public.start_sales_delivery_packing(v_note.id, v_note.version, public.packing_pick_lots(v_note));
    v_auto := true;
   end if;
  exception when sqlstate 'AN001' then v_problem := sqlerrm;
  end;
  if v_problem is null then
   update public.sales_delivery_notes set packer_user_id=v_me, packing_taken_at=now(), packing_auto_reserved=v_auto,
    packing_blocked_reason=null, packing_blocked_at=null, packing_alerted_at=null, packing_alert_task_ids='{}'
   where id=v_row.id returning * into v_row;
   perform public.auto_assign_work('delivery', v_row.id, v_row.delivery_number, 'Pack '||v_row.delivery_number||' (taken from the packing queue)', v_me);
   return v_row;
  end if;
  update public.sales_delivery_notes set packing_blocked_reason=left('Waiting for stock: '||v_problem,300), packing_blocked_at=now() where id=v_note.id;
 end loop;
 return null;
end $$;

-- Packed: the existing "Mark ready for delivery" step, by the packer who took it (or the owner / stores head).
create function public.packing_mark_packed(p_id uuid, p_expected_version integer) returns public.sales_delivery_notes
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_row public.sales_delivery_notes;
begin
 perform public.require_access('deliveries');
 select * into v_row from public.sales_delivery_notes where id=p_id for update;
 if not found or v_row.version<>p_expected_version then raise exception 'Delivery changed; refresh before continuing'; end if;
 if v_row.status<>'packing' then raise exception 'This order is not being packed now'; end if;
 if v_row.packer_user_id is distinct from auth.uid() and not public.packing_supervisor() then
  raise exception 'Only % (who took this order), the stores head or the owner can mark it packed', public.packing_staff_name(v_row.packer_user_id) using errcode='42501';
 end if;
 return public.advance_sales_delivery(p_id, p_expected_version, 'ready', '', '', '', '');
end $$;

-- Put an order back in the queue (owner or stores head), with a reason. It keeps its place.
create function public.packing_release(p_id uuid, p_expected_version integer, p_reason text) returns public.sales_delivery_notes
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_row public.sales_delivery_notes; v_line record; v_lot public.inventory_lots; v_was text;
begin
 perform public.require_access('deliveries');
 if not public.packing_supervisor() then
  raise exception 'Only the owner or the stores head can put an order back in the queue' using errcode='42501';
 end if;
 if length(trim(coalesce(p_reason,''))) not between 3 and 500 then raise exception 'Write why the order goes back to the queue'; end if;
 select * into v_row from public.sales_delivery_notes where id=p_id and version=p_expected_version for update;
 if not found then raise exception 'Delivery changed; refresh before continuing'; end if;
 if v_row.status<>'packing' then raise exception 'This order is not being packed now'; end if;
 v_was := case when v_row.packer_user_id is null then '' else ' (was with '||public.packing_staff_name(v_row.packer_user_id)||')' end;
 -- Stock picked when packing started is released, unless the Tax Invoice reservation (migration 010) reserved it.
 if v_row.packing_auto_reserved or to_regprocedure('public.create_tax_invoice_and_reserve_stock(uuid,integer,text)') is null then
  for v_line in select lot_id, sum(quantity)::integer quantity from public.sales_delivery_lines where delivery_note_id=v_row.id group by lot_id order by lot_id loop
   select * into v_lot from public.inventory_lots where id=v_line.lot_id for update;
   if not found or v_lot.reserved_units<v_line.quantity then raise exception 'Reserved Haadi stock is inconsistent; nothing was changed'; end if;
   update public.inventory_lots set reserved_units=reserved_units-v_line.quantity, version=version+1, updated_at=now() where id=v_line.lot_id;
  end loop;
  delete from public.sales_delivery_lines where delivery_note_id=v_row.id;
 end if;
 update public.sales_delivery_notes set status='sent_to_sales', packing_auto_reserved=false, version=version+1, updated_at=now()
 where id=v_row.id returning * into v_row;
 insert into public.sales_delivery_events(id,delivery_note_id,from_status,to_status,reference,actor_user_id)
 values(gen_random_uuid(), v_row.id, 'packing', 'sent_to_sales', left('Put back in the packing queue'||v_was||': '||trim(p_reason),500), auth.uid());
 return v_row;
end $$;

-- Orders taken more than packing_overdue_minutes() ago and not packed: one urgent task each for the stores head(s)
-- and the owner, given in the packer's name so it shows in their bell. Raised once per take. Returns how many orders.
create function public.packing_raise_overdue_alerts() returns integer
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_note record; v_person record; v_ids uuid[]; v_id uuid; v_count integer := 0; v_name text; v_title text; v_details text;
begin
 if not public.inventory_active_staff() then return 0; end if;
 for v_note in
  select n.*, o.name organization_name from public.sales_delivery_notes n join public.organizations o on o.id=n.organization_id
  where n.status='packing' and n.packer_user_id is not null and n.packing_alerted_at is null
   and n.packing_taken_at <= now() - make_interval(mins => public.packing_overdue_minutes())
  order by n.packing_taken_at for update of n skip locked
 loop
  v_ids := '{}'; v_name := public.packing_staff_name(v_note.packer_user_id);
  v_title := left('Packing over '||public.packing_overdue_minutes()||' min: '||v_note.delivery_number||' · '||v_name, 200);
  v_details := v_name||' took '||v_note.delivery_number||' ('||v_note.organization_name||') at '
   ||to_char(v_note.packing_taken_at at time zone 'Africa/Dar_es_Salaam','HH24:MI')||' and has not pressed Packed. '
   ||case when v_note.customer_waiting then 'The customer is waiting in the lobby. ' else '' end
   ||'Check on it, or put it back in the packing queue. Automatic alert from the packing queue; it closes itself when the order is packed.';
  for v_person in select user_id from public.staff where active and user_id<>v_note.packer_user_id
   and (role='owner' or (role='head' and department='stores')) order by user_id loop
   v_id := gen_random_uuid();
   insert into public.team_tasks(id,task_number,title,details,urgency,due_at,assignee_user_id,assigned_by)
   values(v_id,'TK-'||lpad(nextval('public.team_task_number_seq')::text,6,'0'),v_title,v_details,'do_now',now(),v_person.user_id,v_note.packer_user_id);
   insert into public.team_task_events(task_id,action,note,actor_user_id) values(v_id,'create',v_title,v_note.packer_user_id);
   v_ids := v_ids || v_id;
  end loop;
  update public.sales_delivery_notes set packing_alerted_at=now(), packing_alert_task_ids=v_ids where id=v_note.id;
  v_count := v_count + 1;
 end loop;
 return v_count;
end $$;

-- Items of an order for the packer: what was picked once packing started, otherwise the Pro forma balance.
create function public.packing_items(p_note public.sales_delivery_notes) returns jsonb
language sql stable security definer set search_path=public,pg_temp as $$
 select case when exists(select 1 from public.sales_delivery_lines where delivery_note_id=p_note.id) then
  (select coalesce(jsonb_agg(jsonb_build_object('name',p.name,'quantity',dl.quantity,'uom',pl.uom,'batch',coalesce(lot.batch_number,''))
    order by pl.sort_order, dl.id),'[]')
   from public.sales_delivery_lines dl join public.sales_proforma_lines pl on pl.id=dl.proforma_line_id
   join public.products p on p.id=dl.product_id left join public.inventory_lots lot on lot.id=dl.lot_id
   where dl.delivery_note_id=p_note.id)
 else
  (select coalesce(jsonb_agg(jsonb_build_object('name',p.name,'quantity',pl.quantity,'uom',pl.uom,'batch','') order by pl.sort_order, pl.id),'[]')
   from public.sales_proforma_lines pl join public.products p on p.id=pl.product_id where pl.proforma_id=p_note.proforma_id)
 end $$;

-- One read for the packing page and the TV screen. Raises due alerts first.
create function public.packing_queue_board() returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_waiting jsonb; v_packing jsonb; v_coming jsonb; v_mine uuid;
begin
 perform public.require_access('deliveries');
 perform public.packing_raise_overdue_alerts();
 select coalesce(jsonb_agg(x order by x_order),'[]') into v_waiting from (
  select row_number() over (order by n.customer_waiting desc, n.packing_queued_at nulls last, n.created_at, n.id) x_order,
   jsonb_build_object('id',n.id,'delivery_number',n.delivery_number,'version',n.version,'customer_waiting',n.customer_waiting,
    'queued_at',n.packing_queued_at,'organization',o.name,'location',coalesce(o.location,''),'items',public.packing_items(n),
    'promise_kind',n.promise_kind,'promised_by',n.promised_by,'blocked_reason',n.packing_blocked_reason,
    'call_customer',(not n.customer_waiting and n.promised_by is not null and now() > n.promised_by + interval '2 days')) x
  from public.sales_delivery_notes n join public.organizations o on o.id=n.organization_id
  where n.status='sent_to_sales' order by 1 limit 100) w;
 select coalesce(jsonb_agg(x order by x_order),'[]') into v_packing from (
  select n.packing_taken_at x_order,
   jsonb_build_object('id',n.id,'delivery_number',n.delivery_number,'version',n.version,'customer_waiting',n.customer_waiting,
    'packer_user_id',n.packer_user_id,'packer_name',case when n.packer_user_id is null then null else public.packing_staff_name(n.packer_user_id) end,
    'taken_at',n.packing_taken_at,'alerted',n.packing_alerted_at is not null,'organization',o.name,'location',coalesce(o.location,''),
    'items',public.packing_items(n),'promise_kind',n.promise_kind,'promised_by',n.promised_by,
    'call_customer',(not n.customer_waiting and n.promised_by is not null and now() > n.promised_by + interval '2 days')) x
  from public.sales_delivery_notes n join public.organizations o on o.id=n.organization_id
  where n.status='packing' order by n.packing_taken_at nulls first limit 100) p;
 select jsonb_build_object('count',count(*),'customer_waiting',count(*) filter (where customer_waiting)) into v_coming
 from public.sales_delivery_notes where status in ('accounts_approved','tax_invoice_created');
 select id into v_mine from public.sales_delivery_notes where status='packing' and packer_user_id=auth.uid() limit 1;
 return jsonb_build_object('now',now(),'waiting',v_waiting,'packing',v_packing,'coming',v_coming,'mine',v_mine,
  'can_release',public.packing_supervisor(),'amber_minutes',public.packing_amber_minutes(),'overdue_minutes',public.packing_overdue_minutes());
end $$;

-- Live line for the person who placed an order: where each Pro forma's delivery is now. Cheap: one row per Pro
-- forma, the queue position is a count over the small partial queue index.
create function public.order_live_status(p_proforma_ids uuid[]) returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
 if not (public.has_access('proformas') or public.has_access('deliveries')) then
  raise exception 'You do not have access to Pro formas. Ask your department head.' using errcode='42501';
 end if;
 if cardinality(p_proforma_ids) > 300 then raise exception 'Ask for at most 300 orders at a time'; end if;
 return coalesce((select jsonb_agg(jsonb_build_object(
   'proforma_id',n.proforma_id,'delivery_number',n.delivery_number,'status',n.status,'customer_waiting',n.customer_waiting,
   'queued_at',n.packing_queued_at,'blocked_reason',n.packing_blocked_reason,
   'queue_position',case when n.status='sent_to_sales' then 1+(select count(*) from public.sales_delivery_notes q where q.status='sent_to_sales'
     and (q.customer_waiting and not n.customer_waiting or (q.customer_waiting=n.customer_waiting
      and (q.packing_queued_at, q.created_at, q.id) < (n.packing_queued_at, n.created_at, n.id)))) end,
   'packer_name',case when n.packer_user_id is null then null else public.packing_staff_name(n.packer_user_id) end,
   'taken_at',n.packing_taken_at,
   'ready_at',(select max(e.created_at) from public.sales_delivery_events e where e.delivery_note_id=n.id and e.to_status='ready'),
   'dispatched_at',n.dispatched_at,'delivered_at',n.delivered_at,'promise_kind',n.promise_kind,'promised_by',n.promised_by,
   'call_customer',(n.status not in ('delivered','cancelled') and not n.customer_waiting and n.promised_by is not null and now() > n.promised_by + interval '2 days')))
  from (select distinct on (d.proforma_id) d.* from public.sales_delivery_notes d where d.proforma_id = any(p_proforma_ids)
        order by d.proforma_id, (d.status='cancelled'), d.created_at desc) n), '[]');
end $$;

revoke all on function public.packing_overdue_minutes(), public.packing_amber_minutes(), public.add_working_hours(timestamptz,numeric),
 public.delivery_promise_kind(uuid), public.delivery_promised_by(text,timestamptz,date), public.packing_supervisor(),
 public.packing_staff_name(uuid), public.packing_close_alerts(uuid[],uuid,text,text), public.sales_delivery_notes_packing(),
 public.set_delivery_customer_waiting(uuid,integer,boolean), public.packing_pick_lots(public.sales_delivery_notes),
 public.packing_take_next(), public.packing_mark_packed(uuid,integer), public.packing_release(uuid,integer,text),
 public.packing_raise_overdue_alerts(), public.packing_items(public.sales_delivery_notes), public.packing_queue_board(),
 public.order_live_status(uuid[]) from public, anon;
revoke all on function public.delivery_promise_kind(uuid), public.packing_staff_name(uuid), public.packing_close_alerts(uuid[],uuid,text,text),
 public.sales_delivery_notes_packing(), public.packing_pick_lots(public.sales_delivery_notes), public.packing_items(public.sales_delivery_notes)
 from authenticated;
grant execute on function public.packing_overdue_minutes(), public.packing_amber_minutes(), public.add_working_hours(timestamptz,numeric),
 public.delivery_promised_by(text,timestamptz,date), public.packing_supervisor(),
 public.set_delivery_customer_waiting(uuid,integer,boolean), public.packing_take_next(), public.packing_mark_packed(uuid,integer),
 public.packing_release(uuid,integer,text), public.packing_raise_overdue_alerts(), public.packing_queue_board(),
 public.order_live_status(uuid[]) to authenticated;

commit;
