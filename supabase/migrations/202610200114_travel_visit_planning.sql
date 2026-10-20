-- Structured travel planning and post-visit reports. Owner approval is unchanged.
-- Amounts use the ERP's two-decimal minor units; allowance days and rates are entered, never inferred.
-- Rollback: revoke the new RPCs in a forward migration; retain requests and immutable history.
begin;
alter table public.travel_requests
 add column purposes text[] not null default '{}',
 add column itinerary jsonb not null default '[]'::jsonb check(jsonb_typeof(itinerary)='array' and jsonb_array_length(itinerary)<=20),
 add column currency text not null default 'TZS' check(currency in ('TZS','USD','EUR')),
 add column per_diem_days numeric not null default 0 check(per_diem_days between 0 and 60 and per_diem_days=round(per_diem_days,2)),
 add column per_diem_rate_minor bigint not null default 0 check(per_diem_rate_minor between 0 and 1000000000000),
 add column intercity_transport_minor bigint not null default 0 check(intercity_transport_minor between 0 and 1000000000000),
 add column local_transport_minor bigint not null default 0 check(local_transport_minor between 0 and 1000000000000),
 add column per_diem_total_minor bigint generated always as (round(per_diem_days*per_diem_rate_minor)::bigint) stored,
 add column estimated_total_minor bigint generated always as (round(per_diem_days*per_diem_rate_minor)::bigint+intercity_transport_minor+local_transport_minor) stored,
 add column post_visit_report text not null default '' check(length(post_visit_report)<=6000),
 add column visit_outcomes jsonb not null default '[]'::jsonb check(jsonb_typeof(visit_outcomes)='array' and jsonb_array_length(visit_outcomes)<=20),
 add column form_document_number text not null default 'ERP-TRAVEL-01' check(form_document_number='ERP-TRAVEL-01'),
 add column form_revision integer not null default 1 check(form_revision=1);
update public.travel_requests set purposes=array[purpose];
alter table public.travel_request_events
 add column operation_id uuid,
 add column request_content jsonb,
 add column snapshot jsonb;
create unique index travel_request_events_operation on public.travel_request_events(request_id,operation_id) where operation_id is not null;

create function public.save_travel_visit_plan(p_id uuid,p_expected_version integer,p_operation_id uuid,p_travellers uuid[],
 p_depart_at timestamptz,p_return_at timestamptz,p_transport text,p_notes text,p_purposes text[],p_itinerary jsonb,
 p_currency text,p_per_diem_days numeric,p_per_diem_rate_minor bigint,p_intercity_transport_minor bigint,p_local_transport_minor bigint)
returns public.travel_requests language plpgsql security definer set search_path=public,pg_temp as $$
declare v_row public.travel_requests; v_event public.travel_request_events; v_people uuid[]; v_purposes text[]; v_content jsonb;
 v_stop jsonb; v_clean jsonb:='[]'; v_first jsonb; v_org uuid; v_at timestamptz; v_stop_id uuid; v_stop_ids uuid[]:='{}'; v_action text;
