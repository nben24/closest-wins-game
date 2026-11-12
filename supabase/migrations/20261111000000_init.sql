-- Closest Wins — initial schema.
--
-- Security model
--   * The browser never reads or writes these tables directly. All game,
--     group and admin operations go through Next.js server routes, which
--     connect with a privileged database role (DATABASE_URL) and enforce
--     identity, ownership, membership and admin checks in code.
--   * Row-level security is enabled on every table with NO policies, and all
--     privileges are revoked from the Supabase `anon` and `authenticated`
--     roles. A leaked publishable/anon key therefore cannot read answers,
--     unpublished questions, scores or memberships through the Data API.
--   * Integrity rules that must hold regardless of application bugs live here:
--     unique attempts/rounds, immutable published challenges, finalized rounds
--     that cannot be rescored, approved questions that must carry sources.
--
-- This file records itself in app_migrations, so it can be applied with
-- `npm run db:migrate`, the Supabase SQL editor, or `supabase db push`.

create table if not exists app_migrations (
  name text primary key,
  applied_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Settings (single row)

create table app_settings (
  id boolean primary key default true check (id),
  auto_generate boolean not null default false,
  auto_approve boolean not null default false,
  auto_schedule boolean not null default false,
  inventory_threshold_days int not null default 14 check (inventory_threshold_days between 1 and 180),
  schedule_ahead_days int not null default 14 check (schedule_ahead_days between 1 and 60),
  max_questions_per_job int not null default 20 check (max_questions_per_job between 1 and 100),
  monthly_question_limit int not null default 300 check (monthly_question_limit between 0 and 5000),
  monthly_cost_limit_usd numeric(10, 2) not null default 25 check (monthly_cost_limit_usd >= 0),
  max_api_calls_per_job int not null default 80 check (max_api_calls_per_job between 1 and 1000),
  max_retries_per_candidate int not null default 1 check (max_retries_per_candidate between 0 and 5),
  max_output_tokens_per_call int not null default 16000 check (max_output_tokens_per_call between 1000 and 64000),
  updated_at timestamptz not null default now(),
  updated_by text
);
insert into app_settings default values on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Identity

create table players (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null unique,
  avatar_id text not null check (char_length(avatar_id) <= 32),
  name_adjective text not null check (char_length(name_adjective) <= 32),
  name_noun text not null check (char_length(name_noun) <= 32),
  name_suffix int check (name_suffix is null or name_suffix between 2 and 99),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create unique index players_nickname_unique
  on players (name_adjective, name_noun, coalesce(name_suffix, 0));

create table admins (
  auth_user_id uuid primary key,
  email text,
  granted_by text,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Question bank

create table questions (
  id uuid primary key default gen_random_uuid(),
  prompt text not null check (char_length(prompt) between 10 and 300),
  answer double precision not null,
  unit text not null default '' check (char_length(unit) <= 40),
  category text not null check (category in (
    'everyday', 'food', 'animals', 'entertainment', 'geography', 'products', 'sports', 'science'
  )),
  difficulty text not null check (difficulty in ('easy', 'medium', 'hard')),
  scoring_type text not null check (scoring_type in ('ratio', 'absolute', 'year', 'percent')),
  tolerance double precision not null check (tolerance > 0),
  allow_decimal boolean not null default true,
  allow_negative boolean not null default false,
  explanation text not null default '' check (char_length(explanation) <= 600),
  source_url text check (source_url is null or source_url ~ '^https?://'),
  source_title text,
  source_excerpt text check (source_excerpt is null or char_length(source_excerpt) <= 2000),
  reference_period text,
  subject_key text not null default '',
  normalized_prompt text not null,
  status text not null default 'draft'
    check (status in ('draft', 'review', 'approved', 'rejected', 'archived')),
  verification_status text not null default 'unverified'
    check (verification_status in ('unverified', 'auto_passed', 'needs_review', 'failed', 'admin_verified')),
  verification_notes jsonb not null default '[]'::jsonb,
  verified_at timestamptz,
  provenance text not null check (provenance in ('ai', 'manual', 'demo')),
  is_demo boolean not null default false,
  generation_job_id uuid,
  candidate_id uuid,
  review_notes text,
  approved_at timestamptz,
  approved_by text,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint questions_demo_flag check (is_demo = (provenance = 'demo')),
  -- Production content can only be approved with a source, supporting
  -- evidence and a verification timestamp. Demo content is exempt but is never
  -- eligible for scheduling in production (enforced by the application).
  constraint questions_approved_needs_source check (
    status <> 'approved' or is_demo or (
      coalesce(char_length(source_url), 0) > 0
      and coalesce(char_length(source_title), 0) > 0
      and coalesce(char_length(source_excerpt), 0) > 0
      and verified_at is not null
    )
  )
);
create unique index questions_live_prompt_unique
  on questions (normalized_prompt) where status in ('draft', 'review', 'approved');
create index questions_status_idx on questions (status, category, difficulty);

-- ---------------------------------------------------------------------------
-- Daily challenges

create table daily_challenges (
  id uuid primary key default gen_random_uuid(),
  challenge_date date not null unique,
  number int not null,
  status text not null default 'scheduled' check (status in ('scheduled', 'published')),
  is_demo boolean not null default false,
  source text not null default 'manual' check (source in ('manual', 'auto', 'reserve')),
  published_at timestamptz,
  created_by text,
  created_at timestamptz not null default now()
);

create table challenge_questions (
  challenge_id uuid not null references daily_challenges (id) on delete cascade,
  position smallint not null check (position between 1 and 5),
  question_id uuid not null references questions (id),
  -- Snapshot taken at publish time. Everyone is judged on exactly this.
  prompt text,
  answer double precision,
  unit text,
  category text,
  difficulty text,
  scoring_type text,
  tolerance double precision,
  allow_decimal boolean,
  allow_negative boolean,
  explanation text,
  source_url text,
  source_title text,
  reference_period text,
  -- Audited corrections: a voided question scores 0 for everyone and is
  -- excluded from totals.
  voided boolean not null default false,
  voided_reason text,
  voided_at timestamptz,
  voided_by text,
  primary key (challenge_id, position),
  unique (challenge_id, question_id)
);
create index challenge_questions_question_idx on challenge_questions (question_id);

create or replace function guard_challenge_questions() returns trigger
language plpgsql as $$
declare
  st text;
  q_status text;
begin
  select status into st from daily_challenges
    where id = coalesce(new.challenge_id, old.challenge_id);

  if tg_op = 'INSERT' then
    if st = 'published' then
      raise exception 'challenge is published and immutable' using errcode = 'P0001';
    end if;
    select status into q_status from questions where id = new.question_id;
    if q_status is distinct from 'approved' then
      raise exception 'only approved questions can be scheduled' using errcode = 'P0001';
    end if;
    return new;
  elsif tg_op = 'DELETE' then
    if st = 'published' then
      raise exception 'challenge is published and immutable' using errcode = 'P0001';
    end if;
    return old;
  else
    if st = 'published' then
      if (new.challenge_id, new.position, new.question_id, new.prompt, new.answer, new.unit,
          new.scoring_type, new.tolerance, new.allow_decimal, new.allow_negative,
          new.explanation, new.source_url, new.source_title, new.reference_period,
          new.category, new.difficulty)
         is distinct from
         (old.challenge_id, old.position, old.question_id, old.prompt, old.answer, old.unit,
          old.scoring_type, old.tolerance, old.allow_decimal, old.allow_negative,
          old.explanation, old.source_url, old.source_title, old.reference_period,
          old.category, old.difficulty) then
        raise exception 'published challenge questions are immutable (void instead)' using errcode = 'P0001';
      end if;
      if old.voided and not new.voided then
        raise exception 'a voided question cannot be restored' using errcode = 'P0001';
      end if;
    elsif new.question_id is distinct from old.question_id then
      select status into q_status from questions where id = new.question_id;
      if q_status is distinct from 'approved' then
        raise exception 'only approved questions can be scheduled' using errcode = 'P0001';
      end if;
    end if;
    return new;
  end if;
end $$;

create trigger challenge_questions_guard
  before insert or update or delete on challenge_questions
  for each row execute function guard_challenge_questions();

create or replace function guard_daily_challenges() returns trigger
language plpgsql as $$
declare
  snap_count int;
begin
  if tg_op = 'DELETE' then
    if old.status = 'published' then
      raise exception 'published challenges cannot be deleted' using errcode = 'P0001';
    end if;
    return old;
  end if;
  if old.status = 'published' then
    if (new.challenge_date, new.number, new.status, new.published_at, new.is_demo)
       is distinct from (old.challenge_date, old.number, old.status, old.published_at, old.is_demo) then
      raise exception 'published challenges are immutable' using errcode = 'P0001';
    end if;
  elsif new.status = 'published' then
    select count(*) into snap_count from challenge_questions
      where challenge_id = new.id and prompt is not null and answer is not null
        and scoring_type is not null and tolerance is not null;
    if snap_count <> 5 then
      raise exception 'a challenge needs 5 snapshotted questions to publish' using errcode = 'P0001';
    end if;
    if new.published_at is null then
      new.published_at := now();
    end if;
  end if;
  return new;
end $$;

create trigger daily_challenges_guard
  before update or delete on daily_challenges
  for each row execute function guard_daily_challenges();

-- ---------------------------------------------------------------------------
-- Play

create table attempts (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references players (id) on delete cascade,
  challenge_id uuid not null references daily_challenges (id),
  status text not null default 'in_progress' check (status in ('in_progress', 'completed')),
  total_score int not null default 0 check (total_score between 0 and 5000),
  rounds_finished smallint not null default 0 check (rounds_finished between 0 and 5),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (player_id, challenge_id),
  check ((status = 'completed') = (completed_at is not null))
);
create index attempts_challenge_idx on attempts (challenge_id, status);

create table rounds (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references attempts (id) on delete cascade,
  position smallint not null check (position between 1 and 5),
  reading_started_at timestamptz not null,
  answer_opens_at timestamptz not null,
  deadline_at timestamptz not null,
  status text not null default 'open' check (status in ('open', 'answered', 'no_answer', 'timed_out')),
  raw_input text check (raw_input is null or char_length(raw_input) <= 40),
  guess double precision,
  score int check (score between 0 and 1000),
  submitted_at timestamptz,
  finalized_at timestamptz,
  submission_id text check (submission_id is null or char_length(submission_id) <= 64),
  unique (attempt_id, position),
  check (answer_opens_at > reading_started_at and deadline_at > answer_opens_at),
  check ((status = 'open') = (finalized_at is null)),
  check (status = 'open' or score is not null),
  check (status <> 'answered' or guess is not null)
);

create or replace function guard_rounds() returns trigger
language plpgsql as $$
begin
  if tg_op = 'UPDATE' and old.status <> 'open' then
    if (new.status, new.guess, new.score, new.submitted_at, new.finalized_at, new.raw_input)
       is distinct from (old.status, old.guess, old.score, old.submitted_at, old.finalized_at, old.raw_input) then
      raise exception 'a finalized round cannot be changed' using errcode = 'P0001';
    end if;
  end if;
  if tg_op = 'UPDATE' and (new.reading_started_at, new.answer_opens_at, new.deadline_at, new.position, new.attempt_id)
     is distinct from (old.reading_started_at, old.answer_opens_at, old.deadline_at, old.position, old.attempt_id) then
    raise exception 'round timing cannot be changed' using errcode = 'P0001';
  end if;
  return new;
end $$;

create trigger rounds_guard before update on rounds
  for each row execute function guard_rounds();

-- ---------------------------------------------------------------------------
-- Groups

create table groups (
  id uuid primary key default gen_random_uuid(),
  label_adjective text not null check (char_length(label_adjective) <= 32),
  label_noun text not null check (char_length(label_noun) <= 32),
  owner_player_id uuid not null references players (id) on delete cascade,
  invite_code text not null unique check (invite_code ~ '^[A-Z0-9]{8}$'),
  invite_rotated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table group_members (
  group_id uuid not null references groups (id) on delete cascade,
  player_id uuid not null references players (id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  joined_at timestamptz not null default now(),
  primary key (group_id, player_id)
);
create index group_members_player_idx on group_members (player_id);

-- ---------------------------------------------------------------------------
-- AI generation

create table generation_jobs (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'queued'
    check (status in ('queued', 'running', 'paused', 'completed', 'failed', 'cancelled')),
  trigger text not null default 'manual' check (trigger in ('manual', 'auto')),
  requested_by text,
  params jsonb not null,
  target_count int not null check (target_count between 1 and 100),
  proposed_count int not null default 0,
  accepted_count int not null default 0,
  held_count int not null default 0,
  rejected_count int not null default 0,
  api_calls int not null default 0,
  input_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  web_searches int not null default 0,
  estimated_cost_usd numeric(12, 4) not null default 0,
  progress_note text,
  error text,
  lease_owner text,
  lease_until timestamptz,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  updated_at timestamptz not null default now()
);
create index generation_jobs_status_idx on generation_jobs (status, created_at);

create table generation_candidates (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references generation_jobs (id) on delete cascade,
  batch_index int not null,
  status text not null default 'proposed'
    check (status in ('proposed', 'accepted', 'held', 'rejected', 'failed')),
  attempts int not null default 0,
  proposal jsonb not null,
  research jsonb,
  checks jsonb not null default '[]'::jsonb,
  reasons jsonb not null default '[]'::jsonb,
  normalized_prompt text not null,
  question_id uuid references questions (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index generation_candidates_job_idx on generation_candidates (job_id, status);

create table ai_usage (
  id uuid primary key default gen_random_uuid(),
  job_id uuid references generation_jobs (id) on delete set null,
  candidate_id uuid,
  purpose text not null,
  model text not null,
  input_tokens int not null default 0,
  output_tokens int not null default 0,
  cache_read_tokens int not null default 0,
  web_searches int not null default 0,
  estimated_cost_usd numeric(12, 4) not null default 0,
  ok boolean not null default true,
  error text,
  created_at timestamptz not null default now()
);
create index ai_usage_created_idx on ai_usage (created_at);

-- ---------------------------------------------------------------------------
-- Operations

create table admin_notifications (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  severity text not null default 'info' check (severity in ('info', 'warning', 'error')),
  message text not null,
  dedupe_key text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
create unique index admin_notifications_open_dedupe
  on admin_notifications (dedupe_key) where resolved_at is null and dedupe_key is not null;

create table audit_log (
  id bigserial primary key,
  actor text not null,
  action text not null,
  entity_type text not null,
  entity_id text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index audit_log_entity_idx on audit_log (entity_type, entity_id);

create table rate_limits (
  bucket text not null,
  window_start timestamptz not null,
  count int not null default 0,
  primary key (bucket, window_start)
);

-- ---------------------------------------------------------------------------
-- Lock down: RLS on, no policies, no privileges for browser-facing roles.

do $$
declare
  t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t.tablename);
    execute format('revoke all on table public.%I from public', t.tablename);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all on table public.%I from anon', t.tablename);
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
      execute format('revoke all on table public.%I from authenticated', t.tablename);
    end if;
  end loop;
  revoke execute on function guard_challenge_questions(), guard_daily_challenges(), guard_rounds() from public;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on all sequences in schema public from anon';
    -- Tables created later by this role are not exposed by default either.
    execute 'alter default privileges in schema public revoke all on tables from anon';
    execute 'alter default privileges in schema public revoke all on functions from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on all sequences in schema public from authenticated';
    execute 'alter default privileges in schema public revoke all on tables from authenticated';
    execute 'alter default privileges in schema public revoke all on functions from authenticated';
  end if;
end $$;

insert into app_migrations (name) values ('20261111000000_init') on conflict do nothing;
