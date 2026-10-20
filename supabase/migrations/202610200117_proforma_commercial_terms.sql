-- Commercial terms and service instructions are saved atomically with the quotation revision.
-- Internal notes intentionally never enter the printable revision snapshot.
begin;
alter table public.sales_proformas
 add column commercial_kind text not null default 'sale' check(commercial_kind in ('sale','placement')),
 add column contract_id uuid references public.customer_contracts(id),
 add column installation_required boolean not null default true,
 add column installation_charge_notes text not null default '' check(length(installation_charge_notes)<=2000),
 add column internal_notes text not null default '' check(length(internal_notes)<=4000),
 add constraint placement_contract_required check(commercial_kind<>'placement' or contract_id is not null);
create index sales_proformas_contract on public.sales_proformas(contract_id) where contract_id is not null;
drop function public.save_sales_proforma(uuid,integer,uuid,uuid,text,date,text,text,text,jsonb);
CREATE OR REPLACE FUNCTION public.save_sales_proforma(p_id uuid, p_expected_version integer, p_organization_id uuid, p_contact_id uuid, p_currency text, p_valid_until date, p_delivery_period text, p_payment_terms text, p_notes text, p_lines jsonb, p_commercial_kind text default null, p_contract_id uuid default null, p_installation_required boolean default null, p_installation_charge_notes text default null, p_internal_notes text default null)
 RETURNS sales_proformas
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
 v_row public.sales_proformas;
 v_existing public.sales_proformas;
 v_revision integer;
 v_number text;
 v_count integer;
 v_subtotal bigint;
 v_discount bigint;
 v_tax bigint;
 v_snapshot jsonb;
 v_kind text; v_contract uuid; v_install boolean; v_charge text; v_internal text;
