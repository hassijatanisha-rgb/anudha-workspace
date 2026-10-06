-- Owner turns accounting access on and off (migration 064). Disposable database; rolled back.
--   psql -d <disposable> -At -v ON_ERROR_STOP=1 -f tests/sql/accounting-access.sql   (every line must end in |t)
begin;
insert into auth.users(id,email) values ('00000000-0000-4000-8000-0000000000d1','o@t'),('00000000-0000-4000-8000-0000000000d2','a@t'),('00000000-0000-4000-8000-0000000000d3','h@t');
insert into public.staff(user_id,role,active,department,access) values ('00000000-0000-4000-8000-0000000000d1','owner',true,'management','{}'),
 ('00000000-0000-4000-8000-0000000000d2','staff',true,'accounts','{proformas}'),('00000000-0000-4000-8000-0000000000d3','head',true,'accounts','{proformas}');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-0000000000d3","role":"authenticated"}',true);
do $$ begin perform public.set_accounting_access('00000000-0000-4000-8000-0000000000d2',true); raise exception 'head was allowed'; exception when others then if sqlerrm not like '%Only the owner%' then raise; end if; end $$;
select 'head cannot grant', true;
select 'head cannot list', (select count(*) from public.staff_accounting_access())=0;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-0000000000d1","role":"authenticated"}',true);
select 'owner grants', public.set_accounting_access('00000000-0000-4000-8000-0000000000d2',true);
select 'owner sees it', (select active from public.staff_accounting_access() where user_id='00000000-0000-4000-8000-0000000000d2');
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-0000000000d2","role":"authenticated"}',true);
select 'granted person has accounting', public.accounting_access();
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-0000000000d1","role":"authenticated"}',true);
select 'owner removes', not public.set_accounting_access('00000000-0000-4000-8000-0000000000d2',false);
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-0000000000d2","role":"authenticated"}',true);
select 'removed person loses it', not public.accounting_access();
reset role;
select 'both changes logged', (select string_agg(action,',' order by recorded_at) from public.staff_account_events where user_id='00000000-0000-4000-8000-0000000000d2')='accounting_granted,accounting_removed';
rollback;
