-- Forward fix for migration 043. Existing rows, permissions and stock are unchanged.
-- Rollback: restore the previous function body in a reviewed forward migration;
-- doing so reintroduces the incomplete retry-content check. No data rollback needed.
begin;

create or replace function public.create_pending_stock_request(p_id uuid, p_organization_id uuid, p_contact_id uuid, p_product_id uuid, p_quantity integer,
 p_proforma_id uuid default null, p_lead_id uuid default null, p_salesperson_user_id uuid default null, p_notes text default '')
returns public.pending_stock_requests language plpgsql security definer set search_path=public,pg_temp as $$
declare v_row public.pending_stock_requests; v_salesperson uuid := coalesce(p_salesperson_user_id, auth.uid());
begin
 if not public.inventory_active_staff() then raise exception 'Active staff access is required'; end if;
 if p_id is null or p_organization_id is null or p_product_id is null or p_quantity is null then raise exception 'Client, product and quantity are required'; end if;
 if p_quantity not between 1 and 1000000 then raise exception 'Quantity must be a whole number from 1 to 1,000,000'; end if;
 if length(coalesce(p_notes,'')) > 4000 then raise exception 'Notes are too long'; end if;
 perform pg_advisory_xact_lock(hashtextextended('pending-stock:'||p_id::text,0));
 select * into v_row from public.pending_stock_requests where id=p_id;
 if found then
  -- Compare every creation field after the same normalization used for insertion.
  if v_row.created_by=auth.uid() and v_row.organization_id=p_organization_id and v_row.product_id=p_product_id and v_row.quantity=p_quantity
   and v_row.contact_id is not distinct from p_contact_id and v_row.proforma_id is not distinct from p_proforma_id and v_row.lead_id is not distinct from p_lead_id
   and v_row.salesperson_user_id=v_salesperson and v_row.notes=trim(coalesce(p_notes,'')) then return v_row; end if;
  raise exception 'Pending request already exists; refresh and compare';
 end if;
 if not exists(select 1 from public.organizations where id=p_organization_id and deleted_at is null) then raise exception 'Choose an existing client'; end if;
 if p_contact_id is not null and not exists(select 1 from public.contacts where id=p_contact_id and organization_id=p_organization_id and deleted_at is null) then raise exception 'Choose a contact from the selected client'; end if;
 if not exists(select 1 from public.products where id=p_product_id and deleted_at is null) then raise exception 'Choose an active product'; end if;
 if p_proforma_id is not null and not exists(select 1 from public.sales_proformas where id=p_proforma_id and organization_id=p_organization_id and deleted_at is null) then raise exception 'Choose a Pro forma for the same client'; end if;
 if p_lead_id is not null and not exists(select 1 from public.sales_leads where id=p_lead_id) then raise exception 'Lead not found'; end if;
 if not exists(select 1 from public.staff where user_id=v_salesperson and active) then raise exception 'Choose an active salesperson'; end if;
 insert into public.pending_stock_requests(id,request_number,status,organization_id,contact_id,product_id,quantity,proforma_id,lead_id,salesperson_user_id,notes,expires_on,created_by)
 values(p_id,'PS-'||lpad(nextval('public.pending_stock_number_seq')::text,6,'0'),'waiting',p_organization_id,p_contact_id,p_product_id,p_quantity,p_proforma_id,p_lead_id,
  v_salesperson,trim(coalesce(p_notes,'')),(current_date + interval '6 months')::date,auth.uid())
 returning * into v_row;
 insert into public.pending_stock_events(request_id,action,from_status,to_status,note,expires_on,actor_user_id)
 values(v_row.id,'create',null,'waiting',v_row.notes,v_row.expires_on,auth.uid());
 return v_row;
end $$;

-- CREATE OR REPLACE retains the existing ACL; no new access is granted.
commit;
