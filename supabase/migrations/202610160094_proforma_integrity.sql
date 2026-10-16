begin;

-- Preserve display identities with each new revision. Existing immutable history is
-- intentionally left intact: today's names cannot recover an earlier printed name.
create function public.capture_sales_proforma_identity()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
 v_identity jsonb;
 v_lines jsonb;
begin
 select jsonb_build_object(
  'organizationName',o.name,'organizationLocation',o.location,
  'contactName',concat_ws(' ',nullif(c.title,'N/A'),c.first_name,c.last_name)
 ) into v_identity
 from public.organizations o
 join public.contacts c on c.organization_id=o.id
 where o.id=(new.snapshot->>'organizationId')::uuid
   and c.id=(new.snapshot->>'contactId')::uuid;
 if v_identity is null then raise exception 'Revision client and contact could not be captured'; end if;

 select jsonb_agg(item.line||jsonb_build_object('productName',p.name) order by item.ordinality)
 into v_lines
 from jsonb_array_elements(new.snapshot->'lines') with ordinality as item(line,ordinality)
 join public.products p on p.id=(item.line->>'productId')::uuid;
 if jsonb_array_length(v_lines) is distinct from jsonb_array_length(new.snapshot->'lines') then
  raise exception 'Revision products could not be captured';
 end if;
 new.snapshot:=new.snapshot||v_identity||jsonb_build_object('lines',v_lines);
 return new;
end;
$$;

revoke all on function public.capture_sales_proforma_identity() from public,anon,authenticated;
create trigger sales_proforma_revision_identity
 before insert on public.sales_proforma_revisions
 for each row execute function public.capture_sales_proforma_identity();

commit;
