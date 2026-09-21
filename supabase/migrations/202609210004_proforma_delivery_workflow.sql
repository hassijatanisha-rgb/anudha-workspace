begin;

create sequence public.proforma_document_number_seq start 1;
create sequence public.delivery_note_number_seq start 1;

create table public.sales_proformas (
 id uuid primary key,
 document_number text not null unique,
 organization_id uuid not null references public.organizations(id),
 contact_id uuid not null references public.contacts(id),
 status text not null default 'draft' check (status in ('draft','sent','accepted','rejected','cancelled')),
 currency text not null default 'TZS' check (currency in ('TZS','USD','EUR')),
 valid_until date not null,
 delivery_period text not null check (length(trim(delivery_period)) between 2 and 300),
 payment_terms text not null check (length(trim(payment_terms)) between 2 and 1000),
 notes text not null default '' check (length(notes) <= 4000),
 subtotal_minor bigint not null default 0 check (subtotal_minor >= 0),
 discount_minor bigint not null default 0 check (discount_minor >= 0),
 tax_minor bigint not null default 0 check (tax_minor >= 0),
 total_minor bigint not null default 0 check (total_minor = subtotal_minor - discount_minor + tax_minor),
 revision integer not null default 1 check (revision > 0),
 version integer not null default 1 check (version > 0),
 acceptance_reference text,
 prepared_by uuid not null references auth.users(id),
 accepted_by uuid references auth.users(id),
 accepted_at timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 check ((status='accepted') = (accepted_at is not null and accepted_by is not null and acceptance_reference is not null))
);

create table public.sales_proforma_lines (
 id uuid primary key,
 proforma_id uuid not null references public.sales_proformas(id),
 product_id uuid not null references public.products(id),
 sort_order integer not null check (sort_order between 1 and 100),
 description text not null check (length(trim(description)) between 1 and 4000),
 quantity integer not null check (quantity between 1 and 1000000),
 uom text not null check (length(trim(uom)) between 1 and 40),
 unit_price_minor bigint not null check (unit_price_minor >= 0),
 discount_basis_points integer not null default 0 check (discount_basis_points between 0 and 10000),
 tax_basis_points integer not null default 0 check (tax_basis_points between 0 and 10000),
 unique(proforma_id,sort_order)
);

create table public.sales_proforma_revisions (
 id uuid primary key,
 proforma_id uuid not null references public.sales_proformas(id),
 revision integer not null check (revision > 0),
 snapshot jsonb not null,
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(),
 unique(proforma_id,revision)
);

create table public.sales_proforma_events (
 id uuid primary key,
 proforma_id uuid not null references public.sales_proformas(id),
 from_status text,
 to_status text not null,
 reference text not null default '',
 actor_user_id uuid not null references auth.users(id),
 created_at timestamptz not null default now()
);

create table public.sales_delivery_notes (
 id uuid primary key,
 delivery_number text not null unique,
 proforma_id uuid not null references public.sales_proformas(id),
 organization_id uuid not null references public.organizations(id),
 contact_id uuid not null references public.contacts(id),
 status text not null default 'draft' check (status in ('draft','ready','out_for_delivery','delivered','cancelled')),
 accounts_reference text not null check (length(trim(accounts_reference)) between 2 and 120),
 expected_delivery_date date not null,
 carrier text,
 tracking_reference text,
 recipient_name text,
 proof_reference text,
 version integer not null default 1 check (version > 0),
 created_by uuid not null references auth.users(id),
 dispatched_by uuid references auth.users(id),
 delivered_by uuid references auth.users(id),
 dispatched_at timestamptz,
 delivered_at timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 check ((status in ('out_for_delivery','delivered')) = (dispatched_at is not null and dispatched_by is not null)),
 check ((status='delivered') = (delivered_at is not null and delivered_by is not null and recipient_name is not null and proof_reference is not null))
);

create table public.sales_delivery_lines (
 id uuid primary key,
 delivery_note_id uuid not null references public.sales_delivery_notes(id),
 proforma_line_id uuid not null references public.sales_proforma_lines(id),
 product_id uuid not null references public.products(id),
 lot_id uuid not null references public.inventory_lots(id),
 quantity integer not null check (quantity between 1 and 1000000),
 inventory_issue_id uuid unique references public.inventory_issues(id),
 unique(delivery_note_id,proforma_line_id,lot_id)
);

create table public.sales_delivery_events (
 id uuid primary key,
 delivery_note_id uuid not null references public.sales_delivery_notes(id),
 from_status text,
 to_status text not null,
 reference text not null default '',
 actor_user_id uuid not null references auth.users(id),
 created_at timestamptz not null default now()
);

