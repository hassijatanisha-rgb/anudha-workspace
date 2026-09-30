-- Supabase advisor clean-up. Signed-out (anon) callers could reach these SECURITY DEFINER functions through
-- /rest/v1/rpc because EXECUTE was left granted to PUBLIC and anon. Each function already rejects callers who
-- are not active staff; this removes the exposure itself. Signed-in staff keep their explicit grants.
-- Checked live first: anon holds no table grants in public and no anon/public RLS policy calls these helpers.
begin;
revoke execute on function
 public.dispatch_inventory_transfer(uuid,integer,integer,text),
 public.inventory_active_staff(),
 public.inventory_owner(),
 public.issue_consumer_units(uuid,uuid,integer,uuid,integer,date,text,text),
 public.open_inventory_cartons(uuid,integer,integer,text),
 public.receive_inventory_transfer(uuid,integer,integer,text,text),
 public.request_inventory_transfer(uuid,uuid,uuid,integer,date,text),
 public.save_inventory_location(uuid,integer,text,text,text,boolean),
 public.save_pack_definition(uuid,uuid,integer,text,integer,text),
 public.set_inventory_opening_balance(uuid,integer,uuid,uuid,uuid,text,date,integer,integer,text)
from public, anon;
grant execute on function
 public.dispatch_inventory_transfer(uuid,integer,integer,text),
 public.inventory_active_staff(),
 public.inventory_owner(),
 public.issue_consumer_units(uuid,uuid,integer,uuid,integer,date,text,text),
 public.open_inventory_cartons(uuid,integer,integer,text),
 public.receive_inventory_transfer(uuid,integer,integer,text,text),
 public.request_inventory_transfer(uuid,uuid,uuid,integer,date,text),
 public.save_inventory_location(uuid,integer,text,text,text,boolean),
 public.save_pack_definition(uuid,uuid,integer,text,integer,text),
 public.set_inventory_opening_balance(uuid,integer,uuid,uuid,uuid,text,date,integer,integer,text)
to authenticated;
-- Trigger-only function: triggers do not need EXECUTE for the firing role, so no API role keeps it.
revoke execute on function public.create_installation_cases_for_delivery() from public, anon, authenticated;
-- Pin the search path of the one function the advisor reported as mutable.
alter function public.protect_project_approval_answers() set search_path = public, pg_temp;
commit;
