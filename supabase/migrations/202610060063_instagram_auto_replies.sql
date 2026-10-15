-- Instagram auto-replies: when someone comments on an Anudha post or reel, the instagram-auto-reply Edge Function
-- sends them one private message with the quote page and the WhatsApp link. This table records each reply so a
-- person gets at most one per post and staff can see what was sent. Only the service role writes; Leads staff read.
-- Rollback: drop the table in a forward migration.
begin;
create table public.instagram_auto_replies (
 comment_id text primary key check (length(comment_id) between 1 and 100),
 commenter_id text not null check (length(commenter_id) between 1 and 100),
 commenter_username text not null default '' check (length(commenter_username) <= 100),
 media_id text not null default '' check (length(media_id) <= 100),
 comment_text text not null default '' check (length(comment_text) <= 2200),
 status text not null check (status in ('sent','failed','skipped')),
 detail text not null default '' check (length(detail) <= 500),
 created_at timestamptz not null default now()
);
create index instagram_auto_replies_person on public.instagram_auto_replies(commenter_id, media_id);
create index instagram_auto_replies_time on public.instagram_auto_replies(created_at desc);
alter table public.instagram_auto_replies enable row level security;
create policy instagram_auto_replies_read on public.instagram_auto_replies for select to authenticated using ((select public.has_access('leads')));
revoke all on public.instagram_auto_replies from public, anon, authenticated;
grant select on public.instagram_auto_replies to authenticated;
grant select, insert on public.instagram_auto_replies to service_role;
commit;
