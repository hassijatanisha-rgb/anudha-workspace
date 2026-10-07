-- Clients & items data: a new access area "records". Only people with it (and the owner, who has every area) may add,
-- change or delete client records (organizations/branches, contacts) and items (products, pack definitions, product
-- detail reviews, categories, machine links, source mappings). Everyone else keeps choosing the existing clients and
-- items in leads, Pro formas, orders, deliveries and service reports exactly as before; reading is unchanged.
-- Nobody gets the area automatically and it is in no department template. Only the owner gives or removes it: a head
-- can neither give it nor take it away, even if the head has it.
-- Each save function below gets "perform public.require_access('records');" as the first statement after begin; the
-- rest of each function stays exactly as it is live (taken from pg_get_functiondef, not copied by hand).
-- Rollback: a forward migration that removes that one line from the same functions (same do-block with the replace
-- reversed). Leaving "records" in the area list is harmless.
begin;

create or replace function public.staff_access_areas() returns text[] language sql immutable set search_path=public,pg_temp as $$
 select array['leads','proformas','deliveries','service','purchasing','stock','stock_count','travel','reports','records']::text[]
$$;
alter table public.staff drop constraint staff_access_check;
alter table public.staff add constraint staff_access_check
 check (access <@ array['leads','proformas','deliveries','service','purchasing','stock','stock_count','travel','reports','records']::text[]);

-- Plain message for the new area; every other area keeps today's wording.
create or replace function public.require_access(p_area text) returns void
language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
 if not public.has_access(p_area) then
  if p_area='records' then
   raise exception 'Only people with Clients & items data access can change clients and items. Ask the owner.' using errcode='42501';
  end if;
  raise exception 'You do not have access to %. Ask your department head.', replace(p_area,'_',' ') using errcode='42501';
 end if;
end $$;

-- Which areas a person may use. A head can only give areas they have themselves, and never changes "records".
create or replace function public.set_staff_access(p_user_id uuid, p_access text[])
returns public.staff language plpgsql security definer set search_path=public,pg_temp as $$
declare v_row public.staff; v_me public.staff; v_access text[];
begin
 select array(select distinct a from unnest(coalesce(p_access,'{}')) a order by a) into v_access;
 if not (v_access <@ public.staff_access_areas()) then raise exception 'Choose areas from the list'; end if;
 if not public.can_manage_staff(p_user_id) then raise exception 'You can only change access for people in your own department' using errcode='42501'; end if;
 select * into v_me from public.staff where user_id=auth.uid();
 select * into v_row from public.staff where user_id=p_user_id for update;
 if not found then raise exception 'Staff account does not exist'; end if;
 if v_row.role='owner' then raise exception 'Owners always have full access'; end if;
 if v_me.role<>'owner' and ('records'=any(v_access)) is distinct from ('records'=any(v_row.access)) then
  raise exception 'Only the owner can give or remove Clients & items data access' using errcode='42501';
 end if;
 if v_me.role<>'owner' and not (array_remove(v_access,'records') <@ v_me.access) then
  raise exception 'You can only give access you have yourself: %', array_to_string(array(select a from unnest(v_access) a where a<>'records' and not a=any(v_me.access)),', ');
 end if;
 if v_row.access is distinct from v_access then
  update public.staff set access=v_access where user_id=p_user_id returning * into v_row;
  insert into public.staff_account_events(user_id,action,note,actor_user_id) values(p_user_id,'access_changed',left(array_to_string(v_access,', '),500),auth.uid());
 end if;
 return v_row;
end $$;

-- Head: put a newly created login on the staff list in the head's own department. Never with "records".
create or replace function public.add_department_staff(p_user_id uuid, p_access text[])
returns public.staff language plpgsql security definer set search_path=public,pg_temp as $$
declare v_me public.staff; v_row public.staff; v_access text[];
begin
 select array(select distinct a from unnest(coalesce(p_access,'{}')) a order by a) into v_access;
 select * into v_me from public.staff where user_id=auth.uid() and active and role='head';
 if not found or not public.mfa_satisfied() then raise exception 'Only a department head can add staff here' using errcode='42501'; end if;
 if v_me.department='' then raise exception 'Ask the owner to set your department first'; end if;
 if 'records'=any(v_access) then raise exception 'Only the owner can give Clients & items data access' using errcode='42501'; end if;
 if not (v_access <@ v_me.access) then raise exception 'You can only give access you have yourself'; end if;
 if not exists(select 1 from auth.users where id=p_user_id) then raise exception 'Login not found'; end if;
 if exists(select 1 from public.staff where user_id=p_user_id) then raise exception 'This person is already on the staff list'; end if;
 insert into public.staff(user_id,role,active,department,access) values(p_user_id,'staff',true,v_me.department,v_access) returning * into v_row;
 return v_row;
end $$;

-- Every function that adds, changes or (soft-)deletes clients or items. Owner-only checks inside them stay as they are.
do $do$
declare v_fn regprocedure; v_def text; v_new text;
begin
 foreach v_fn in array array[
  -- clients: organizations / branches
  'public.save_organization(uuid,text,text,text)',
  'public.approve_organization(uuid)',
  'public.set_organization_parent(uuid,uuid)',
  -- clients: contacts
  'public.save_contact(uuid,integer,jsonb)',
  'public.restore_contact(uuid,integer)',
  -- clients: delete and restore (recycle bin)
  'public.archive_record(text,uuid)',
  'public.restore_record(text,uuid)',
  -- clients and items: import
  'public.import_records(jsonb,jsonb,jsonb)',
  -- items
  'public.save_product(uuid,integer,text,text)',
  'public.set_product_match(uuid,integer,uuid,text)',
  'public.set_product_archived(uuid,boolean)',
  'public.apply_product_list(jsonb)',
  'public.save_pack_definition(uuid,uuid,integer,text,integer,text)',
  'public.save_product_detail_review(uuid,uuid,integer,text,text,text,text,boolean,boolean,text)',
  'public.save_product_inventory_classification(uuid,uuid,integer,text,text)',
  'public.save_product_machine_link_review(uuid,uuid,integer,uuid[],text)',
  'public.save_product_source_mapping_review(uuid,text,integer,uuid,text,jsonb,text)'
 ]::regprocedure[] loop
  if not (select prosecdef and prolang=(select oid from pg_language where lanname='plpgsql') from pg_proc where oid=v_fn) then
   raise exception '% is not a SECURITY DEFINER plpgsql function; check it by hand', v_fn;
  end if;
  v_def := pg_get_functiondef(v_fn);
  if strpos(v_def, 'require_access(''records'')') > 0 then raise exception '% already checks records', v_fn; end if;
  -- First line that is exactly "begin" (the function body; nested blocks are indented).
  v_new := regexp_replace(v_def, E'\\n(begin[ \\t]*)\\n', E'\n\\1\n perform public.require_access(''records'');\n');
  if v_new = v_def then raise exception 'No begin line found in %', v_fn; end if;
  execute v_new;
 end loop;
end $do$;

commit;
