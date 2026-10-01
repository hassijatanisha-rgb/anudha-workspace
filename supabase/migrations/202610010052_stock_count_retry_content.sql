-- Forward-only correction to 047: a retry must describe the same saved count.
-- No row, stock, signature or ACL changes. Retirement requires a reviewed forward
-- replacement; do not restore the permissive retry comparison.
begin;
create or replace function public.record_stock_count(p_id uuid, p_session_id uuid, p_godown text, p_code text, p_unlisted text, p_quantity numeric,
 p_unit text, p_batch text default '', p_expiry date default null, p_condition text default 'good', p_notes text default '')
returns public.stock_count_entries language plpgsql security definer set search_path=public,pg_temp as $$
declare v_row public.stock_count_entries;
begin
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
end $$;
commit;
