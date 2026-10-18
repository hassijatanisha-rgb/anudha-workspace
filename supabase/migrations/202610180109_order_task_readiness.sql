-- Keep invoice tasks aligned with the order balance and automatic owners within their existing access.
begin;

create or replace function public.workflow_step_access(p_step text,p_user_id uuid)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select exists(select 1 from public.staff s where s.user_id=p_user_id and s.active and
  case p_step
   when 'invoice' then public.work_assignment_access('proforma',s.user_id)
    and public.work_assignment_access('delivery',s.user_id)
    and exists(select 1 from public.accounting_memberships m where m.user_id=s.user_id and m.active)
   when 'packing' then public.work_assignment_access('delivery',s.user_id)
   when 'delivery' then public.work_assignment_access('delivery',s.user_id)
   when 'installation' then public.work_assignment_access('service',s.user_id)
   when 'service' then public.work_assignment_access('service',s.user_id)
   when 'purchase_approval' then s.role='owner'
   else false end)
$$;

create or replace function public.workflow_step_default(p_step text) returns uuid
language sql stable security definer set search_path=public,pg_temp as $$
 select coalesce(
  (select o.default_user_id from public.workflow_step_owners o
   where o.step=p_step and public.workflow_step_access(p_step,o.default_user_id)
    and o.version=(select max(version) from public.workflow_step_owners where step=p_step)),
  case when p_step='purchase_approval'
   then (select s.user_id from public.staff s where s.active and s.role='owner' order by s.user_id limit 1)
   when public.workflow_step_access(p_step,auth.uid()) then auth.uid() end)
$$;

-- Matches order_invoice_quantities: a live legacy whole-order invoice covers every line.
create or replace function public.order_needs_invoice(p_proforma_id uuid)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select exists(select 1 from public.sales_proformas p where p.id=p_proforma_id and p.status='accepted' and p.deleted_at is null
  and not exists(select 1 from public.acc_invoices i where i.proforma_id=p.id and i.voided_at is null
   and (jsonb_array_length(i.lines)=0 or exists(select 1 from jsonb_array_elements(i.lines) x where nullif(x->>'proforma_line_id','') is null)))
  and exists(select 1 from public.sales_proforma_lines l where l.proforma_id=p.id and l.quantity>coalesce((
   select sum((x->>'quantity')::integer) from public.acc_invoices i cross join lateral jsonb_array_elements(i.lines) x
   where i.proforma_id=p.id and i.voided_at is null and x->>'proforma_line_id'=l.id::text),0)))
$$;

create or replace function public.sync_order_invoice_work(p_proforma_id uuid)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare v_pf public.sales_proformas;
begin
 select * into v_pf from public.sales_proformas where id=p_proforma_id for update;
 if not found or v_pf.status<>'accepted' or v_pf.deleted_at is not null then return; end if;
 if public.order_needs_invoice(v_pf.id) then
  -- A partial invoice preserves an eligible current reviewer, including a manual owner override.
  if not exists(select 1 from public.work_assignments where record_type='proforma' and record_id=v_pf.id and status='open'
   and public.workflow_step_access('invoice',assignee_user_id)) then
   perform public.auto_assign_work('proforma',v_pf.id,v_pf.document_number,
    'Review quantities and available stock for '||v_pf.document_number||' in Accounts, then invoice the ready quantities',
    public.workflow_step_default('invoice'),'Order has quantities awaiting invoice');
  end if;
 else
  perform public.auto_close_work('proforma',v_pf.id,'done','All order quantities invoiced');
 end if;
end $$;

