-- Eight-second Undo for the owner's own draft deletion. Ordinary recycle-bin restore stays available.
-- Rollback: revoke undo_draft_proforma_archive in a forward migration; retain all archive history.
begin;

alter table public.sales_proforma_events
 add column archive_action text,
 add column archive_version integer,
 add column undo_expires_at timestamptz,
 add column undoes_event_id uuid references public.sales_proforma_events(id),
 add constraint sales_proforma_events_archive_proof check (
  (archive_action is null and archive_version is null and undo_expires_at is null and undoes_event_id is null)
  or (archive_action is not null and archive_version is not null and archive_version>0
   and from_status is not distinct from 'draft' and to_status='draft'
   and ((archive_action='archive' and undo_expires_at is not null
     and undo_expires_at=created_at+interval '8 seconds' and undoes_event_id is null)
    or (archive_action='restore' and undo_expires_at is null and undoes_event_id is null)
    or (archive_action='undo_archive' and undo_expires_at is null and undoes_event_id is not null))));
create unique index sales_proforma_events_archive_version
 on public.sales_proforma_events(proforma_id,archive_version) where archive_version is not null;

create or replace function public.set_draft_proforma_archived(p_id uuid,p_expected_version integer,p_archived boolean)
returns public.sales_proformas language plpgsql security definer set search_path=public,pg_temp as $$
declare v_row public.sales_proformas; v_actor uuid:=auth.uid(); v_now timestamptz;
begin
 if v_actor is null or public.inventory_owner() is not true then raise exception 'Active owner access and verified sign-in are required' using errcode='42501'; end if;
 perform 1 from public.staff where user_id=v_actor and active and role='owner' for share;
 if not found or public.inventory_owner() is not true then raise exception 'Active owner access and verified sign-in are required' using errcode='42501'; end if;
 if p_id is null or p_expected_version is null or p_expected_version<1 then raise exception 'Pro forma and positive expected version are required'; end if;
 if p_archived is null then raise exception 'Choose archive or restore'; end if;
 select * into v_row from public.sales_proformas where id=p_id for update;
 if not found then raise exception 'Pro forma not found'; end if;
 if v_row.version<>p_expected_version then raise exception 'Pro forma changed; refresh before continuing'; end if;
 if v_row.status<>'draft' then raise exception 'Only a draft Pro forma can be archived or restored'; end if;
 if exists(select 1 from public.sales_delivery_notes where proforma_id=p_id) then raise exception 'A delivery-linked Pro forma cannot be archived or restored'; end if;
 -- Preserve the existing same-state no-op, without creating proof or renewing a deadline.
 if (v_row.deleted_at is not null)=p_archived then return v_row; end if;
 if v_row.version=2147483647 then raise exception 'Pro forma version exhausted'; end if;
 v_now:=clock_timestamp();
 update public.sales_proformas set deleted_at=case when p_archived then v_now end,
  deleted_by=case when p_archived then v_actor end,version=version+1,updated_at=v_now
 where id=p_id returning * into v_row;
 insert into public.sales_proforma_events(id,proforma_id,from_status,to_status,reference,actor_user_id,created_at,archive_action,archive_version,undo_expires_at)
 values(gen_random_uuid(),p_id,'draft','draft',case when p_archived then 'Moved to Deleted Items' else 'Restored from Deleted Items' end,
  v_actor,v_now,case when p_archived then 'archive' else 'restore' end,v_row.version,case when p_archived then v_now+interval '8 seconds' end);
 return v_row;
end $$;

create function public.undo_draft_proforma_archive(p_id uuid,p_expected_version integer)
returns public.sales_proformas language plpgsql security definer set search_path=public,pg_temp as $$
declare v_row public.sales_proformas; v_archive public.sales_proforma_events; v_actor uuid:=auth.uid(); v_now timestamptz;
begin
 if v_actor is null or public.inventory_owner() is not true then raise exception 'Active owner access and verified sign-in are required' using errcode='42501'; end if;
 perform 1 from public.staff where user_id=v_actor and active and role='owner' for share;
 if not found or public.inventory_owner() is not true then raise exception 'Active owner access and verified sign-in are required' using errcode='42501'; end if;
 if p_id is null or p_expected_version is null or p_expected_version<2 then raise exception 'Deleted draft and its version are required'; end if;
 select * into v_row from public.sales_proformas where id=p_id for update;
 if not found then raise exception 'Pro forma not found'; end if;
 select * into v_archive from public.sales_proforma_events where proforma_id=p_id and archive_version=p_expected_version
  and archive_action='archive' and actor_user_id=v_actor;
 if not found then raise exception 'Only your recorded draft deletion can be undone' using errcode='42501'; end if;
 if v_row.status<>'draft' then raise exception 'Only a draft Pro forma can be restored'; end if;
 if exists(select 1 from public.sales_delivery_notes where proforma_id=p_id) then raise exception 'A delivery-linked Pro forma cannot be restored'; end if;
 -- A lost successful response can be retried after expiry only while its exact inverse is still current.
 if v_row.version::bigint=p_expected_version::bigint+1 and v_row.deleted_at is null and v_row.deleted_by is null
  and exists(select 1 from public.sales_proforma_events e where e.proforma_id=p_id and e.archive_version=v_row.version
   and e.archive_action='undo_archive' and e.undoes_event_id=v_archive.id and e.actor_user_id=v_actor
   and e.created_at=v_row.updated_at and e.created_at>=v_archive.created_at and e.created_at<v_archive.undo_expires_at)
  then return v_row; end if;
 if v_row.version<>p_expected_version then raise exception 'Pro forma changed; refresh before continuing'; end if;
 if v_row.deleted_by is distinct from v_actor or v_row.deleted_at is distinct from v_archive.created_at
  or v_row.updated_at is distinct from v_archive.created_at
  or v_archive.undo_expires_at is distinct from v_archive.created_at+interval '8 seconds' then raise exception 'This draft deletion is no longer current'; end if;
 v_now:=clock_timestamp();
 if v_now>=v_archive.undo_expires_at or v_now<v_archive.created_at then raise exception 'The eight-second Undo period has ended'; end if;
 if v_row.version=2147483647 then raise exception 'Pro forma version exhausted'; end if;
 update public.sales_proformas set deleted_at=null,deleted_by=null,version=version+1,updated_at=v_now
 where id=p_id returning * into v_row;
 insert into public.sales_proforma_events(id,proforma_id,from_status,to_status,reference,actor_user_id,created_at,archive_action,archive_version,undoes_event_id)
 values(gen_random_uuid(),p_id,'draft','draft','Undid deletion',v_actor,v_now,'undo_archive',v_row.version,v_archive.id);
 return v_row;
end $$;

revoke all on function public.set_draft_proforma_archived(uuid,integer,boolean),public.undo_draft_proforma_archive(uuid,integer) from public,anon;
grant execute on function public.set_draft_proforma_archived(uuid,integer,boolean),public.undo_draft_proforma_archive(uuid,integer) to authenticated;
commit;
