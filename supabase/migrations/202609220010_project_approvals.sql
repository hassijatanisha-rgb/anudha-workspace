-- Additive migration. Once decisions exist, do not drop these tables.
-- Rollback: hide the navigation entry; retain immutable history.
begin;
create table public.project_approval_questions (
 id text primary key,
 title text not null,
 question text not null,
 version integer not null default 1 check(version>0),
 created_at timestamptz not null default now()
);
create table public.project_approval_answers (
 id uuid primary key,
 question_id text not null references public.project_approval_questions(id),
 question_version integer not null,
 answer text not null check(length(trim(answer)) between 1 and 4000),
 answered_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(),
 unique(question_id,question_version)
);
alter table public.project_approval_questions enable row level security;
alter table public.project_approval_answers enable row level security;
create policy approval_question_read on public.project_approval_questions for select to authenticated using(exists(select 1 from public.staff where user_id=auth.uid() and active and role='owner'));
create policy approval_answer_read on public.project_approval_answers for select to authenticated using(exists(select 1 from public.staff where user_id=auth.uid() and active and role='owner'));
revoke all on public.project_approval_questions,public.project_approval_answers from anon,authenticated;
grant select on public.project_approval_questions,public.project_approval_answers to authenticated;
create function public.record_project_approval(p_id uuid,p_question_id text,p_version integer,p_answer text) returns public.project_approval_answers
language plpgsql security definer set search_path=public,pg_temp as $$
declare q public.project_approval_questions; a public.project_approval_answers;
begin
 if not exists(select 1 from public.staff where user_id=auth.uid() and active and role='owner') then raise exception 'Owner access required'; end if;
 if p_id is null or p_version is null or p_answer is null or length(trim(p_answer)) not between 1 and 4000 then raise exception 'Enter an answer of 1–4000 characters'; end if;
 select * into q from public.project_approval_questions where id=p_question_id for update;
 if not found then raise exception 'Question unavailable'; end if;
 select * into a from public.project_approval_answers where id=p_id;
 if found then
  if a.answered_by=auth.uid() and a.question_id=p_question_id and a.question_version=p_version and a.answer=trim(p_answer) then return a; end if;
  raise exception 'Request identifier already used';
 end if;
 if q.version<>p_version then raise exception 'Another answer was saved. Refresh and review it before answering again'; end if;
 insert into public.project_approval_answers(id,question_id,question_version,answer,answered_by) values(p_id,p_question_id,p_version,trim(p_answer),auth.uid()) returning * into a;
 update public.project_approval_questions set version=version+1 where id=q.id;
 return a;
end $$;
revoke all on function public.record_project_approval(uuid,text,integer,text) from public,anon;
grant execute on function public.record_project_approval(uuid,text,integer,text) to authenticated;
create function public.protect_project_approval_answers() returns trigger language plpgsql as $$
begin raise exception 'Decision history is immutable; record a new answer'; end $$;
create trigger immutable_project_approval_answers before update or delete on public.project_approval_answers for each row execute function public.protect_project_approval_answers();
commit;