-- Patch the installed functions so their owner checks, retry behavior and history remain intact.
do $migration$
declare r record; v_definition text;
begin
 for r in select * from (values
  ('public.set_workflow_step_owner(text,integer,uuid,uuid[])',
   $old$ if p_default_user_id is not null and not exists(select 1 from public.staff where user_id=p_default_user_id and active) then raise exception 'Choose an active employee'; end if;$old$,
   $new$ if p_default_user_id is not null and not public.workflow_step_access(p_step,p_default_user_id) then raise exception 'Choose an active employee with access to this workflow step'; end if;$new$),
  ('public.set_workflow_step_owner(text,integer,uuid,uuid[])',
   $old$ if exists(select 1 from unnest(v_team) t where not exists(select 1 from public.staff where user_id=t and active)) then raise exception 'Team members must be active employees'; end if;$old$,
   $new$ if exists(select 1 from unnest(v_team) t where not public.workflow_step_access(p_step,t)) then raise exception 'Team members must have access to this workflow step'; end if;$new$),
  ('public.auto_assign_work(text,uuid,text,text,uuid,text)',
   $old$ if p_assignee is null or not exists(select 1 from public.staff where user_id=p_assignee and active) then return; end if;
 perform pg_advisory_xact_lock(hashtextextended('work:'||p_type||':'||p_id::text,0));$old$,
   $new$ perform pg_advisory_xact_lock(hashtextextended('work:'||p_type||':'||p_id::text,0));
 if p_assignee is null or not public.work_assignment_access(p_type,p_assignee) then
  perform public.auto_close_work(p_type,p_id,'handed_on','Next step needs an employee with workflow access');
  return;
 end if;$new$),
  ('public.handoff_delivery()',
   $old$'Confirm the Tally tax invoice for '||new.delivery_number$old$,
   $new$case new.status when 'tax_invoice_created' then 'Send '||new.delivery_number||' to downstairs sales'
    else 'Link the ERP invoice and reserve stock for '||new.delivery_number end$new$),
  ('public.sync_order_pending(uuid)',
   $old$ end loop;
end $old$,
   $new$ end loop;
 perform public.sync_order_invoice_work(v_pf.id);
end $new$),
  ('public.unowned_work()',
   $old$   where p.deleted_at is null and p.status in ('draft','sent','accepted')
    and not exists(select 1 from public.tally_sales_invoices i where i.proforma_id=p.id and i.match_status='matched' and not i.cancelled)$old$,
   $new$   where p.deleted_at is null and ((p.status in ('draft','sent')
    and not exists(select 1 from public.tally_sales_invoices i where i.proforma_id=p.id and i.match_status='matched' and not i.cancelled))
    or (p.status='accepted' and public.order_needs_invoice(p.id)))$new$)
 ) patches(signature,old_body,new_body) loop
  v_definition:=pg_get_functiondef(to_regprocedure(r.signature));
  if v_definition is null then raise exception 'Missing order task dependency: %',r.signature; end if;
  if strpos(v_definition,r.new_body)>0 then continue; end if;
  if (length(v_definition)-length(replace(v_definition,r.old_body,'')))/length(r.old_body)<>1 then
   raise exception 'Unexpected order task dependency: %',r.signature;
  end if;
  execute replace(v_definition,r.old_body,r.new_body);
 end loop;
end $migration$;

revoke all on function public.workflow_step_access(text,uuid),public.order_needs_invoice(uuid),public.sync_order_invoice_work(uuid)
 from public,anon,authenticated;

-- Correct completed invoice tasks and inaccessible reviewers; preserve eligible unfinished assignments.
do $repair$
declare v_id uuid; v_note public.sales_delivery_notes; v_work public.work_assignments; v_task text;
begin
 for v_id in select p.id from public.sales_proformas p where p.status='accepted' and p.deleted_at is null
  and exists(select 1 from public.work_assignments w where w.record_type='proforma' and w.record_id=p.id and w.status='open'
   and (not public.order_needs_invoice(p.id) or not public.workflow_step_access('invoice',w.assignee_user_id)))
  order by p.id loop
  perform public.sync_order_invoice_work(v_id);
 end loop;
 -- Replace only the untouched automatic legacy instruction; keep the previous task as history.
 for v_note in select * from public.sales_delivery_notes where status in ('accounts_approved','tax_invoice_created') order by id for update loop
  select * into v_work from public.work_assignments where record_type='delivery' and record_id=v_note.id and status='open'
   and task='Confirm the Tally tax invoice for '||v_note.delivery_number and note='Automatic: ' and due_on is null for update;
  if not found then continue; end if;
  v_task:=case v_note.status when 'tax_invoice_created' then 'Send '||v_note.delivery_number||' to downstairs sales'
   else 'Link the ERP invoice and reserve stock for '||v_note.delivery_number end;
  perform public.auto_assign_work('delivery',v_note.id,v_note.delivery_number,v_task,v_work.assignee_user_id);
 end loop;
end $repair$;

commit;
