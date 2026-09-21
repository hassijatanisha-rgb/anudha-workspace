begin;

delete from public.sales_delivery_lines line
using public.sales_delivery_notes note
where line.delivery_note_id=note.id
 and note.status in ('draft','ready')
 and line.inventory_issue_id is null;

update public.sales_delivery_notes
set status='accounts_approved',updated_at=now(),version=version+1
where status in ('draft','ready');

insert into public.sales_delivery_events(id,delivery_note_id,from_status,to_status,reference,actor_user_id)
select gen_random_uuid(),note.id,null,'accounts_approved','Migrated legacy delivery; Accounts approval must be verified and packing stock reselected',note.created_by
from public.sales_delivery_notes note
where note.status='accounts_approved'
 and not exists(
  select 1 from public.sales_delivery_events event
  where event.delivery_note_id=note.id and event.to_status='accounts_approved'
 );

commit;
