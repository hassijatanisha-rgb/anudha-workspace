-- Employees edit contact details on their existing staff identity; login and assigned access stay unchanged.
-- Rollback: revoke these two RPCs in a forward migration; retain contact data and immutable history.
begin;

alter table public.staff add column contact_email text not null default ''
 check (length(contact_email)<=254
  and contact_email=lower(regexp_replace(contact_email,'^[[:space:]]+|[[:space:]]+$','','g'))
  and (contact_email='' or contact_email ~ '^[^[:space:]@<>]+@[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'));

alter table public.staff_account_events drop constraint staff_account_events_action_check;
alter table public.staff_account_events add constraint staff_account_events_action_check check (action in
 ('created','password_reset','phone_changed','department_changed','two_step_reset','access_changed','role_changed','deactivated','reactivated',
  'accounting_granted','accounting_removed','contact_email_changed'));

-- Keep the existing name/version audit guard, with active self-service alongside manager authorization.
create or replace function public.audit_staff_display_name_change()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if tg_op='INSERT' then
  if new.display_name is not null or new.name_version is distinct from 0 then raise exception 'Start unnamed at version zero; the owner or department head sets the display name separately';end if;
  return new;
 end if;
 if row(new.display_name,new.name_version) is not distinct from row(old.display_name,old.name_version) then return new;end if;
 if public.can_manage_staff(old.user_id) is not true
  and (old.user_id=auth.uid() and public.inventory_active_staff()) is not true then
  raise exception 'Active employee or department manager access required' using errcode='42501';
 end if;
 if new.display_name is null or length(new.display_name) not between 1 and 120
  or new.display_name<>regexp_replace(new.display_name,'^[[:space:]]+|[[:space:]]+$','','g') then raise exception 'Display name must be trimmed, nonblank and at most 120 characters';end if;
 if new.name_version is null or new.name_version::bigint<>old.name_version::bigint+1 then raise exception 'Name version must increment by one';end if;
 insert into public.staff_display_name_events(user_id,old_display_name,new_display_name,old_name_version,new_name_version,actor_user_id)
 values(old.user_id,old.display_name,new.display_name,old.name_version,new.name_version,auth.uid());
 return new;
end $$;

create function public.get_my_staff_profile()
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_row public.staff;
begin
 if auth.uid() is null or public.inventory_active_staff() is not true then raise exception 'Active staff and verified sign-in are required' using errcode='42501';end if;
 select * into v_row from public.staff where user_id=auth.uid() and active;
 if not found then raise exception 'Active staff and verified sign-in are required' using errcode='42501';end if;
 return jsonb_build_object('user_id',v_row.user_id,'display_name',v_row.display_name,'name_version',v_row.name_version,
  'phone',v_row.phone,'contact_email',v_row.contact_email,'role',v_row.role,'department',v_row.department);
end $$;

create function public.save_my_staff_profile(p_expected_values jsonb,p_values jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_row public.staff;v_old public.staff;v_name text;v_phone text;v_email text;
begin
 if auth.uid() is null or public.inventory_active_staff() is not true then raise exception 'Active staff and verified sign-in are required' using errcode='42501';end if;
 if jsonb_typeof(p_expected_values) is distinct from 'object' or jsonb_typeof(p_values) is distinct from 'object' then
  raise exception 'Saved profile and new profile values are required';
 end if;
 if not p_values ?& array['display_name','phone','contact_email']
  or exists(select 1 from jsonb_object_keys(p_values) k where k not in ('display_name','phone','contact_email')) then
  raise exception 'Only display name, phone and contact email can be changed';
 end if;
 if not p_expected_values ?& array['display_name','name_version','phone','contact_email']
  or exists(select 1 from jsonb_object_keys(p_expected_values) k where k not in ('display_name','name_version','phone','contact_email')) then
  raise exception 'The saved name, version, phone and contact email are required';
 end if;
 if jsonb_typeof(p_values->'display_name')<>'string' or jsonb_typeof(p_values->'phone')<>'string' or jsonb_typeof(p_values->'contact_email')<>'string'
  or jsonb_typeof(p_expected_values->'display_name') not in ('string','null')
  or jsonb_typeof(p_expected_values->'name_version')<>'number' or (p_expected_values->>'name_version') !~ '^(0|[1-9][0-9]*)$'
  or jsonb_typeof(p_expected_values->'phone')<>'string' or jsonb_typeof(p_expected_values->'contact_email')<>'string' then
  raise exception 'Profile values have an invalid format';
 end if;
 v_name:=regexp_replace(p_values->>'display_name','^[[:space:]]+|[[:space:]]+$','','g');
 if length(v_name) not between 1 and 120 then raise exception 'Display name must be nonblank and at most 120 characters';end if;
 v_phone:=regexp_replace(p_values->>'phone','[[:space:]()-]','','g');
 if length(p_values->>'phone')>24 or (v_phone<>'' and v_phone !~ '^\+[0-9]{8,15}$') then raise exception 'Enter the phone with country code, or leave it empty';end if;
 v_email:=lower(regexp_replace(p_values->>'contact_email','^[[:space:]]+|[[:space:]]+$','','g'));
 if length(v_email)>254 or (v_email<>'' and v_email !~ '^[^[:space:]@<>]+@[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$') then
  raise exception 'Enter a contact email of at most 254 characters, or leave it empty';
 end if;
 -- Match manager name edits' lock order; the row lock also serializes phone/contact changes.
 perform pg_advisory_xact_lock(20260929,40);
 select * into v_row from public.staff where user_id=auth.uid() for update;
 if not found or v_row.active is not true or public.inventory_active_staff() is not true then raise exception 'Active staff and verified sign-in are required' using errcode='42501';end if;
 if jsonb_build_object('display_name',v_row.display_name,'name_version',v_row.name_version,'phone',v_row.phone,'contact_email',v_row.contact_email)
  is distinct from p_expected_values then raise exception 'Your profile changed; refresh before saving';end if;
 if v_row.display_name is distinct from v_name and v_row.name_version=2147483647 then raise exception 'Staff name version exhausted';end if;
 v_old:=v_row;
 if row(v_row.display_name,v_row.phone,v_row.contact_email) is distinct from row(v_name,v_phone,v_email) then
  update public.staff set display_name=v_name,name_version=name_version+case when display_name is distinct from v_name then 1 else 0 end,
   phone=v_phone,contact_email=v_email where user_id=auth.uid() returning * into v_row;
  if v_old.phone is distinct from v_row.phone then
   insert into public.staff_account_events(user_id,action,note,actor_user_id) values(v_row.user_id,'phone_changed',v_row.phone,auth.uid());
  end if;
  if v_old.contact_email is distinct from v_row.contact_email then
   insert into public.staff_account_events(user_id,action,note,actor_user_id) values(v_row.user_id,'contact_email_changed',v_row.contact_email,auth.uid());
  end if;
 end if;
 return jsonb_build_object('user_id',v_row.user_id,'display_name',v_row.display_name,'name_version',v_row.name_version,
  'phone',v_row.phone,'contact_email',v_row.contact_email,'role',v_row.role,'department',v_row.department);
end $$;

revoke all on function public.get_my_staff_profile(),public.save_my_staff_profile(jsonb,jsonb) from public,anon,service_role;
grant execute on function public.get_my_staff_profile(),public.save_my_staff_profile(jsonb,jsonb) to authenticated;
commit;
