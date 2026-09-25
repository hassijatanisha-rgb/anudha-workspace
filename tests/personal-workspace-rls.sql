-- Run only on a disposable migrated Supabase clone using psql -v ON_ERROR_STOP=1.
-- Requires an existing active owner and active non-owner staff user. Their identities
-- are selected, never invented; no fixture changes survive the final ROLLBACK.
-- Run as postgres (able to SET ROLE authenticated and update staff for the inactive test).
begin;

do $$
declare v_owner uuid; v_staff uuid;
begin
 select user_id into v_owner from public.staff where active and role='owner' order by user_id limit 1;
 select user_id into v_staff from public.staff where active and role<>'owner' and user_id<>v_owner order by user_id limit 1;
 if v_owner is null or v_staff is null then raise exception 'Fixture needs an active owner and an active non-owner'; end if;
 perform set_config('test.workspace_owner',v_owner::text,true);
 perform set_config('test.workspace_staff',v_staff::text,true);
 perform set_config('test.workspace_private',gen_random_uuid()::text,true);
 perform set_config('test.workspace_company',gen_random_uuid()::text,true);
 perform set_config('test.workspace_task',gen_random_uuid()::text,true);
end $$;

create function pg_temp.assert_true(p_result boolean,p_message text) returns void language plpgsql as $$
begin if p_result is distinct from true then raise exception 'Assertion failed: %',p_message; end if; end $$;
create function pg_temp.expect_error(p_sql text,p_fragment text) returns void language plpgsql as $$
declare v_failed boolean := false;
begin
 begin execute p_sql;
 exception when others then
  if position(p_fragment in sqlerrm)=0 then raise exception 'Wrong error: %',sqlerrm; end if;
  v_failed:=true;
 end;
 if not v_failed then raise exception 'Expected rejection: %',p_fragment; end if;
end $$;

grant usage on schema pg_temp to authenticated, anon;
set local role authenticated;
select set_config('request.jwt.claim.sub',current_setting('test.workspace_staff'),true);
select public.save_workspace_entry(current_setting('test.workspace_private')::uuid,0,'note','personal','Private fixture','Private content',null,null,null,'normal',false);
select public.save_workspace_entry(current_setting('test.workspace_private')::uuid,1,'note','personal','Private fixture','Private content',null,null,now()+interval '1 hour','normal',true);
select pg_temp.assert_true((select remind_at is not null and completed and version=2 from public.workspace_entries where id=current_setting('test.workspace_private')::uuid),'notes support reminders and dismissal');
select public.save_workspace_entry(current_setting('test.workspace_task')::uuid,0,'task','personal','Task fixture','',now(),null,now(),'urgent',false);
select pg_temp.expect_error($q$select public.save_workspace_entry(current_setting('test.workspace_task')::uuid,0,'task','personal','Task fixture','',now(),null,now(),'urgent',false)$q$,'duplicate key');
select pg_temp.assert_true((select count(*)=2 from public.workspace_entries where id in (current_setting('test.workspace_private')::uuid,current_setting('test.workspace_task')::uuid)),'staff sees own entries');
select pg_temp.expect_error($q$select public.save_workspace_entry(gen_random_uuid(),0,'event','company','Denied','',now(),null,null,'normal',false)$q$,'Owner access');
select pg_temp.expect_error($q$update public.workspace_entries set title='Bypass' where id=current_setting('test.workspace_private')::uuid$q$,'permission denied');
select pg_temp.expect_error($q$delete from public.workspace_entries where id=current_setting('test.workspace_private')::uuid$q$,'permission denied');
select pg_temp.expect_error($q$insert into public.workspace_entries(id,owner_id,kind,visibility,title) values(gen_random_uuid(),auth.uid(),'note','personal','Bypass')$q$,'permission denied');
select pg_temp.expect_error($q$insert into public.workspace_entry_audit(entry_id,actor_id,new_entry) values(current_setting('test.workspace_private')::uuid,auth.uid(),'{}')$q$,'permission denied');

select set_config('request.jwt.claim.sub',current_setting('test.workspace_owner'),true);
select pg_temp.assert_true((select count(*)=0 from public.workspace_entries where id=current_setting('test.workspace_private')::uuid),'owner cannot read staff private entries');
select pg_temp.assert_true((select count(*)=0 from public.workspace_entry_audit where entry_id=current_setting('test.workspace_private')::uuid),'owner cannot read private audit snapshots');
select pg_temp.expect_error($q$select public.save_workspace_entry(current_setting('test.workspace_private')::uuid,1,'note','personal','Stolen','',null,null,null,'normal',false)$q$,'Entry unavailable');
select pg_temp.expect_error($q$select public.save_workspace_entry(current_setting('test.workspace_private')::uuid,1,'note','personal','Stolen','',null,null,null,'normal',false,true)$q$,'Entry unavailable');
select public.save_workspace_entry(current_setting('test.workspace_company')::uuid,0,'event','company','Shared fixture','',now(),now()+interval '1 hour',null,'normal',false);
select pg_temp.expect_error($q$select public.save_workspace_entry(current_setting('test.workspace_company')::uuid,1,'event','company','Shared fixture','',now(),null,null,'normal',true)$q$,'check constraint');
select pg_temp.expect_error($q$select public.save_workspace_entry(gen_random_uuid(),0,'task','company','Invalid','',now(),null,null,'normal',false)$q$,'check constraint');

