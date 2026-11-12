-- Lower default AI budgets (cost-conscious defaults).
-- Existing settings rows are only changed if they still hold the original defaults.
alter table app_settings alter column monthly_cost_limit_usd set default 3;
alter table app_settings alter column monthly_question_limit set default 250;
alter table app_settings alter column max_api_calls_per_job set default 60;

update app_settings set monthly_cost_limit_usd = 3 where monthly_cost_limit_usd = 25;
update app_settings set monthly_question_limit = 250 where monthly_question_limit = 300;
update app_settings set max_api_calls_per_job = 60 where max_api_calls_per_job = 80;

insert into app_migrations (name) values ('20261112000000_lower_cost_defaults') on conflict do nothing;
