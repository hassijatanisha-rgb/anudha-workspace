-- Read-only status additions. Existing access checks, grants and money visibility remain unchanged.
begin;
do $migration$
declare v_definition text; r record;
begin
 for r in select * from (values
 ('public.order_live_status(uuid[])',
 $old$   'queued_at',n.packing_queued_at,'blocked_reason',n.packing_blocked_reason,$old$,
 $new$   'queued_at',n.packing_queued_at,'blocked_reason',n.packing_blocked_reason,
   'quantity_summary',(select jsonb_build_object('ordered',coalesce(sum(l.quantity),0),
     'invoiced',coalesce(sum(a.quantity),0),'pending',coalesce(sum(greatest(0,l.quantity-a.quantity)),0))
    from public.sales_proforma_lines l cross join lateral (
     select case when exists(select 1 from public.acc_invoices i where i.proforma_id=n.proforma_id and i.voided_at is null
       and (jsonb_array_length(i.lines)=0 or exists(select 1 from jsonb_array_elements(i.lines) x where nullif(x->>'proforma_line_id','') is null)))
      then l.quantity else coalesce((select sum((x->>'quantity')::integer)
       from public.acc_invoices i cross join lateral jsonb_array_elements(i.lines) x
       where i.proforma_id=n.proforma_id and i.voided_at is null and x->>'proforma_line_id'=l.id::text),0) end quantity
    ) a where l.proforma_id=n.proforma_id),$new$),
 ('public.packing_queue_board()',
 $old$ select id into v_mine from public.sales_delivery_notes where status='packing' and packer_user_id=auth.uid() limit 1;$old$,
 $new$ v_coming:=v_coming||jsonb_build_object('items',coalesce((select jsonb_agg(item order by created_at,id) from (
   select n.created_at,n.id,jsonb_build_object('id',n.id,'delivery_number',n.delivery_number,'status',n.status,
    'organization',o.name,'owner_name',(select public.packing_staff_name(w.assignee_user_id) from public.work_assignments w
     where w.record_type='delivery' and w.record_id=n.id and w.status='open' limit 1)) item
   from public.sales_delivery_notes n join public.organizations o on o.id=n.organization_id
   where n.status in ('accounts_approved','tax_invoice_created') order by n.created_at,n.id limit 100
  ) waiting),'[]'::jsonb));
 select id into v_mine from public.sales_delivery_notes where status='packing' and packer_user_id=auth.uid() limit 1;$new$)
 ) patches(signature,old_body,new_body) loop
  v_definition:=pg_get_functiondef(to_regprocedure(r.signature));
  if v_definition is null or (length(v_definition)-length(replace(v_definition,r.old_body,'')))/length(r.old_body)<>1 then
   raise exception 'Unexpected workflow status implementation: %',r.signature;
  end if;
  execute replace(v_definition,r.old_body,r.new_body);
 end loop;
end $migration$;
commit;
