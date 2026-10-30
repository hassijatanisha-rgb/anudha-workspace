-- Read-only Leads landing. Full records/history remain behind explicit opening.
-- Rollback: revoke this RPC in a forward migration and restore the previous landing.
begin;
create function public.sales_lead_page(p_query text default '',p_filter text default 'open',p_page integer default 0,
 p_owner_names jsonb default '{}'::jsonb,p_now timestamptz default now())
returns jsonb language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare v_result jsonb;v_query text;v_archive text;v_today date;
 -- String.trim() whitespace used by the existing lead search and display directory.
 v_space constant text:=U&'\0009\000a\000b\000c\000d\0020\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff';
begin
 if public.inventory_active_staff() is not true or public.has_access('leads') is not true then
  raise exception 'Lead access is required' using errcode='42501';
 end if;
 if p_query is null or length(p_query)>2000 then raise exception 'Search must be 2000 characters or fewer' using errcode='22023'; end if;
 if p_filter is null or p_filter not in('open','new','mine','won','lost','all') then raise exception 'Choose a valid lead filter' using errcode='22023'; end if;
 if p_page is null or p_page<0 or p_page>1000000 then raise exception 'Choose a valid lead page' using errcode='22023'; end if;
 if p_now is null or not isfinite(p_now) then raise exception 'Choose a valid lead time' using errcode='22023'; end if;
 -- Names supplied by the existing display directory affect search only, never authorization or output.
 if p_owner_names is null or jsonb_typeof(p_owner_names)<>'object' or octet_length(p_owner_names::text)>2000000 then
  raise exception 'The salesperson search directory is invalid' using errcode='22023';
 end if;
 if (select count(*) from jsonb_each(p_owner_names))>10000 or exists(
  select 1 from jsonb_each(p_owner_names) e where e.key!~'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
   or jsonb_typeof(e.value)<>'string' or length(e.value#>>'{}') not between 1 and 120
 ) then raise exception 'The salesperson search directory is invalid' using errcode='22023'; end if;
 v_query:=lower(btrim(p_query,v_space));
 v_archive:=lower(regexp_replace(btrim(regexp_replace(p_query,'[^[:alnum:]@.+ -]',' ','g')),'\s+',' ','g'));
 v_today:=(p_now at time zone 'Africa/Dar_es_Salaam')::date;
 with scope as materialized (
  select l.id,l.lead_number,l.subject,l.stage,l.owner_user_id,l.next_action_on,l.created_at,l.caller_name,l.caller_phone,l.caller_organization,
   case when v_query<>'' then l.details else '' end as details,case when v_query<>'' then l.next_action else '' end as next_action,
   case when o.id is not null then o.name||case when coalesce(o.location,'')<>'' then ' · '||o.location else '' end
   else coalesce(nullif(concat_ws(' · ',nullif(l.caller_organization,''),nullif(l.caller_name,'')),''),'Unknown caller') end as client_label,
   case when l.owner_user_id is null then 'Unassigned' else coalesce(nullif(btrim(p_owner_names->>l.owner_user_id::text,v_space),''),
    case when l.owner_user_id=auth.uid() then 'You' else 'Employee name not set' end) end as owner_search,
   case l.caller_role when 'doctor' then 'Doctor / user' when 'head_of_department' then 'Head of department'
    when 'procurement' then 'Procurement / purchasing' when 'management' then 'Management / director'
    when 'biomedical' then 'Biomedical engineer' when 'other' then 'Other' else '' end as role_search
  from public.sales_leads l left join public.organizations o on o.id=l.organization_id and o.deleted_at is null
  where l.stage not in('won','lost') or l.updated_at>=p_now-interval '183 days' or (length(v_archive)>=3 and (
   strpos(lower(l.lead_number),v_archive)>0 or strpos(lower(l.subject),v_archive)>0 or strpos(lower(l.caller_name),v_archive)>0
   or strpos(lower(l.caller_phone),v_archive)>0 or strpos(lower(l.caller_organization),v_archive)>0))
 ), matches as materialized (
  select *,case when stage in('won','lost') then 1 else 0 end as closed_rank,
   case when stage not in('won','lost') and next_action_on<v_today then 1 else 0 end as overdue_rank
  from scope where (p_filter='all' or (p_filter='open' and stage not in('won','lost')) or (p_filter='new' and stage='inquiry')
   or (p_filter='mine' and stage not in('won','lost') and owner_user_id=auth.uid()) or stage=p_filter)
   and (v_query='' or strpos(lower(array_to_string(array[lead_number,subject,details,caller_name,caller_phone,caller_organization,role_search,client_label,owner_search,next_action],' ','')),v_query)>0)
 ), totals as (
  select count(*) total,greatest(1,(count(*)+24)/25) pages,least(p_page,greatest(0,(count(*)-1)/25)) page from matches
 ), page_rows as (
  select * from matches order by closed_rank,overdue_rank desc,coalesce(next_action_on::text,'9999') collate "C",created_at desc,id
  limit 25 offset (select page*25 from totals)
 )
 select jsonb_build_object('rows',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'page_summary',true,
  'lead_number',r.lead_number,'subject',r.subject,'stage',r.stage,'client_label',r.client_label,'owner_user_id',r.owner_user_id,'next_action_on',r.next_action_on)
  order by r.closed_rank,r.overdue_rank desc,coalesce(r.next_action_on::text,'9999') collate "C",r.created_at desc,r.id) from page_rows r),'[]'::jsonb),
  'total',totals.total,'page',totals.page,'pages',totals.pages,'as_of',v_today,
  'counts',(select jsonb_build_object('all',count(*),'open',count(*) filter(where stage not in('won','lost')),
   'new',count(*) filter(where stage='inquiry'),'mine',count(*) filter(where stage not in('won','lost') and owner_user_id=auth.uid()),
   'won',count(*) filter(where stage='won'),'lost',count(*) filter(where stage='lost')) from scope)) into v_result from totals;
 return v_result;
end $$;
revoke all on function public.sales_lead_page(text,text,integer,jsonb,timestamptz) from public,anon;
grant execute on function public.sales_lead_page(text,text,integer,jsonb,timestamptz) to authenticated;
commit;