alter table public.inventory_issues add column delivery_note_id uuid references public.sales_delivery_notes(id);
alter table public.inventory_issues add column delivery_line_id uuid unique references public.sales_delivery_lines(id);

create index sales_proformas_organization_created on public.sales_proformas(organization_id,created_at desc);
create index sales_proformas_status_created on public.sales_proformas(status,created_at desc);
create index sales_delivery_notes_status_created on public.sales_delivery_notes(status,created_at desc);
create index sales_delivery_lines_proforma_line on public.sales_delivery_lines(proforma_line_id);

create or replace function public.deny_sales_history_mutation()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
 raise exception 'Sales history is immutable';
end $$;
create trigger sales_proforma_revisions_immutable before update or delete on public.sales_proforma_revisions for each row execute function public.deny_sales_history_mutation();
create trigger sales_proforma_events_immutable before update or delete on public.sales_proforma_events for each row execute function public.deny_sales_history_mutation();
create trigger sales_delivery_events_immutable before update or delete on public.sales_delivery_events for each row execute function public.deny_sales_history_mutation();

create or replace function public.save_sales_proforma(
 p_id uuid,p_expected_version integer,p_organization_id uuid,p_contact_id uuid,p_currency text,
 p_valid_until date,p_delivery_period text,p_payment_terms text,p_notes text,p_lines jsonb
)
returns public.sales_proformas language plpgsql security definer set search_path=public,pg_temp as $$
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
begin
 if not public.inventory_active_staff() then raise exception 'Active staff access is required'; end if;
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
  insert into public.sales_proformas(id,document_number,organization_id,contact_id,currency,valid_until,delivery_period,payment_terms,notes,subtotal_minor,discount_minor,tax_minor,total_minor,prepared_by)
  values(p_id,v_number,p_organization_id,p_contact_id,p_currency,p_valid_until,trim(p_delivery_period),trim(p_payment_terms),trim(coalesce(p_notes,'')),v_subtotal,v_discount,v_tax,v_subtotal-v_discount+v_tax,auth.uid()) returning * into v_row;
 else
  select * into v_existing from public.sales_proformas where id=p_id for update;
  if not found then raise exception 'Pro forma invoice not found'; end if;
  if v_existing.version<>p_expected_version then raise exception 'Pro forma changed; refresh before saving'; end if;
  if v_existing.status<>'draft' then raise exception 'Only a draft can be revised'; end if;
  update public.sales_proformas set organization_id=p_organization_id,contact_id=p_contact_id,currency=p_currency,valid_until=p_valid_until,
   delivery_period=trim(p_delivery_period),payment_terms=trim(p_payment_terms),notes=trim(coalesce(p_notes,'')),subtotal_minor=v_subtotal,
   discount_minor=v_discount,tax_minor=v_tax,total_minor=v_subtotal-v_discount+v_tax,revision=revision+1,version=version+1,updated_at=now()
  where id=p_id returning * into v_row;
  delete from public.sales_proforma_lines where proforma_id=p_id;
 end if;

 insert into public.sales_proforma_lines(id,proforma_id,product_id,sort_order,description,quantity,uom,unit_price_minor,discount_basis_points,tax_basis_points)
 select gen_random_uuid(),v_row.id,(line->>'productId')::uuid,ordinality,trim(line->>'description'),(line->>'quantity')::integer,trim(line->>'uom'),
        (line->>'unitPriceMinor')::bigint,(line->>'discountBasisPoints')::integer,(line->>'taxBasisPoints')::integer
 from jsonb_array_elements(p_lines) with ordinality as item(line,ordinality);

 select jsonb_build_object('documentNumber',v_row.document_number,'revision',v_row.revision,'organizationId',v_row.organization_id,'contactId',v_row.contact_id,
  'currency',v_row.currency,'validUntil',v_row.valid_until,'deliveryPeriod',v_row.delivery_period,'paymentTerms',v_row.payment_terms,'notes',v_row.notes,
  'subtotalMinor',v_row.subtotal_minor,'discountMinor',v_row.discount_minor,'taxMinor',v_row.tax_minor,'totalMinor',v_row.total_minor,
  'lines',jsonb_agg(jsonb_build_object('productId',l.product_id,'description',l.description,'quantity',l.quantity,'uom',l.uom,'unitPriceMinor',l.unit_price_minor,'discountBasisPoints',l.discount_basis_points,'taxBasisPoints',l.tax_basis_points) order by l.sort_order))
 into v_snapshot from public.sales_proforma_lines l where l.proforma_id=v_row.id;
 insert into public.sales_proforma_revisions(id,proforma_id,revision,snapshot,created_by) values(gen_random_uuid(),v_row.id,v_row.revision,v_snapshot,auth.uid());
 if p_expected_version=0 then insert into public.sales_proforma_events(id,proforma_id,to_status,reference,actor_user_id) values(gen_random_uuid(),v_row.id,'draft','Created',auth.uid()); end if;
 return v_row;
