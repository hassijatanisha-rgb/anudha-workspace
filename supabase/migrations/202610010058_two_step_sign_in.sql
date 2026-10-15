-- Two-step sign-in (authenticator app). Anyone who has turned it on must sign in with their 6-digit code before
-- the database lets them read or change anything beyond their own staff row; staff who have not turned it on are
-- unchanged. The check sits in the shared access functions that every policy and RPC already uses, so no page can
-- skip it. The owner can see who has it on, and can reset it (through the staff-accounts server function) when a
-- phone is lost.
-- Rollback: redefine mfa_satisfied() to return true in a forward migration.
begin;

-- True when the session signed in with the code (aal2), or when this person has no verified authenticator.
create function public.mfa_satisfied()
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select coalesce((select auth.jwt()->>'aal'),'aal1') = 'aal2'
  or not exists(select 1 from auth.mfa_factors f where f.user_id = (select auth.uid()) and f.status = 'verified')
$$;

create or replace function public.inventory_active_staff()
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select exists(select 1 from public.staff where user_id=auth.uid() and active=true) and public.mfa_satisfied() $$;
create or replace function public.inventory_owner()
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select exists(select 1 from public.staff where user_id=auth.uid() and active=true and role='owner') and public.mfa_satisfied() $$;
create or replace function public.is_owner()
returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
 select exists(select 1 from public.staff where user_id = auth.uid() and active and role = 'owner') and public.mfa_satisfied() $$;
create or replace function public.is_active_staff()
returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
 select exists(select 1 from public.staff where user_id = auth.uid() and active) and public.mfa_satisfied() $$;

-- These two checked the staff table directly; they now use the same owner check.
alter policy approval_question_read on public.project_approval_questions using ((select public.is_owner()));
alter policy approval_answer_read on public.project_approval_answers using ((select public.is_owner()));
create or replace function public.record_project_approval(p_id uuid, p_question_id text, p_version integer, p_answer text)
returns public.project_approval_answers language plpgsql security definer set search_path=public,pg_temp as $$
declare q public.project_approval_questions; a public.project_approval_answers;
begin
if not public.is_owner() then raise exception 'Owner access required'; end if;
if p_id is null or p_version is null or p_answer is null or length(trim(p_answer)) not between 1 and 4000 then raise exception 'Enter an answer of 1 to 4000 characters'; end if;
select * into q from public.project_approval_questions where id=p_question_id for update;
if not found then raise exception 'Question unavailable'; end if;
select * into a from public.project_approval_answers where id=p_id;
if found then
if a.answered_by=auth.uid() and a.question_id=p_question_id and a.question_version=p_version and a.answer=trim(p_answer) then return a; end if;
raise exception 'Request identifier already used';
end if;
if q.version<>p_version then raise exception 'Another answer was saved. Refresh and review it before answering again'; end if;
insert into public.project_approval_answers(id,question_id,question_version,answer,answered_by) values(p_id,p_question_id,p_version,trim(p_answer),auth.uid()) returning * into a;
update public.project_approval_questions set version=version+1 where id=q.id;
return a;
end $$;

-- Owner view: who has two-step sign-in on (never the secret).
create function public.staff_two_step_status()
returns table(user_id uuid, enabled boolean) language sql stable security definer set search_path=public,pg_temp as $$
 select s.user_id, exists(select 1 from auth.mfa_factors f where f.user_id = s.user_id and f.status = 'verified')
 from public.staff s where public.is_owner()
$$;

alter table public.staff_account_events drop constraint staff_account_events_action_check;
alter table public.staff_account_events add constraint staff_account_events_action_check
 check (action in ('created','password_reset','phone_changed','department_changed','two_step_reset'));

revoke all on function public.mfa_satisfied(), public.staff_two_step_status() from public, anon;
grant execute on function public.mfa_satisfied(), public.staff_two_step_status() to authenticated;
commit;
