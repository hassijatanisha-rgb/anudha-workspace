begin;

-- Source-check dates use Tanzania's civil day, matching the profile editor.
create or replace function public.save_organization_business_contacts(p_request_id uuid,p_organization_id uuid,p_expected_version integer,
 p_emails jsonb,p_phones jsonb,p_website text,p_physical_address text,p_postal_address text,
 p_source_url text,p_source_checked_on date,p_evidence_note text)
returns public.organization_business_contact_versions
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_row public.organization_business_contact_versions; v_version integer; v_kind text; v_channels jsonb;
 v_item jsonb; v_clean jsonb; v_value text; v_purpose text; v_request jsonb;
begin
 if public.inventory_active_staff() is not true then raise exception 'Active staff access is required' using errcode='42501'; end if;
 perform public.require_access('records');
 if p_request_id is null or p_organization_id is null or p_expected_version is null or p_expected_version<0 or p_expected_version>=2147483647 then
  raise exception 'Customer, request identity and current version are required';
 end if;
 p_emails:=coalesce(p_emails,'[]'::jsonb);p_phones:=coalesce(p_phones,'[]'::jsonb);
 for v_kind,v_channels in select 'email',p_emails union all select 'phone',p_phones loop
  if jsonb_typeof(v_channels) is distinct from 'array' then raise exception 'Use a list for business % channels',v_kind; end if;
  if jsonb_array_length(v_channels)>20 then raise exception 'Use no more than 20 business % channels',v_kind; end if;
  v_clean:='[]'::jsonb;
  for v_item in select value from jsonb_array_elements(v_channels) loop
   if jsonb_typeof(v_item) is distinct from 'object' or jsonb_typeof(v_item->'value') is distinct from 'string'
    or (v_item?'purpose' and jsonb_typeof(v_item->'purpose') is distinct from 'string')
    or (v_item-'value'-'purpose')<>'{}'::jsonb then raise exception 'Each business channel needs a value and optional purpose only'; end if;
   v_value:=trim(v_item->>'value');v_purpose:=trim(coalesce(v_item->>'purpose',''));
   if length(v_purpose)>120 then raise exception 'Business channel purposes must be 120 characters or fewer'; end if;
   if v_kind='email' then
    if length(v_value) not between 3 and 254 or v_value!~'^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
     raise exception 'Enter a valid business email address or remove the empty channel';
    end if;
   elsif length(v_value) not between 3 and 80 or v_value!~'^[0-9+() ./#xX-]+$'
    or length(regexp_replace(v_value,'[^0-9]','','g'))<3 then
    raise exception 'Enter a published business phone number or remove the empty channel';
   end if;
   v_clean:=v_clean||jsonb_build_array(jsonb_build_object('value',v_value,'purpose',v_purpose));
  end loop;
  if v_kind='email' then p_emails:=v_clean;else p_phones:=v_clean;end if;
 end loop;
 p_website:=trim(coalesce(p_website,''));p_source_url:=trim(coalesce(p_source_url,''));
 p_physical_address:=trim(coalesce(p_physical_address,''));p_postal_address:=trim(coalesce(p_postal_address,''));
 p_evidence_note:=trim(coalesce(p_evidence_note,''));
 if length(p_physical_address)>1000 or length(p_postal_address)>1000 or length(p_evidence_note) not between 5 and 2000 then
  raise exception 'Keep each address within 1000 characters and explain the evidence in 5 to 2000 characters';
 end if;
 foreach v_value in array array[p_website,p_source_url] loop
  if length(v_value)>2000 or (v_value<>'' and (v_value!~*'^https?://[^[:space:]/?#@]+([/?#][^[:space:]]*)?$' or v_value~'[[:cntrl:]]')) then
   raise exception 'Use a complete http or https website/source URL, or leave it blank';
  end if;
 end loop;
 if p_source_checked_on is not null and (not isfinite(p_source_checked_on) or p_source_checked_on>(now() at time zone 'Africa/Dar_es_Salaam')::date) then
  raise exception 'Use a real source-check date no later than today, or leave it blank';
 end if;
 v_request:=jsonb_build_object('organization_id',p_organization_id,'emails',p_emails,'phones',p_phones,'website',p_website,
  'physical_address',p_physical_address,'postal_address',p_postal_address,'source_url',p_source_url,
  'source_checked_on',p_source_checked_on,'evidence_note',p_evidence_note);

 -- The existing customer row serializes first saves and revisions without a second mutable table.
 perform 1 from public.organizations where id=p_organization_id and deleted_at is null for update;
 if not found then raise exception 'Choose an existing active customer or branch'; end if;
 select * into v_row from public.organization_business_contact_versions where id=p_request_id;
 if found then
  if v_row.created_by<>auth.uid() or v_row.version-1<>p_expected_version
   or (to_jsonb(v_row)-array['id','version','created_by','created_at']) is distinct from v_request then
   raise exception 'This business-contact request was already saved with different details';
  end if;
  return v_row;
 end if;
 select coalesce(max(version),0) into v_version from public.organization_business_contact_versions where organization_id=p_organization_id;
 if v_version<>p_expected_version then
  raise exception 'Business contact details changed; refresh and compare before saving' using errcode='40001';
 end if;
 insert into public.organization_business_contact_versions(id,organization_id,version,emails,phones,website,physical_address,
  postal_address,source_url,source_checked_on,evidence_note,created_by)
 values(p_request_id,p_organization_id,v_version+1,p_emails,p_phones,p_website,p_physical_address,
  p_postal_address,p_source_url,p_source_checked_on,p_evidence_note,auth.uid()) returning * into v_row;
 return v_row;
end $$;
commit;