end $$;

create or replace function public.advance_sales_proforma(p_id uuid,p_expected_version integer,p_action text,p_reference text default '')
returns public.sales_proformas language plpgsql security definer set search_path=public,pg_temp as $$
declare v_row public.sales_proformas; v_from text; v_to text; v_reference text:=trim(coalesce(p_reference,''));
begin
 if not public.inventory_active_staff() then raise exception 'Active staff access is required'; end if;
 select * into v_row from public.sales_proformas where id=p_id and version=p_expected_version for update;
 if not found then raise exception 'Pro forma changed; refresh before continuing'; end if;
 v_from:=v_row.status;
 if p_action='send' and v_from='draft' then v_to:='sent';
 elsif p_action='revise' and v_from='sent' then v_to:='draft';
 elsif p_action='accept' and v_from='sent' then v_to:='accepted';
 elsif p_action='reject' and v_from='sent' then v_to:='rejected';
 elsif p_action='cancel' and v_from in ('draft','sent') then v_to:='cancelled';
 else raise exception 'This is not the next allowed Pro forma step'; end if;
 if p_action in ('revise','accept','reject','cancel') and length(v_reference)<2 then raise exception 'Enter the customer reference or reason'; end if;
 update public.sales_proformas set status=v_to,version=version+1,updated_at=now(),
  acceptance_reference=case when v_to='accepted' then v_reference else acceptance_reference end,
  accepted_by=case when v_to='accepted' then auth.uid() else accepted_by end,
  accepted_at=case when v_to='accepted' then now() else accepted_at end
 where id=v_row.id returning * into v_row;
 insert into public.sales_proforma_events(id,proforma_id,from_status,to_status,reference,actor_user_id) values(gen_random_uuid(),v_row.id,v_from,v_to,v_reference,auth.uid());
 return v_row;
end $$;

create or replace function public.create_sales_delivery_note(
 p_id uuid,p_proforma_id uuid,p_expected_proforma_version integer,p_accounts_reference text,p_expected_delivery_date date,p_lines jsonb
)
returns public.sales_delivery_notes language plpgsql security definer set search_path=public,pg_temp as $$
declare v_proforma public.sales_proformas; v_row public.sales_delivery_notes; v_number text; v_count integer;
begin
 if not public.inventory_active_staff() then raise exception 'Active staff access is required'; end if;
 if length(trim(coalesce(p_accounts_reference,''))) not between 2 and 120 then raise exception 'Enter the Accounts or tax-invoice clearance reference'; end if;
 if p_expected_delivery_date is null or p_expected_delivery_date<current_date then raise exception 'Expected delivery date cannot be in the past'; end if;
 if jsonb_typeof(p_lines)<>'array' or jsonb_array_length(p_lines) not between 1 and 100 then raise exception 'Choose at least one item to deliver'; end if;
 select * into v_proforma from public.sales_proformas where id=p_proforma_id and version=p_expected_proforma_version and status='accepted' for update;
 if not found then raise exception 'Accepted Pro forma changed; refresh before creating delivery'; end if;
 if exists(select 1 from jsonb_array_elements(p_lines) line where coalesce((line->>'quantity')::integer,0) not between 1 and 1000000) then raise exception 'Every delivery quantity must be a positive whole number'; end if;
 select count(*) into v_count from jsonb_array_elements(p_lines) line
 join public.sales_proforma_lines pl on pl.id=(line->>'proformaLineId')::uuid and pl.proforma_id=v_proforma.id
 join public.inventory_lots lot on lot.id=(line->>'lotId')::uuid and lot.product_id=pl.product_id and lot.stock_status='available'
 join public.inventory_locations location on location.id=lot.location_id and location.active=true and location.is_dispatch_hub=true;
 if v_count<>jsonb_array_length(p_lines) then raise exception 'Every delivery item must use matching available stock at Haadi'; end if;
 if exists(
  select 1 from (
   select pl.id,pl.quantity,
    coalesce((select sum(dl.quantity) from public.sales_delivery_lines dl join public.sales_delivery_notes dn on dn.id=dl.delivery_note_id where dl.proforma_line_id=pl.id and dn.status<>'cancelled'),0)+
    coalesce((select sum((line->>'quantity')::integer) from jsonb_array_elements(p_lines) line where (line->>'proformaLineId')::uuid=pl.id),0) as allocated
   from public.sales_proforma_lines pl where pl.proforma_id=v_proforma.id
  ) totals where allocated>quantity
 ) then raise exception 'A delivery quantity exceeds the accepted Pro forma balance'; end if;
 v_number:='DN-'||to_char(current_date,'YYYY')||'-'||lpad(nextval('public.delivery_note_number_seq')::text,6,'0');
 insert into public.sales_delivery_notes(id,delivery_number,proforma_id,organization_id,contact_id,accounts_reference,expected_delivery_date,created_by)
 values(p_id,v_number,v_proforma.id,v_proforma.organization_id,v_proforma.contact_id,trim(p_accounts_reference),p_expected_delivery_date,auth.uid()) returning * into v_row;
 insert into public.sales_delivery_lines(id,delivery_note_id,proforma_line_id,product_id,lot_id,quantity)
 select gen_random_uuid(),v_row.id,pl.id,pl.product_id,(line->>'lotId')::uuid,(line->>'quantity')::integer
 from jsonb_array_elements(p_lines) line join public.sales_proforma_lines pl on pl.id=(line->>'proformaLineId')::uuid;
 insert into public.sales_delivery_events(id,delivery_note_id,to_status,reference,actor_user_id) values(gen_random_uuid(),v_row.id,'draft',v_row.accounts_reference,auth.uid());
 return v_row;
