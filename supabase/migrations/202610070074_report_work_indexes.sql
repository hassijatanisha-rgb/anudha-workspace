-- Reports > Work reads the steps finished in the period (ordered by closed_at, id) and every open step (ordered by
-- id), 1,000 rows a request. With no index for either order every request scanned and sorted the whole table: on
-- 175,000 steps ~80 ms each, spilling the sort to disk, for 100+ requests per report. With these each request reads
-- its rows from the index (about 1-3 ms, measured on a local copy with that many steps). Indexes only: no data,
-- function or permission changes.
-- Rollback: drop index public.work_assignments_closed_at, public.work_assignments_open_id in a forward migration.
begin;
create index if not exists work_assignments_closed_at on public.work_assignments(closed_at,id) where closed_at is not null;
create index if not exists work_assignments_open_id on public.work_assignments(id) where status='open';
commit;
