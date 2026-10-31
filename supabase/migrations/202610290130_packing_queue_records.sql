-- Refresh confirmed packing changes without rereading every card. The ordered ID lists use the same
-- 100-row windows and access gate as packing_queue_board; only changed or newly visible cards carry details.
-- Rollback: drop function public.packing_queue_records(uuid[],uuid[],uuid[]); restore the previous packing client.
begin;

create function public.packing_queue_records(p_ids uuid[], p_known_waiting_ids uuid[] default '{}', p_known_packing_ids uuid[] default '{}') returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_waiting uuid[]; v_packing uuid[]; v_rows jsonb; v_mine uuid;
begin
 perform public.require_access('deliveries');
 if coalesce(cardinality(p_ids),0)>100 or coalesce(cardinality(p_known_waiting_ids),0)>100 or coalesce(cardinality(p_known_packing_ids),0)>100 then
  raise exception 'Ask for at most 100 changed packing records and 100 known records per queue';
 end if;
 p_ids:=coalesce(p_ids,'{}');p_known_waiting_ids:=coalesce(p_known_waiting_ids,'{}');p_known_packing_ids:=coalesce(p_known_packing_ids,'{}');
 if array_position(p_ids,null) is not null or array_position(p_known_waiting_ids,null) is not null or array_position(p_known_packing_ids,null) is not null then
  raise exception 'Packing record IDs must not be null';
 end if;
 perform public.packing_raise_overdue_alerts();
 -- One statement keeps the visible IDs and returned rows on the same snapshot.
 with waiting as materialized (
  select n.id,row_number() over(order by n.customer_waiting desc,n.packing_queued_at nulls last,n.created_at,n.id) position
  from public.sales_delivery_notes n join public.organizations o on o.id=n.organization_id
  where n.status='sent_to_sales' order by 2 limit 100
 ), packing as materialized (
  select n.id,n.packing_taken_at taken_at
  from public.sales_delivery_notes n join public.organizations o on o.id=n.organization_id
  where n.status='packing' order by n.packing_taken_at nulls first limit 100
 )
 select
  coalesce((select array_agg(id order by position) from waiting),'{}'),
  coalesce((select array_agg(id order by taken_at) from packing),'{}'),
  coalesce((select jsonb_agg(jsonb_build_object(
   'id',n.id,'status',n.status,'delivery_number',n.delivery_number,'version',n.version,'customer_waiting',n.customer_waiting,
   'organization',o.name,'location',coalesce(o.location,''),'items',public.packing_items(n),
   'promise_kind',n.promise_kind,'promised_by',n.promised_by,
   'call_customer',(not n.customer_waiting and n.promised_by is not null and now()>n.promised_by+interval '2 days')
  )||case when n.status='packing' then jsonb_build_object(
   'packer_user_id',n.packer_user_id,'packer_name',case when n.packer_user_id is null then null else public.packing_staff_name(n.packer_user_id) end,
   'taken_at',n.packing_taken_at,'alerted',n.packing_alerted_at is not null
  ) else jsonb_build_object('queued_at',n.packing_queued_at,'blocked_reason',n.packing_blocked_reason) end)
  from public.sales_delivery_notes n join public.organizations o on o.id=n.organization_id
  where n.id in(select id from waiting union all select id from packing)
   and (n.id=any(p_ids) or (n.status='sent_to_sales' and not n.id=any(p_known_waiting_ids))
    or (n.status='packing' and not n.id=any(p_known_packing_ids)))),'[]'),
  (select id from public.sales_delivery_notes where status='packing' and packer_user_id=auth.uid() limit 1)
 into v_waiting,v_packing,v_rows,v_mine;
 return jsonb_build_object('now',now(),'waiting_ids',v_waiting,'packing_ids',v_packing,'mine',v_mine,
  'can_release',public.packing_supervisor(),'rows',v_rows);
end $$;

revoke all on function public.packing_queue_records(uuid[],uuid[],uuid[]) from public,anon;
grant execute on function public.packing_queue_records(uuid[],uuid[],uuid[]) to authenticated;
commit;
