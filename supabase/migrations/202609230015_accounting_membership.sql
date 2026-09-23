-- Additive authorization foundation. No people are enrolled by this migration.
-- Pending disposable-database tests and explicit live activation approval.
-- Rollback: leave this unused schema intact; disable dependent UI via forward release.
begin;
create table public.accounting_memberships (
 user_id uuid primary key references auth.users(id),
 active boolean not null default false,
 approved_by uuid not null references auth.users(id),
 approval_reference text not null check(length(trim(approval_reference)) between 1 and 500),
 created_at timestamptz not null default now()
);
alter table public.accounting_memberships enable row level security;
-- No client table grants/policies: clients cannot enroll themselves or list members.
revoke all on public.accounting_memberships from public,anon,authenticated;

create function public.accounting_access()
returns boolean language sql stable security definer
set search_path=public,pg_temp as $$
 select auth.uid() is not null
  and public.inventory_active_staff()
  and exists(select 1 from public.accounting_memberships m where m.user_id=auth.uid() and m.active);
$$;
revoke all on function public.accounting_access() from public,anon,authenticated;
grant execute on function public.accounting_access() to authenticated;
commit;
