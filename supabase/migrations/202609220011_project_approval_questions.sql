-- Project questions only; never seed answers on the owner's behalf.
begin;
insert into public.project_approval_questions(id,title,question) values
 ('free-installation','Free installation','When no installation fee is charged but our engineer must visit, should an installation case still be opened?'),
 ('inventory-source-review','Product identity review','Confirm which repeated or abbreviated reagent names represent the same sellable item and pack size. Until reviewed, preserve them separately without merging.')
on conflict(id) do nothing;
commit;
