-- Temporary credentials cannot unlock business records before password replacement.
begin;

-- Carry the existing first-login requirement into administrator-controlled metadata once.
update auth.users set raw_app_meta_data=coalesce(raw_app_meta_data,'{}'::jsonb)||'{"must_change_password":true}'::jsonb
 where raw_user_meta_data->>'must_change_password'='true'
 and not coalesce(raw_app_meta_data,'{}'::jsonb)?'must_change_password';

create or replace function public.password_change_satisfied() returns boolean
language sql stable security definer set search_path=public,pg_temp as $$
 select exists(select 1 from auth.users u where u.id=(select auth.uid())
  and coalesce(u.raw_app_meta_data->>'must_change_password','false')='false')
$$;
revoke all on function public.password_change_satisfied() from public,anon;
grant execute on function public.password_change_satisfied() to authenticated;

-- Auth owns password verification. Only a changed password hash clears the gate; editing user metadata cannot.
-- An administrator reset changes a private nonce as well, so it retains the requirement even on repeated resets.
create or replace function public.clear_password_replacement_on_change() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if old.encrypted_password is distinct from new.encrypted_password
  and coalesce(new.encrypted_password,'')<>''
  and old.raw_app_meta_data->>'must_change_password'='true'
  and new.raw_app_meta_data is not distinct from old.raw_app_meta_data then
  new.raw_app_meta_data:=coalesce(new.raw_app_meta_data,'{}'::jsonb)||'{"must_change_password":false}'::jsonb;
  new.raw_user_meta_data:=coalesce(new.raw_user_meta_data,'{}'::jsonb)||'{"must_change_password":false}'::jsonb;
 end if;
 return new;
end $$;
revoke all on function public.clear_password_replacement_on_change() from public,anon,authenticated;
drop trigger if exists clear_password_replacement on auth.users;
create trigger clear_password_replacement before update of encrypted_password on auth.users
 for each row execute function public.clear_password_replacement_on_change();

-- Preserve the current 30-day authenticator requirement on both branches of the common data-access gate.
create or replace function public.mfa_satisfied()
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select public.password_change_satisfied() and (
  (coalesce((select auth.jwt()->>'aal'),'aal1')='aal2'
   and exists(select 1 from jsonb_array_elements(case when jsonb_typeof((select auth.jwt())->'amr')='array' then (select auth.jwt())->'amr' else '[]'::jsonb end) m
    where m->>'method'='totp' and (m->>'timestamp')~'^[0-9]+$'
     and (m->>'timestamp')::bigint>=extract(epoch from now()-interval '30 days')::bigint))
  or (not exists(select 1 from auth.mfa_factors f where f.user_id=(select auth.uid()) and f.status='verified')
   and not public.two_step_required()))
$$;
commit;
