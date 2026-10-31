begin;

create function public.sales_delivery_page(p_filter text default 'notes',p_page integer default 0)
returns jsonb language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare v_result jsonb;
begin
 if not public.inventory_active_staff() or not public.has_access('deliveries') then
  raise exception 'Delivery access is required' using errcode='42501';
 end if;
 if p_filter is null or p_filter not in ('notes','awaiting') then raise exception 'Choose a valid delivery filter'; end if;
 if p_page is null or p_page<0 or p_page>1000000 then raise exception 'Choose a valid delivery page'; end if;
 with notes as materialized (
  select n.id,n.delivery_number,n.proforma_id,n.organization_id,n.contact_id,n.status,n.created_at,n.expected_delivery_date,n.tax_invoice_reference,
   n.customer_waiting,n.packer_user_id,n.packing_taken_at,n.packing_blocked_reason,n.promise_kind,n.promised_by
  from public.sales_delivery_notes n
 ), awaiting as materialized (
  select p.id,p.document_number,p.organization_id,p.contact_id,p.created_at
  from public.sales_proformas p where p.status='accepted' and exists(
   select 1 from public.sales_proforma_lines l where l.proforma_id=p.id and l.quantity>coalesce((
    select sum(dl.quantity) from public.sales_delivery_lines dl join public.sales_delivery_notes n on n.id=dl.delivery_note_id
    where dl.proforma_line_id=l.id and n.proforma_id=p.id and n.status<>'cancelled'
   ),0)
  )
 ), matches as materialized (
  select id,created_at from notes where p_filter='notes'
  union all select id,created_at from awaiting where p_filter='awaiting'
 ), totals as (
  select count(*) as total,greatest(1,(count(*)+49)/50) as pages,least(p_page,greatest(0,(count(*)-1)/50)) as page from matches
 ), page_rows as materialized (
  select * from matches order by created_at desc,id limit 50 offset (select page*50 from totals)
 ), summaries as (
  select n.id,n.created_at,jsonb_build_object('id',n.id,'register_summary',true,'kind','delivery','delivery_number',n.delivery_number,
   'proforma_id',n.proforma_id,'proforma_number',coalesce(p.document_number,'Unavailable'),'status',n.status,'created_at',n.created_at,
   'organization',jsonb_build_object('name',coalesce(o.name,'Client unavailable'),'location',coalesce(o.location,'')),
   'contact_name',case when c.id is null then 'Contact unavailable' else concat_ws(' ',case when c.title<>'N/A' then nullif(c.title,'') end,nullif(c.first_name,''),nullif(c.last_name,'')) end,
   'expected_delivery_date',n.expected_delivery_date,'tax_invoice_reference',n.tax_invoice_reference,
   'customer_waiting',n.customer_waiting,'packer_user_id',n.packer_user_id,'packer_name',nullif(btrim(packer.display_name),''),
   'packing_taken_at',n.packing_taken_at,'packing_blocked_reason',n.packing_blocked_reason,'promise_kind',n.promise_kind,'promised_by',n.promised_by,
   'responsible',handoff.summary,'responsible_delay',delay.summary) as summary
  from page_rows page join notes n on n.id=page.id
  left join public.sales_proformas p on p.id=n.proforma_id
  left join public.organizations o on o.id=n.organization_id and o.deleted_at is null
  left join public.contacts c on c.id=n.contact_id and c.deleted_at is null
  left join public.staff packer on packer.user_id=n.packer_user_id
  left join lateral (
   select w.id,jsonb_build_object('id',w.id,'status',w.status,'assignee_user_id',w.assignee_user_id,'assigned_by',w.assigned_by,
    'assignee_name',nullif(btrim(assignee.display_name),''),'sender_name',nullif(btrim(sender.display_name),''),
    'task',w.task,'created_at',w.created_at,'due_on',w.due_on) as summary
   from public.work_assignments w
   left join public.staff assignee on assignee.user_id=w.assignee_user_id
   left join public.staff sender on sender.user_id=w.assigned_by
   where w.record_type='delivery' and w.record_id=n.id and w.status='open' order by w.created_at desc,w.id desc limit 1
  ) handoff on true
  left join lateral (select jsonb_build_object('reason',d.reason,'expected_on',d.expected_on) as summary from public.work_delays d where d.assignment_id=handoff.id order by d.recorded_at desc,d.id desc limit 1) delay on true
  where p_filter='notes'
  union all
  select p.id,p.created_at,jsonb_build_object('id',p.id,'register_summary',true,'kind','awaiting','document_number',p.document_number,'created_at',p.created_at,
   'organization',jsonb_build_object('name',coalesce(o.name,'Client unavailable'),'location',coalesce(o.location,'')),
   'contact_name',case when c.id is null then 'Contact unavailable' else concat_ws(' ',case when c.title<>'N/A' then nullif(c.title,'') end,nullif(c.first_name,''),nullif(c.last_name,'')) end)
  from page_rows page join awaiting p on p.id=page.id
  left join public.organizations o on o.id=p.organization_id and o.deleted_at is null
  left join public.contacts c on c.id=p.contact_id and c.deleted_at is null
  where p_filter='awaiting'
 )
 select jsonb_build_object('rows',coalesce((select jsonb_agg(summary order by created_at desc,id) from summaries),'[]'::jsonb),
  'filter',p_filter,'total',totals.total,'page',totals.page,'pages',totals.pages,
  'counts',jsonb_build_object('notes',(select count(*) from notes),'awaiting',(select count(*) from awaiting))) into v_result from totals;
 return v_result;
end $$;
revoke all on function public.sales_delivery_page(text,integer) from public,anon;
grant execute on function public.sales_delivery_page(text,integer) to authenticated;
commit;
