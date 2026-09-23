-- Requires accounting membership migration 015. Does not issue or post documents.
-- Forward rollback: revoke save RPC and hide UI; preserve draft history.
begin;
create table public.accounting_drafts (
 id uuid primary key,
 kind text not null check(kind in ('tax_invoice','delivery','purchase','payment','receipt','contra','credit_note')),
 version integer not null check(version>0),
 organization_id uuid references public.organizations(id),
 contact_id uuid references public.contacts(id),
 body jsonb not null check(jsonb_typeof(body)='object' and octet_length(body::text)<=200000),
 created_by uuid not null references auth.users(id),
 updated_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create table public.accounting_draft_history (
 draft_id uuid not null references public.accounting_drafts(id),version integer not null,
 organization_id uuid references public.organizations(id),contact_id uuid references public.contacts(id),
 body jsonb not null,actor_id uuid not null references auth.users(id),saved_at timestamptz not null default now(),
 primary key(draft_id,version)
);
create trigger accounting_draft_history_immutable before update or delete on public.accounting_draft_history for each row execute function public.deny_product_classification_mutation();
alter table public.accounting_drafts enable row level security;
alter table public.accounting_draft_history enable row level security;
revoke all on public.accounting_drafts,public.accounting_draft_history from public,anon,authenticated;
grant select on public.accounting_drafts,public.accounting_draft_history to authenticated;
create policy accounting_drafts_read on public.accounting_drafts for select to authenticated using(public.accounting_access());
create policy accounting_draft_history_read on public.accounting_draft_history for select to authenticated using(public.accounting_access());
create function public.save_accounting_draft(p_id uuid,p_kind text,p_expected_version integer,p_organization_id uuid,p_contact_id uuid,p_body jsonb)
returns public.accounting_drafts language plpgsql security definer set search_path=public,pg_temp as $$
declare old public.accounting_drafts; result public.accounting_drafts;
begin
 if public.accounting_access() is not true then raise exception 'Accounting access required';end if;
 if p_id is null or p_expected_version is null or p_expected_version<0 then raise exception 'Draft identity and version required';end if;
 if jsonb_typeof(p_body) is distinct from 'object' or octet_length(p_body::text)>200000 then raise exception 'Invalid or oversized draft';end if;
 if jsonb_typeof(p_body->'lines') is distinct from 'array' or jsonb_array_length(p_body->'lines')>100 then raise exception 'Draft needs a line list of at most 100 rows';end if;
 if p_contact_id is not null and not exists(select 1 from public.contacts where id=p_contact_id and organization_id=p_organization_id and deleted_at is null) then raise exception 'Choose a contact belonging to the selected customer';end if;
 if p_organization_id is not null and not exists(select 1 from public.organizations where id=p_organization_id and deleted_at is null) then raise exception 'Customer is unavailable';end if;
 -- Serializes both first save and competing revisions, without a table lock.
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,0));
 select * into old from public.accounting_drafts where id=p_id for update;
 if found then
  if old.version<>p_expected_version or old.kind<>p_kind then raise exception 'Draft changed; reopen and compare before saving';end if;
  update public.accounting_drafts set version=version+1,organization_id=p_organization_id,contact_id=p_contact_id,body=p_body,updated_by=auth.uid(),updated_at=now() where id=p_id returning * into result;
 else
  if p_expected_version<>0 then raise exception 'Draft not found; reopen the list';end if;
  insert into public.accounting_drafts(id,kind,version,organization_id,contact_id,body,created_by,updated_by) values(p_id,p_kind,1,p_organization_id,p_contact_id,p_body,auth.uid(),auth.uid()) returning * into result;
 end if;
 insert into public.accounting_draft_history(draft_id,version,organization_id,contact_id,body,actor_id) values(result.id,result.version,result.organization_id,result.contact_id,result.body,auth.uid());
 return result;
end $$;
revoke all on function public.save_accounting_draft(uuid,text,integer,uuid,uuid,jsonb) from public,anon;
grant execute on function public.save_accounting_draft(uuid,text,integer,uuid,uuid,jsonb) to authenticated;
commit;
