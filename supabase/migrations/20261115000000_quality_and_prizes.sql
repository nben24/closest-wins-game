-- Question quality + relaxed auto-approval + weekly prize codes.
--
-- 1. app_settings.approval_mode: 'strict' (source page must confirm the number)
--    or 'relaxed' (AI research found a source AND an independent AI double-check agrees).
-- 2. prize_codes: a private claim code for each weekly top-3 finisher.
-- 3. Fairer tolerances for questions that have not been played yet (published
--    snapshots are immutable and are never touched).
-- 4. Slightly higher default limits for bigger batches.

alter table app_settings add column if not exists approval_mode text not null default 'strict'
  check (approval_mode in ('strict', 'relaxed'));

create table if not exists prize_codes (
  week_start date not null,
  player_id uuid not null references players (id) on delete cascade,
  rank int not null check (rank between 1 and 3),
  code text not null unique,
  created_at timestamptz not null default now(),
  primary key (week_start, player_id)
);

-- Same lockdown as every other table: no direct access from browsers.
alter table prize_codes enable row level security;
revoke all on table prize_codes from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on table prize_codes from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on table prize_codes from authenticated';
  end if;
end $$;

-- Fairer tolerances (mirrors fairTolerance() in src/lib/scoring.ts) for every
-- question not yet in a published challenge.
update questions q set tolerance = greatest(q.tolerance,
    case q.difficulty when 'easy' then 1.35 when 'medium' then 1.5 else 1.8 end)
 where q.scoring_type = 'ratio'
   and not exists (select 1 from challenge_questions cq join daily_challenges dc on dc.id = cq.challenge_id
                    where cq.question_id = q.id and dc.status = 'published');

update questions q set tolerance = greatest(q.tolerance,
    least(25, greatest(3, round((extract(year from now())::int - q.answer) / 8.0))))
 where q.scoring_type = 'year'
   and not exists (select 1 from challenge_questions cq join daily_challenges dc on dc.id = cq.challenge_id
                    where cq.question_id = q.id and dc.status = 'published');

update questions q set tolerance = greatest(q.tolerance, 6)
 where q.scoring_type = 'percent'
   and not exists (select 1 from challenge_questions cq join daily_challenges dc on dc.id = cq.challenge_id
                    where cq.question_id = q.id and dc.status = 'published');

-- Bigger batches and a little more budget headroom (only if still on the old defaults).
alter table app_settings alter column max_questions_per_job set default 50;
alter table app_settings alter column monthly_cost_limit_usd set default 5;
alter table app_settings alter column max_api_calls_per_job set default 150;
update app_settings set max_questions_per_job = 50 where max_questions_per_job = 20;
update app_settings set monthly_cost_limit_usd = 5 where monthly_cost_limit_usd = 3;
update app_settings set max_api_calls_per_job = 150 where max_api_calls_per_job = 60;

insert into app_migrations (name) values ('20261115000000_quality_and_prizes') on conflict do nothing;
