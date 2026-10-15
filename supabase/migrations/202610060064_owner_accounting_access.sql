-- The owner gives or removes accounting access from the Staff page instead of by database change. Uses the existing
-- accounting_memberships table (accounting_access() is unchanged); each change records who approved it and is logged
-- in the staff account history. Only the owner can see or change it.
-- Rollback: revoke the two functions in a forward migration; memberships stay as set.
begin;
alter table public.staff_account_events drop constraint staff_account_events_action_check;
alter table public.staff_account_events add constraint staff_account_events_action_check check (action in
 ('created','password_reset','phone_changed','department_changed','two_step_reset','access_changed','role_changed','deactivated','reactivated',
  'accounting_granted','accounting_removed'));

create function public.set_accounting_access(p_user_id uuid, p_active boolean)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare v_was boolean;
begin
 if not public.is_owner() then raise exception 'Only the owner can change accounting access' using errcode='42501'; end if;
 if p_active is null then raise exception 'Choose on or off'; end if;
 if not exists(select 1 from public.staff where user_id=p_user_id and (active or not p_active)) then raise exception 'Choose an active employee'; end if;
 select active into v_was from public.accounting_memberships where user_id=p_user_id for update;
 if v_was is not distinct from p_active then return p_active; end if;
 insert into public.accounting_memberships(user_id,active,approved_by,approval_reference)
 values(p_user_id,p_active,auth.uid(),'Owner, Staff page')
 on conflict(user_id) do update set active=excluded.active,approved_by=excluded.approved_by,approval_reference=excluded.approval_reference;
 insert into public.staff_account_events(user_id,action,note,actor_user_id)
 values(p_user_id,case when p_active then 'accounting_granted' else 'accounting_removed' end,'',auth.uid());
 return p_active;
end $$;

create function public.staff_accounting_access()
returns table(user_id uuid, active boolean) language sql stable security definer set search_path=public,pg_temp as $$
 select m.user_id, m.active from public.accounting_memberships m where public.is_owner()
$$;

revoke all on function public.set_accounting_access(uuid,boolean), public.staff_accounting_access() from public, anon;
grant execute on function public.set_accounting_access(uuid,boolean), public.staff_accounting_access() to authenticated;
commit;
