-- Staff phone numbers and an append-only log of account actions (created, password reset) done through the
-- owner-only staff-accounts Edge Function. The function performs login changes with the service key and records
-- them here under the owner's own session, so auth.uid() is the owner who acted. No passwords are stored.
begin;

alter table public.staff add column phone text not null default '' check (phone = '' or phone ~ '^\+[0-9]{8,15}$');

create table public.staff_account_events (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id),
 action text not null check (action in ('created','password_reset','phone_changed')),
 note text not null default '' check (length(note) <= 500),
 actor_user_id uuid not null references auth.users(id),
 recorded_at timestamptz not null default now()
);
create index staff_account_events_user on public.staff_account_events(user_id, recorded_at desc);
create index staff_account_events_actor on public.staff_account_events(actor_user_id);
create function public.deny_staff_account_event_mutation() returns trigger
language plpgsql set search_path=public,pg_temp as $$ begin raise exception 'Staff account history is immutable'; end $$;
create trigger staff_account_events_immutable before update or delete on public.staff_account_events for each row execute function public.deny_staff_account_event_mutation();
create trigger staff_account_events_no_truncate before truncate on public.staff_account_events for each statement execute function public.deny_staff_account_event_mutation();
alter table public.staff_account_events enable row level security;
create policy staff_account_events_read on public.staff_account_events for select to authenticated using ((select public.is_owner()));
revoke all on public.staff_account_events from public, anon, authenticated;
grant select on public.staff_account_events to authenticated;

create function public.record_staff_account_event(p_user_id uuid, p_action text, p_note text default '')
returns public.staff_account_events language plpgsql security definer set search_path=public,pg_temp as $$
declare v_row public.staff_account_events;
begin
 if not public.is_owner() then raise exception 'Owner access required' using errcode='42501'; end if;
 if not exists(select 1 from public.staff where user_id=p_user_id) then raise exception 'Staff account does not exist'; end if;
 insert into public.staff_account_events(user_id,action,note,actor_user_id) values(p_user_id,p_action,left(trim(coalesce(p_note,'')),500),auth.uid()) returning * into v_row;
 return v_row;
end $$;

create function public.set_staff_phone(p_user_id uuid, p_phone text)
returns public.staff language plpgsql security definer set search_path=public,pg_temp as $$
declare v_row public.staff; v_phone text := regexp_replace(coalesce(p_phone,''),'[[:space:]()-]','','g');
begin
 if not public.is_owner() then raise exception 'Owner access required' using errcode='42501'; end if;
 if v_phone <> '' and v_phone !~ '^\+[0-9]{8,15}$' then raise exception 'Enter the phone with country code, for example +255712345678'; end if;
 update public.staff set phone=v_phone where user_id=p_user_id returning * into v_row;
 if not found then raise exception 'Staff account does not exist'; end if;
 insert into public.staff_account_events(user_id,action,note,actor_user_id) values(p_user_id,'phone_changed',v_phone,auth.uid());
 return v_row;
end $$;

revoke all on function public.record_staff_account_event(uuid,text,text), public.set_staff_phone(uuid,text) from public, anon;
grant execute on function public.record_staff_account_event(uuid,text,text), public.set_staff_phone(uuid,text) to authenticated;
revoke all on function public.deny_staff_account_event_mutation() from public, anon, authenticated;
commit;
