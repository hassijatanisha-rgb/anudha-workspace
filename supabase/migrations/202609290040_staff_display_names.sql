-- Additive naming only; requires inventory foundation 001. No inferred names.
-- Forward-only; retain naming audit on rollback. No account or role changes.
begin;
alter table public.staff add column display_name text,
 add column name_version integer not null default 0 check(name_version>=0),
 add constraint staff_display_name_valid check(display_name is null or
  (length(display_name) between 1 and 120 and display_name=regexp_replace(display_name,'^[[:space:]]+|[[:space:]]+$','','g')));
create table public.staff_display_name_events(
 id uuid primary key default gen_random_uuid(),user_id uuid not null,
 old_display_name text,new_display_name text not null,
 old_name_version integer not null,new_name_version integer not null,
 actor_user_id uuid not null,recorded_at timestamptz not null default clock_timestamp(),
 check(new_name_version=old_name_version+1),unique(user_id,new_name_version)
);
alter table public.staff_display_name_events enable row level security;
revoke all on public.staff_display_name_events from public,anon,authenticated,service_role;
create function public.deny_staff_name_audit_mutation() returns trigger
language plpgsql set search_path=public,pg_temp as $$
begin raise exception 'Staff name history is immutable';end $$;
create trigger staff_name_events_immutable before update or delete on public.staff_display_name_events
 for each row execute function public.deny_staff_name_audit_mutation();
create trigger staff_name_events_no_truncate before truncate on public.staff_display_name_events
 for each statement execute function public.deny_staff_name_audit_mutation();
create function public.audit_staff_display_name_change() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if tg_op='INSERT' then
  if new.display_name is not null or new.name_version is distinct from 0 then raise exception 'Start unnamed at version zero; an active owner must set the display name separately';end if;
  return new;
 end if;
 if row(new.display_name,new.name_version) is not distinct from row(old.display_name,old.name_version) then return new;end if;
 if not public.inventory_owner() then raise exception 'Active owner access is required';end if;
 if new.display_name is null or length(new.display_name) not between 1 and 120
  or new.display_name<>regexp_replace(new.display_name,'^[[:space:]]+|[[:space:]]+$','','g') then raise exception 'Display name must be trimmed, nonblank and at most 120 characters';end if;
 if new.name_version is null or new.name_version::bigint<>old.name_version::bigint+1 then raise exception 'Name version must increment by one';end if;
 insert into public.staff_display_name_events(user_id,old_display_name,new_display_name,old_name_version,new_name_version,actor_user_id)
 values(old.user_id,old.display_name,new.display_name,old.name_version,new.name_version,auth.uid());
 return new;
end $$;
create trigger staff_display_name_audit before insert or update of display_name,name_version on public.staff
 for each row execute function public.audit_staff_display_name_change();
revoke all on function public.deny_staff_name_audit_mutation(),public.audit_staff_display_name_change()
 from public,anon,authenticated,service_role;

create function public.set_staff_display_name(p_user_id uuid,p_expected_version integer,p_display_name text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_row public.staff;v_name text:=regexp_replace(p_display_name,'^[[:space:]]+|[[:space:]]+$','','g');
begin
 if not public.inventory_owner() then raise exception 'Active owner access is required';end if;
 if p_user_id is null or p_expected_version is null or p_expected_version<0 then raise exception 'Staff account and nonnegative expected version are required';end if;
 if v_name is null or length(v_name) not between 1 and 120 then raise exception 'Display name must be nonblank and at most 120 characters';end if;
 -- Serialize name edits and hold owner authorization until the transaction ends.
 perform pg_advisory_xact_lock(20260929,40);
 perform 1 from public.staff where user_id=auth.uid() and active=true and role='owner' for share;
 if not found then raise exception 'Active owner access is required';end if;
 select * into v_row from public.staff where user_id=p_user_id for update;
 if not found then raise exception 'Staff account does not exist';end if;
 if v_row.name_version<>p_expected_version then raise exception 'Staff name changed; refresh before saving';end if;
 if v_row.name_version=2147483647 then raise exception 'Staff name version exhausted';end if;
 update public.staff set display_name=v_name,name_version=name_version+1 where user_id=p_user_id returning * into v_row;
 return jsonb_build_object('user_id',v_row.user_id,'display_name',v_row.display_name,'name_version',v_row.name_version,'active',v_row.active);
end $$;

create function public.list_staff_display_names(p_limit integer default 100,p_after_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_result jsonb;
begin
 if not public.inventory_active_staff() then raise exception 'Active staff access is required';end if;
 if p_limit is null or p_limit<1 or p_limit>100 then raise exception 'Page limit must be between 1 and 100';end if;
 with eligible as(select user_id,display_name,name_version,active from public.staff
  where p_after_id is null or user_id>p_after_id order by user_id limit p_limit+1),
 page as(select * from eligible order by user_id limit p_limit)
 select jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(p) order by p.user_id) from page p),'[]'::jsonb),
 'next_after_id',case when (select count(*) from eligible)>p_limit then (select user_id from page order by user_id desc limit 1) else null end) into v_result;
 return v_result;
end $$;

create function public.lookup_staff_display_name(p_email text)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_email text:=lower(regexp_replace(p_email,'^[[:space:]]+|[[:space:]]+$','','g'));v_matches jsonb;
begin
 if not public.inventory_owner() then raise exception 'Active owner access is required';end if;
 if v_email is null or length(v_email) not between 1 and 320 then raise exception 'Existing account email is required, at most 320 characters';end if;
 select coalesce(jsonb_agg(jsonb_build_object('user_id',s.user_id,'display_name',s.display_name,'name_version',s.name_version,'active',s.active)),'[]'::jsonb)
 into v_matches from public.staff s join auth.users u on u.id=s.user_id where lower(u.email)=v_email;
 if jsonb_array_length(v_matches)>1 then raise exception 'Multiple staff accounts match; resolve account mapping before naming';end if;
 return v_matches->0;
end $$;
revoke all on function public.set_staff_display_name(uuid,integer,text),public.list_staff_display_names(integer,uuid),public.lookup_staff_display_name(text)
 from public,anon,service_role;
grant execute on function public.set_staff_display_name(uuid,integer,text),public.list_staff_display_names(integer,uuid),public.lookup_staff_display_name(text)
 to authenticated;
commit;
