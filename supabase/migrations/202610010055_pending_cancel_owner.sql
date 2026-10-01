-- Restrict manual pending cancellation to existing owners; no new memberships or stock changes.
-- Department-head delegation is not configured by this migration.
-- Rollback: reviewed forward function replacement; restoring 043 would reopen staff cancellation.
-- Unapplied candidate renumbered after concurrent main migrations 050–053.
begin;
create or replace function public.advance_pending_stock_request(p_id uuid, p_expected_version integer, p_action text, p_note text default '', p_extend_months integer default null)
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
 if p_action='cancel' and not v_owner then raise exception 'Only the owner can cancel a pending request'; end if;
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

-- Existing function ACL is preserved by CREATE OR REPLACE.
commit;
