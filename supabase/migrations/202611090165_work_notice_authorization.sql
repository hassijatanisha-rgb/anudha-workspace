-- Direct notice reads and acknowledgements require the same verified staff session as the bell.
begin;

alter policy work_notices_read on public.work_notices using (
 (select public.inventory_active_staff())
 and (user_id=(select auth.uid()) or (select public.inventory_owner())));

create or replace function public.dismiss_work_notice(p_id uuid) returns public.work_notices
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_row public.work_notices;
begin
 if auth.uid() is null or public.inventory_active_staff() is not true then
  raise exception 'Active staff and verified sign-in are required' using errcode='42501';
 end if;
 update public.work_notices set read_at=now() where id=p_id and user_id=auth.uid() and read_at is null returning * into v_row;
 if not found then raise exception 'Notice not found or already read'; end if;
 return v_row;
end $$;

revoke all on function public.dismiss_work_notice(uuid) from public,anon;
grant execute on function public.dismiss_work_notice(uuid) to authenticated;
commit;
