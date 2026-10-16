-- Faster pages (16 October 2026): clients, contacts and products record when they last changed, so a browser that
-- already holds the lists asks only for rows changed since its last visit instead of downloading all ~34,000 again.
-- The time is set by a trigger named to run after every other BEFORE UPDATE trigger on these tables (Postgres runs
-- them in name order): guard_archived_profile compares whole rows and must see the row before this column changes.
begin;

alter table public.organizations add column if not exists updated_at timestamptz not null default now();
alter table public.contacts add column if not exists updated_at timestamptz not null default now();
alter table public.products add column if not exists updated_at timestamptz not null default now();

create or replace function public.touch_updated_at() returns trigger language plpgsql set search_path=public,pg_temp as $$
begin new.updated_at:=now(); return new; end $$;

drop trigger if exists zz_touch_updated_at on public.organizations;
create trigger zz_touch_updated_at before update on public.organizations for each row execute function public.touch_updated_at();
drop trigger if exists zz_touch_updated_at on public.contacts;
create trigger zz_touch_updated_at before update on public.contacts for each row execute function public.touch_updated_at();
drop trigger if exists zz_touch_updated_at on public.products;
create trigger zz_touch_updated_at before update on public.products for each row execute function public.touch_updated_at();

create index if not exists organizations_updated_at on public.organizations(updated_at);
create index if not exists contacts_updated_at on public.contacts(updated_at);
create index if not exists products_updated_at on public.products(updated_at);

commit;
