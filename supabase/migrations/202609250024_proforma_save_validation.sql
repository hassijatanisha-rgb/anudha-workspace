-- Add only input guards to the installed migration-004 save RPC.
-- CREATE OR REPLACE preserves its identity, ownership and existing grants.
begin;
do $migration$
declare
 v_oid oid;
 v_body text;
 v_definition text;
 v_anchor constant text := ' if not public.inventory_active_staff() then raise exception ''Active staff access is required''; end if;';
 v_guards constant text := E'\n -- proforma_save_validation_024\n if p_expected_version is null or p_expected_version<0 then raise exception ''A nonnegative expected version is required''; end if;\n if p_lines is null or jsonb_typeof(p_lines) is distinct from ''array'' then raise exception ''Pro forma lines must be a JSON array''; end if;\n if p_currency is null then raise exception ''Choose TZS, USD or EUR currency''; end if;';
 v_baseline constant text := '830d2cd70685bf1b16b02e5b21ce0d9b';
begin
 if (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='save_sales_proforma')<>1 then
  raise exception 'Expected exactly one public.save_sales_proforma implementation; review migration 024 manually';
 end if;
 v_oid:=to_regprocedure('public.save_sales_proforma(uuid,integer,uuid,uuid,text,date,text,text,text,jsonb)');
 if v_oid is null then raise exception 'Unexpected save_sales_proforma signature'; end if;
 select prosrc,pg_get_functiondef(oid) into v_body,v_definition from pg_proc where oid=v_oid;
 if strpos(v_body,'proforma_save_validation_024')>0 then
  if md5(replace(v_body,v_guards,''))<>v_baseline or (length(v_body)-length(replace(v_body,v_guards,'')))/length(v_guards)<>1 then
   raise exception 'Unexpected previously patched save_sales_proforma implementation';
  end if;
  return;
 end if;
 if md5(v_body)<>v_baseline or (length(v_body)-length(replace(v_body,v_anchor,'')))/length(v_anchor)<>1 then
  raise exception 'Unexpected save_sales_proforma implementation; expected migration 004 body';
 end if;
 execute replace(v_definition,v_anchor,v_anchor||v_guards);
end
$migration$;
commit;
