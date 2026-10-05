-- Step holder when no fixed person is chosen (migration 061). Disposable database with the schema applied; rolled back.
--   psql -d <disposable> -At -v ON_ERROR_STOP=1 -f tests/sql/step-holder.sql   (every line must end in |t)
begin;
insert into auth.users(id,email) values ('00000000-0000-4000-8000-0000000000b1','o@t'),('00000000-0000-4000-8000-0000000000b2','s@t'),('00000000-0000-4000-8000-0000000000b3','p@t');
insert into public.staff(user_id,role,active,department,access) values ('00000000-0000-4000-8000-0000000000b1','owner',true,'management','{}'),('00000000-0000-4000-8000-0000000000b2','staff',true,'stores','{deliveries}'),('00000000-0000-4000-8000-0000000000b3','staff',true,'stores','{deliveries}');
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-0000000000b2","role":"authenticated"}',true);
select 'unset step stays with the person acting', public.workflow_step_default('packing')='00000000-0000-4000-8000-0000000000b2';
select 'purchase approval goes to the owner', public.workflow_step_default('purchase_approval')='00000000-0000-4000-8000-0000000000b1';
insert into public.workflow_step_owners(step,version,default_user_id,team,created_by) values('packing',1,'00000000-0000-4000-8000-0000000000b3','{}','00000000-0000-4000-8000-0000000000b1');
select 'a chosen person still wins', public.workflow_step_default('packing')='00000000-0000-4000-8000-0000000000b3';
select set_config('request.jwt.claims','',true);
select 'no signed-in person: nobody (listed as unowned)', public.workflow_step_default('delivery') is null;
rollback;
