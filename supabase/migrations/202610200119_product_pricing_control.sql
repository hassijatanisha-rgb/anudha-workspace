-- Central sale prices and the agreed 10% department-head discount limit.
-- No prices are inferred from historical quotes. Configure each product/currency before quoting it.
-- Rollback: disable the price guard in a forward migration; preserve price history.
begin;

create table if not exists public.product_sale_prices(
 product_id uuid not null references public.products(id),
 currency text not null check(currency in ('TZS','USD','EUR')),
 unit_price_minor bigint not null check(unit_price_minor between 0 and 9000000000000000),
 version integer not null check(version>0),
 updated_by uuid not null references auth.users(id),
 updated_at timestamptz not null default now(),
 primary key(product_id,currency)
);
create table if not exists public.product_sale_price_events(
 id uuid primary key,
 product_id uuid not null references public.products(id),
 currency text not null check(currency in ('TZS','USD','EUR')),
 old_unit_price_minor bigint,
 unit_price_minor bigint not null check(unit_price_minor between 0 and 9000000000000000),
 version integer not null check(version>0),
 reason text not null check(length(trim(reason)) between 2 and 1000),
 actor_user_id uuid not null references auth.users(id),
 created_at timestamptz not null default now(),
 unique(product_id,currency,version)
);
create or replace function public.deny_product_price_history_mutation() returns trigger
language plpgsql set search_path=public,pg_temp as $$begin raise exception 'Product price history is permanent'; end $$;
revoke all on function public.deny_product_price_history_mutation() from public,anon,authenticated;
drop trigger if exists product_sale_price_events_immutable on public.product_sale_price_events;
create trigger product_sale_price_events_immutable before update or delete on public.product_sale_price_events
 for each row execute function public.deny_product_price_history_mutation();
drop trigger if exists product_sale_price_events_no_truncate on public.product_sale_price_events;
create trigger product_sale_price_events_no_truncate before truncate on public.product_sale_price_events
 for each statement execute function public.deny_product_price_history_mutation();

alter table public.product_sale_prices enable row level security;
alter table public.product_sale_price_events enable row level security;
revoke all on public.product_sale_prices,public.product_sale_price_events from public,anon,authenticated;
grant select on public.product_sale_prices,public.product_sale_price_events to authenticated;
drop policy if exists product_sale_prices_read on public.product_sale_prices;
create policy product_sale_prices_read on public.product_sale_prices for select to authenticated using
 ((select public.inventory_active_staff()) and ((select public.inventory_owner()) or (select public.accounting_access()) or (select public.has_access('proformas'))));
drop policy if exists product_sale_price_events_read on public.product_sale_price_events;
create policy product_sale_price_events_read on public.product_sale_price_events for select to authenticated using
 ((select public.inventory_active_staff()) and ((select public.inventory_owner()) or (select public.accounting_access()) or (select public.has_access('proformas'))));

create or replace function public.set_product_sale_price(p_request_id uuid,p_product_id uuid,p_currency text,p_expected_version integer,p_unit_price_minor bigint,p_reason text)
returns public.product_sale_prices language plpgsql security definer set search_path=public,pg_temp as $$
declare v_row public.product_sale_prices; v_event public.product_sale_price_events; v_old bigint; v_reason text:=trim(coalesce(p_reason,''));
begin
 if auth.uid() is null or public.inventory_active_staff() is not true or not (public.inventory_owner() or public.accounting_access()) then
  raise exception 'Only the owner or approved accounting users can set product prices' using errcode='42501';
 end if;
 if p_request_id is null or p_product_id is null or p_expected_version is null or p_expected_version<0 then raise exception 'Price request, product and version are required'; end if;
 if coalesce(p_currency,'') not in ('TZS','USD','EUR') then raise exception 'Choose TZS, USD or EUR'; end if;
 if p_unit_price_minor is null or p_unit_price_minor not between 0 and 9000000000000000 then raise exception 'Enter a valid configured price, including explicit zero if applicable'; end if;
 if length(v_reason) not between 2 and 1000 then raise exception 'Write the reason for this price (2 to 1000 characters)'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_product_id::text||':'||p_currency,0));
 select * into v_event from public.product_sale_price_events where id=p_request_id;
 if found then
  if v_event.product_id=p_product_id and v_event.currency=p_currency and v_event.version=p_expected_version+1
    and v_event.unit_price_minor=p_unit_price_minor and v_event.reason=v_reason and v_event.actor_user_id=auth.uid() then
   return (v_event.product_id,v_event.currency,v_event.unit_price_minor,v_event.version,v_event.actor_user_id,v_event.created_at)::public.product_sale_prices;
  end if;
  raise exception 'This price request was already recorded differently';
 end if;
 if not exists(select 1 from public.products where id=p_product_id and deleted_at is null) then raise exception 'Choose an active product'; end if;
 select * into v_row from public.product_sale_prices where product_id=p_product_id and currency=p_currency for update;
 if found then
  if v_row.version<>p_expected_version then raise exception 'Product price changed; refresh before saving'; end if;
  v_old:=v_row.unit_price_minor;
  update public.product_sale_prices set unit_price_minor=p_unit_price_minor,version=version+1,updated_by=auth.uid(),updated_at=now()
   where product_id=p_product_id and currency=p_currency returning * into v_row;
 else
  if p_expected_version<>0 then raise exception 'Product price changed; refresh before saving'; end if;
  insert into public.product_sale_prices(product_id,currency,unit_price_minor,version,updated_by)
   values(p_product_id,p_currency,p_unit_price_minor,1,auth.uid()) returning * into v_row;
 end if;
 insert into public.product_sale_price_events(id,product_id,currency,old_unit_price_minor,unit_price_minor,version,reason,actor_user_id,created_at)
 values(p_request_id,p_product_id,p_currency,v_old,v_row.unit_price_minor,v_row.version,v_reason,auth.uid(),v_row.updated_at);
 return v_row;
end $$;
revoke all on function public.set_product_sale_price(uuid,uuid,text,integer,bigint,text) from public,anon;
grant execute on function public.set_product_sale_price(uuid,uuid,text,integer,bigint,text) to authenticated;

create or replace function public.enforce_product_sale_price() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_currency text; v_kind text; v_price bigint;
begin
 select currency,commercial_kind into v_currency,v_kind from public.sales_proformas where id=new.proforma_id;
 if not found then raise exception 'Pro forma unavailable'; end if;
 -- Migration 117 restricts placement documents to machines and captures their commercial terms.
 if v_kind='placement' and new.unit_price_minor=0 then return new; end if;
 select unit_price_minor into v_price from public.product_sale_prices where product_id=new.product_id and currency=v_currency for share;
 if not found then raise exception 'No configured % price for this product. Ask the owner or accounting to set its price.',v_currency; end if;
 if new.unit_price_minor is distinct from v_price then raise exception 'Use the configured % product price. Refresh the quote; use a discount for a price reduction.',v_currency; end if;
 return new;
end $$;
revoke all on function public.enforce_product_sale_price() from public,anon,authenticated;
drop trigger if exists sales_proforma_lines_central_price on public.sales_proforma_lines;
create trigger sales_proforma_lines_central_price before insert or update on public.sales_proforma_lines
 for each row execute function public.enforce_product_sale_price();

update public.discount_policy set head_limit_basis_points=1000,version=version+1,updated_at=now()
 where id and head_limit_basis_points is distinct from 1000;
commit;