begin
 perform public.require_access('proformas');
 if not public.inventory_active_staff() then raise exception 'Active staff access is required'; end if;

 if p_id is null then raise exception 'Pro forma identity is required'; end if;
 select * into v_existing from public.sales_proformas where id=p_id for update;
 v_kind:=coalesce(p_commercial_kind,v_existing.commercial_kind,'sale');
 v_contract:=case when v_kind='placement' then coalesce(p_contract_id,v_existing.contract_id) else null end;
 v_install:=coalesce(p_installation_required,v_existing.installation_required,true);
 v_charge:=trim(coalesce(p_installation_charge_notes,v_existing.installation_charge_notes,''));
 v_internal:=trim(coalesce(p_internal_notes,v_existing.internal_notes,''));
 if v_kind not in ('sale','placement') or length(v_charge)>2000 or length(v_internal)>4000 then raise exception 'Check commercial category and internal/service notes'; end if;
 if v_kind='placement' and not exists(select 1 from public.customer_contracts c where c.id=v_contract and c.organization_id=p_organization_id and c.kind='placement' and c.status<>'cancelled') then
  raise exception 'Select this customer branch’s placement contract';
 end if;
 -- proforma_save_validation_024
 if p_expected_version is null or p_expected_version<0 then raise exception 'A nonnegative expected version is required'; end if;
 if p_lines is null or jsonb_typeof(p_lines) is distinct from 'array' then raise exception 'Pro forma lines must be a JSON array'; end if;
 if p_currency is null then raise exception 'Choose TZS, USD or EUR currency'; end if;
 if p_currency not in ('TZS','USD','EUR') then raise exception 'Choose TZS, USD or EUR'; end if;
 if p_valid_until is null or p_valid_until<current_date then raise exception 'Validity date cannot be in the past'; end if;
 if length(trim(coalesce(p_delivery_period,''))) not between 2 and 300 then raise exception 'Enter the delivery period'; end if;
 if length(trim(coalesce(p_payment_terms,''))) not between 2 and 1000 then raise exception 'Enter payment terms'; end if;
 if length(coalesce(p_notes,''))>4000 then raise exception 'Notes are too long'; end if;
 if jsonb_typeof(p_lines)<>'array' or jsonb_array_length(p_lines) not between 1 and 100 then raise exception 'Add between 1 and 100 items'; end if;
 if not exists(select 1 from public.organizations where id=p_organization_id and deleted_at is null) or
    not exists(select 1 from public.contacts where id=p_contact_id and organization_id=p_organization_id and deleted_at is null and status<>'incorrect') then
  raise exception 'Choose an active client branch and one of its valid contacts';
 end if;
 select count(*) into v_count from jsonb_array_elements(p_lines) line
 join public.products product on product.id=(line->>'productId')::uuid;
 if v_count<>jsonb_array_length(p_lines) then raise exception 'One or more products are unavailable'; end if;
 if exists(select 1 from jsonb_array_elements(p_lines) line where
   coalesce(line->>'productId','')='' or coalesce((line->>'quantity')::integer,0) not between 1 and 1000000 or
   coalesce((line->>'unitPriceMinor')::bigint,-1)<0 or coalesce((line->>'discountBasisPoints')::integer,-1) not between 0 and 10000 or
   coalesce((line->>'taxBasisPoints')::integer,-1) not between 0 and 10000 or
   length(trim(coalesce(line->>'uom',''))) not between 1 and 40 or length(trim(coalesce(line->>'description',''))) not between 1 and 4000
 ) then raise exception 'Check every item, quantity, unit, price, discount and tax'; end if;


 if v_kind='placement' and exists(select 1 from jsonb_array_elements(p_lines) line where (line->>'unitPriceMinor')::bigint<>0 or not exists(
  select 1 from public.product_inventory_classifications c where c.product_id=(line->>'productId')::uuid and c.category='machines'
   and c.version=(select max(latest.version) from public.product_inventory_classifications latest where latest.product_id=c.product_id))) then
  raise exception 'Placement contains zero-charge machines only; quote consumables separately';
 end if;
 select coalesce(sum(gross),0),coalesce(sum(discount),0),coalesce(sum(round((gross-discount)*tax_basis_points/10000)),0)
 into v_subtotal,v_discount,v_tax from (
  select (line->>'quantity')::bigint*(line->>'unitPriceMinor')::bigint as gross,
         round((line->>'quantity')::numeric*(line->>'unitPriceMinor')::numeric*(line->>'discountBasisPoints')::numeric/10000) as discount,
         (line->>'taxBasisPoints')::numeric as tax_basis_points
  from jsonb_array_elements(p_lines) line
 ) totals;
 if v_subtotal>9000000000000000 or v_subtotal-v_discount+v_tax>9000000000000000 then raise exception 'Document total is too large'; end if;

 if p_expected_version=0 then
  v_number:='PF-'||to_char(current_date,'YYYY')||'-'||lpad(nextval('public.proforma_document_number_seq')::text,6,'0');
  insert into public.sales_proformas(id,document_number,organization_id,contact_id,currency,valid_until,delivery_period,payment_terms,notes,subtotal_minor,discount_minor,tax_minor,total_minor,prepared_by,commercial_kind,contract_id,installation_required,installation_charge_notes,internal_notes)
  values(p_id,v_number,p_organization_id,p_contact_id,p_currency,p_valid_until,trim(p_delivery_period),trim(p_payment_terms),trim(coalesce(p_notes,'')),v_subtotal,v_discount,v_tax,v_subtotal-v_discount+v_tax,auth.uid(),v_kind,v_contract,v_install,v_charge,v_internal) returning * into v_row;
 else
  select * into v_existing from public.sales_proformas where id=p_id for update;
  if not found then raise exception 'Pro forma invoice not found'; end if;
  if v_existing.version<>p_expected_version then raise exception 'Pro forma changed; refresh before saving'; end if;
  if v_existing.status<>'draft' then raise exception 'Only a draft can be revised'; end if;
  update public.sales_proformas set organization_id=p_organization_id,contact_id=p_contact_id,currency=p_currency,valid_until=p_valid_until,
   delivery_period=trim(p_delivery_period),payment_terms=trim(p_payment_terms),notes=trim(coalesce(p_notes,'')),subtotal_minor=v_subtotal,
   discount_minor=v_discount,tax_minor=v_tax,total_minor=v_subtotal-v_discount+v_tax,commercial_kind=v_kind,contract_id=v_contract,installation_required=v_install,installation_charge_notes=v_charge,internal_notes=v_internal,revision=revision+1,version=version+1,updated_at=now()
  where id=p_id returning * into v_row;
  delete from public.sales_proforma_lines where proforma_id=p_id;
 end if;

 insert into public.sales_proforma_lines(id,proforma_id,product_id,sort_order,description,quantity,uom,unit_price_minor,discount_basis_points,tax_basis_points)
 select gen_random_uuid(),v_row.id,(line->>'productId')::uuid,ordinality,trim(line->>'description'),(line->>'quantity')::integer,trim(line->>'uom'),
        (line->>'unitPriceMinor')::bigint,(line->>'discountBasisPoints')::integer,(line->>'taxBasisPoints')::integer
 from jsonb_array_elements(p_lines) with ordinality as item(line,ordinality);

 select jsonb_build_object('documentNumber',v_row.document_number,'revision',v_row.revision,'organizationId',v_row.organization_id,'contactId',v_row.contact_id,
  'currency',v_row.currency,'validUntil',v_row.valid_until,'deliveryPeriod',v_row.delivery_period,'paymentTerms',v_row.payment_terms,'notes',v_row.notes,
  'commercialKind',v_row.commercial_kind,'contractId',v_row.contract_id,'installationRequired',v_row.installation_required,'installationChargeNotes',v_row.installation_charge_notes,
  'subtotalMinor',v_row.subtotal_minor,'discountMinor',v_row.discount_minor,'taxMinor',v_row.tax_minor,'totalMinor',v_row.total_minor,
  'lines',jsonb_agg(jsonb_build_object('productId',l.product_id,'description',l.description,'quantity',l.quantity,'uom',l.uom,'unitPriceMinor',l.unit_price_minor,'discountBasisPoints',l.discount_basis_points,'taxBasisPoints',l.tax_basis_points) order by l.sort_order))
 into v_snapshot from public.sales_proforma_lines l where l.proforma_id=v_row.id;
 insert into public.sales_proforma_revisions(id,proforma_id,revision,snapshot,created_by) values(gen_random_uuid(),v_row.id,v_row.revision,v_snapshot,auth.uid());
 if p_expected_version=0 then insert into public.sales_proforma_events(id,proforma_id,to_status,reference,actor_user_id) values(gen_random_uuid(),v_row.id,'draft','Created',auth.uid()); end if;
 return v_row;
