-- Add the Marketing department (product managers, marketing and application specialists, headed by Nishita).
-- The department list is otherwise unchanged.
begin;
alter table public.staff drop constraint staff_department_check;
alter table public.staff add constraint staff_department_check check (department in ('','sales','accounts','stores','service','marketing','management'));

create or replace function public.set_staff_department(p_user_id uuid, p_department text)
returns public.staff language plpgsql security definer set search_path=public,pg_temp as $$
declare v_row public.staff;
begin
 if not public.is_owner() then raise exception 'Owner access required' using errcode='42501'; end if;
 if coalesce(p_department,'') not in ('','sales','accounts','stores','service','marketing','management') then raise exception 'Choose a department from the list'; end if;
 update public.staff set department=coalesce(p_department,'') where user_id=p_user_id returning * into v_row;
 if not found then raise exception 'Staff account does not exist'; end if;
 insert into public.staff_account_events(user_id,action,note,actor_user_id) values(p_user_id,'department_changed',coalesce(p_department,''),auth.uid());
 return v_row;
end $$;
commit;
