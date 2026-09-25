-- Additive schema only. No imports or live activation.
-- Production rollback: disable the UI, retain these tables and their audit history,
-- and use a reviewed forward migration. Dropping this schema after use loses private data.
begin;

create table public.workspace_entries (
 id uuid primary key,
 owner_id uuid not null references auth.users(id),
 kind text not null check (kind in ('event','task','note')),
 visibility text not null check (visibility in ('personal','company')),
 title text not null check (length(trim(title)) between 1 and 200),
 body text not null default '' check (length(body) <= 20000),
 starts_at timestamptz,
 ends_at timestamptz,
 remind_at timestamptz,
 priority text not null default 'normal' check (priority in ('normal','urgent')),
 completed boolean not null default false,
 version integer not null default 1 check (version > 0),
 deleted_at timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 check (visibility = 'personal' or kind = 'event'),
 check (kind <> 'event' or starts_at is not null),
 check (ends_at is null or (starts_at is not null and ends_at >= starts_at)),
 check (kind <> 'note' or (starts_at is null and ends_at is null)),
 check (kind <> 'event' or completed = false)
);
create index workspace_entries_personal_list on public.workspace_entries(owner_id, kind, updated_at desc, id) where deleted_at is null;
create index workspace_entries_company_calendar on public.workspace_entries(starts_at, id) where visibility='company' and deleted_at is null;

create function public.deny_workspace_entry_delete()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
 raise exception 'Workspace entries require soft deletion';
end $$;
create trigger workspace_entries_no_delete before delete on public.workspace_entries
for each row execute function public.deny_workspace_entry_delete();
create trigger workspace_entries_no_truncate before truncate on public.workspace_entries
for each statement execute function public.deny_workspace_entry_delete();

create table public.workspace_entry_audit (
 id uuid primary key default gen_random_uuid(),
 entry_id uuid not null references public.workspace_entries(id),
 actor_id uuid not null references auth.users(id),
 old_entry jsonb,
 new_entry jsonb not null,
 created_at timestamptz not null default now()
);
create index workspace_entry_audit_entry on public.workspace_entry_audit(entry_id, created_at);

create function public.deny_workspace_audit_mutation()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
 raise exception 'Workspace history is immutable';
end $$;
create trigger workspace_entry_audit_immutable before update or delete on public.workspace_entry_audit
for each row execute function public.deny_workspace_audit_mutation();
create trigger workspace_entry_audit_no_truncate before truncate on public.workspace_entry_audit
for each statement execute function public.deny_workspace_audit_mutation();

alter table public.workspace_entries enable row level security;
alter table public.workspace_entry_audit enable row level security;
create policy workspace_entries_read on public.workspace_entries for select to authenticated
using (public.inventory_active_staff() and deleted_at is null and (owner_id=auth.uid() or visibility='company'));
-- Audit snapshots inherit the same privacy boundary; owners have no private-data override.
create policy workspace_entry_audit_read on public.workspace_entry_audit for select to authenticated
using (public.inventory_active_staff() and (
 (new_entry->>'owner_id')=auth.uid()::text or new_entry->>'visibility'='company'
));
revoke all on public.workspace_entries, public.workspace_entry_audit from public, anon, authenticated;
grant select on public.workspace_entries, public.workspace_entry_audit to authenticated;

create function public.save_workspace_entry(
 p_id uuid, p_expected_version integer, p_kind text, p_visibility text,
 p_title text, p_body text, p_starts_at timestamptz, p_ends_at timestamptz,
 p_remind_at timestamptz, p_priority text, p_completed boolean, p_deleted boolean default false
)
returns public.workspace_entries language plpgsql security definer set search_path=public,pg_temp as $$
declare
 v_existing public.workspace_entries;
 v_row public.workspace_entries;
 v_actor uuid := auth.uid();
begin
 if not public.inventory_active_staff() then raise exception 'Active staff access is required'; end if;
 if p_id is null or p_expected_version is null or p_expected_version < 0 or p_deleted is null then
  raise exception 'Provide an entry ID, version and deletion choice';
 end if;
 if p_expected_version=0 then
  if p_deleted then raise exception 'Save an entry before deleting it'; end if;
  if p_visibility='company' and not public.inventory_owner() then raise exception 'Owner access is required for company events'; end if;
  insert into public.workspace_entries(id,owner_id,kind,visibility,title,body,starts_at,ends_at,remind_at,priority,completed)
  values(p_id,v_actor,p_kind,p_visibility,trim(p_title),coalesce(p_body,''),p_starts_at,p_ends_at,p_remind_at,p_priority,p_completed)
  returning * into v_row;
 else
  -- Filter before locking so private IDs never return another person's data.
  select * into v_existing from public.workspace_entries
  where id=p_id and deleted_at is null and (owner_id=v_actor or visibility='company') for update;
  if not found then raise exception 'Entry unavailable; refresh your workspace'; end if;
  if v_existing.visibility='company' then
   if not public.inventory_owner() then raise exception 'Owner access is required for company events'; end if;
  elsif v_existing.owner_id<>v_actor then
   raise exception 'Entry unavailable; refresh your workspace';
  end if;
  if v_existing.version<>p_expected_version then raise exception 'Entry changed; refresh before saving'; end if;
  -- Scope never changes: a private entry cannot become public accidentally.
  if p_kind is distinct from v_existing.kind or p_visibility is distinct from v_existing.visibility then
   raise exception 'Entry type and visibility cannot change; create a new entry';
  end if;
  if p_deleted then
   update public.workspace_entries set deleted_at=now(),updated_at=now(),version=version+1
   where id=p_id returning * into v_row;
  else
   update public.workspace_entries set title=trim(p_title),body=coalesce(p_body,''),
    starts_at=p_starts_at,ends_at=p_ends_at,remind_at=p_remind_at,priority=p_priority,
    completed=p_completed,version=version+1,updated_at=now()
   where id=p_id returning * into v_row;
  end if;
 end if;
 insert into public.workspace_entry_audit(entry_id,actor_id,old_entry,new_entry)
 values(v_row.id,v_actor,case when p_expected_version=0 then null else to_jsonb(v_existing) end,to_jsonb(v_row));
 return v_row;
end $$;
revoke all on function public.deny_workspace_audit_mutation() from public, anon, authenticated;
revoke all on function public.deny_workspace_entry_delete() from public, anon, authenticated;
revoke all on function public.save_workspace_entry(uuid,integer,text,text,text,text,timestamptz,timestamptz,timestamptz,text,boolean,boolean) from public, anon, authenticated;
grant execute on function public.save_workspace_entry(uuid,integer,text,text,text,text,timestamptz,timestamptz,timestamptz,text,boolean,boolean) to authenticated;

commit;