select set_config('request.jwt.claim.sub',current_setting('test.workspace_staff'),true);
select pg_temp.assert_true((select count(*)=1 from public.workspace_entries where id=current_setting('test.workspace_company')::uuid),'staff sees shared events');
select pg_temp.expect_error($q$select public.save_workspace_entry(current_setting('test.workspace_company')::uuid,1,'event','company','Denied','',now(),null,null,'normal',false)$q$,'Owner access');
select pg_temp.expect_error($q$select public.save_workspace_entry(current_setting('test.workspace_company')::uuid,1,'event','company','Denied','',now(),null,null,'normal',false,true)$q$,'Owner access');
select public.save_workspace_entry(current_setting('test.workspace_task')::uuid,1,'task','personal','Task fixture','Done',now(),null,null,'urgent',true);
-- Models two clients that both read version 1: the second writer must fail.
select pg_temp.expect_error($q$select public.save_workspace_entry(current_setting('test.workspace_task')::uuid,1,'task','personal','Stale','',null,null,null,'normal',false)$q$,'Entry changed');
select pg_temp.assert_true((select version=2 and completed and body='Done' from public.workspace_entries where id=current_setting('test.workspace_task')::uuid),'stale writer cannot overwrite accepted change');
select pg_temp.assert_true((select count(*)=2 from public.workspace_entry_audit where entry_id=current_setting('test.workspace_task')::uuid),'failed write creates no audit');
select pg_temp.assert_true((select count(*)=1 from public.workspace_entry_audit where entry_id=current_setting('test.workspace_task')::uuid and old_entry->>'version'='1' and new_entry->>'version'='2' and actor_id=auth.uid()),'audit records old/new state and actor');
select pg_temp.expect_error($q$select public.save_workspace_entry(current_setting('test.workspace_task')::uuid,2,'task','company','Invalid','',null,null,null,'normal',false)$q$,'visibility cannot change');
select public.save_workspace_entry(current_setting('test.workspace_private')::uuid,2,'note','personal','Private fixture','Private content',null,null,null,'normal',false,true);
select pg_temp.assert_true((select count(*)=0 from public.workspace_entries where id=current_setting('test.workspace_private')::uuid),'soft deleted entry hidden');
select pg_temp.expect_error($q$select public.save_workspace_entry(current_setting('test.workspace_private')::uuid,2,'note','personal','Restore','',null,null,null,'normal',false)$q$,'Entry unavailable');

reset role;
select pg_temp.expect_error($q$delete from public.workspace_entries where id=current_setting('test.workspace_task')::uuid$q$,'require soft deletion');
select pg_temp.expect_error('truncate public.workspace_entries cascade','require soft deletion');
select pg_temp.expect_error($q$update public.workspace_entry_audit set new_entry='{}' where entry_id=current_setting('test.workspace_task')::uuid$q$,'history is immutable');
select pg_temp.expect_error($q$delete from public.workspace_entry_audit where entry_id=current_setting('test.workspace_task')::uuid$q$,'history is immutable');
select pg_temp.expect_error('truncate public.workspace_entry_audit','history is immutable');
update public.staff set active=false where user_id=current_setting('test.workspace_staff')::uuid;
set local role authenticated;
select set_config('request.jwt.claim.sub',current_setting('test.workspace_staff'),true);
select pg_temp.assert_true((select count(*)=0 from public.workspace_entries),'inactive staff reads no entries');
select pg_temp.assert_true((select count(*)=0 from public.workspace_entry_audit),'inactive staff reads no history');
select pg_temp.expect_error($q$select public.save_workspace_entry(gen_random_uuid(),0,'note','personal','Denied','',null,null,null,'normal',false)$q$,'Active staff');
reset role;
set local role anon;
select pg_temp.expect_error('select * from public.workspace_entries','permission denied');
select pg_temp.expect_error($q$select public.save_workspace_entry(gen_random_uuid(),0,'note','personal','Denied','',null,null,null,'normal',false)$q$,'permission denied');
reset role;
rollback;

-- Limits: this fixture checks real RLS/RPC behavior and stale-version semantics when
-- executed, but is not a simultaneous two-connection race test, load test, timezone
-- UI test or notification-delivery test. For a race test on a disposable clone,
-- both connections read one version, A begins and saves without committing, B saves
-- the same version and blocks; committing A must make B reject with 'Entry changed'.
-- Neither this file nor the migration applies itself. No live database is needed
-- for static review; runtime behavior remains unverified until explicitly run.
