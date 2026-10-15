-- No fixed workflow: when nobody has been chosen for a step on the Staff page, the person who moves the record to
-- that step is responsible for it until they hand it to someone else (Hand to). Purchase approval goes to an owner,
-- since only an owner can approve. A person chosen on the Staff page still takes precedence. Previously an
-- unconfigured step left the record with nobody responsible (only listed in unowned_work()).
-- Rollback: restore the previous body from 202610010051_automatic_handoffs.sql.
begin;
create or replace function public.workflow_step_default(p_step text) returns uuid
language sql stable security definer set search_path=public,pg_temp as $$
 select coalesce(
  (select o.default_user_id from public.workflow_step_owners o
    where o.step=p_step and exists(select 1 from public.staff s where s.user_id=o.default_user_id and s.active)
      and o.version=(select max(version) from public.workflow_step_owners where step=p_step)),
  case when p_step='purchase_approval'
   then (select s.user_id from public.staff s where s.active and s.role='owner' order by s.user_id limit 1)
   else (select s.user_id from public.staff s where s.user_id=auth.uid() and s.active) end)
$$;
commit;
