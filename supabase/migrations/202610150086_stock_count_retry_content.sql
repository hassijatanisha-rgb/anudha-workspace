-- Retried stock counts and count sessions must match what was saved (replaces unmerged PR #12, rebuilt on the live
-- functions). Before this, a retried count ignored batch, expiry, condition, notes and description, and a retried
-- session ignored its name and who opened it, so changed content appeared saved. These are the live definitions with
-- only those comparisons changed; the stock-count access check added by migration 060 is kept. Rows are untouched.
begin;

create or replace function public.open_stock_count(p_id uuid, p_name text)
 RETURNS stock_count_sessions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_row public.stock_count_sessions;
begin
 if not public.inventory_owner() then raise exception 'Only the owner can start a count'; end if;
 select * into v_row from public.stock_count_sessions where id=p_id;
 if found then
  if v_row.opened_by=auth.uid() and v_row.name=trim(coalesce(p_name,'')) then return v_row; end if;
  raise exception 'Count session already saved with different details; refresh';
 end if;
 if exists(select 1 from public.stock_count_sessions where status='open') then raise exception 'A count is already running; close it first'; end if;
 insert into public.stock_count_sessions(id,name,status,opened_by) values(p_id,trim(coalesce(p_name,'')),'open',auth.uid()) returning * into v_row;
 return v_row;
end $function$;

create or replace function public.record_stock_count(p_id uuid, p_session_id uuid, p_godown text, p_code text, p_unlisted text, p_quantity numeric, p_unit text, p_batch text DEFAULT ''::text, p_expiry date DEFAULT NULL::date, p_condition text DEFAULT 'good'::text, p_notes text DEFAULT ''::text)
 RETURNS stock_count_entries
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_row public.stock_count_entries;
begin
 perform public.require_access('stock_count');
 if not public.inventory_active_staff() then raise exception 'Active staff access is required'; end if;
 if p_id is null or p_session_id is null then raise exception 'Count and session are required'; end if;
 perform pg_advisory_xact_lock(hashtextextended('stock-count:'||p_id::text,0));
 select * into v_row from public.stock_count_entries where id=p_id;
 if found then
  if v_row.counted_by=auth.uid() and v_row.session_id=p_session_id and v_row.godown=p_godown and v_row.code is not distinct from nullif(p_code,'')
   and v_row.quantity=p_quantity and v_row.unit=p_unit
   and v_row.unlisted = (case when nullif(p_code,'') is null then trim(coalesce(p_unlisted,'')) else '' end)
   and v_row.batch = trim(coalesce(p_batch,''))
   and v_row.expiry is not distinct from p_expiry
   and v_row.condition = coalesce(p_condition,'good')
   and v_row.notes = trim(coalesce(p_notes,'')) then return v_row; end if;
  raise exception 'Count already saved with different details; refresh';
 end if;
 if not exists(select 1 from public.stock_count_sessions where id=p_session_id and status='open') then raise exception 'This count is closed; ask the owner to start one'; end if;
 if nullif(p_code,'') is not null and not exists(select 1 from public.count_catalogue where code=p_code) then raise exception 'Choose a product from the list, or describe it as not on the list'; end if;
 if p_expiry is not null and p_expiry < date '2000-01-01' then raise exception 'Check the expiry date'; end if;
 insert into public.stock_count_entries(id,session_id,godown,code,unlisted,quantity,unit,batch,expiry,condition,notes,counted_by)
 values(p_id,p_session_id,p_godown,nullif(p_code,''),case when nullif(p_code,'') is null then trim(coalesce(p_unlisted,'')) else '' end,p_quantity,p_unit,
  trim(coalesce(p_batch,'')),p_expiry,coalesce(p_condition,'good'),trim(coalesce(p_notes,'')),auth.uid())
 returning * into v_row;
 return v_row;
end $function$;

commit;
