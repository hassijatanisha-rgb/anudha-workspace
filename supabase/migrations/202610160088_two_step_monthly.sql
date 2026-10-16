-- Two-step code at most every 30 days (owner decision, 16 October 2026).
-- A person with an authenticator must have entered a code in this sign-in within the last 30 days. A device the person
-- chose to trust keeps its sign-in between visits, so the code is asked on a new device or browser, after signing out,
-- and at least every 30 days. The time comes from the sign-in token's amr claim ([{"method":"totp","timestamp":…}]).
-- Rules for who must use two-step sign-in (migration 080) are unchanged.
begin;

create or replace function public.mfa_satisfied()
returns boolean language sql stable security definer set search_path to 'public','pg_temp' as $$
 select (
   coalesce((select auth.jwt()->>'aal'),'aal1') = 'aal2'
   and exists(select 1 from jsonb_array_elements(case when jsonb_typeof((select auth.jwt())->'amr')='array' then (select auth.jwt())->'amr' else '[]'::jsonb end) m
              where m->>'method' = 'totp' and (m->>'timestamp') ~ '^[0-9]+$'
                and (m->>'timestamp')::bigint >= extract(epoch from now() - interval '30 days')::bigint)
  )
  or (not exists(select 1 from auth.mfa_factors f where f.user_id = (select auth.uid()) and f.status = 'verified')
      and not public.two_step_required())
$$;

commit;
