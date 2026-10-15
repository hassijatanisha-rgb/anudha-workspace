-- Department per employee, set by the owner, so the work report can total done/open/overdue work by department.
-- Changes are logged in staff_account_events. staff_departments() lets any active staff member read names'
-- departments for the report without widening read access to the staff table itself.
-- Rollback: revoke the RPCs in a forward migration; the column can stay.
begin;

alter table public.staff add column department text not null default '' check (department in ('','sales','accounts','stores','service','management'));

alter table public.staff_account_events drop constraint staff_account_events_action_check;
alter table public.staff_account_events add constraint staff_account_events_action_check check (action in ('created','password_reset','phone_changed','department_changed'));

create function public.set_staff_department(p_user_id uuid, p_department text)
returns public.staff language plpgsql security definer set search_path=public,pg_temp as $$
declare v_row public.staff;
begin
 if not public.is_owner() then raise exception 'Owner access required' using errcode='42501'; end if;
 if coalesce(p_department,'') not in ('','sales','accounts','stores','service','management') then raise exception 'Choose a department from the list'; end if;
 update public.staff set department=coalesce(p_department,'') where user_id=p_user_id returning * into v_row;
 if not found then raise exception 'Staff account does not exist'; end if;
 insert into public.staff_account_events(user_id,action,note,actor_user_id) values(p_user_id,'department_changed',coalesce(p_department,''),auth.uid());
 return v_row;
end $$;

create function public.staff_departments()
returns table(user_id uuid, department text, active boolean)
language sql stable security definer set search_path=public,pg_temp as $$
 select s.user_id, s.department, s.active from public.staff s where public.inventory_active_staff()
$$;

revoke all on function public.set_staff_department(uuid,text), public.staff_departments() from public, anon;
grant execute on function public.set_staff_department(uuid,text), public.staff_departments() to authenticated;
commit;