end $$;

create or replace function public.advance_sales_delivery(
 p_id uuid,p_expected_version integer,p_action text,p_carrier text default '',p_tracking_reference text default '',p_recipient_name text default '',p_proof_reference text default ''
)
returns public.sales_delivery_notes language plpgsql security definer set search_path=public,pg_temp as $$
declare v_row public.sales_delivery_notes; v_from text; v_to text; v_line record; v_lot public.inventory_lots; v_issue_id uuid; v_reference text;
begin
 if not public.inventory_active_staff() then raise exception 'Active staff access is required'; end if;
 select * into v_row from public.sales_delivery_notes where id=p_id and version=p_expected_version for update;
 if not found then raise exception 'Delivery changed; refresh before continuing'; end if;
 v_from:=v_row.status;
 if p_action='ready' and v_from='draft' then v_to:='ready';
 elsif p_action='dispatch' and v_from='ready' then v_to:='out_for_delivery';
 elsif p_action='deliver' and v_from='out_for_delivery' then v_to:='delivered';
 elsif p_action='cancel' and v_from in ('draft','ready') then v_to:='cancelled';
 else raise exception 'This is not the next allowed delivery step'; end if;
 if p_action='dispatch' and (length(trim(coalesce(p_carrier,'')))<2 or length(trim(coalesce(p_tracking_reference,'')))<2) then raise exception 'Enter the carrier and dispatch or tracking reference'; end if;
 if p_action='deliver' and (length(trim(coalesce(p_recipient_name,'')))<2 or length(trim(coalesce(p_proof_reference,'')))<2) then raise exception 'Enter the recipient and signed delivery-note proof reference'; end if;
 if p_action='cancel' and length(trim(coalesce(p_proof_reference,'')))<2 then raise exception 'Enter the cancellation reason'; end if;

 if p_action in ('ready','dispatch') then
  for v_line in select lot_id,product_id,sum(quantity)::integer as quantity from public.sales_delivery_lines where delivery_note_id=v_row.id group by lot_id,product_id order by lot_id loop
   select lot.* into v_lot from public.inventory_lots lot join public.inventory_locations location on location.id=lot.location_id
   where lot.id=v_line.lot_id and lot.product_id=v_line.product_id and lot.stock_status='available' and location.active=true and location.is_dispatch_hub=true for update of lot;
   if not found or v_lot.loose_units-v_lot.reserved_units<v_line.quantity then raise exception 'Haadi stock is no longer sufficient for this delivery'; end if;
  end loop;
 end if;
 if p_action='dispatch' then
  for v_line in select * from public.sales_delivery_lines where delivery_note_id=v_row.id order by lot_id,id loop
    select * into v_lot from public.inventory_lots where id=v_line.lot_id for update;
    update public.inventory_lots set loose_units=loose_units-v_line.quantity,version=version+1,updated_at=now() where id=v_lot.id;
    v_issue_id:=gen_random_uuid();
    insert into public.inventory_issues(id,lot_id,organization_id,product_id,quantity,issued_on,reference,reason,issued_by,delivery_note_id,delivery_line_id)
    values(v_issue_id,v_lot.id,v_row.organization_id,v_line.product_id,v_line.quantity,current_date,v_row.delivery_number,'Dispatched from accepted '||(select document_number from public.sales_proformas where id=v_row.proforma_id),auth.uid(),v_row.id,v_line.id);
    update public.sales_delivery_lines set inventory_issue_id=v_issue_id where id=v_line.id;
    insert into public.inventory_movements(id,lot_id,movement_type,loose_unit_change,base_unit_change,reason,actor_user_id)
    values(gen_random_uuid(),v_lot.id,'consumer_issue',-v_line.quantity,-v_line.quantity,'Delivery '||v_row.delivery_number||' · '||trim(p_tracking_reference),auth.uid());
  end loop;
 end if;
 v_reference:=case when p_action='dispatch' then trim(p_tracking_reference) when p_action='deliver' then trim(p_proof_reference) when p_action='cancel' then trim(p_proof_reference) else 'Packing and stock checked' end;
 update public.sales_delivery_notes set status=v_to,version=version+1,updated_at=now(),
  carrier=case when p_action='dispatch' then trim(p_carrier) else carrier end,
  tracking_reference=case when p_action='dispatch' then trim(p_tracking_reference) else tracking_reference end,
  dispatched_by=case when p_action='dispatch' then auth.uid() else dispatched_by end,
  dispatched_at=case when p_action='dispatch' then now() else dispatched_at end,
  recipient_name=case when p_action='deliver' then trim(p_recipient_name) else recipient_name end,
  proof_reference=case when p_action='deliver' then trim(p_proof_reference) else proof_reference end,
  delivered_by=case when p_action='deliver' then auth.uid() else delivered_by end,
  delivered_at=case when p_action='deliver' then now() else delivered_at end
 where id=v_row.id returning * into v_row;
 insert into public.sales_delivery_events(id,delivery_note_id,from_status,to_status,reference,actor_user_id) values(gen_random_uuid(),v_row.id,v_from,v_to,v_reference,auth.uid());
 return v_row;
