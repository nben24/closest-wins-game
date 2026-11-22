-- Player feedback on questions, given from the results screen after finishing a day:
--  - reaction: 1 = fun (thumbs up), -1 = not fun (thumbs down), null = none
--  - report: optional short note that something is wrong ("the answer is outdated")
-- One row per player per question. Only the admin ever sees it; it feeds the
-- question generator's "what players enjoyed" examples. No new personal data:
-- rows hang off the existing anonymous player.

create table if not exists question_feedback (
  player_id uuid not null references players (id) on delete cascade,
  challenge_id uuid not null references daily_challenges (id) on delete cascade,
  position smallint not null check (position between 1 and 5),
  reaction smallint check (reaction is null or reaction in (-1, 1)),
  report text check (report is null or char_length(report) between 1 and 300),
  reported_at timestamptz,
  report_resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (player_id, challenge_id, position),
  check ((report is null) = (reported_at is null))
);
create index if not exists question_feedback_challenge_idx on question_feedback (challenge_id, position);
create index if not exists question_feedback_open_reports_idx on question_feedback (reported_at)
  where report is not null and report_resolved_at is null;

-- Same lockdown as every other table: no direct access from browsers.
alter table question_feedback enable row level security;
revoke all on table question_feedback from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on table question_feedback from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on table question_feedback from authenticated';
  end if;
end $$;

insert into app_migrations (name) values ('20261123000000_question_feedback') on conflict do nothing;
