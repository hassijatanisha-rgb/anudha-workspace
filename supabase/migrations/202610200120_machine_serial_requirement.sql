-- New machine units must be identified during packing. Historical delivered records are unchanged.
begin;
create function public.delivery_product_requires_serial(p_product_id uuid)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select exists(select 1 from public.product_serial_settings where product_id=p_product_id and serial_required)
  or coalesce((select category='machines' from public.product_inventory_classifications where product_id=p_product_id order by version desc limit 1),false)
$$;
revoke all on function public.delivery_product_requires_serial(uuid) from public,anon,authenticated;

create function public.guard_machine_delivery_serials()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if new.status not in ('ready','out_for_delivery') or old.status is not distinct from new.status then return new; end if;
 if exists(select 1 from public.sales_delivery_lines line where line.delivery_note_id=new.id and public.delivery_product_requires_serial(line.product_id)
  and line.quantity<>(select count(*) from public.delivery_line_serials serial where serial.delivery_line_id=line.id and serial.returned_at is null)) then
  raise exception 'Enter one real serial number for every machine unit and other serial-tracked item before marking Packed or sending the delivery out';
 end if;
 return new;
end $$;
revoke all on function public.guard_machine_delivery_serials() from public,anon,authenticated;
create trigger sales_delivery_machine_serials before update of status on public.sales_delivery_notes
 for each row execute function public.guard_machine_delivery_serials();

do $migration$
declare r record;v_definition text;
begin
 for r in select * from (values
  ('public.set_product_serial_required(uuid,boolean)',
   $old$ if p_product_id is null or p_required is null then raise exception 'Product and choice are required'; end if;$old$,
   $new$ if p_product_id is null or p_required is null then raise exception 'Product and choice are required'; end if;
 if not p_required and coalesce((select category='machines' from public.product_inventory_classifications where product_id=p_product_id order by version desc limit 1),false) then
  raise exception 'Machine serial numbers are mandatory and cannot be switched off';
 end if;$new$),
  ('public.record_delivery_serials(uuid,integer,jsonb)',
   $old$  if not exists(select 1 from public.product_serial_settings where product_id=v_line.product_id and serial_required) then raise exception 'This product does not need serial numbers'; end if;$old$,
   $new$  if not public.delivery_product_requires_serial(v_line.product_id) then raise exception 'This product does not need serial numbers'; end if;$new$)
 ) patches(signature,old_body,new_body) loop
  v_definition:=pg_get_functiondef(to_regprocedure(r.signature));
  if v_definition is null or (length(v_definition)-length(replace(v_definition,r.old_body,'')))/length(r.old_body)<>1 then raise exception 'Unexpected serial workflow implementation: %',r.signature; end if;
  execute replace(v_definition,r.old_body,r.new_body);
 end loop;
end $migration$;
commit;
