-- Required two-step sign-in for owners and accounts (owner decision, 13 October 2026).
-- Owners, the accounts department and anyone with active accounting access must sign in with an authenticator code.
-- Until they have set one up, the database refuses them everything except their own staff row (the same refusal as
-- an unconfirmed code under migration 058), and the page sends them to the setup screen. Everyone else keeps
-- two-step sign-in optional, exactly as before.
begin;

-- Whether the signed-in person must use two-step sign-in. Only ever answers about the caller.
create or replace function public.two_step_required()
returns boolean language sql stable security definer set search_path to 'public','pg_temp' as $$
 select exists(select 1 from public.staff s where s.user_id=(select auth.uid()) and s.active
  and (s.role='owner' or s.department='accounts'
   or exists(select 1 from public.accounting_memberships m where m.user_id=s.user_id and m.active)))
$$;

-- Before: satisfied with a confirmed code, or when no authenticator is set up. Now a person who must use two-step
-- sign-in is never satisfied without a confirmed code.
create or replace function public.mfa_satisfied()
returns boolean language sql stable security definer set search_path to 'public','pg_temp' as $$
 select coalesce((select auth.jwt()->>'aal'),'aal1') = 'aal2'
  or (not exists(select 1 from auth.mfa_factors f where f.user_id = (select auth.uid()) and f.status = 'verified')
      and not public.two_step_required())
$$;

-- True when the caller must set up two-step sign-in before using the workspace.
create or replace function public.two_step_setup_required()
returns boolean language sql stable security definer set search_path to 'public','pg_temp' as $$
 select public.two_step_required()
  and not exists(select 1 from auth.mfa_factors f where f.user_id = (select auth.uid()) and f.status = 'verified')
$$;

revoke all on function public.two_step_required(), public.two_step_setup_required() from public, anon;
grant execute on function public.two_step_required(), public.two_step_setup_required() to authenticated;

commit;
