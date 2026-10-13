-- Discount approval (owner decision, 12 October 2026).
-- Any discount on a Pro forma must be approved before the Pro forma is sent. A department head may approve when the
-- largest line discount is within the owner-set limit; above it, or while no limit is set, an owner (MD) approves.
-- Nobody approves their own Pro forma. A decision binds to the exact revision: saving the draft creates a new
-- revision, which needs a new decision. Decisions are append-only.
begin;

create table if not exists public.discount_policy(
 id boolean primary key default true check(id),
 head_limit_basis_points integer check(head_limit_basis_points between 1 and 10000),
 version integer not null default 1 check(version>0),
 updated_by uuid,
 updated_at timestamptz not null default now()
);
insert into public.discount_policy(id) values(true) on conflict(id) do nothing;

create table if not exists public.sales_proforma_discount_decisions(
 id uuid primary key,
 proforma_id uuid not null references public.sales_proformas(id),
 revision integer not null check(revision>0),
 max_discount_basis_points integer not null check(max_discount_basis_points between 1 and 10000),
 discount_minor bigint not null check(discount_minor>=0),
 required_level text not null check(required_level in ('head','owner')),
 decision text not null check(decision in ('approved','rejected')),
 reason text not null check(length(trim(reason)) between 2 and 1000),
 decided_by uuid not null,
 decided_at timestamptz not null default now()
);
create index if not exists sales_proforma_discount_decisions_revision
 on public.sales_proforma_discount_decisions(proforma_id,revision,decided_at desc);

create or replace function public.deny_discount_decision_mutation() returns trigger language plpgsql set search_path to 'public','pg_temp' as $$
begin raise exception 'Discount decisions are permanent history'; end $$;
drop trigger if exists discount_decisions_append_only on public.sales_proforma_discount_decisions;
create trigger discount_decisions_append_only before update or delete on public.sales_proforma_discount_decisions
 for each row execute function public.deny_discount_decision_mutation();

alter table public.discount_policy enable row level security;
alter table public.sales_proforma_discount_decisions enable row level security;
revoke all on public.discount_policy, public.sales_proforma_discount_decisions from public, anon, authenticated;
grant select on public.discount_policy, public.sales_proforma_discount_decisions to authenticated;
drop policy if exists discount_policy_read on public.discount_policy;
create policy discount_policy_read on public.discount_policy for select to authenticated using ((select public.has_access('proformas')));
drop policy if exists discount_decisions_read on public.sales_proforma_discount_decisions;
create policy discount_decisions_read on public.sales_proforma_discount_decisions for select to authenticated using ((select public.has_access('proformas')));

-- Which approval the Pro forma's current revision needs: none, head or owner.
create or replace function public.proforma_discount_requirement(p_id uuid)
returns table(revision integer, max_discount_basis_points integer, discount_minor bigint, required_level text)
language sql stable security definer set search_path to 'public','pg_temp' as $$
 select p.revision, coalesce(max(l.discount_basis_points),0)::integer, p.discount_minor,
  case when coalesce(max(l.discount_basis_points),0)=0 then 'none'
       when max(l.discount_basis_points)<=(select head_limit_basis_points from public.discount_policy where id) then 'head'
       else 'owner' end
 from public.sales_proformas p left join public.sales_proforma_lines l on l.proforma_id=p.id
 where p.id=p_id group by p.id, p.revision, p.discount_minor
$$;
revoke all on function public.proforma_discount_requirement(uuid) from public, anon, authenticated;

