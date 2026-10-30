begin;

create function public.my_handoff_page(p_page integer,p_now timestamptz,p_today date,p_utc_today date)
returns jsonb language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare v_result jsonb;
begin
 if not public.inventory_active_staff() then raise exception 'Active staff access is required' using errcode='42501'; end if;
 if p_page is null or p_page<0 or p_page>1000000 then raise exception 'Choose a valid handoff page'; end if;
 if p_now is null or not isfinite(p_now) or p_today is null or not isfinite(p_today) or p_utc_today is null or not isfinite(p_utc_today) then raise exception 'Valid browser time and dates are required'; end if;
 -- workAgeLevel uses the browser's civil day; workOverdue uses its UTC day.
 with mine as materialized (
  select w.id,w.record_type,w.record_id,w.record_label,w.task,w.assignee_user_id,w.assigned_by,w.due_on,w.status,w.version,w.created_at,
   d.expected_on,
   case when d.expected_on is not null then case when d.expected_on<p_today then 2 else 0 end
    when w.due_on is not null then case when w.due_on<p_today then 2 else 0 end
    when p_now-w.created_at>interval '48 hours' then 2
    when p_now-w.created_at>interval '24 hours' then 1 else 0 end as age_rank,
   coalesce(w.due_on<p_utc_today,false) as overdue
  from public.work_assignments w
  left join lateral(select delay.expected_on from public.work_delays delay where delay.assignment_id=w.id order by delay.recorded_at desc,delay.id desc limit 1) d on true
  where w.assignee_user_id=auth.uid() and w.status='open'
 ), totals as (
  select count(*) as total,greatest(1,(count(*)+19)/20) as pages,least(p_page,greatest(0,(count(*)-1)/20)) as page from mine
 ), page_rows as (
  select * from mine order by age_rank desc,overdue desc,due_on nulls last,created_at,id limit 20 offset (select page*20 from totals)
 )
 select jsonb_build_object('total',total,'page',page,'pages',pages,
  'rows',coalesce((select jsonb_agg((to_jsonb(p)-'age_rank')||jsonb_build_object('age_level',case p.age_rank when 2 then 'red' when 1 then 'yellow' else '' end)
   order by age_rank desc,overdue desc,due_on nulls last,created_at,id) from page_rows p),'[]'::jsonb)) into v_result from totals;
 return v_result;
end $$;
revoke all on function public.my_handoff_page(integer,timestamptz,date,date) from public,anon;
grant execute on function public.my_handoff_page(integer,timestamptz,date,date) to authenticated;
commit;
