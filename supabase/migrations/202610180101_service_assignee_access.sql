-- An assigned engineer must be able to open the service case. Match the existing picker and service read policy.
begin;

do $migration$
declare
 v_oid oid := to_regprocedure('public.advance_service_case(uuid,integer,text,uuid,date,text)');
 v_definition text;
 v_old text := $old$ if v_to not in ('new','cancelled') and (v_assignee is null or not exists(select 1 from public.staff where user_id=v_assignee and active=true)) then raise exception 'Choose an active employee'; end if;$old$;
 v_new text := $new$ if v_to not in ('new','cancelled') and (v_assignee is null or not exists(select 1 from public.staff where user_id=v_assignee and active=true and (role='owner' or 'service'=any(access)))) then raise exception 'Choose an active employee with Service access'; end if;$new$;
begin
 if v_oid is null then raise exception 'Missing expected service case RPC'; end if;
 if not (select prosecdef and prolang=(select oid from pg_language where lanname='plpgsql') from pg_proc where oid=v_oid) then
  raise exception 'Expected SECURITY DEFINER plpgsql service case RPC';
 end if;
 v_definition := pg_get_functiondef(v_oid);
 if strpos(v_definition,v_new)>0 then return; end if;
 if (length(v_definition)-length(replace(v_definition,v_old,'')))/length(v_old)<>1 then
  raise exception 'Unexpected service case assignee validation';
 end if;
 execute replace(v_definition,v_old,v_new);
end $migration$;

commit;
