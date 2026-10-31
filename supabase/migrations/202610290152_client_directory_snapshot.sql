begin;

-- One CRM read; validation, duplicate matching and locale sorting keep their existing JavaScript rules.
-- The response contains the complete caller-visible directory, not a bounded server page.
create function public.client_directory_snapshot()
returns jsonb language plpgsql stable security invoker set search_path=public,pg_temp as $$
begin
 if public.inventory_active_staff() is not true then raise exception 'Active staff access is required' using errcode='42501'; end if;
 return jsonb_build_object(
  'organizations',coalesce((select jsonb_agg(to_jsonb(o) order by o.id) from (
   select id,name,location,type,parent_id,approval_status from public.organizations where deleted_at is null
  ) o),'[]'::jsonb),
  'contacts',coalesce((select jsonb_agg(to_jsonb(c) order by c.id) from (
   select id,organization_id,title,first_name,last_name,position,phone_country,country_code,phone,email,status
   from public.contacts where deleted_at is null
  ) c),'[]'::jsonb)
 );
end $$;
revoke all on function public.client_directory_snapshot() from public,anon;
grant execute on function public.client_directory_snapshot() to authenticated;

commit;
