begin;

do $$
declare v_owner uuid;
begin
 select user_id into v_owner from public.staff where active=true and role='owner' order by user_id limit 1;
 if v_owner is null then raise exception 'Create an active owner before seeding inventory locations'; end if;

 insert into public.inventory_locations(id,name,code,location_type,is_dispatch_hub,active,created_by)
 select '10000000-0000-4000-8000-000000000001','Main Location','MAIN','godown',false,true,v_owner
 where not exists(select 1 from public.inventory_locations where name='Main Location' or code='MAIN');

 insert into public.inventory_locations(id,name,code,location_type,is_dispatch_hub,active,created_by)
 select '10000000-0000-4000-8000-000000000002','Haadi','HAA','dispatch_hub',true,true,v_owner
 where not exists(select 1 from public.inventory_locations where name='Haadi' or code='HAA' or is_dispatch_hub=true);
end $$;

commit;