begin
 perform public.require_access('travel');
 if not public.inventory_active_staff() or not public.mfa_satisfied() then raise exception 'Active staff and verified sign-in are required'; end if;
 if p_id is null or p_operation_id is null or p_expected_version is null or p_expected_version<0 then raise exception 'Request, operation and version are required'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,0));
 select * into v_row from public.travel_requests where id=p_id for update;
 if found and auth.uid()<>v_row.created_by and not public.inventory_owner() then raise exception 'Only the person who asked or the owner can change this request'; end if;
 v_content:=jsonb_build_object('version',p_expected_version,'travellers',p_travellers,'depart',p_depart_at,'return',p_return_at,'transport',p_transport,'notes',p_notes,
 'purposes',p_purposes,'itinerary',p_itinerary,'currency',p_currency,'days',p_per_diem_days,'rate',p_per_diem_rate_minor,'intercity',p_intercity_transport_minor,'local',p_local_transport_minor);
 select * into v_event from public.travel_request_events where request_id=p_id and operation_id=p_operation_id;
 if found then
  if v_event.actor_user_id<>auth.uid() or v_event.action not in ('create','edit') or v_event.request_content is distinct from v_content then raise exception 'Operation already used with different details'; end if;
  return jsonb_populate_record(null::public.travel_requests,v_event.snapshot);
 end if;
 if v_row.id is not null and (v_row.status<>'requested' or v_row.version<>p_expected_version) then raise exception 'Travel request changed or already decided; refresh'; end if;
 if v_row.id is null and p_expected_version<>0 then raise exception 'Travel request not found; refresh'; end if;
 select array_agg(distinct t order by t) into v_people from unnest(coalesce(p_travellers,'{}'::uuid[])) t where t is not null;
 if coalesce(cardinality(v_people),0) not between 1 and 20 then raise exception 'Choose between 1 and 20 travellers'; end if;
 if exists(select 1 from unnest(v_people) t where not exists(select 1 from public.staff s where s.user_id=t and s.active)) then raise exception 'Everyone travelling must be an active employee'; end if;
 select array_agg(distinct t order by t) into v_purposes from unnest(coalesce(p_purposes,'{}'::text[])) t;
 if coalesce(cardinality(v_purposes),0) not between 1 and 6 or exists(select 1 from unnest(v_purposes) t where t is null or t not in ('meeting','installation','service','delivery','training','other')) then raise exception 'Choose at least one valid trip purpose'; end if;
 if p_depart_at is null or p_return_at is null or not isfinite(p_depart_at) or not isfinite(p_return_at) or p_return_at<=p_depart_at or p_return_at>p_depart_at+interval '60 days' then raise exception 'Choose a return after departure within 60 days'; end if;
 if v_row.id is null and p_depart_at<now()-interval '1 day' then raise exception 'The trip cannot start in the past'; end if;
 if p_transport is null or p_notes is null or length(p_transport)>200 or length(p_notes)>2000 then raise exception 'Transport or notes are too long'; end if;
 if p_currency is null or p_currency not in ('TZS','USD','EUR') or p_per_diem_days is null or p_per_diem_days not between 0 and 60 or p_per_diem_days<>round(p_per_diem_days,2)
 or p_per_diem_rate_minor is null or p_per_diem_rate_minor not between 0 and 1000000000000
 or p_intercity_transport_minor is null or p_intercity_transport_minor not between 0 and 1000000000000
 or p_local_transport_minor is null or p_local_transport_minor not between 0 and 1000000000000 then raise exception 'Enter valid currency, allowance days and non-negative costs'; end if;
 if p_itinerary is null or jsonb_typeof(p_itinerary)<>'array' then raise exception 'Add an itinerary'; end if;
 if jsonb_array_length(p_itinerary) not between 1 and 20 or octet_length(p_itinerary::text)>200000 then raise exception 'An itinerary needs between 1 and 20 stops'; end if;
 for v_stop in select value from jsonb_array_elements(p_itinerary) loop
  if jsonb_typeof(v_stop)<>'object' or exists(select 1 from jsonb_object_keys(v_stop) k where k not in ('id','organization_id','destination','contact_name','appointment_purpose','appointment_at','preparation','resources')) then raise exception 'Invalid itinerary stop fields'; end if;
  if exists(select 1 from jsonb_each(v_stop) x where x.key<>'organization_id' and jsonb_typeof(x.value)<>'string')
   or (v_stop ? 'organization_id' and jsonb_typeof(v_stop->'organization_id') not in ('string','null')) then raise exception 'Invalid itinerary stop values'; end if;
  v_stop_id:=(v_stop->>'id')::uuid; v_org:=nullif(v_stop->>'organization_id','')::uuid; v_at:=(v_stop->>'appointment_at')::timestamptz;
  if v_stop_id is null or v_stop_id=any(v_stop_ids) then raise exception 'Every stop needs a unique identifier'; end if;
  v_stop_ids:=array_append(v_stop_ids,v_stop_id);
  if v_org is not null and not exists(select 1 from public.organizations where id=v_org and deleted_at is null) then raise exception 'Choose an active client for each stop'; end if;
  if (v_org is null and length(trim(coalesce(v_stop->>'destination','')))<2) or length(coalesce(v_stop->>'destination',''))>300 then raise exception 'Name the site for every stop'; end if;
  if length(trim(coalesce(v_stop->>'contact_name',''))) not between 2 and 300 or length(trim(coalesce(v_stop->>'appointment_purpose',''))) not between 3 and 1000 then raise exception 'Name the contact and appointment purpose for every stop'; end if;
  if v_at is null or not isfinite(v_at) or v_at<p_depart_at or v_at>p_return_at then raise exception 'Every appointment must fall within the trip'; end if;
  if length(coalesce(v_stop->>'preparation',''))>2000 or length(coalesce(v_stop->>'resources',''))>2000 then raise exception 'Preparation or resources are too long'; end if;
  v_clean:=v_clean||jsonb_build_array(jsonb_build_object('id',v_stop_id,'organization_id',v_org,'destination',trim(coalesce(v_stop->>'destination','')),
   'contact_name',trim(v_stop->>'contact_name'),'appointment_purpose',trim(v_stop->>'appointment_purpose'),'appointment_at',v_at,
   'preparation',coalesce(v_stop->>'preparation',''),'resources',coalesce(v_stop->>'resources','')));
 end loop;
 v_first:=v_clean->0;
 if v_row.id is null then
  v_action:='create';
  insert into public.travel_requests(id,request_number,travellers,organization_id,destination,purpose,meeting_with,depart_at,return_at,transport,notes,
   purposes,itinerary,currency,per_diem_days,per_diem_rate_minor,intercity_transport_minor,local_transport_minor,created_by)
  values(p_id,'TR-'||lpad(nextval('public.travel_request_number_seq')::text,6,'0'),v_people,(v_first->>'organization_id')::uuid,v_first->>'destination',v_purposes[1],v_first->>'contact_name',
   p_depart_at,p_return_at,trim(p_transport),p_notes,v_purposes,v_clean,p_currency,p_per_diem_days,p_per_diem_rate_minor,p_intercity_transport_minor,p_local_transport_minor,auth.uid()) returning * into v_row;
 else
  v_action:='edit';
  update public.travel_requests set travellers=v_people,organization_id=(v_first->>'organization_id')::uuid,destination=v_first->>'destination',purpose=v_purposes[1],meeting_with=v_first->>'contact_name',
   depart_at=p_depart_at,return_at=p_return_at,transport=trim(p_transport),notes=p_notes,purposes=v_purposes,itinerary=v_clean,currency=p_currency,per_diem_days=p_per_diem_days,
   per_diem_rate_minor=p_per_diem_rate_minor,intercity_transport_minor=p_intercity_transport_minor,local_transport_minor=p_local_transport_minor,version=version+1,updated_at=now() where id=p_id returning * into v_row;
 end if;
 insert into public.travel_request_events(request_id,action,actor_user_id,operation_id,request_content,snapshot) values(p_id,v_action,auth.uid(),p_operation_id,v_content,to_jsonb(v_row));
 return v_row;
