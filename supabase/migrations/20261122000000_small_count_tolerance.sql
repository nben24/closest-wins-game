-- Fairer scoring for small-count questions (mirrors fairTolerance() in src/lib/scoring.ts).
--
-- In live play, "absolute" questions (small counts like Oscars won or countries
-- bordering Germany) averaged 224 points out of 1000, far below every other
-- type: a decent guess like 8 for 11 earned almost nothing. New and unplayed
-- small-count questions now give half points within a quarter of the answer
-- (never tighter than 1.5).
--
-- Only questions that have never been published are touched. Published games
-- keep the exact scoring their players were judged on (the snapshot in
-- challenge_questions is never changed).

update questions q
   set tolerance = greatest(q.tolerance, 1.5, round((abs(q.answer) * 0.25)::numeric, 1)::double precision),
       updated_at = now()
 where q.scoring_type = 'absolute'
   and abs(q.answer) <= 30
   and q.tolerance < greatest(1.5, round((abs(q.answer) * 0.25)::numeric, 1)::double precision)
   and not exists (select 1 from challenge_questions cq join daily_challenges dc on dc.id = cq.challenge_id
                    where cq.question_id = q.id and dc.status = 'published');

insert into app_migrations (name) values ('20261122000000_small_count_tolerance') on conflict do nothing;