end $$;

alter table public.sales_proformas enable row level security;
alter table public.sales_proforma_lines enable row level security;
alter table public.sales_proforma_revisions enable row level security;
alter table public.sales_proforma_events enable row level security;
alter table public.sales_delivery_notes enable row level security;
alter table public.sales_delivery_lines enable row level security;
alter table public.sales_delivery_events enable row level security;

create policy sales_proformas_read on public.sales_proformas for select to authenticated using (public.inventory_active_staff());
create policy sales_proforma_lines_read on public.sales_proforma_lines for select to authenticated using (public.inventory_active_staff());
create policy sales_proforma_revisions_read on public.sales_proforma_revisions for select to authenticated using (public.inventory_active_staff());
create policy sales_proforma_events_read on public.sales_proforma_events for select to authenticated using (public.inventory_active_staff());
create policy sales_delivery_notes_read on public.sales_delivery_notes for select to authenticated using (public.inventory_active_staff());
create policy sales_delivery_lines_read on public.sales_delivery_lines for select to authenticated using (public.inventory_active_staff());
create policy sales_delivery_events_read on public.sales_delivery_events for select to authenticated using (public.inventory_active_staff());

revoke all on public.sales_proformas,public.sales_proforma_lines,public.sales_proforma_revisions,public.sales_proforma_events,public.sales_delivery_notes,public.sales_delivery_lines,public.sales_delivery_events from anon;
grant select on public.sales_proformas,public.sales_proforma_lines,public.sales_proforma_revisions,public.sales_proforma_events,public.sales_delivery_notes,public.sales_delivery_lines,public.sales_delivery_events to authenticated;
revoke all on function public.save_sales_proforma(uuid,integer,uuid,uuid,text,date,text,text,text,jsonb),public.advance_sales_proforma(uuid,integer,text,text),public.create_sales_delivery_note(uuid,uuid,integer,text,date,jsonb),public.advance_sales_delivery(uuid,integer,text,text,text,text,text) from public,anon;
grant execute on function public.save_sales_proforma(uuid,integer,uuid,uuid,text,date,text,text,text,jsonb),public.advance_sales_proforma(uuid,integer,text,text),public.create_sales_delivery_note(uuid,uuid,integer,text,date,jsonb),public.advance_sales_delivery(uuid,integer,text,text,text,text,text) to authenticated;

commit;
