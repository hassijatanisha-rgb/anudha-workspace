-- Additive review-only migration. No source balances or operational lots change.
-- Rollback: revoke RPC execute via a forward migration; preserve audit rows.
begin;
create table public.godown_mapping_reviews (
 id uuid primary key,
 source_godown text not null check(length(trim(source_godown)) between 1 and 500),
 version integer not null check(version>0),
 location_id uuid references public.inventory_locations(id),
 reason text not null check(length(trim(reason)) between 5 and 1000),
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(),
 unique(source_godown,version)
);
create trigger godown_mapping_immutable before update or delete on public.godown_mapping_reviews for each row execute function public.deny_product_classification_mutation();
alter table public.godown_mapping_reviews enable row level security;
revoke all on public.godown_mapping_reviews from public,anon,authenticated;
grant select on public.godown_mapping_reviews to authenticated;
create policy godown_mapping_read on public.godown_mapping_reviews for select to authenticated using(public.inventory_active_staff());
create function public.save_godown_mapping_review(p_id uuid,p_godown text,p_expected_version integer,p_location_id uuid,p_reason text)
returns public.godown_mapping_reviews language plpgsql security definer set search_path=public,pg_temp as $$
declare prior public.godown_mapping_reviews; v integer;
begin
 if not public.inventory_owner() then raise exception 'Owner access required'; end if;
 if p_id is null or p_expected_version is null or p_expected_version<0 then raise exception 'Request and expected version required'; end if;
 if p_godown is null or length(trim(p_godown)) not between 1 and 500 then raise exception 'Source godown required'; end if;
 if p_reason is null or length(trim(p_reason)) not between 5 and 1000 then raise exception 'Reason required'; end if;
 -- Serialize retries by request ID, then revisions by exact source label.
 perform pg_advisory_xact_lock(hashtextextended('godown-request:'||p_id::text,0));
 perform pg_advisory_xact_lock(hashtextextended('godown-source:'||p_godown,0));
 select * into prior from public.godown_mapping_reviews where id=p_id;
 if found then
  if prior.source_godown is distinct from p_godown or prior.location_id is distinct from p_location_id or prior.reason is distinct from trim(p_reason) or prior.created_by is distinct from auth.uid() or prior.version<>p_expected_version+1 then raise exception 'Request conflict'; end if;
  return prior;
 end if;
 if not exists(select 1 from public.tally_stock_sources where godown=p_godown) then raise exception 'Unknown source godown'; end if;
 if p_location_id is not null then
  perform 1 from public.inventory_locations where id=p_location_id and active for share;
  if not found then raise exception 'Choose an active location'; end if;
 end if;
 select coalesce(max(version),0) into v from public.godown_mapping_reviews where source_godown=p_godown;
 if v<>p_expected_version then raise exception 'Mapping changed; refresh and compare'; end if;
 insert into public.godown_mapping_reviews(id,source_godown,version,location_id,reason,created_by)
 values(p_id,p_godown,v+1,p_location_id,trim(p_reason),auth.uid()) returning * into prior;
 return prior;
end $$;
revoke all on function public.save_godown_mapping_review(uuid,text,integer,uuid,text) from public,anon;
grant execute on function public.save_godown_mapping_review(uuid,text,integer,uuid,text) to authenticated;
commit;
