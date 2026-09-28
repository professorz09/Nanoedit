-- ═══════════════════════════════════════════════════════════════════════════
-- Shorts Maker (components/ShortsMaker.tsx).
--
-- A project = one YouTube link; its clips = the Short-worthy moments found in
-- it. Both are read and written ONLY by the render server (Movievideomaker's
-- shortsbot/web.py) with the service role — the browser never touches these
-- tables directly (RLS on, no policies), it goes through that server's API,
-- which checks the user's Supabase login and charges credits with the
-- existing spend_credit()/refund_credit() (1 credit per Short, charged the
-- first time it's downloaded).
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.shorts_projects (
  id            bigserial primary key,
  user_id       uuid not null references public.profiles(id) on delete cascade,
  url           text not null,
  video_id      text,
  title         text,
  thumb         text,
  duration      double precision,
  length        text,
  subtitles     text,
  style         text,
  instructions  text,
  status        text not null,            -- finding | ready | failed
  error         text,
  created_at    double precision not null default extract(epoch from now())
);
create index if not exists shorts_projects_user_idx on public.shorts_projects(user_id, created_at);

create table if not exists public.shorts_clips (
  id           bigserial primary key,
  project_id   bigint not null references public.shorts_projects(id) on delete cascade,
  idx          integer not null,
  start_sec    double precision not null,
  end_sec      double precision not null,
  orig_start   double precision not null,
  orig_end     double precision not null,
  title        text,
  title_lines  text,
  description  text,
  score        integer,
  reason       text,
  speaker      text,
  status       text not null default 'idle',   -- idle | queued | rendering | ready | failed
  stage        text,
  file         text,
  file_start   double precision,
  file_end     double precision,
  rendered_at  double precision,
  charged      boolean not null default false,
  renders      integer not null default 0,
  error        text,
  job_id       bigint
);
create index if not exists shorts_clips_project_idx on public.shorts_clips(project_id, idx);
create index if not exists shorts_clips_status_idx on public.shorts_clips(status);

alter table public.shorts_projects enable row level security;
alter table public.shorts_clips    enable row level security;
revoke all on public.shorts_projects from anon, authenticated;
revoke all on public.shorts_clips    from anon, authenticated;
revoke all on sequence public.shorts_projects_id_seq from anon, authenticated;
revoke all on sequence public.shorts_clips_id_seq    from anon, authenticated;