create or replace function public.decide_proforma_discount(p_decision_id uuid, p_proforma_id uuid, p_expected_version integer, p_decision text, p_reason text)
returns public.sales_proforma_discount_decisions
language plpgsql security definer set search_path to 'public','pg_temp' as $$
declare v_row public.sales_proformas; v_need record; v_result public.sales_proforma_discount_decisions; v_reason text:=trim(coalesce(p_reason,''));
begin
 perform public.require_access('proformas');
 if not public.inventory_active_staff() then raise exception 'Active staff access is required'; end if;
 if p_decision_id is null or p_proforma_id is null or p_expected_version is null then raise exception 'Decision, Pro forma and version are required'; end if;
 if p_decision not in ('approved','rejected') then raise exception 'Choose approve or reject'; end if;
 if length(v_reason) not between 2 and 1000 then raise exception 'Write the reason for this decision'; end if;
 select * into v_result from public.sales_proforma_discount_decisions where id=p_decision_id;
 if found then
  if v_result.proforma_id=p_proforma_id and v_result.decision=p_decision and v_result.reason=v_reason and v_result.decided_by=auth.uid() then return v_result; end if;
  raise exception 'This decision was already recorded differently; refresh';
 end if;
 select * into v_row from public.sales_proformas where id=p_proforma_id and version=p_expected_version for update;
 if not found then raise exception 'Pro forma changed; refresh before deciding'; end if;
 if v_row.status<>'draft' then raise exception 'Only a draft Pro forma discount can be decided'; end if;
 select * into v_need from public.proforma_discount_requirement(v_row.id);
 if v_need.required_level='none' then raise exception 'This Pro forma has no discount to approve'; end if;
 if v_row.prepared_by=auth.uid() then raise exception 'You cannot decide the discount on your own Pro forma. Ask your department head or the owner.'; end if;
 if v_need.required_level='owner' and not public.inventory_owner() then
  raise exception 'This discount is above the department head limit. Only the owner (MD) can decide it.';
 end if;
 if v_need.required_level='head' and not (public.inventory_owner() or public.is_department_head()) then
  raise exception 'Only a department head or the owner can decide discounts.';
 end if;
 insert into public.sales_proforma_discount_decisions(id,proforma_id,revision,max_discount_basis_points,discount_minor,required_level,decision,reason,decided_by)
 values(p_decision_id,v_row.id,v_need.revision,v_need.max_discount_basis_points,v_need.discount_minor,v_need.required_level,p_decision,v_reason,auth.uid())
 returning * into v_result;
 return v_result;
end $$;
revoke all on function public.decide_proforma_discount(uuid,uuid,integer,text,text) from public, anon;
grant execute on function public.decide_proforma_discount(uuid,uuid,integer,text,text) to authenticated;

create or replace function public.set_discount_policy(p_expected_version integer, p_head_limit_basis_points integer)
returns public.discount_policy
language plpgsql security definer set search_path to 'public','pg_temp' as $$
declare v_row public.discount_policy;
begin
 if not public.inventory_owner() then raise exception 'Only the owner (MD) can set the discount limit'; end if;
 if p_head_limit_basis_points is not null and p_head_limit_basis_points not between 1 and 10000 then
  raise exception 'Set a limit between 0.01%% and 100%%, or clear it so every discount needs the owner';
 end if;
 update public.discount_policy set head_limit_basis_points=p_head_limit_basis_points,version=version+1,updated_by=auth.uid(),updated_at=now()
 where id and version=p_expected_version returning * into v_row;
 if not found then raise exception 'Discount limit changed; refresh'; end if;
 return v_row;
end $$;
revoke all on function public.set_discount_policy(integer,integer) from public, anon;
grant execute on function public.set_discount_policy(integer,integer) to authenticated;

-- Same transitions as before; sending now requires an approved discount decision for the current revision.
create or replace function public.advance_sales_proforma(p_id uuid, p_expected_version integer, p_action text, p_reference text DEFAULT ''::text)
 RETURNS sales_proformas
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_row public.sales_proformas; v_from text; v_to text; v_reference text:=trim(coalesce(p_reference,'')); v_need record; v_last public.sales_proforma_discount_decisions;
begin
 perform public.require_access('proformas');
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
 -- discount_approval_079
 if p_action='send' then
  select * into v_need from public.proforma_discount_requirement(v_row.id);
  if v_need.required_level<>'none' then
   select * into v_last from public.sales_proforma_discount_decisions
    where proforma_id=v_row.id and revision=v_need.revision order by decided_at desc, id desc limit 1;
   if not found then raise exception 'This Pro forma has a discount. Ask your department head or the owner to approve it before sending.'; end if;
   if v_last.decision<>'approved' then raise exception 'The discount on this revision was rejected. Change the discount or ask again for approval.'; end if;
   if v_need.required_level='owner' and v_last.required_level<>'owner' then
    raise exception 'The discount limit changed; this discount now needs the owner (MD) to approve it.';
   end if;
  end if;
 end if;
 update public.sales_proformas set status=v_to,version=version+1,updated_at=now(),
  acceptance_reference=case when v_to='accepted' then v_reference else acceptance_reference end,
  accepted_by=case when v_to='accepted' then auth.uid() else accepted_by end,
  accepted_at=case when v_to='accepted' then now() else accepted_at end
 where id=v_row.id returning * into v_row;
 insert into public.sales_proforma_events(id,proforma_id,from_status,to_status,reference,actor_user_id) values(gen_random_uuid(),v_row.id,v_from,v_to,v_reference,auth.uid());
 return v_row;
end $function$;

commit;
