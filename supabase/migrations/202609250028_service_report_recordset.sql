-- PostgreSQL requires typed record definitions inside ROWS FROM when adding ordinality.
-- Preserve the existing report RPC identity, grants and all validation behavior.
begin;
do $migration$
declare
 v_oid oid := to_regprocedure('public.complete_service_report(uuid,integer,date,text,text,text,text,text,text,text,uuid,text,date,text,date,text,text,date,text,boolean,text,boolean,text,date,text,text,bigint,text,integer,jsonb,jsonb)');
 v_definition text;
 v_old text;
 v_new text;
 r record;
begin
 if v_oid is null then raise exception 'Missing expected complete_service_report RPC'; end if;
 select pg_get_functiondef(v_oid) into v_definition;
 for r in select * from (values
  ('p_accessories','description text,serial_number text'),
  ('p_attendees','full_name text,telephone text,designation text')
 ) as lists(parameter,columns) loop
  v_old := 'jsonb_to_recordset('||r.parameter||') with ordinality as row('||r.columns||',ordinality bigint)';
  v_new := 'rows from (jsonb_to_recordset('||r.parameter||') as ('||r.columns||')) with ordinality as row';
  if strpos(v_definition,v_old)>0 then
   v_definition := replace(v_definition,v_old,v_new);
  elsif strpos(v_definition,v_new)=0 then
   raise exception 'Unexpected complete_service_report implementation for %',r.parameter;
  end if;
 end loop;
 execute v_definition;
end
$migration$;
commit;