end $function$;
revoke all on function public.save_sales_proforma(uuid,integer,uuid,uuid,text,date,text,text,text,jsonb,text,uuid,boolean,text,text) from public,anon;
grant execute on function public.save_sales_proforma(uuid,integer,uuid,uuid,text,date,text,text,text,jsonb,text,uuid,boolean,text,text) to authenticated;

create function public.guard_placement_proforma()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if new.commercial_kind<>'placement' then return new; end if;
 if new.status in ('sent','accepted') then
  perform 1 from public.customer_contracts c where c.id=new.contract_id and c.organization_id=new.organization_id and c.kind='placement'
   and c.status='approved' and c.starts_on<=current_date and (c.ends_on is null or c.ends_on>=current_date) for share;
  if not found then raise exception 'An approved placement contract effective today is required before sending this order'; end if;
 end if;
 -- The meeting did not resolve contract/delivery-note versus zero-value invoice treatment.
 -- Stop before any accounting or stock operation rather than silently choose either route.
 if new.status='accepted' and (tg_op='INSERT' or old.status<>'accepted') then
  raise exception 'Placement billing and stock-release route must be configured before submitting to accounting';
 end if;
 return new;
end $$;
revoke all on function public.guard_placement_proforma() from public,anon,authenticated;
create trigger sales_placement_contract_guard before insert or update on public.sales_proformas
 for each row execute function public.guard_placement_proforma();
commit;