end $$;

create function public.advance_travel_visit(p_id uuid,p_expected_version integer,p_operation_id uuid,p_action text,p_note text,p_outcomes jsonb default '[]'::jsonb)
returns public.travel_requests language plpgsql security definer set search_path=public,pg_temp as $$
declare v_row public.travel_requests; v_event public.travel_request_events; v_content jsonb; v_status text; v_outcome jsonb; v_stop uuid; v_seen uuid[]:='{}'; v_clean jsonb:='[]';
begin
 perform public.require_access('travel');
 if not public.inventory_active_staff() or not public.mfa_satisfied() then raise exception 'Active staff and verified sign-in are required'; end if;
 if p_id is null or p_expected_version is null or p_expected_version<1 or p_operation_id is null then raise exception 'Request, operation and version are required'; end if;
 if p_action is null or p_action not in ('approve','decline','done','cancel') then raise exception 'Unknown action'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,0));
 select * into v_row from public.travel_requests where id=p_id for update;
 if not found then raise exception 'Travel request not found'; end if;
 if p_action in ('approve','decline') and not public.inventory_owner() then raise exception 'Only the owner can approve or decline travel'; end if;
 if p_action='done' and not (auth.uid()=any(v_row.travellers) or auth.uid()=v_row.created_by or public.inventory_owner()) then raise exception 'Only a traveller, the person who asked or the owner can close this trip'; end if;
 if p_action='cancel' and auth.uid()<>v_row.created_by and not public.inventory_owner() then raise exception 'Only the person who asked or the owner can cancel'; end if;
 v_content:=jsonb_build_object('version',p_expected_version,'action',p_action,'note',p_note,'outcomes',p_outcomes);
 select * into v_event from public.travel_request_events where request_id=p_id and operation_id=p_operation_id;
 if found then
  if v_event.actor_user_id<>auth.uid() or v_event.action<>p_action or v_event.request_content is distinct from v_content then raise exception 'Operation already used with different details'; end if;
  return jsonb_populate_record(null::public.travel_requests,v_event.snapshot);
 end if;
 if v_row.version<>p_expected_version then raise exception 'Travel request changed; refresh'; end if;
 if p_note is null or length(p_note)>(case when p_action in ('approve','decline') then 1000 when p_action='done' then 6000 else 2000 end) then raise exception 'Note or report is too long'; end if;
 if p_outcomes is null or jsonb_typeof(p_outcomes)<>'array' then raise exception 'Invalid visit outcomes'; end if;
 if p_action<>'done' and p_outcomes<>'[]'::jsonb then raise exception 'Outcomes are only accepted with the post-visit report'; end if;
 if p_action in ('approve','decline') then
  if v_row.status<>'requested' then raise exception 'This request has already been decided'; end if;
  if p_action='decline' and length(trim(p_note))<3 then raise exception 'Say why it is declined'; end if;
  v_status:=case when p_action='approve' then 'approved' else 'declined' end;
  update public.travel_requests set status=v_status,decided_by=auth.uid(),decided_at=now(),decision_note=trim(p_note),version=version+1,updated_at=now() where id=p_id returning * into v_row;
 elsif p_action='done' then
  if v_row.status<>'approved' then raise exception 'Only an approved trip can be marked done'; end if;
  if length(trim(p_note))<3 then raise exception 'Write the post-visit report'; end if;
  if jsonb_array_length(p_outcomes)<>jsonb_array_length(v_row.itinerary) or octet_length(p_outcomes::text)>200000 then raise exception 'Report the outcome of every itinerary stop'; end if;
  for v_outcome in select value from jsonb_array_elements(p_outcomes) loop
   if jsonb_typeof(v_outcome)<>'object' or exists(select 1 from jsonb_object_keys(v_outcome) k where k not in ('stop_id','outcome','follow_up','follow_up_on'))
    or exists(select 1 from jsonb_each(v_outcome) x where jsonb_typeof(x.value)<>'string') then raise exception 'Invalid visit outcome fields'; end if;
   v_stop:=(v_outcome->>'stop_id')::uuid;
   if v_stop is null or v_stop=any(v_seen) or not exists(select 1 from jsonb_array_elements(v_row.itinerary) s where (s->>'id')::uuid=v_stop) then raise exception 'Outcome must match a unique itinerary stop'; end if;
   v_seen:=array_append(v_seen,v_stop);
   if length(trim(coalesce(v_outcome->>'outcome',''))) not between 3 and 2000 or length(coalesce(v_outcome->>'follow_up',''))>2000 then raise exception 'Write each visit outcome and valid follow-up'; end if;
   if coalesce(v_outcome->>'follow_up_on','')<>'' then
    if length(trim(coalesce(v_outcome->>'follow_up','')))<3 then raise exception 'A follow-up date needs an action'; end if;
    if (v_outcome->>'follow_up_on')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or not isfinite((v_outcome->>'follow_up_on')::date) then raise exception 'Enter a valid follow-up date'; end if;
   end if;
   v_clean:=v_clean||jsonb_build_array(jsonb_build_object('stop_id',v_stop,'outcome',trim(v_outcome->>'outcome'),'follow_up',trim(coalesce(v_outcome->>'follow_up','')),'follow_up_on',coalesce(v_outcome->>'follow_up_on','')));
  end loop;
  update public.travel_requests set status='done',post_visit_report=trim(p_note),visit_outcomes=v_clean,outcome_note=left(trim(p_note),2000),version=version+1,updated_at=now() where id=p_id returning * into v_row;
 else
  if v_row.status not in ('requested','approved') then raise exception 'This trip is already closed'; end if;
  update public.travel_requests set status='cancelled',outcome_note=trim(p_note),version=version+1,updated_at=now() where id=p_id returning * into v_row;
 end if;
 insert into public.travel_request_events(request_id,action,note,actor_user_id,operation_id,request_content,snapshot) values(p_id,p_action,left(p_note,2000),auth.uid(),p_operation_id,v_content,to_jsonb(v_row));
 return v_row;
end $$;
-- Retired writers cannot bypass itinerary/report checks or operation receipts.
revoke all on function public.save_travel_request(uuid,integer,uuid[],uuid,text,text,text,timestamptz,timestamptz,text,text),public.advance_travel_request(uuid,integer,text,text) from authenticated;
revoke all on function public.save_travel_visit_plan(uuid,integer,uuid,uuid[],timestamptz,timestamptz,text,text,text[],jsonb,text,numeric,bigint,bigint,bigint),public.advance_travel_visit(uuid,integer,uuid,text,text,jsonb) from public,anon;
grant execute on function public.save_travel_visit_plan(uuid,integer,uuid,uuid[],timestamptz,timestamptz,text,text,text[],jsonb,text,numeric,bigint,bigint,bigint),public.advance_travel_visit(uuid,integer,uuid,text,text,jsonb) to authenticated;
commit;
