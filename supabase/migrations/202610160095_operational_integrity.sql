-- Preserve workflow history while rejecting stale edits and unsafe stock releases.
begin;

-- Blocked orders rotate behind unchecked orders, then oldest checks are retried first.
-- Keep lobby/FIFO priority within each group and the existing 50-attempt RPC limit.
create index if not exists sales_delivery_notes_packing_recheck on public.sales_delivery_notes
 (packing_blocked_at asc nulls first, customer_waiting desc, packing_queued_at, created_at, id)
 where status='sent_to_sales';

do $migration$
declare r record; v_oid oid; v_definition text;
begin
 for r in select * from (values
  ('public.resolve_sales_return_line(uuid,integer,text,text,boolean)',
   $old$ select * into v_q from public.inventory_lots where id=v_line.quarantine_lot_id for update;$old$,
   $new$ select * into v_q from public.inventory_lots where id=v_line.quarantine_lot_id for update;
 if p_resolution='restock' and v_q.expiry_date < (now() at time zone 'Africa/Dar_es_Salaam')::date then
  raise exception 'Expired goods cannot go back into stock. Write them off or return them to the supplier.';
 end if;$new$),
  ('public.record_delivery_serials(uuid,integer,jsonb)',
   $old$ return query select * from public.delivery_line_serials where delivery_note_id=v_note.id order by delivery_line_id, serial_number;$old$,
   $new$ update public.sales_delivery_notes set version=version+1,updated_at=now() where id=v_note.id;
 return query select * from public.delivery_line_serials where delivery_note_id=v_note.id order by delivery_line_id, serial_number;$new$),
  ('public.advance_travel_request(uuid,integer,text,text)',
   $old$ if length(coalesce(p_note,'')) > 2000 then raise exception 'Note is too long'; end if;$old$,
   $new$ if length(coalesce(p_note,'')) > (case when p_action in ('approve','decline') then 1000 else 2000 end) then
  raise exception 'Note is too long';
 end if;$new$),
  ('public.packing_take_next()',
   $old$ loop
  select * into v_note from public.sales_delivery_notes where status='sent_to_sales' and id <> all(v_tried)
  order by customer_waiting desc, packing_queued_at nulls last, created_at, id
  limit 1 for update skip locked;
  exit when not found or cardinality(v_tried) >= 50;$old$,
   $new$ loop
  exit when cardinality(v_tried) >= 50;
  select * into v_note from public.sales_delivery_notes where status='sent_to_sales' and id <> all(v_tried)
  order by packing_blocked_at asc nulls first, customer_waiting desc, packing_queued_at nulls last, created_at, id
  limit 1 for update skip locked;
  exit when not found;$new$),
  ('public.packing_take_next()',
   $old$  update public.sales_delivery_notes set packing_blocked_reason=left('Waiting for stock: '||v_problem,300), packing_blocked_at=now() where id=v_note.id;$old$,
   $new$  update public.sales_delivery_notes set packing_blocked_reason=left('Waiting for stock: '||v_problem,300), packing_blocked_at=clock_timestamp() where id=v_note.id;$new$)
 ) as patches(signature,old_body,new_body) loop
  v_oid:=to_regprocedure(r.signature);
  if v_oid is null then raise exception 'Missing expected operational RPC: %',r.signature; end if;
  if not (select prosecdef and prolang=(select oid from pg_language where lanname='plpgsql') from pg_proc where oid=v_oid) then
   raise exception 'Expected SECURITY DEFINER plpgsql operational RPC: %',r.signature;
  end if;
  v_definition:=pg_get_functiondef(v_oid);
  if strpos(v_definition,r.new_body)>0 then continue; end if;
  if (length(v_definition)-length(replace(v_definition,r.old_body,'')))/length(r.old_body)<>1 then
   raise exception 'Unexpected operational RPC implementation: %',r.signature;
  end if;
  execute replace(v_definition,r.old_body,r.new_body);
 end loop;
end $migration$;

commit;
