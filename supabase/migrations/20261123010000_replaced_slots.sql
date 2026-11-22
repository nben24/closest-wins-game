-- Remember which question a scheduled slot replaced, so the admin schedule can
-- show "replaced" with the old question instead of a vague "will be replaced".
-- Not part of the published snapshot (the immutability guard ignores these).

alter table challenge_questions add column if not exists replaced_question_id uuid references questions (id);
alter table challenge_questions add column if not exists replaced_at timestamptz;

insert into app_migrations (name) values ('20261123010000_replaced_slots') on conflict do nothing;
